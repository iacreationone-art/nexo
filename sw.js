// Service worker do Nexo: permite instalar o site como app e abrir a tela mesmo sem internet.
// Ao mudar arquivos do app, aumente a versão: o celular baixa tudo de novo de uma vez.
const CACHE = 'nexo-v22'
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/cripto.js',
  'js/emoji.js',
  'js/figurinhas.js',
  'js/salvas.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/badge-96.png',
  'icons/vazio-96.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

// Apaga só as versões antigas do app (o cache "nexo-arquivos", de fotos cifradas, fica).
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nexo-v') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// O app abre na hora com a cópia guardada e, ao mesmo tempo, busca a versão nova
// para a próxima abertura. Sem cópia (primeira vez), vai direto à rede.
// O jsdelivr tem versão fixa no endereço, então a cópia nunca fica velha.
// Chamadas ao Supabase nunca passam pelo cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  const cdn = url.hostname === 'cdn.jsdelivr.net'
  if (e.request.method !== 'GET' || (url.origin !== self.location.origin && !cdn)) return

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true })
      if (hit && cdn) return hit
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(url.origin + url.pathname, res.clone())
        return res
      })
      if (!hit) return fresh.catch(() => Response.error())
      e.waitUntil(fresh.catch(() => {}))
      return hit
    })
  )
})

// Mensagem cifrada: abre com a chave da conversa guardada neste aparelho (mesmo formato de js/cripto.js).
// Sem a chave aqui, a notificação fica com o texto genérico que veio da Edge Function.
function localKey(id) {
  return new Promise((resolve) => {
    const req = indexedDB.open('nexo-chaves', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('chaves')
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      const get = req.result.transaction('chaves').objectStore('chaves').get('key:' + id)
      get.onsuccess = () => resolve(get.result || null)
      get.onerror = () => resolve(null)
    }
  })
}

async function openPushText(data) {
  if (!data.ciphertext || !data.key_id) return null
  try {
    const key = await localKey(data.key_id)
    if (!key) return null
    const bytes = Uint8Array.from(atob(data.ciphertext.slice(3)), (c) => c.charCodeAt(0))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(data.conversation_id) },
      key,
      bytes.subarray(12),
    )
    const p = JSON.parse(new TextDecoder().decode(plain))
    if (p.f) return '🎭 Figurinha'
    if (p.n) return (p.y || '').startsWith('image/') ? '📷 Foto' : '📎 ' + p.n
    if (/^:fig:[a-z-]+:$/.test(p.t.trim())) return '🎭 Figurinha'
    return p.t.length > 200 ? p.t.slice(0, 200) + '…' : p.t
  } catch {
    return null
  }
}

// Push vindo da Edge Function send-push (funciona com o app fechado).
self.addEventListener('push', (e) => {
  let data = {}
  try {
    data = e.data ? e.data.json() : {}
  } catch {
    data = { body: e.data?.text() }
  }

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // Se o app está aberto e na frente, a mensagem já aparece na tela.
      if (clients.some((c) => c.visibilityState === 'visible' && c.focused)) return
      const body = (await openPushText(data)) || data.body
      return self.registration.showNotification(data.title || 'Nexo', {
        body: body || 'Nova mensagem',
        tag: data.conversation_id,
        renotify: true,
        icon: 'icons/vazio-96.png', // transparente: sem ele o Chrome põe um ícone cinza com "i" à direita
        badge: 'icons/badge-96.png', // só a silhueta branca: o Android pinta o resto
        data: { conversation_id: data.conversation_id },
      })
    })
  )
})

// Clicar na notificação abre (ou foca) o app na conversa certa.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const conv = e.notification.data?.conversation_id
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients[0]
      if (client) {
        client.postMessage({ open: conv })
        return client.focus()
      }
      return self.clients.openWindow(conv ? './?c=' + conv : './')
    })
  )
})
