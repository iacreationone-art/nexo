import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js'

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
  contact: null,      // dados do contato da conversa aberta (contact_card)
  phone: null,        // meu telefone { phone, visible }
}
let tmpSeq = 0
let listTimer = null

const MSG_COLS = 'id, conversation_id, sender_id, body, created_at, read_at, attachment_path, attachment_name, attachment_type, attachment_size'
const MAX_FILE = 20 * 1024 * 1024

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
  syncPush()
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
    contact: null, phone: null,
  })
  urlCache.clear()
  $('conv-list').replaceChildren()
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).single()
  if (error) console.error(error)
  state.profile = data || { id: state.user.id, name: state.user.email, email: state.user.email }
  renderMe()

  const { data: phone } = await supabase.from('user_phones').select('phone, visible').maybeSingle()
  state.phone = phone || null
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

// include: id de uma conversa que deve aparecer mesmo se estiver apagada.
async function loadConversations(include) {
  const p_conv = (typeof include === 'string' && include) || state.current?.conversation_id || null
  const { data, error } = await supabase.rpc('my_conversations', { p_conv })
  if (error) return console.error(error)
  state.conversations = data
  renderConversations()
}

function renderConversations() {
  const list = $('conv-list')
  list.replaceChildren()
  $('conv-empty').hidden = state.conversations.length > 0
  $('swipe-hint').hidden = state.conversations.length === 0

  const q = normalize($('search-input').value.trim())
  const shown = q
    ? state.conversations.filter((c) => normalize(`${c.other_name} ${c.last_body || ''}`).includes(q))
    : state.conversations
  $('search-empty').hidden = !q || shown.length > 0 || state.conversations.length === 0

  for (const c of shown) {
    const wrap = el('li', 'conv-swipe')
    wrap.dataset.id = c.conversation_id
    const bg = el('span', 'conv-swipe-bg', 'Apagar')
    bg.setAttribute('aria-hidden', 'true')
    bg.insertAdjacentHTML('afterbegin', TRASH_ICON)

    const li = el('div', 'conv-item')
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
    wrap.append(bg, li)
    list.append(wrap)
  }
}

const TRASH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>'

// Arrastar para a esquerda: passando de 35% da largura, onDelete(wrap) apaga
// (devolve true; com false o item volta ao lugar). Rolagem vertical continua normal.
function swipeToDelete(list, onDelete) {
  let row = null
  let startX = 0
  let startY = 0
  let dx = 0
  let dragging = false
  list.addEventListener('pointerdown', (e) => {
    row = e.button === 0 ? e.target.closest('.conv-item') : null
    startX = e.clientX
    startY = e.clientY
    dx = 0
    dragging = false
  })
  list.addEventListener('pointermove', (e) => {
    if (!row) return
    const x = e.clientX - startX
    const y = e.clientY - startY
    if (!dragging) {
      if (Math.abs(y) > 10 && Math.abs(y) > Math.abs(x)) return void (row = null) // está rolando a lista
      if (x > -10) return
      dragging = true
      row.setPointerCapture(e.pointerId)
      row.classList.add('dragging')
    }
    dx = Math.min(0, x)
    row.style.transform = `translateX(${dx}px)`
  })
  const end = async () => {
    if (!row) return
    const r = row
    row = null
    r.classList.remove('dragging')
    if (!dragging) return
    setTimeout(() => (dragging = false)) // depois do clique que o soltar dispara
    if (-dx < r.offsetWidth * 0.35) return void (r.style.transform = '')
    const wrap = r.closest('.conv-swipe')
    r.style.transform = 'translateX(-100%)'
    wrap.classList.add('removing')
    if (await onDelete(wrap)) {
      wrap.hidden = true
      renderConversations() // apagou o último: mostra o estado vazio
    } else {
      wrap.classList.remove('removing')
      r.style.transform = ''
    }
  }
  list.addEventListener('pointerup', end)
  list.addEventListener('pointercancel', end)
  // Soltar depois de arrastar não abre a conversa.
  list.addEventListener('click', (e) => dragging && (e.preventDefault(), e.stopPropagation()), true)
}

swipeToDelete($('conv-list'), (wrap) => hideConversation(wrap.dataset.id))

// Apaga a conversa só para mim, com "Desfazer" no aviso.
async function hideConversation(id) {
  const { error } = await supabase.rpc('hide_conversation', { p_conv: id })
  if (error) {
    toast('Não foi possível apagar a conversa.')
    return false
  }
  if (state.current?.conversation_id === id) {
    if (history.state?.chat) history.back()
    else closeConversation()
  }
  state.conversations = state.conversations.filter((c) => c.conversation_id !== id)
  toast('Conversa apagada.', {
    label: 'Desfazer',
    run: async () => {
      const { error: undo } = await supabase.rpc('hide_conversation', { p_conv: id, p_hide: false })
      if (undo) return toast('Não foi possível desfazer.')
      loadConversations()
    },
  })
  return true
}

// Pesquisa sem diferenciar maiúsculas nem acentos ("joao" encontra "João").
function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

$('search-input').addEventListener('input', renderConversations)

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

  loadContact(c)

  const { data, error } = await supabase
    .from('messages')
    .select(MSG_COLS)
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
  state.contact = null
  $('call-btn').hidden = true
  if (!resetView) return
  document.body.classList.remove('in-chat')
  $('chat-view').hidden = true
  $('chat-placeholder').hidden = false
  $('msg-input').value = ''
  renderConversations()
}

// ---------- Dados do contato ----------

// "+5511912345678" -> "+55 (11) 91234-5678"
function formatPhone(phone) {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(phone || '')
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : phone || ''
}

async function loadContact(c) {
  const { data, error } = await supabase.rpc('contact_card', { p_user: c.other_id })
  if (state.current !== c) return
  if (error) return console.error(error)
  state.contact = data?.[0] || null
  const phone = state.contact?.phone
  $('call-btn').hidden = !phone
  if (phone) $('call-btn').href = 'tel:' + phone
}

$('chat-contact').addEventListener('click', async () => {
  const c = state.current
  if (!c) return
  if (!state.contact) await loadContact(c)
  const k = state.contact || { id: c.other_id, name: c.other_name, avatar_url: c.other_avatar }

  avatar($('contact-avatar'), k.name, k.id, k.avatar_url)
  $('contact-name').textContent = k.name
  $('contact-about').textContent = k.about || ''
  $('contact-about').hidden = !k.about
  $('contact-email').textContent = k.email || ''
  $('contact-email').parentElement.hidden = !k.email

  $('contact-phone-box').hidden = !k.phone
  if (k.phone) {
    $('contact-phone').textContent = formatPhone(k.phone)
    $('contact-call').href = 'tel:' + k.phone
    $('contact-whats').href = 'https://wa.me/' + k.phone.replace(/\D/g, '')
  }
  $('contact-dialog').showModal()
})

$('contact-delete').addEventListener('click', async () => {
  const c = state.current
  if (!c) return
  $('contact-dialog').close()
  await hideConversation(c.conversation_id)
})

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
  const existing = state.msgs.find((x) => x.id === m.id)
  if (existing) {
    if (m.localUrl && !existing.localUrl) existing.localUrl = m.localUrl
    return
  }
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
    if (m.attachment_path || m.localUrl) {
      bubble.append(renderAttachment(m, bubble))
      if (m.body) bubble.append(el('span', 'msg-text', m.body))
    } else {
      bubble.append(document.createTextNode(m.body))
    }

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

// ---------- Anexos ----------

// Os arquivos ficam numa pasta privada: cada um é aberto por um link temporário (1 hora).
const urlCache = new Map() // caminho -> { url, expires } ou Promise

function attachmentUrl(path) {
  const hit = urlCache.get(path)
  if (hit && !(hit instanceof Promise) && hit.expires > Date.now()) return Promise.resolve(hit.url)
  if (hit instanceof Promise) return hit
  const p = supabase.storage
    .from('attachments')
    .createSignedUrl(path, 3600)
    .then(({ data, error }) => {
      if (error) throw error
      urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 })
      return data.signedUrl
    })
    .catch((err) => {
      urlCache.delete(path)
      throw err
    })
  urlCache.set(path, p)
  return p
}

function cachedUrl(path) {
  const hit = urlCache.get(path)
  return hit && !(hit instanceof Promise) && hit.expires > Date.now() ? hit.url : null
}

function withDownload(url, name) {
  return url + (url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(name || 'arquivo')
}

function fileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB'
}

const FILE_ICON = '<svg viewBox="0 0 24 24" width="32" height="32"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5zM8 13v2h8v-2zm0 4v2h5v-2z"/></svg>'

function renderAttachment(m, bubble) {
  const isImage = (m.attachment_type || '').startsWith('image/')

  if (isImage) {
    bubble.classList.add('has-image')
    const img = el('img', 'msg-img')
    img.alt = m.attachment_name || 'Foto'
    img.draggable = false
    const ready = m.localUrl || cachedUrl(m.attachment_path)
    if (ready) img.src = ready
    else attachmentUrl(m.attachment_path).then((url) => (img.src = url)).catch(() => (img.alt = 'Foto indisponível'))
    if (!m.pending) img.addEventListener('click', () => openViewer(m))
    return img
  }

  const a = el('a', 'msg-file')
  a.insertAdjacentHTML('afterbegin', FILE_ICON)
  const info = el('span', 'msg-file-info')
  info.append(
    el('strong', null, m.attachment_name || 'Arquivo'),
    el('small', null, m.pending ? 'Enviando…' : fileSize(m.attachment_size)),
  )
  a.append(info)
  if (!m.pending) {
    a.target = '_blank'
    a.rel = 'noopener'
    const ready = cachedUrl(m.attachment_path)
    if (ready) a.href = withDownload(ready, m.attachment_name)
    else attachmentUrl(m.attachment_path).then((url) => (a.href = withDownload(url, m.attachment_name))).catch(() => {})
  }
  return a
}

async function openViewer(m) {
  try {
    const url = await attachmentUrl(m.attachment_path)
    $('viewer-img').src = url
    $('viewer-download').href = withDownload(url, m.attachment_name)
    $('viewer').showModal()
  } catch {
    toast('Não foi possível abrir a foto.')
  }
}

$('viewer').addEventListener('click', (e) => {
  if (e.target.id === 'viewer' || e.target.id === 'viewer-img') $('viewer').close()
})

// Fotos grandes viram JPEG de até 1600px (economiza internet e espaço). GIFs vão como estão.
function shrinkImage(file, max = 1600) {
  return new Promise((resolve) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return resolve(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) return resolve(file)
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
        resolve(new File([blob], name, { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.82)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      resolve(file)
    }
    img.src = URL.createObjectURL(file)
  })
}

// Nome seguro para o Storage: sem acentos, espaços nem símbolos.
function safeFileName(name) {
  const clean = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return clean.slice(-100) || 'arquivo'
}

async function sendAttachment(original) {
  const conv = state.current
  if (!conv) return
  const file = await shrinkImage(original)
  if (file.size > MAX_FILE) return toast(`"${original.name}" passa de 20 MB.`)

  const type = file.type || 'application/octet-stream'
  const tmp = {
    id: 'tmp-' + ++tmpSeq,
    conversation_id: conv.conversation_id,
    sender_id: state.user.id,
    body: null,
    created_at: new Date().toISOString(),
    read_at: null,
    attachment_name: original.name,
    attachment_type: type,
    attachment_size: file.size,
    localUrl: type.startsWith('image/') ? URL.createObjectURL(file) : null,
    pending: true,
  }
  state.msgs.push(tmp)
  renderMessages(true)

  const path = `${conv.conversation_id}/${crypto.randomUUID()}/${safeFileName(file.name)}`
  const up = await supabase.storage.from('attachments').upload(path, file, { contentType: type })

  let data = null
  let error = up.error
  if (!error) {
    ;({ data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conv.conversation_id,
        attachment_path: path,
        attachment_name: original.name,
        attachment_type: type,
        attachment_size: file.size,
      })
      .select(MSG_COLS)
      .single())
    if (error) await supabase.storage.from('attachments').remove([path])
  }

  if (state.current !== conv) return
  state.msgs = state.msgs.filter((m) => m !== tmp)
  if (error) {
    renderMessages(false)
    toast('Não foi possível enviar o arquivo: ' + error.message)
    return
  }
  data.localUrl = tmp.localUrl // a foto aparece na hora, sem baixar de novo
  addMessage(data)
  scheduleListRefresh()
}

$('file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files]
  e.target.value = ''
  for (const f of files) await sendAttachment(f)
})

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
    .select(MSG_COLS)
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

  const query = $('new-chat-email').value.trim()
  const { data: found, error } = await supabase.rpc('find_user', { p_query: query })
  if (error || !found?.length) {
    btn.disabled = false
    const what = query.includes('@') ? 'esse e-mail' : 'esse telefone'
    return setMsg($('new-chat-msg'), `Ninguém com ${what} usa o Nexo ainda. Peça para a pessoa entrar uma vez.`, true)
  }

  const { data: convId, error: err2 } = await supabase.rpc('start_direct_chat', { p_other: found[0].id })
  btn.disabled = false
  if (err2) return setMsg($('new-chat-msg'), err2.message, true)

  $('new-chat-dialog').close()
  await loadConversations(convId)
  openById(convId)
})

// ---------- Perfil ----------

function renderMe() {
  const p = state.profile
  avatar($('me-btn'), p.name, p.id, p.avatar_url)
  avatar($('menu-avatar'), p.name, p.id, p.avatar_url)
  avatar($('profile-avatar'), p.name, p.id, p.avatar_url)
  $('menu-name').textContent = p.name
  $('menu-email').textContent = p.email
  $('photo-remove').hidden = !p.avatar_url
}

// action (opcional): { label, run } vira um botão no aviso, como "Desfazer".
let toastTimer = null
function toast(text, action = null) {
  const t = $('toast')
  t.textContent = text
  if (action) {
    const btn = el('button', 'toast-action', action.label)
    btn.type = 'button'
    btn.onclick = () => {
      t.hidden = true
      action.run()
    }
    t.append(' ', btn)
  }
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (t.hidden = true), action ? 6000 : 3500)
}

// Menu do usuário
function toggleMenu(open) {
  $('user-menu').hidden = !open
  $('me-btn').setAttribute('aria-expanded', String(open))
  if (open) updateNotifyBtn()
}

$('me-btn').addEventListener('click', (e) => {
  e.stopPropagation()
  toggleMenu($('user-menu').hidden)
})
document.addEventListener('click', (e) => {
  if (!$('user-menu').hidden && !e.target.closest('.menu-wrap')) toggleMenu(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('user-menu').hidden) toggleMenu(false)
})

$('menu-profile').addEventListener('click', () => {
  toggleMenu(false)
  $('profile-name').value = state.profile.name
  $('profile-about').value = state.profile.about || ''
  $('profile-email').value = state.profile.email
  $('profile-phone').value = formatPhone(state.phone?.phone)
  $('profile-phone-visible').checked = state.phone ? state.phone.visible : true
  setMsg($('profile-msg'), '')
  renderMe()
  $('profile-dialog').showModal()
})

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const changes = {
    name: $('profile-name').value.trim(),
    about: $('profile-about').value.trim() || null,
  }
  if (!changes.name) return setMsg($('profile-msg'), 'Digite seu nome.', true)
  const { error } = await supabase.from('profiles').update(changes).eq('id', state.user.id)
  if (error) return setMsg($('profile-msg'), error.message, true)
  Object.assign(state.profile, changes)

  const phoneText = $('profile-phone').value.trim()
  const visible = $('profile-phone-visible').checked
  const phoneChanged = phoneText !== formatPhone(state.phone?.phone) || visible !== (state.phone?.visible ?? true)
  if (phoneChanged) {
    const { data: saved, error: phoneErr } = await supabase.rpc('set_my_phone', { p_phone: phoneText, p_visible: visible })
    if (phoneErr) return setMsg($('profile-msg'), phoneErr.message, true)
    state.phone = saved ? { phone: saved, visible } : null
  }
  renderMe()
  $('profile-dialog').close()
  toast('Perfil salvo')
})

$('logout-btn').addEventListener('click', async () => {
  toggleMenu(false)
  await unsubscribePush()
  await supabase.auth.signOut()
})

// Foto de perfil: recorta em quadrado, reduz para 512px e envia ao Storage.
function squareJpeg(file, size = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const out = Math.min(size, side)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = out
      canvas.getContext('2d').drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, out, out,
      )
      URL.revokeObjectURL(img.src)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('imagem inválida'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => reject(new Error('Não foi possível ler essa imagem.'))
    img.src = URL.createObjectURL(file)
  })
}

async function clearOldPhotos(keep) {
  const folder = state.user.id
  const { data } = await supabase.storage.from('avatars').list(folder)
  const old = (data || []).map((f) => `${folder}/${f.name}`).filter((path) => path !== keep)
  if (old.length) await supabase.storage.from('avatars').remove(old)
}

async function setAvatarUrl(url) {
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', state.user.id)
  if (error) throw error
  state.profile.avatar_url = url
  renderMe()
}

$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  const wrap = document.querySelector('.photo-wrap')
  wrap.classList.add('loading')
  setMsg($('profile-msg'), 'Enviando foto…')
  try {
    const blob = await squareJpeg(file)
    const path = `${state.user.id}/${Date.now()}.jpg`
    const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' })
    if (error) throw error
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    await setAvatarUrl(data.publicUrl)
    await clearOldPhotos(path)
    setMsg($('profile-msg'), 'Foto atualizada.')
  } catch (err) {
    setMsg($('profile-msg'), 'Não foi possível enviar a foto: ' + err.message, true)
  } finally {
    wrap.classList.remove('loading')
  }
})

$('photo-remove').addEventListener('click', async () => {
  try {
    await setAvatarUrl(null)
    await clearOldPhotos(null)
    setMsg($('profile-msg'), 'Foto removida.')
  } catch (err) {
    setMsg($('profile-msg'), err.message, true)
  }
})

document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close())
)

// ---------- Notificações push (chegam mesmo com o app fechado) ----------

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

async function savePush(sub) {
  const { endpoint, keys } = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
  })
  if (error) throw error
}

async function subscribePush() {
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }))
  await savePush(sub)
}

// Ao abrir o app, renova a inscrição (o navegador pode trocá-la com o tempo).
async function syncPush() {
  if (!pushSupported || Notification.permission !== 'granted') return
  try {
    await subscribePush()
  } catch (err) {
    console.error('push', err)
  }
}

async function unsubscribePush() {
  if (!pushSupported) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
  } catch (err) {
    console.error('push', err)
  }
}

function updateNotifyBtn() {
  const btn = $('notify-btn')
  const label = $('notify-label')
  btn.hidden = false
  btn.disabled = false
  if (!pushSupported) {
    if (isIOS && !isStandalone) {
      label.textContent = 'Instale na tela inicial para receber notificações'
      btn.disabled = true
    } else {
      btn.hidden = true
    }
  } else if (Notification.permission === 'denied') {
    label.textContent = 'Notificações bloqueadas'
    btn.disabled = true
  } else if (Notification.permission === 'granted') {
    label.textContent = 'Notificações ativadas ✓'
    btn.disabled = true
  } else {
    label.textContent = 'Ativar notificações'
  }
}

$('notify-btn').addEventListener('click', async () => {
  const permission = await Notification.requestPermission()
  if (permission === 'granted') {
    try {
      await subscribePush()
      toast('Pronto! Você vai receber avisos de mensagens novas.')
    } catch (err) {
      toast('Não foi possível ativar: ' + err.message)
    }
  }
  updateNotifyBtn()
})

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
