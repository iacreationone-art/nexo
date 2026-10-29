// Criptografia de ponta a ponta do Nexo (só usa o WebCrypto do próprio navegador).
//
// - Cada pessoa: par de chaves ECDH P-256. A privada fica no aparelho (IndexedDB, sem poder
//   ser exportada) e uma cópia vai para o banco trancada com a senha de recuperação.
// - Cada conversa: uma chave AES-256-GCM, embrulhada para cada participante com uma chave
//   derivada do ECDH entre quem embrulha e quem recebe.
// - Mensagem: "e1:" + base64(iv + texto cifrado), presa à conversa (AAD = id da conversa).
// O service worker (sw.js) repete a parte de abrir mensagens para mostrar as notificações.

const enc = new TextEncoder()
const dec = new TextDecoder()
const subtle = crypto.subtle
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
export const ITERATIONS = 600000

// ---------- Base64 ----------

export function toB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode(...arr.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function join(a, b) {
  const out = new Uint8Array(a.length + b.byteLength)
  out.set(a)
  out.set(new Uint8Array(b), a.length)
  return out
}

// ---------- Guardado no aparelho (IndexedDB) ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('nexo-chaves', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('chaves')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction('chaves', mode)
    const req = fn(tx.objectStore('chaves'))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
  })
}

export const localGet = (key) => idb('readonly', (s) => s.get(key))
export const localSet = (key, value) => idb('readwrite', (s) => s.put(value, key))
export const localClear = () => idb('readwrite', (s) => s.clear())

// ---------- Minhas chaves ----------

async function passwordKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// Cria o par de chaves e a cópia trancada com a senha.
export async function createIdentity(password) {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits'])
  const publicJwk = await subtle.exportKey('jwk', pair.publicKey)
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const lock = await passwordKey(password, salt, ITERATIONS)
  const backup = join(iv, await subtle.encrypt({ name: 'AES-GCM', iv }, lock, pkcs8))

  // No aparelho a chave privada fica sem poder ser exportada.
  const privateKey = await subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits'])
  return {
    publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    privateKey,
    backup: toB64(backup),
    salt: toB64(salt),
    iterations: ITERATIONS,
  }
}

// Abre a cópia com a senha. Senha errada: lança erro.
export async function restoreIdentity(password, { private_backup, salt, iterations }) {
  const data = fromB64(private_backup)
  const lock = await passwordKey(password, fromB64(salt), iterations)
  const pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, lock, data.subarray(12))
  return subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits'])
}

export function sameKey(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y
}

// ---------- Chave da conversa ----------

// Chave para embrulhar entre duas pessoas (ECDH + HKDF), presa à conversa.
async function wrapKey(myPrivate, theirJwk, convId) {
  const theirs = await subtle.importKey('jwk', theirJwk, ECDH, false, [])
  const bits = await subtle.deriveBits({ name: 'ECDH', public: theirs }, myPrivate, 256)
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(convId), info: enc.encode('nexo-chave-conversa') },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function newConversationKey() {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function wrapConversationKey(raw, myPrivate, theirJwk, convId) {
  const key = await wrapKey(myPrivate, theirJwk, convId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return toB64(join(iv, await subtle.encrypt({ name: 'AES-GCM', iv }, key, raw)))
}

export async function unwrapConversationKey(wrapped, myPrivate, wrapperJwk, convId) {
  const key = await wrapKey(myPrivate, wrapperJwk, convId)
  const data = fromB64(wrapped)
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12) }, key, data.subarray(12)))
}

export function importConversationKey(raw) {
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

// ---------- Mensagens e arquivos ----------

const aad = (convId) => enc.encode(convId)

// payload: { t: texto } ou { n: nome do arquivo }
export async function encryptMessage(key, convId, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(convId) }, key, enc.encode(JSON.stringify(payload)))
  return 'e1:' + toB64(join(iv, data))
}

export async function decryptMessage(key, convId, ciphertext) {
  const data = fromB64(ciphertext.slice(3))
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: aad(convId) }, key, data.subarray(12))
  return JSON.parse(dec.decode(plain))
}

export async function encryptFile(key, convId, file) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(convId) }, key, await file.arrayBuffer())
  return new Blob([iv, data], { type: 'application/octet-stream' })
}

export async function decryptFile(key, convId, buffer) {
  const data = new Uint8Array(buffer)
  return subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: aad(convId) }, key, data.subarray(12))
}
