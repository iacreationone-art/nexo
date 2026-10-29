import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

const $ = (id) => document.getElementById(id)
const configured = !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('SUA_ANON_KEY')
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

const state = {
  user: null,
  profile: null,
  conversations: [],
  current: null,      // conversa aberta (linha de my_conversations)
  msgs: [],           // mensagens da conversa aberta
  online: new Set(),  // ids de quem está com o app aberto
  typingUntil: 0,
  dbChannel: null,
  presence: null,
  typingChannel: null,
  lastTypingSent: 0,
  pendingOpen: new URLSearchParams(location.search).get('c'),
}
let tmpSeq = 0
let listTimer = null

// ---------- Utilidades ----------

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function hue(id) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

function avatar(node, name, id, url) {
  node.replaceChildren()
  node.style.background = `hsl(${hue(id || '')} 55% 50%)`
  if (url) {
    const img = el('img')
    img.src = url
    img.alt = ''
    node.append(img)
  } else {
    node.textContent = (name || '?').trim().charAt(0)
  }
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const longDateFmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

function dayDiff(date) {
  const a = new Date(date); a.setHours(0, 0, 0, 0)
  const b = new Date(); b.setHours(0, 0, 0, 0)
  return Math.round((b - a) / 86400000)
}

function listTime(iso) {
  const d = new Date(iso)
  const diff = dayDiff(d)
  if (diff === 0) return timeFmt.format(d)
  if (diff === 1) return 'Ontem'
  return dateFmt.format(d)
}

function dayLabel(iso) {
  const diff = dayDiff(iso)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return longDateFmt.format(new Date(iso))
}

function setMsg(node, text, isError = false) {
  node.textContent = text || ''
  node.classList.toggle('error', isError)
}

function show(screen) {
  $('splash').hidden = true
  $('login').hidden = screen !== 'login'
  $('app').hidden = screen !== 'app'
}

// ---------- Login ----------

$('email-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = $('email-input').value.trim().toLowerCase()
  const btn = e.submitter
  btn.disabled = true
  setMsg($('login-msg'), 'Enviando…')
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  })
  btn.disabled = false
  if (error) return setMsg($('login-msg'), error.message, true)
  $('email-sent').textContent = email
  $('email-form').hidden = true
  $('code-form').hidden = false
  $('code-input').focus()
  setMsg($('login-msg'), 'Confira sua caixa de entrada (e o spam).')
})

$('code-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.submitter
  btn.disabled = true
  setMsg($('login-msg'), 'Verificando…')
  const { error } = await supabase.auth.verifyOtp({
    email: $('email-sent').textContent,
    token: $('code-input').value.replace(/\s/g, ''),
    type: 'email',
  })
  btn.disabled = false
  if (error) return setMsg($('login-msg'), 'Código inválido ou expirado.', true)
  setMsg($('login-msg'), '')
})

$('change-email').addEventListener('click', () => {
  $('code-form').hidden = true
  $('email-form').hidden = false
  $('code-input').value = ''
  setMsg($('login-msg'), '')
})

// ---------- Sessão ----------

async function handleSession(session) {
  const user = session?.user || null
  if (state.started && user?.id === state.user?.id) return
  state.started = true
  if (state.user) teardown()
  state.user = user
  if (user) await startApp()
  else show('login')
}

async function startApp() {
  show('app')
  await loadProfile()
  await loadConversations()
  subscribeRealtime()
  if (state.pendingOpen) {
    openById(state.pendingOpen)
    state.pendingOpen = null
    history.replaceState(history.state, '', location.pathname)
  }
}

function teardown() {
  supabase.removeAllChannels()
  closeConversation()
  Object.assign(state, {
    user: null, profile: null, conversations: [], current: null, msgs: [],
    online: new Set(), dbChannel: null, presence: null, typingChannel: null,
  })
  $('conv-list').replaceChildren()
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).single()
  if (error) console.error(error)
  state.profile = data || { id: state.user.id, name: state.user.email, email: state.user.email }
  avatar($('me-btn'), state.profile.name, state.profile.id, state.profile.avatar_url)
}

// ---------- Tempo real ----------

function subscribeRealtime() {
  // As regras RLS garantem que só chegam mensagens das conversas do usuário.
  state.dbChannel = supabase
    .channel('db-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => onUpdate(p.new))
    .subscribe()

  state.presence = supabase.channel('online', { config: { presence: { key: state.user.id } } })
  state.presence
    .on('presence', { event: 'sync' }, () => {
      state.online = new Set(Object.keys(state.presence.presenceState()))
      renderChatStatus()
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await state.presence.track({ at: Date.now() })
    })
}

async function onInsert(m) {
  const mine = m.sender_id === state.user.id
  const isOpen = state.current?.conversation_id === m.conversation_id

  if (isOpen) {
    addMessage(m)
    if (!mine && document.visibilityState === 'visible') await markRead()
  }
  if (!mine && (!isOpen || document.visibilityState !== 'visible')) notify(m)
  scheduleListRefresh()
}

function onUpdate(m) {
  if (state.current?.conversation_id === m.conversation_id) {
    const existing = state.msgs.find((x) => x.id === m.id)
    if (existing) {
      Object.assign(existing, m)
      renderMessages(false)
    }
  }
  scheduleListRefresh()
}

function scheduleListRefresh() {
  clearTimeout(listTimer)
  listTimer = setTimeout(loadConversations, 300)
}

// ---------- Lista de conversas ----------

async function loadConversations() {
  const { data, error } = await supabase.rpc('my_conversations')
  if (error) return console.error(error)
  state.conversations = data
  renderConversations()
}

function renderConversations() {
  const list = $('conv-list')
  list.replaceChildren()
  $('conv-empty').hidden = state.conversations.length > 0

  for (const c of state.conversations) {
    const li = el('li', 'conv-item')
    if (c.conversation_id === state.current?.conversation_id) li.classList.add('active')
    if (c.unread > 0) li.classList.add('unread')

    const av = el('div', 'avatar')
    avatar(av, c.other_name, c.other_id, c.other_avatar)

    const main = el('div', 'conv-main')
    const top = el('div', 'conv-top')
    top.append(el('span', 'conv-name', c.other_name), el('span', 'conv-time', listTime(c.last_at)))

    const bottom = el('div', 'conv-bottom')
    const last = el('span', 'conv-last')
    if (c.last_body && c.last_sender === state.user.id) {
      last.append(el('span', c.last_read_at ? 'ticks read' : 'ticks', c.last_read_at ? '✓✓ ' : '✓ '))
    }
    last.append(document.createTextNode(c.last_body ?? 'Nova conversa'))
    bottom.append(last)
    if (c.unread > 0) bottom.append(el('span', 'badge', c.unread > 99 ? '99+' : String(c.unread)))

    main.append(top, bottom)
    li.append(av, main)
    li.addEventListener('click', () => openConversation(c))
    list.append(li)
  }
}

// ---------- Conversa ----------

function openById(id) {
  const c = state.conversations.find((x) => x.conversation_id === id)
  if (c) openConversation(c)
}

async function openConversation(c) {
  if (state.current?.conversation_id === c.conversation_id) return
  closeConversation(false)
  state.current = c
  state.msgs = []

  document.body.classList.add('in-chat')
  if (!history.state?.chat) history.pushState({ chat: true }, '')
  $('chat-placeholder').hidden = true
  $('chat-view').hidden = false
  $('chat-name').textContent = c.other_name
  avatar($('chat-avatar'), c.other_name, c.other_id, c.other_avatar)
  renderChatStatus()
  renderConversations()
  renderMessages(true)

  state.typingChannel = supabase
    .channel('typing:' + c.conversation_id)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.user_id === state.user.id) return
      state.typingUntil = Date.now() + 3000
      renderChatStatus()
      setTimeout(renderChatStatus, 3100)
    })
    .subscribe()

  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, created_at, read_at')
    .eq('conversation_id', c.conversation_id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (state.current !== c) return
  if (error) return console.error(error)

  // Junta com o que pode ter chegado pelo tempo real enquanto carregava.
  const loaded = data.reverse()
  const ids = new Set(loaded.map((m) => m.id))
  state.msgs = [...loaded, ...state.msgs.filter((m) => !ids.has(m.id))]
  renderMessages(true)
  if (c.unread > 0) {
    await markRead()
    scheduleListRefresh()
  }
  if (matchMedia('(pointer: fine)').matches) $('msg-input').focus()
}

function closeConversation(resetView = true) {
  if (state.typingChannel) supabase.removeChannel(state.typingChannel)
  state.typingChannel = null
  state.current = null
  state.msgs = []
  state.typingUntil = 0
  if (!resetView) return
  document.body.classList.remove('in-chat')
  $('chat-view').hidden = true
  $('chat-placeholder').hidden = false
  $('msg-input').value = ''
  renderConversations()
}

async function markRead() {
  if (!state.current) return
  const { error } = await supabase.rpc('mark_read', { p_conv: state.current.conversation_id })
  if (error) console.error(error)
}

function renderChatStatus() {
  const status = $('chat-status')
  if (!state.current) return
  const typing = Date.now() < state.typingUntil
  status.classList.toggle('typing', typing)
  status.textContent = typing ? 'digitando…' : state.online.has(state.current.other_id) ? 'online' : ''
}

function addMessage(m) {
  if (state.msgs.some((x) => x.id === m.id)) return
  state.msgs.push(m)
  renderMessages(false)
}

function renderMessages(forceBottom) {
  const box = $('messages')
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120
  box.replaceChildren()

  let lastDay = ''
  for (const m of state.msgs) {
    const day = new Date(m.created_at).toDateString()
    if (day !== lastDay) {
      box.append(el('div', 'day-sep', dayLabel(m.created_at)))
      lastDay = day
    }

    const mine = m.sender_id === state.user.id
    const bubble = el('div', 'msg' + (mine ? ' me' : '') + (m.pending ? ' pending' : ''))
    bubble.append(document.createTextNode(m.body))

    const meta = el('div', 'msg-meta', timeFmt.format(new Date(m.created_at)))
    if (mine) {
      const t = m.pending ? '🕓' : m.read_at ? '✓✓' : '✓'
      meta.append(el('span', m.read_at ? 'ticks read' : 'ticks', t))
    }
    bubble.append(meta)
    box.append(bubble)
  }

  if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight
}

// ---------- Enviar ----------

const input = $('msg-input')

function autosize() {
  input.style.height = 'auto'
  input.style.height = Math.min(input.scrollHeight, 140) + 'px'
}

input.addEventListener('input', () => {
  autosize()
  if (state.typingChannel && Date.now() - state.lastTypingSent > 2000) {
    state.lastTypingSent = Date.now()
    state.typingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: state.user.id } })
  }
})

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
    e.preventDefault()
    $('send-form').requestSubmit()
  }
})

$('send-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = input.value.trim()
  const conv = state.current
  if (!text || !conv) return
  input.value = ''
  autosize()

  const tmp = {
    id: 'tmp-' + ++tmpSeq,
    conversation_id: conv.conversation_id,
    sender_id: state.user.id,
    body: text,
    created_at: new Date().toISOString(),
    read_at: null,
    pending: true,
  }
  state.msgs.push(tmp)
  renderMessages(true)

  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conv.conversation_id, body: text })
    .select('id, conversation_id, sender_id, body, created_at, read_at')
    .single()

  if (state.current !== conv) return
  state.msgs = state.msgs.filter((m) => m !== tmp)
  if (error) {
    renderMessages(false)
    if (!input.value) input.value = text
    alert('Não foi possível enviar: ' + error.message)
    return
  }
  addMessage(data)
  scheduleListRefresh()
})

// ---------- Navegação (botão voltar do celular) ----------

$('back-btn').addEventListener('click', () => {
  if (history.state?.chat) history.back()
  else closeConversation()
})

window.addEventListener('popstate', () => {
  if (state.current) closeConversation()
})

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.current) {
    await markRead()
    scheduleListRefresh()
  }
})

// ---------- Nova conversa ----------

function openNewChat() {
  $('new-chat-email').value = ''
  setMsg($('new-chat-msg'), '')
  $('new-chat-dialog').showModal()
}
$('new-chat-btn').addEventListener('click', openNewChat)
$('new-chat-empty').addEventListener('click', openNewChat)

$('new-chat-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.submitter
  btn.disabled = true
  setMsg($('new-chat-msg'), 'Procurando…')

  const { data: found, error } = await supabase.rpc('find_user_by_email', { p_email: $('new-chat-email').value })
  if (error || !found?.length) {
    btn.disabled = false
    return setMsg($('new-chat-msg'), 'Ninguém com esse e-mail usa o Nexo ainda. Peça para a pessoa entrar uma vez.', true)
  }

  const { data: convId, error: err2 } = await supabase.rpc('start_direct_chat', { p_other: found[0].id })
  btn.disabled = false
  if (err2) return setMsg($('new-chat-msg'), err2.message, true)

  $('new-chat-dialog').close()
  await loadConversations()
  openById(convId)
})

// ---------- Perfil ----------

$('me-btn').addEventListener('click', () => {
  $('profile-name').value = state.profile.name
  $('profile-email').textContent = state.profile.email
  setMsg($('profile-msg'), '')
  updateNotifyBtn()
  $('profile-dialog').showModal()
})

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const name = $('profile-name').value.trim()
  const { error } = await supabase.from('profiles').update({ name }).eq('id', state.user.id)
  if (error) return setMsg($('profile-msg'), error.message, true)
  state.profile.name = name
  avatar($('me-btn'), name, state.profile.id, state.profile.avatar_url)
  $('profile-dialog').close()
})

$('logout-btn').addEventListener('click', async () => {
  $('profile-dialog').close()
  await supabase.auth.signOut()
})

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close())
)

// ---------- Notificações (com o app aberto ou em segundo plano) ----------

function updateNotifyBtn() {
  const btn = $('notify-btn')
  if (!('Notification' in window)) {
    btn.hidden = true
    return
  }
  btn.hidden = Notification.permission === 'granted'
  btn.disabled = Notification.permission === 'denied'
  if (Notification.permission === 'denied') btn.textContent = 'Notificações bloqueadas no navegador'
}

$('notify-btn').addEventListener('click', async () => {
  await Notification.requestPermission()
  updateNotifyBtn()
})

async function notify(m) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker?.getRegistration()
  if (!reg) return
  const conv = state.conversations.find((c) => c.conversation_id === m.conversation_id)
  reg.showNotification(conv?.other_name || 'Nova mensagem', {
    body: m.body,
    tag: m.conversation_id,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { conversation_id: m.conversation_id },
  })
}

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.open) openById(e.data.open)
})

// ---------- Instalar na tela inicial ----------

let installEvent = null
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

function installDismissed() {
  try { return localStorage.getItem('nexo-install-dismissed') === '1' } catch { return false }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installEvent = e
  if (!installDismissed()) $('install-banner').hidden = false
})

if (isIOS && !isStandalone && !installDismissed()) {
  $('install-text').textContent = 'No iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início".'
  $('install-btn').hidden = true
  $('install-banner').hidden = false
}

$('install-btn').addEventListener('click', async () => {
  if (!installEvent) return
  installEvent.prompt()
  await installEvent.userChoice
  installEvent = null
  $('install-banner').hidden = true
})

$('install-close').addEventListener('click', () => {
  $('install-banner').hidden = true
  try { localStorage.setItem('nexo-install-dismissed', '1') } catch {}
})

// ---------- Início ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')

if (!configured) {
  show('login')
  $('email-form').hidden = true
  setMsg($('login-msg'), 'Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.', true)
} else {
  // setTimeout evita chamar o Supabase de dentro do callback de autenticação.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0)
  })
}
