// Imagens salvas ("minhas figurinhas"): ficam só neste aparelho, no IndexedDB, separadas por conta.
// Não vão para o servidor; quando a pessoa envia uma, ela sai cifrada como qualquer foto.

// Animações para os recortes: nome que vai na mensagem → classe do CSS (reaproveita as dos emojis).
export const CUT_ANIMS = [
  ['', 'Parado'],
  ['pula', 'Pulando'],
  ['balanca', 'Balançando'],
  ['treme', 'Tremendo'],
  ['coracao', 'Coração batendo'],
  ['gira', 'Girando'],
  ['flutua', 'Flutuando'],
]
const ANIM_CLASS = { pula: 'em-jump', balanca: 'cut-balanca', treme: 'em-angry', coracao: 'em-beat', gira: 'em-spin', flutua: 'em-bob' }
export const cutAnimClass = (a) => (ANIM_CLASS[a] ? 'cut-anim ' + ANIM_CLASS[a] : '')
export const validAnim = (a) => (ANIM_CLASS[a] ? a : '')

const ANIM_KEY = 'nexo-animacao-recorte'
export function loadAnim() {
  try {
    return validAnim(localStorage.getItem(ANIM_KEY))
  } catch {
    return ''
  }
}
export function saveAnim(a) {
  try { localStorage.setItem(ANIM_KEY, a) } catch {}
}

const DB = 'nexo-salvas'
const STORE = 'imagens'
export const MAX_SAVED = 80
export const MAX_SAVED_SIZE = 8 * 1024 * 1024

let dbPromise = null
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('owner', 'owner')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

function run(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const out = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(out?.result ?? out)
    tx.onerror = () => reject(tx.error)
  }))
}

// Mais recentes primeiro.
export async function listSaved(owner) {
  const all = await run('readonly', (s) => s.index('owner').getAll(owner))
  return all.sort((a, b) => b.at - a.at)
}

// extra.cutout: imagem recortada (fundo transparente), que vai como figurinha.
// extra.anim: animação própria (recorte animado recebido); sem ela, vale a escolhida no painel.
export async function addSaved(owner, blob, name, extra = {}) {
  if (blob.size > MAX_SAVED_SIZE) throw new Error('imagem grande demais (máximo 8 MB)')
  const list = await listSaved(owner)
  if (list.length >= MAX_SAVED) throw new Error(`você já tem ${MAX_SAVED} imagens salvas; apague alguma antes`)
  // A mesma imagem não entra duas vezes.
  if (list.some((x) => x.size === blob.size && x.name === name)) return false
  const item = { id: crypto.randomUUID(), owner, blob, name: name || 'imagem', type: blob.type, size: blob.size, at: Date.now(), cutout: !!extra.cutout, anim: validAnim(extra.anim) }
  await run('readwrite', (s) => s.put(item))
  return true
}

export function removeSaved(id) {
  return run('readwrite', (s) => s.delete(id))
}

export function getSaved(id) {
  return run('readonly', (s) => s.get(id))
}
