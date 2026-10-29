import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js'
import * as cripto from './cripto.js'
import { emojiOnly, motionFor, emojiRain, setupEmojiPicker } from './emoji.js'
import { stickerOf, stickerText, stickerSvg, stickerRain } from './figurinhas.js'
import { listSaved, addSaved, removeSaved, getSaved, cutAnimClass, validAnim } from './salvas.js'

const $ = (id) => document.getElementById(id)
const configured = !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('SUA_ANON_KEY')
// A biblioteca vem do <script> no index.html (um arquivo só, carregado antes deste).
const supabase = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

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
  myKey: null,        // minha chave privada (CryptoKey) — só existe neste aparelho
  myPublic: null,     // minha chave pública (JWK)
}
const keyCache = new Map()  // id da chave da conversa -> CryptoKey, ou null se ainda não recebi
const sendKeys = new Map()  // id da conversa -> { keyId, key } usada para enviar
let tmpSeq = 0
let listTimer = null
let listLoaded = false // já veio a lista do servidor (a guardada não pode mais sobrescrever)

const MSG_COLS = 'id, conversation_id, sender_id, body, ciphertext, key_id, created_at, read_at, deleted_at, attachment_path, attachment_name, attachment_type, attachment_size'
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

$('google-btn').addEventListener('click', async () => {
  $('google-btn').disabled = true
  setMsg($('login-msg'), 'Abrindo o Google…')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  })
  if (error) {
    $('google-btn').disabled = false
    setMsg($('login-msg'), error.message, true)
  }
})

function loginErrorText(error) {
  const msg = (error.message || '').toLowerCase()
  if (error.status === 429 || msg.includes('rate limit')) {
    return /seconds|segundos/.test(msg)
      ? 'Aguarde um minuto antes de pedir outro código.'
      : 'Muitos códigos enviados na última hora. Tente de novo mais tarde' +
          ($('google-area').hidden ? '.' : ' ou entre com o Google.')
  }
  return error.message
}

// O botão do Google só aparece se o login com Google estiver ligado no Supabase.
async function checkGoogleEnabled() {
  $('google-area').hidden = true
  try {
    const res = await fetch(SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: SUPABASE_ANON_KEY } })
    const settings = await res.json()
    $('google-area').hidden = !settings.external?.google || !$('code-form').hidden
  } catch {
    // sem internet ou erro: fica só o login por e-mail
  }
}

// Se o Google ou o Supabase devolveram um erro no endereço, mostra na tela de login.
function showLoginErrorFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search)
  const desc = params.get('error_description')
  if (!desc) return
  setMsg($('login-msg'), 'Não foi possível entrar: ' + desc.replace(/\+/g, ' '), true)
  history.replaceState(history.state, '', location.pathname)
}

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
  if (error) return setMsg($('login-msg'), loginErrorText(error), true)
  $('email-sent').textContent = email
  $('google-area').hidden = true
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
  checkGoogleEnabled()
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
  else {
    show('login')
    checkGoogleEnabled()
    showLoginErrorFromUrl()
  }
}

async function startApp() {
  show('app')
  // A lista guardada aparece na hora; perfil e chaves são buscados ao mesmo tempo.
  showSavedConversations()
  const [ok] = await Promise.all([setupKeys(), loadProfile()])
  if (!ok) return
  await loadConversations()
  subscribeRealtime()
  syncPush()
  shareMissingKeys()
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
    contact: null, phone: null, myKey: null, myPublic: null,
  })
  keyCache.clear()
  sendKeys.clear()
  listLoaded = false
  for (const hit of urlCache.values()) if (hit.blob) URL.revokeObjectURL(hit.url)
  urlCache.clear()
  $('conv-list').replaceChildren()
}

async function loadProfile() {
  const [{ data, error }, { data: phone }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', state.user.id).single(),
    supabase.from('user_phones').select('phone, visible').maybeSingle(),
  ])
  if (error) console.error(error)
  state.profile = data || { id: state.user.id, name: state.user.email, email: state.user.email }
  renderMe()
  state.phone = phone || null
}

// ---------- Criptografia de ponta a ponta ----------
// Regras e formato em js/cripto.js e supabase/cripto.sql.

function useIdentity({ privateKey, publicJwk }) {
  state.myKey = privateKey
  state.myPublic = publicJwk
}

async function storeIdentity(identity) {
  try {
    await cripto.localClear()
    await cripto.localSet('me', { userId: state.user.id, privateKey: identity.privateKey, publicJwk: identity.publicJwk })
  } catch (err) {
    console.error('chaves', err) // navegação privada: a chave vale só enquanto o app estiver aberto
  }
  useIdentity(identity)
}

// Garante que este aparelho tem minha chave: usa a guardada ou pede a senha de recuperação
// (na primeira vez, pede para criar uma). Devolve false se a pessoa preferiu sair da conta.
async function setupKeys() {
  let local = await cripto.localGet('me').catch(() => null)
  if (local && local.userId !== state.user.id) {
    await cripto.localClear().catch(() => {})
    local = null
  }
  const { data: mine, error } = await supabase.from('user_keys').select('public_key').eq('user_id', state.user.id).maybeSingle()
  if (error) {
    console.error(error)
    if (local) useIdentity(local) // sem internet: segue com a chave deste aparelho
    return true
  }
  if (local && cripto.sameKey(local.publicJwk, mine?.public_key)) {
    useIdentity(local)
    return true
  }
  return askKeys(mine ? 'unlock' : 'create', mine?.public_key)
}

const KEYS_TEXT = {
  create: {
    title: 'Proteja suas conversas',
    text: 'Agora suas mensagens são criptografadas de ponta a ponta: só você e a pessoa com quem conversa conseguem ler. ' +
      'Crie uma senha de recuperação. Ela serve para abrir suas conversas se você trocar de celular. ' +
      'Anote num lugar seguro: ninguém consegue recuperar essa senha, nem o Nexo.',
    submit: 'Criar senha',
  },
  unlock: {
    title: 'Digite sua senha de recuperação',
    text: 'Para ler suas conversas neste aparelho, digite a senha de recuperação que você criou.',
    submit: 'Abrir conversas',
    other: 'Esqueci a senha',
  },
  reset: {
    title: 'Criar uma senha nova',
    text: 'Com uma senha nova, as mensagens antigas não abrem mais. Você só vai ler as mensagens que chegarem daqui em diante.',
    submit: 'Criar senha nova',
    other: 'Lembrei a senha',
  },
}
let keysMode = 'create'
let keysPublic = null
let keysDone = null

function askKeys(mode, publicJwk) {
  keysPublic = publicJwk
  setKeysMode(mode)
  $('keys-dialog').showModal()
  return new Promise((resolve) => (keysDone = resolve))
}

function setKeysMode(mode) {
  keysMode = mode
  const t = KEYS_TEXT[mode]
  const isNew = mode !== 'unlock'
  $('keys-title').textContent = t.title
  $('keys-text').textContent = t.text
  $('keys-submit').textContent = t.submit
  $('keys-other').textContent = t.other || ''
  $('keys-other').hidden = !t.other
  $('keys-confirm-label').hidden = !isNew
  $('keys-confirm').required = isNew
  $('keys-pass').autocomplete = isNew ? 'new-password' : 'current-password'
  $('keys-pass').value = ''
  $('keys-confirm').value = ''
  setMsg($('keys-msg'), '')
}

function finishKeys(ok) {
  $('keys-dialog').close()
  keysDone?.(ok)
  keysDone = null
}

$('keys-dialog').addEventListener('cancel', (e) => e.preventDefault()) // não fecha com Esc/voltar

$('keys-other').addEventListener('click', () => {
  if (keysMode === 'reset') return setKeysMode('unlock')
  if (confirm('Sem a senha, as mensagens antigas não podem ser abertas. Criar uma senha nova?')) setKeysMode('reset')
})

$('keys-logout').addEventListener('click', async () => {
  finishKeys(false)
  await cripto.localClear().catch(() => {})
  await supabase.auth.signOut()
})

$('keys-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const pass = $('keys-pass').value
  if (keysMode !== 'unlock') {
    if (pass.length < 8) return setMsg($('keys-msg'), 'Use pelo menos 8 caracteres.', true)
    if (pass !== $('keys-confirm').value) return setMsg($('keys-msg'), 'As duas senhas não são iguais.', true)
  }
  const btn = $('keys-submit')
  btn.disabled = true
  setMsg($('keys-msg'), keysMode === 'unlock' ? 'Abrindo…' : 'Protegendo suas conversas…')
  try {
    if (keysMode === 'unlock') {
      const { data: backup, error } = await supabase
        .from('user_key_backups').select('private_backup, salt, iterations').eq('user_id', state.user.id).single()
      if (error) throw error
      const privateKey = await cripto.restoreIdentity(pass, backup).catch(() => {
        throw new Error('Senha incorreta.')
      })
      await storeIdentity({ privateKey, publicJwk: keysPublic })
    } else {
      const identity = await cripto.createIdentity(pass)
      const { error } = await supabase.rpc('set_my_keys', {
        p_public: identity.publicJwk,
        p_backup: identity.backup,
        p_salt: identity.salt,
        p_iterations: identity.iterations,
        p_replace: keysMode === 'reset',
      })
      if (error) throw error
      await storeIdentity(identity)
    }
    finishKeys(true)
  } catch (err) {
    setMsg($('keys-msg'), err.message, true)
  } finally {
    btn.disabled = false
  }
})

// Minha cópia da chave de uma conversa, desembrulhada (bytes), ou null se ainda não recebi.
async function myRawKey(keyId) {
  if (!state.myKey) return null
  const { data } = await supabase
    .from('conversation_keys')
    .select('conversation_id, wrapped_key, wrapper_public')
    .eq('key_id', keyId)
    .eq('user_id', state.user.id)
    .maybeSingle()
  if (!data) return null
  try {
    return await cripto.unwrapConversationKey(data.wrapped_key, state.myKey, data.wrapper_public, data.conversation_id)
  } catch (err) {
    console.error('chave', err)
    return null
  }
}

// Chave de uma conversa pronta para usar. Fica guardada no aparelho (o sw.js usa nas notificações).
function getKey(keyId) {
  if (!keyCache.has(keyId)) {
    const p = (async () => {
      const local = await cripto.localGet('key:' + keyId).catch(() => null)
      if (local) return local
      const raw = await myRawKey(keyId)
      if (!raw) return null
      const key = await cripto.importConversationKey(raw)
      cripto.localSet('key:' + keyId, key).catch(() => {})
      return key
    })()
    keyCache.set(keyId, p)
    p.then((key) => key || keyCache.delete(keyId), () => keyCache.delete(keyId)) // sem chave: tenta de novo depois
  }
  return keyCache.get(keyId).catch(() => null)
}

// Abre uma mensagem cifrada (texto e nome do arquivo). Sem a chave, ela fica "trancada".
async function openMessage(m) {
  if (!m.ciphertext) return
  try {
    const key = await getKey(m.key_id)
    if (!key) throw new Error('sem chave')
    const p = await cripto.decryptMessage(key, m.conversation_id, m.ciphertext)
    m.body = p.t ?? null
    if (p.n) m.attachment_name = p.n
    m.sticker = !!p.f // imagem recortada: aparece sem balão, como figurinha
    m.stickerAnim = p.f ? validAnim(p.a) : '' // e pode vir com animação (pulando, girando…)
    m.locked = false
  } catch {
    m.locked = true
  }
}

// Chave para enviar nesta conversa. Cria uma nova quando precisa (primeira mensagem,
// ou alguém trocou de senha) e entrega para os outros participantes.
async function sendKeyFor(convId) {
  const hit = sendKeys.get(convId)
  if (hit) return hit
  if (!state.myKey) throw new Error('este aparelho ainda não tem sua chave. Feche e abra o Nexo de novo.')

  const { data, error } = await supabase.rpc('conversation_key_state', { p_conv: convId })
  if (error) throw error
  const st = data?.[0]
  let keyId = st?.key_id
  let key = keyId && !st.needs_new ? await getKey(keyId) : null

  if (!key) {
    const raw = cripto.newConversationKey()
    const wrapped = await cripto.wrapConversationKey(raw, state.myKey, state.myPublic, convId)
    const { data: id, error: err } = await supabase.rpc('create_conversation_key', { p_conv: convId, p_wrapped: wrapped })
    if (err) throw err
    keyId = id
    key = await cripto.importConversationKey(raw)
    keyCache.set(keyId, Promise.resolve(key))
    cripto.localSet('key:' + keyId, key).catch(() => {})
    await shareMissingKeys()
  }

  const out = { keyId, key }
  sendKeys.set(convId, out)
  return out
}

// Entrega as chaves que eu tenho para quem ainda não recebeu (contato que acabou de criar a senha, etc.).
let shareQueue = Promise.resolve()
function shareMissingKeys() {
  shareQueue = shareQueue.then(runShare, runShare)
  return shareQueue
}

async function runShare() {
  if (!state.myKey) return
  try {
    const { data, error } = await supabase.rpc('missing_conversation_keys')
    if (error) throw error
    for (const row of data) {
      const raw = await myRawKey(row.key_id)
      if (!raw) continue
      const wrapped = await cripto.wrapConversationKey(raw, state.myKey, row.public_key, row.conversation_id)
      const { error: err } = await supabase.rpc('share_conversation_key', { p_key: row.key_id, p_user: row.user_id, p_wrapped: wrapped })
      if (err) console.error('chaves', err)
    }
  } catch (err) {
    console.error('chaves', err)
  }
}

// Chegou uma chave para mim: abre as mensagens daquela conversa que estavam trancadas.
async function onKeyReceived({ new: row }) {
  keyCache.delete(row.key_id)
  const c = state.current
  if (c?.conversation_id === row.conversation_id) {
    const locked = state.msgs.filter((m) => m.locked && m.key_id === row.key_id)
    await Promise.all(locked.map(openMessage))
    if (locked.length && state.current === c) renderMessages(false)
  }
  scheduleListRefresh()
}

// ---------- Tempo real ----------

function subscribeRealtime() {
  // As regras RLS garantem que só chegam mensagens das conversas do usuário.
  state.dbChannel = supabase
    .channel('db-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => onInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) => onUpdate(p.new))
    // Recebi a chave de uma conversa: abre as mensagens que estavam trancadas.
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_keys', filter: `user_id=eq.${state.user.id}` }, onKeyReceived)
    // Um contato criou ou trocou as chaves: entrega a ele as chaves das conversas.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'user_keys' }, (p) => {
      if (p.new?.user_id === state.user.id) return
      sendKeys.clear()
      shareMissingKeys()
    })
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

  if (isOpen) await openMessage(m)
  if (isOpen && state.current?.conversation_id === m.conversation_id) {
    if (!mine && !state.msgs.some((x) => x.id === m.id)) emojiRain($('chat-view'), emojiOnly(m.body) || stickerRain(m.body))
    addMessage(m)
    if (!mine && document.visibilityState === 'visible') await markRead()
  }
  scheduleListRefresh()
}

function onUpdate(m) {
  if (state.current?.conversation_id === m.conversation_id) {
    const existing = state.msgs.find((x) => x.id === m.id)
    if (existing && m.deleted_at && !existing.deleted_at) {
      applyDeleted(existing, m.deleted_at) // quem enviou apagou para todos
    } else if (existing) {
      existing.read_at = m.read_at // fora isso, só o "lida" muda depois de enviada: troca só o ✓
      $('messages').querySelector(`[data-id="${m.id}"] .msg-meta`)?.replaceWith(metaNode(existing))
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
  await Promise.all(data.map(openPreview))
  listLoaded = true
  state.conversations = data
  renderConversations()
  // Guarda no aparelho (junto das chaves; sai ao sair da conta) para abrir rápido da próxima vez.
  cripto.localSet('lista', { userId: state.user.id, rows: data }).catch(() => {})
}

async function showSavedConversations() {
  const saved = await cripto.localGet('lista').catch(() => null)
  if (saved?.userId !== state.user?.id || listLoaded) return
  state.conversations = saved.rows
  renderConversations()
}

// A última mensagem vem cifrada: abre aqui para mostrar na lista.
async function openPreview(c) {
  if (!c.last_key || !c.last_body?.startsWith('e1:')) return
  try {
    const key = await getKey(c.last_key)
    if (!key) throw new Error('sem chave')
    const p = await cripto.decryptMessage(key, c.conversation_id, c.last_body)
    c.last_body = !p.n ? (stickerOf(p.t) ? '🎭 Figurinha' : p.t) : p.f ? '🎭 Figurinha' : (p.y || '').startsWith('image/') ? '📷 Foto' : '📎 ' + p.n
  } catch {
    c.last_body = '🔒 Mensagem protegida'
  }
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

  await Promise.all(data.map(openMessage))
  if (state.current !== c) return

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
  emojiPicker.close()
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

const dayKey = (m) => new Date(m.created_at).toDateString()
const isNearBottom = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 120

// Mensagem nova vai para o fim da conversa: só acrescenta o balão (não redesenha tudo).
function addMessage(m, forceBottom = false) {
  const existing = state.msgs.find((x) => x.id === m.id)
  if (existing) {
    if (m.localUrl && !existing.localUrl) existing.localUrl = m.localUrl
    return
  }
  const box = $('messages')
  const nearBottom = isNearBottom(box)
  const last = state.msgs[state.msgs.length - 1]
  m.freshAt = Date.now() // acabou de chegar: emoji grande entra "pulando"
  state.msgs.push(m)
  if (!last || dayKey(last) !== dayKey(m)) box.append(el('div', 'day-sep', dayLabel(m.created_at)))
  box.append(messageNode(m))
  if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight
}

// Tira uma mensagem (a provisória "Enviando…") da lista e da tela.
function removeMessage(m) {
  state.msgs = state.msgs.filter((x) => x !== m)
  const node = $('messages').querySelector(`[data-id="${m.id}"]`)
  if (!node) return
  const before = node.previousElementSibling
  const after = node.nextElementSibling
  node.remove()
  // Não deixa um "Hoje" sobrando sem mensagens embaixo.
  if (before?.classList.contains('day-sep') && (!after || after.classList.contains('day-sep'))) before.remove()
}

// Mensagem apagada para todos: some o conteúdo (e a cópia do anexo guardada no aparelho).
function applyDeleted(m, when) {
  if (m.attachment_path) forgetFile(m.attachment_path)
  Object.assign(m, {
    deleted_at: when,
    body: null,
    ciphertext: null,
    key_id: null,
    attachment_path: null,
    attachment_name: null,
    attachment_type: null,
    attachment_size: null,
    localUrl: null,
    sticker: false,
    stickerAnim: '',
    locked: false,
  })
  if (viewerMsg === m) $('viewer').close()
  $('messages').querySelector(`[data-id="${m.id}"]`)?.replaceWith(messageNode(m))
}

function metaNode(m) {
  const meta = el('div', 'msg-meta', timeFmt.format(new Date(m.created_at)))
  if (m.sender_id === state.user.id) {
    const t = m.pending ? '🕓' : m.read_at ? '✓✓' : '✓'
    meta.append(el('span', m.read_at ? 'ticks read' : 'ticks', t))
  }
  return meta
}

function messageNode(m) {
  const mine = m.sender_id === state.user.id
  const bubble = el('div', 'msg' + (mine ? ' me' : '') + (m.pending ? ' pending' : ''))
  bubble.dataset.id = m.id
  const plain = !m.locked && !m.attachment_path && !m.localUrl
  const fig = plain && stickerOf(m.body)
  const emojis = plain && !fig && emojiOnly(m.body)
  if (m.deleted_at) {
    bubble.classList.add('deleted')
    bubble.append(el('span', 'msg-deleted', mine ? '🚫 Você apagou esta mensagem' : '🚫 Mensagem apagada'))
  } else if (m.locked) {
    bubble.append(el('span', 'msg-locked', '🔒 Esta mensagem não pode ser aberta neste aparelho.'))
  } else if (m.attachment_path || m.localUrl) {
    bubble.append(renderAttachment(m, bubble))
    if (m.body) bubble.append(el('span', 'msg-text', m.body))
  } else if (fig) {
    // Figurinha da Turma do Nexo: desenho animado, sem balão.
    bubble.classList.add('emoji-only', 'sticker')
    if (Date.now() - (m.freshAt || 0) < 1000) bubble.classList.add('fresh')
    const art = el('div', 'sticker-art')
    art.innerHTML = stickerSvg(fig) // desenho nosso, escolhido pelo nome (nunca texto de quem enviou)
    bubble.append(art)
  } else if (emojis) {
    // Só emojis: aparecem grandes e se mexendo.
    bubble.classList.add('emoji-only', 'emoji-' + emojis.length)
    if (Date.now() - (m.freshAt || 0) < 1000) bubble.classList.add('fresh')
    for (const g of emojis) bubble.append(el('span', 'big-emoji ' + motionFor(g), g))
  } else {
    bubble.append(document.createTextNode(m.body))
  }
  bubble.append(metaNode(m))
  return bubble
}

// Desenha a conversa inteira (ao abrir, ou quando chegam chaves e mensagens trancadas abrem).
function renderMessages(forceBottom) {
  const box = $('messages')
  const nearBottom = isNearBottom(box)
  imageObserver.disconnect()
  const frag = document.createDocumentFragment()
  let lastDay = ''
  for (const m of state.msgs) {
    const day = dayKey(m)
    if (day !== lastDay) {
      frag.append(el('div', 'day-sep', dayLabel(m.created_at)))
      lastDay = day
    }
    frag.append(messageNode(m))
  }
  box.replaceChildren(frag)
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

// Arquivo cifrado: baixa, abre com a chave da conversa e vira um link local (blob:).
// Arquivos antigos (sem criptografia) continuam pelo link temporário.
function fileUrl(m) {
  if (!m.ciphertext) return attachmentUrl(m.attachment_path)
  const id = 'blob:' + m.attachment_path
  const hit = urlCache.get(id)
  if (hit) return hit instanceof Promise ? hit : Promise.resolve(hit.url)
  const p = (async () => {
    const key = await getKey(m.key_id)
    if (!key) throw new Error('sem chave')
    let sealed = await savedFile(m.attachment_path)
    if (!sealed) {
      const res = await fetch(await attachmentUrl(m.attachment_path))
      if (!res.ok) throw new Error('download ' + res.status)
      sealed = await res.arrayBuffer()
      saveFile(m.attachment_path, sealed)
    }
    const plain = await cripto.decryptFile(key, m.conversation_id, sealed)
    const url = URL.createObjectURL(new Blob([plain], { type: m.attachment_type || 'application/octet-stream' }))
    urlCache.set(id, { url, blob: true, expires: Infinity })
    return url
  })()
  urlCache.set(id, p)
  p.catch(() => urlCache.delete(id))
  return p
}

// Cópias dos arquivos cifrados guardadas no aparelho (continuam embaralhadas, como no servidor).
// Assim cada foto é baixada uma vez só. Ficam as 300 mais recentes.
const FILES_CACHE = 'nexo-arquivos'
const fileKey = (path) => new URL('nexo-arquivo/' + path, location.href).href

async function savedFile(path) {
  try {
    const res = await (await caches.open(FILES_CACHE)).match(fileKey(path))
    return res ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

async function forgetFile(path) {
  try {
    await (await caches.open(FILES_CACHE)).delete(fileKey(path))
  } catch {}
}

async function saveFile(path, data) {
  try {
    const cache = await caches.open(FILES_CACHE)
    await cache.put(fileKey(path), new Response(data))
    const keys = await cache.keys()
    for (const old of keys.slice(0, Math.max(0, keys.length - 300))) await cache.delete(old)
  } catch {
    // sem espaço ou navegação privada: só não guarda
  }
}

// Foto só é baixada quando aparece na tela (ou chega perto dela).
const imageObserver = new IntersectionObserver((entries) => {
  for (const { isIntersecting, target } of entries) {
    if (!isIntersecting) continue
    imageObserver.unobserve(target)
    fileUrl(target.msg).then((url) => (target.src = url)).catch(() => (target.alt = 'Foto indisponível'))
  }
}, { root: $('messages'), rootMargin: '600px 0px' })

function cachedFileUrl(m) {
  return cachedUrl(m.ciphertext ? 'blob:' + m.attachment_path : m.attachment_path)
}

function downloadUrl(m, url) {
  return m.ciphertext ? url : withDownload(url, m.attachment_name)
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
    if (m.sticker) bubble.classList.add('emoji-only', 'sticker-img')
    const img = el('img', ('msg-img ' + cutAnimClass(m.stickerAnim)).trim())
    img.alt = m.attachment_name || 'Foto'
    img.draggable = false
    img.decoding = 'async'
    const ready = m.localUrl || cachedFileUrl(m)
    if (ready) img.src = ready
    else {
      img.msg = m
      imageObserver.observe(img)
    }
    if (!m.pending) img.addEventListener('click', () => openViewer(m))
    if (!m.stickerAnim) return img
    // Recorte animado: caixa de tamanho fixo com folga, para o movimento caber nela
    // (sem criar barra de rolagem e sem ser cortado).
    const box = el('div', 'cut-box')
    box.append(img)
    return box
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
    if (m.ciphertext) a.download = m.attachment_name || 'arquivo'
    const ready = cachedFileUrl(m)
    if (ready) a.href = downloadUrl(m, ready)
    else if (!m.ciphertext) attachmentUrl(m.attachment_path).then((url) => (a.href = withDownload(url, m.attachment_name))).catch(() => {})
    else {
      // Arquivo cifrado só é baixado quando a pessoa toca nele.
      a.href = '#'
      a.addEventListener('click', async (e) => {
        if (a.dataset.ready) return
        e.preventDefault()
        info.lastChild.textContent = 'Abrindo…'
        try {
          a.href = await fileUrl(m)
          a.dataset.ready = '1'
          a.click()
        } catch {
          toast('Não foi possível abrir o arquivo.')
        }
        info.lastChild.textContent = fileSize(m.attachment_size)
      })
    }
  }
  return a
}

let viewerMsg = null

async function openViewer(m) {
  try {
    const url = await fileUrl(m)
    viewerMsg = m
    $('viewer-img').src = url
    $('viewer-download').href = downloadUrl(m, url)
    $('viewer-download').download = m.attachment_name || 'foto.jpg'
    $('viewer').showModal()
  } catch {
    toast('Não foi possível abrir a foto.')
  }
}

$('viewer').addEventListener('click', (e) => {
  if (e.target.id === 'viewer' || e.target.id === 'viewer-img') $('viewer').close()
})

// A foto da mensagem, já aberta (sem criptografia), pronta para salvar ou reenviar.
async function messageFile(m) {
  const blob = await (await fetch(await fileUrl(m))).blob()
  const type = m.attachment_type || blob.type || 'image/jpeg'
  return new File([blob], m.attachment_name || 'foto.jpg', { type })
}

// ⭐ Salvar: a imagem vai para a aba "Salvas" do painel de emojis (só neste aparelho).
// Recorte animado recebido é salvo com a mesma animação, para reenviar igualzinho.
async function saveMessageImage(m) {
  try {
    const file = await messageFile(m)
    const cutout = m.sticker || (await isCutout(file))
    const added = await addSaved(state.user.id, file, file.name, { cutout, anim: m.stickerAnim })
    toast(added ? '⭐ Salva! Ela fica na aba ⭐ do painel de emojis.' : 'Essa imagem já está nas salvas.')
    emojiPicker.refreshSaved()
  } catch (err) {
    toast('Não foi possível salvar: ' + err.message)
  }
}

$('viewer-save').addEventListener('click', () => viewerMsg && saveMessageImage(viewerMsg))

// 📥 Salvar na galeria do celular.
// iPhone: site não grava direto no app Fotos; o menu de compartilhar tem "Salvar Imagem".
// Android e computador: baixa o arquivo (no Android ele aparece na galeria, pasta Download).
// (iPad novo se apresenta como Mac: por isso o teste do toque)
const isApplePhone = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

async function saveToGallery(m) {
  let file
  try {
    file = await messageFile(m)
  } catch {
    return toast('Não foi possível pegar a foto.')
  }
  if (isApplePhone && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
    } catch (err) {
      if (err.name === 'AbortError') return // a pessoa fechou o menu
      // Demorou para preparar a foto e o iPhone exige um toque novo para abrir o menu.
      toast('A foto está pronta.', { label: 'Salvar', run: () => navigator.share({ files: [file] }).catch(() => {}) })
    }
    return
  }
  const url = URL.createObjectURL(file)
  const a = el('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  toast('📥 Foto salva. Na galeria, ela fica na pasta Download.')
}

// O botão de baixar da foto aberta também passa a salvar na galeria.
$('viewer-download').addEventListener('click', (e) => {
  if (!viewerMsg) return
  e.preventDefault()
  saveToGallery(viewerMsg)
})

// Encaminhar: escolhe a conversa, abre ela e manda a mesma foto lá.
$('viewer-forward').addEventListener('click', () => {
  const m = viewerMsg
  if (!m) return
  const rows = state.conversations.map((c) => {
    const li = el('li')
    const row = el('button', 'picker-item')
    row.type = 'button'
    const av = el('div', 'avatar')
    avatar(av, c.other_name, c.other_id, c.other_avatar)
    const main = el('span', 'picker-item-main')
    main.append(el('strong', null, c.other_name))
    row.append(av, main)
    row.addEventListener('click', () => forwardTo(m, c, row))
    li.append(row)
    return li
  })
  $('forward-list').replaceChildren(...rows)
  $('forward-empty').hidden = rows.length > 0
  $('forward-dialog').showModal()
})

async function forwardTo(m, c, row) {
  row.disabled = true
  let file
  try {
    file = await messageFile(m)
  } catch {
    row.disabled = false
    return toast('Não foi possível pegar a foto.')
  }
  $('forward-dialog').close()
  $('viewer').close()
  await openConversation(c)
  if (state.current === c) await sendAttachment(file, { sticker: !!m.sticker, anim: m.stickerAnim })
}

// ---------- Menu da mensagem (tocar e segurar, ou clique direito) ----------

let menuMsg = null

function openMsgMenu(bubble) {
  const m = state.msgs.find((x) => String(x.id) === bubble.dataset.id)
  if (!m || m.pending || $('msg-menu').open) return
  menuMsg = m
  const mine = m.sender_id === state.user.id
  $('msg-copy').hidden = !(m.body && !m.deleted_at && !m.locked && !stickerOf(m.body))
  $('msg-save').hidden = !(m.attachment_path && (m.attachment_type || '').startsWith('image/') && !m.locked)
  $('msg-gallery').hidden = $('msg-save').hidden
  $('msg-delete-all').hidden = !mine || !!m.deleted_at
  // Fecha o teclado e o painel de emojis: senão eles cobrem as opções de baixo do menu.
  document.activeElement?.blur()
  emojiPicker.close()
  $('msg-menu').showModal()
}

const msgBox = $('messages')
let pressTimer = null
let pressStart = null
let pressFired = false // segurou: o toque que vem depois não abre a foto
let lastPointer = 'mouse'

msgBox.addEventListener('pointerdown', (e) => {
  lastPointer = e.pointerType
  const bubble = e.target.closest('.msg')
  if (!bubble || e.pointerType === 'mouse') return
  pressStart = { x: e.clientX, y: e.clientY }
  pressFired = false
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressFired = true
    openMsgMenu(bubble)
  }, 500)
})
const cancelPress = () => clearTimeout(pressTimer)
msgBox.addEventListener('pointermove', (e) => {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress()
})
msgBox.addEventListener('pointerup', cancelPress)
msgBox.addEventListener('pointercancel', cancelPress)
msgBox.addEventListener('scroll', cancelPress)
// Clique direito no computador; no Android, segurar também chega aqui.
msgBox.addEventListener('contextmenu', (e) => {
  const bubble = e.target.closest('.msg')
  if (!bubble) return
  e.preventDefault()
  cancelPress()
  pressFired = lastPointer !== 'mouse'
  openMsgMenu(bubble)
})
msgBox.addEventListener('click', (e) => {
  if (!pressFired) return
  pressFired = false
  e.preventDefault()
  e.stopPropagation()
}, true)

$('msg-menu').addEventListener('click', (e) => {
  if (e.target.id === 'msg-menu') $('msg-menu').close() // tocou fora
})

$('msg-save').addEventListener('click', () => {
  $('msg-menu').close()
  saveMessageImage(menuMsg)
})

$('msg-gallery').addEventListener('click', () => {
  $('msg-menu').close()
  saveToGallery(menuMsg)
})

$('msg-copy').addEventListener('click', async () => {
  $('msg-menu').close()
  try {
    await navigator.clipboard.writeText(menuMsg.body)
    toast('Texto copiado.')
  } catch {
    toast('Não foi possível copiar.')
  }
})

// Apagar para mim: some só daqui. Dá para desfazer.
$('msg-hide').addEventListener('click', async () => {
  const m = menuMsg
  $('msg-menu').close()
  const { error } = await supabase.rpc('hide_message', { p_id: m.id })
  if (error) return toast('Não foi possível apagar: ' + error.message)
  removeMessage(m)
  scheduleListRefresh()
  toast('Mensagem apagada.', {
    label: 'Desfazer',
    run: async () => {
      const { error: undo } = await supabase.rpc('hide_message', { p_id: m.id, p_hide: false })
      if (undo) return toast('Não foi possível desfazer: ' + undo.message)
      if (state.current?.conversation_id === m.conversation_id && !state.msgs.some((x) => x.id === m.id)) {
        state.msgs.push(m)
        state.msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        renderMessages()
      }
      scheduleListRefresh()
    },
  })
})

// Apagar para todos: só quem enviou. Não dá para desfazer.
$('msg-delete-all').addEventListener('click', async () => {
  const m = menuMsg
  $('msg-menu').close()
  if (!confirm('Apagar esta mensagem para todos? Não dá para desfazer.')) return
  const { data: path, error } = await supabase.rpc('delete_message_for_all', { p_id: m.id })
  if (error) return toast('Não foi possível apagar: ' + error.message)
  if (path) supabase.storage.from('attachments').remove([path]) // o arquivo cifrado sai do servidor
  applyDeleted(m, new Date().toISOString())
  scheduleListRefresh()
})

// Tem partes transparentes? (recorte de foto, figurinha). Olha um pixel a cada 4.
function hasClearPixels(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true
  return false
}

// Imagem recortada (fundo transparente)? Confere numa cópia pequena (no 1º quadro, se for animada).
function isCutout(blob) {
  return new Promise((resolve) => {
    if (!/^image\/(png|webp|gif)$/.test(blob.type)) return resolve(false)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(hasClearPixels(canvas))
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      resolve(false)
    }
    img.src = URL.createObjectURL(blob)
  })
}

// WebP ou PNG animado? (o desenho no canvas pegaria só o 1º quadro)
// O WebP animado tem o bloco "ANIM" e o PNG animado tem o "acTL", ambos logo no começo do arquivo.
async function isAnimated(file) {
  if (!/^image\/(png|webp)$/.test(file.type)) return false
  try {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer())
    const tag = file.type === 'image/webp' ? 'ANIM' : 'acTL'
    const codes = [...tag].map((ch) => ch.charCodeAt(0))
    for (let i = 0; i + 4 <= head.length; i++) {
      if (codes.every((c, j) => head[i + j] === c)) return true
      if (tag === 'acTL' && head[i] === 73 && head[i + 1] === 68 && head[i + 2] === 65 && head[i + 3] === 84) return false // chegou no IDAT
    }
  } catch {}
  return false
}

// Fotos grandes viram JPEG de até 1600px (economiza internet e espaço). GIFs e animados vão como estão.
// Recortes (com fundo transparente) continuam PNG, para o recorte não ganhar fundo.
async function shrinkImage(file, max = 1600) {
  if (await isAnimated(file)) return file
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
      const clear = /^image\/(png|webp)$/.test(file.type) && hasClearPixels(canvas)
      const [type, ext] = clear ? ['image/png', '.png'] : ['image/jpeg', '.jpg']
      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) return resolve(file)
        const name = file.name.replace(/\.[^.]+$/, '') + ext
        resolve(new File([blob], name, { type }))
      }, type, 0.82)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      resolve(file)
    }
    img.src = URL.createObjectURL(file)
  })
}

// sticker: imagem recortada que vai como figurinha (sem balão); anim: como ela se mexe.
async function sendAttachment(original, { sticker = false, anim = '' } = {}) {
  const stickerAnim = sticker ? validAnim(anim) : ''
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
    sticker,
    stickerAnim,
    pending: true,
  }
  addMessage(tmp, true)

  // O arquivo e o nome dele vão cifrados; o caminho no Storage não tem o nome.
  const path = `${conv.conversation_id}/${crypto.randomUUID()}`
  let data = null
  let error = null
  try {
    const { keyId, key } = await sendKeyFor(conv.conversation_id)
    const sealed = await cripto.encryptFile(key, conv.conversation_id, file)
    const up = await supabase.storage.from('attachments').upload(path, sealed, { contentType: 'application/octet-stream' })
    if (up.error) throw up.error
    saveFile(path, sealed) // a cópia cifrada fica no aparelho: abre sem baixar de novo
    ;({ data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conv.conversation_id,
        key_id: keyId,
        ciphertext: await cripto.encryptMessage(key, conv.conversation_id, {
          n: original.name,
          y: type,
          ...(sticker && { f: 1 }),
          ...(stickerAnim && { a: stickerAnim }),
        }),
        attachment_path: path,
        attachment_type: type,
        attachment_size: file.size,
      })
      .select(MSG_COLS)
      .single())
    if (error) await supabase.storage.from('attachments').remove([path])
  } catch (err) {
    error = err
  }

  if (state.current !== conv) return
  removeMessage(tmp)
  if (error) {
    toast('Não foi possível enviar o arquivo: ' + error.message)
    return
  }
  // O arquivo aparece e abre na hora, sem baixar de novo.
  urlCache.set('blob:' + path, { url: tmp.localUrl || URL.createObjectURL(file), blob: true, expires: Infinity })
  data.localUrl = tmp.localUrl
  data.attachment_name = original.name
  data.sticker = sticker
  data.stickerAnim = stickerAnim
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
const emojiPicker = setupEmojiPicker({
  input,
  button: $('emoji-btn'),
  panel: $('emoji-panel'),
  onSticker: (name) => sendText(stickerText(name)),
  saved: {
    load: () => listSaved(state.user.id),
    remove: removeSaved,
    add: () => $('saved-input').click(),
    paste: pasteFromClipboard,
    pick: async (id, anim) => {
      const item = await getSaved(id).catch(() => null)
      if (item) sendAttachment(new File([item.blob], item.name, { type: item.type }), { sticker: !!item.cutout, anim })
    },
  },
})

// Guarda imagens nas salvas (sem enviar). Recortes continuam com o fundo transparente.
async function saveImages(files) {
  let n = 0
  for (const original of files) {
    try {
      const file = await shrinkImage(original)
      if (await addSaved(state.user.id, file, file.name, { cutout: await isCutout(file) })) n++
    } catch (err) {
      toast(`"${original.name}": ${err.message}`)
      return
    }
  }
  toast(n === 0 ? 'Essa imagem já está nas salvas.' : n === 1 ? '⭐ Salva! Toque nela para enviar.' : `⭐ ${n} imagens salvas.`)
  emojiPicker.openSaved()
}

const extOf = (type) => ({ 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' })[type] || type.split('/')[1] || 'png'
const imagesOf = (files) => [...(files || [])].filter((f) => f.type.startsWith('image/'))

// "+" na aba Salvas: escolhe imagens do celular.
$('saved-input').addEventListener('change', (e) => {
  const files = imagesOf(e.target.files)
  e.target.value = ''
  if (files.length) saveImages(files)
})

// Colar um recorte na caixa de mensagem: vai para as salvas, pronto para enviar.
input.addEventListener('paste', (e) => {
  const files = imagesOf(e.clipboardData?.files)
  if (!files.length) return
  e.preventDefault()
  saveImages(files.map((f, i) => (f.name && !/^image\.\w+$/.test(f.name) ? f : new File([f], `recorte-${Date.now()}-${i}.${extOf(f.type)}`, { type: f.type }))))
})

// Botão "Colar" na aba Salvas.
async function pasteFromClipboard() {
  try {
    const files = []
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) files.push(new File([await item.getType(type)], `recorte-${Date.now()}.${extOf(type)}`, { type }))
    }
    if (!files.length) return toast('Não tem imagem copiada. Copie o recorte primeiro e depois toque em Colar.')
    saveImages(files)
  } catch {
    toast('O celular não deixou colar por aqui. Toque e segure na caixa de mensagem e escolha "Colar".')
  }
}

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

$('send-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text || !state.current) return
  input.value = ''
  autosize()
  sendText(text)
})

// Envia um texto (ou o código de uma figurinha) na conversa aberta.
async function sendText(text) {
  const conv = state.current
  if (!conv) return
  const tmp = {
    id: 'tmp-' + ++tmpSeq,
    conversation_id: conv.conversation_id,
    sender_id: state.user.id,
    body: text,
    created_at: new Date().toISOString(),
    read_at: null,
    pending: true,
  }
  addMessage(tmp, true)

  let data = null
  let error = null
  try {
    const { keyId, key } = await sendKeyFor(conv.conversation_id)
    ;({ data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conv.conversation_id,
        key_id: keyId,
        ciphertext: await cripto.encryptMessage(key, conv.conversation_id, { t: text }),
      })
      .select(MSG_COLS)
      .single())
  } catch (err) {
    error = err
  }

  if (state.current !== conv) return
  removeMessage(tmp)
  if (error) {
    if (!input.value && !stickerOf(text)) input.value = text
    alert('Não foi possível enviar: ' + error.message)
    return
  }
  data.body = text
  addMessage(data)
  emojiRain($('chat-view'), emojiOnly(text) || stickerRain(text))
  scheduleListRefresh()
}

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

// Uma busca só: nome filtra os contatos; e-mail completo ou telefone com DDD procura no Nexo.

const APP_URL = location.origin + location.pathname
const INVITE_TEXT = `Vamos conversar pelo Nexo! É só abrir ${APP_URL} e entrar.`
const hasContactPicker = 'contacts' in navigator && 'select' in navigator.contacts
let pickerSeq = 0
let pickerTimer = null

function queryKind(q) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q)) return 'email'
  const digits = q.replace(/\D/g, '')
  if (/^[\d\s()+.-]+$/.test(q) && digits.length >= 10) return 'phone'
  if (q.includes('@') || (/^[\d\s()+.-]+$/.test(q) && digits.length > 0)) return 'partial'
  return 'name'
}

function pickerRow(person, subtitle, action) {
  const li = el('li')
  const row = el('button', 'picker-item')
  row.type = 'button'
  const av = el('div', 'avatar')
  avatar(av, person.name, person.id, person.avatar_url)
  const main = el('span', 'picker-item-main')
  main.append(el('strong', null, person.name))
  if (subtitle) main.append(el('small', null, subtitle))
  row.append(av, main)
  if (action) row.append(el('span', 'btn btn-small', action))
  row.addEventListener('click', () => startChatWith(person.id, row))
  li.append(row)
  return li
}

function renderPickerContacts(q) {
  const contacts = state.conversations
  const n = normalize(q)
  const shown = q ? contacts.filter((c) => normalize(c.other_name).includes(n)) : contacts
  const list = $('picker-contacts')
  list.replaceChildren(
    ...shown.map((c) =>
      pickerRow({ id: c.other_id, name: c.other_name, avatar_url: c.other_avatar }, c.last_body || 'Nova conversa'),
    ),
  )
  $('picker-count').textContent = contacts.length === 1 ? '1 contato' : `${contacts.length} contatos`
  const empty = $('picker-contacts-empty')
  empty.hidden = shown.length > 0
  empty.textContent = contacts.length
    ? 'Nenhum contato com esse nome.'
    : 'Você ainda não tem contatos. Busque alguém pelo e-mail ou telefone.'
  $('picker-contacts-section').hidden = !!q && shown.length === 0 && queryKind(q) !== 'name'
}

function resetPickerSearch() {
  $('picker-hint').hidden = true
  $('picker-found-section').hidden = true
  $('picker-notfound').hidden = true
}

async function updatePicker() {
  const q = $('picker-input').value.trim()
  const kind = queryKind(q)
  const seq = ++pickerSeq
  clearTimeout(pickerTimer)
  resetPickerSearch()
  renderPickerContacts(kind === 'name' ? q : '')
  if (!q || kind === 'name') return

  const hint = $('picker-hint')
  hint.hidden = false
  if (kind === 'partial') {
    hint.textContent = q.includes('@')
      ? 'Continue digitando o e-mail completo…'
      : 'Digite o telefone com DDD, por exemplo (11) 91234-5678.'
    return
  }

  hint.textContent = 'Procurando no Nexo…'
  pickerTimer = setTimeout(async () => {
    const { data: found, error } = await supabase.rpc('find_user', { p_query: q })
    if (seq !== pickerSeq) return
    hint.hidden = true
    if (error) {
      hint.hidden = false
      hint.textContent = 'Não foi possível procurar agora. Verifique a internet.'
      return
    }
    if (found?.length) {
      $('picker-found').replaceChildren(...found.map((p) => pickerRow(p, q, 'Conversar')))
      $('picker-found-section').hidden = false
    } else {
      showNotFound(q, kind)
    }
  }, 400)
}

function showNotFound(q, kind) {
  $('picker-notfound-title').textContent =
    kind === 'email' ? 'Ninguém com esse e-mail usa o Nexo ainda.' : 'Ninguém com esse telefone usa o Nexo ainda.'
  const direct = $('invite-direct')
  if (kind === 'phone') {
    let digits = q.replace(/\D/g, '').replace(/^0+/, '')
    if (digits.length <= 11) digits = '55' + digits
    direct.href = `https://wa.me/${digits}?text=${encodeURIComponent(INVITE_TEXT)}`
    direct.textContent = 'Convidar pelo WhatsApp'
  } else {
    direct.href = `mailto:${q}?subject=${encodeURIComponent('Vamos conversar pelo Nexo')}&body=${encodeURIComponent(INVITE_TEXT)}`
    direct.textContent = 'Convidar por e-mail'
  }
  $('picker-notfound').hidden = false
}

async function shareInvite() {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Nexo', text: INVITE_TEXT, url: APP_URL })
    } catch {
      // a pessoa fechou a janela de compartilhar
    }
    return
  }
  try {
    await navigator.clipboard.writeText(INVITE_TEXT)
    toast('Convite copiado. Cole onde quiser enviar.')
  } catch {
    toast(INVITE_TEXT)
  }
}

async function startChatWith(userId, row) {
  row.disabled = true
  const { data: convId, error } = await supabase.rpc('start_direct_chat', { p_other: userId })
  row.disabled = false
  if (error) return toast('Não foi possível abrir a conversa: ' + error.message)
  $('new-chat-dialog').close()
  await loadConversations(convId)
  openById(convId)
}

function openNewChat() {
  $('picker-input').value = ''
  $('pick-contact').hidden = !hasContactPicker
  updatePicker()
  $('new-chat-dialog').showModal()
  $('picker-input').focus()
}
$('new-chat-btn').addEventListener('click', openNewChat)
$('new-chat-empty').addEventListener('click', openNewChat)
$('picker-input').addEventListener('input', updatePicker)
$('invite-btn').addEventListener('click', shareInvite)
$('invite-share').addEventListener('click', shareInvite)

// Agenda do celular (Chrome no Android): pega o telefone ou e-mail e procura no Nexo.
$('pick-contact').addEventListener('click', async () => {
  try {
    const [contact] = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: false })
    if (!contact) return
    const value = contact.tel?.[0] || contact.email?.[0]
    if (!value) return toast('Esse contato não tem telefone nem e-mail.')
    $('picker-input').value = value
    updatePicker()
  } catch {
    // a pessoa cancelou
  }
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
  await cripto.localClear().catch(() => {}) // as chaves saem do aparelho junto com a conta
  await caches.delete(FILES_CACHE).catch(() => {})
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

// ---------- Tamanho da tela (teclado do celular) ----------

// Mantém o app do tamanho da área visível: com o teclado aberto, o topo e a caixa
// de mensagem continuam na tela (principalmente no iPhone, que não encolhe a página).
// Só mexe no tamanho quando o teclado está aberto; no resto do tempo vale o 100dvh do CSS.
let fitFrame = 0
let keyboardOpen = false

function fitViewport() {
  cancelAnimationFrame(fitFrame)
  fitFrame = requestAnimationFrame(() => {
    const vv = window.visualViewport
    const root = document.documentElement.style
    const open = vv && vv.height > 200 && window.innerHeight - vv.height > 120
    if (open) {
      root.setProperty('--app-h', Math.round(vv.height) + 'px')
      root.setProperty('--app-top', Math.round(vv.offsetTop) + 'px')
    } else {
      root.removeProperty('--app-h')
      root.removeProperty('--app-top')
    }
    // Teclado acabou de abrir enquanto digita: as últimas mensagens continuam à vista.
    if (open && !keyboardOpen && document.activeElement === $('msg-input')) {
      $('messages').scrollTop = $('messages').scrollHeight
    }
    keyboardOpen = !!open
  })
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', fitViewport)
  visualViewport.addEventListener('scroll', fitViewport)
}

// ---------- Início ----------

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')

if (!configured) {
  show('login')
  $('email-form').hidden = true
  $('google-area').hidden = true
  setMsg($('login-msg'), 'Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.', true)
} else {
  // setTimeout evita chamar o Supabase de dentro do callback de autenticação.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => handleSession(session), 0)
  })
}
