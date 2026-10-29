// Service worker do Nexo: permite instalar o site como app e abrir a tela mesmo sem internet.
// Ao mudar arquivos do app, aumente a versão para forçar a atualização do cache.
const CACHE = 'nexo-v7'
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Rede primeiro (sempre a versão mais nova); cache só quando estiver offline.
// Chamadas ao Supabase nunca passam pelo cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  const cacheable =
    e.request.method === 'GET' &&
    (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net')
  if (!cacheable) return

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
        }
        return res
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  )
})

// Push vindo da Edge Function send-push (funciona com o app fechado).
self.addEventListener('push', (e) => {
  let data = {}
  try {
    data = e.data ? e.data.json() : {}
  } catch {
    data = { body: e.data?.text() }
  }

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Se o app está aberto e na frente, a mensagem já aparece na tela.
      if (clients.some((c) => c.visibilityState === 'visible' && c.focused)) return
      return self.registration.showNotification(data.title || 'Nexo', {
        body: data.body || 'Nova mensagem',
        tag: data.conversation_id,
        renotify: true,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
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
