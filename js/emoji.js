// Emojis do Nexo: painel para escolher, emojis grandes e animados nas mensagens
// e "chuva" de emojis. Tudo local (sem baixar imagens de fora), então nada vaza da criptografia.

import { STICKER_NAMES, stickerSvg, stickerLabel } from './figurinhas.js'
import { CUT_ANIMS, cutAnimClass, loadAnim, saveAnim } from './salvas.js'
import { GRUPOS, TONAVEIS, NOVOS } from './emoji-dados.js'

// Todos os emojis do teclado do celular, nas mesmas categorias.
const CATEGORIES = [
  { icon: '🕘', name: 'Recentes', list: [] },
  { icon: '😀', name: 'Carinhas e emoções', list: GRUPOS.carinhas },
  { icon: '👋', name: 'Pessoas e gestos', list: GRUPOS.pessoas },
  { icon: '🐶', name: 'Animais e natureza', list: GRUPOS.natureza },
  { icon: '🍕', name: 'Comidas e bebidas', list: GRUPOS.comida },
  { icon: '✈️', name: 'Viagens e lugares', list: GRUPOS.viagens },
  { icon: '⚽', name: 'Atividades', list: GRUPOS.atividades },
  { icon: '💡', name: 'Objetos', list: GRUPOS.objetos },
  { icon: '🔣', name: 'Símbolos', list: GRUPOS.simbolos },
  { icon: '🏳️', name: 'Bandeiras', list: GRUPOS.bandeiras },
  { icon: 'bolota-oi', name: 'Figurinhas', stickers: true, list: STICKER_NAMES },
]
for (const c of CATEGORIES) if (typeof c.list === 'string') c.list = c.list.split(' ')

// ---------- Tons de pele ----------

const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}']
const TONEABLE = new Set(TONAVEIS.split(' '))
const TONE_KEY = 'nexo-emoji-tom'

// Põe o tom logo depois do primeiro caractere (tirando o "️" que vem ali, se houver).
function withTone(emoji, tone) {
  if (!tone || !TONEABLE.has(emoji)) return emoji
  const [first, ...rest] = Array.from(emoji)
  if (rest[0] === '️') rest.shift()
  return first + tone + rest.join('')
}

// ---------- Emojis novos que o aparelho ainda não desenha ----------
// Celular antigo mostra um quadradinho (ou dois emojis lado a lado) no lugar do emoji novo.
// Conferimos uma vez, desenhando num canvas, e escondemos os que não funcionam.

let missing = null
function findMissing() {
  if (missing) return missing
  missing = new Set()
  try {
    const size = 32
    const c = document.createElement('canvas')
    c.width = c.height = size * 2
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.font = size + 'px sans-serif'
    ctx.textBaseline = 'top'
    const ref = ctx.measureText('😀').width
    for (const e of NOVOS.split(' ')) {
      if (ctx.measureText(e).width > ref * 1.4) { missing.add(e); continue } // virou dois desenhos
      ctx.clearRect(0, 0, c.width, c.height)
      // Pinta de vermelho puro: o quadradinho sai vermelho; um emoji de verdade tem suas próprias cores.
      ctx.fillStyle = '#f00'
      ctx.fillText(e, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let color = false
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 40 && (d[i + 1] > 30 || d[i + 2] > 30)) { color = true; break }
      }
      if (!color) missing.add(e)
    }
  } catch {}
  return missing
}

// ---------- Mensagem só de emojis (até 3) ----------

const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// Devolve a lista de emojis se o texto for só emojis (1 a 3); senão, null.
export function emojiOnly(text) {
  const t = (text || '').replace(/\s+/g, '')
  if (!t || t.length > 40) return null
  const list = segmenter ? [...segmenter.segment(t)].map((s) => s.segment) : Array.from(t)
  return list.length <= 3 && list.every((g) => PICTO.test(g)) ? list : null
}

// Cada emoji ganha um jeito de se mexer.
const MOTIONS = {
  beat: '❤️ 🧡 💛 💚 💙 🩵 💜 🖤 🤍 🤎 💕 💞 💓 💗 💖 💘 💝 ❤️‍🔥 🥰 😍 😘 😻 💋',
  laugh: '😂 🤣 😆 😅 😹 😁 😄',
  wave: '👋 🤚 🖐️ ✋',
  flicker: '🔥 ✨ ⚡ 🎆 🎇 💥',
  jump: '🎉 🎊 🥳 🎈 🎁 🎂 🏆 🥇 🚀 💃 🕺',
  spin: '😵‍💫 ⭐ 🌟 💫 🌀 ⚽ 🏀',
  pump: '👍 👏 🙌 💪 ✊ 👊 🤝 🫶 ✌️ 🤘 👌',
  cry: '😭 😢 🥺 🥹 😿 💔',
  angry: '😡 😠 🤬 😤 👿',
  shy: '🙈 🫣 🤭 😳 😊',
}
const strip = (g) => g.replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, '') // sem variação nem tom de pele
const MOTION_OF = new Map()
for (const [motion, list] of Object.entries(MOTIONS)) for (const g of list.split(' ')) MOTION_OF.set(strip(g), motion)

export function motionFor(emoji) {
  return 'em-' + (MOTION_OF.get(strip(emoji)) || 'bob')
}

// ---------- Chuva de emojis (quando chega um ❤️, 🎉, 🔥…) ----------

const RAIN = [
  [MOTIONS.beat.split(' ').slice(0, 17), ['❤️', '💖', '💕', '💗']],
  [['🎉', '🎊', '🥳', '🎈'], ['🎉', '🎊', '✨', '🎈', '🥳']],
  [['🎂'], ['🎂', '🎉', '🎈', '✨']],
  [['🔥'], ['🔥']],
  [['😂', '🤣'], ['😂', '🤣']],
  [['👏'], ['👏', '✨']],
  [['⭐', '🌟', '✨'], ['⭐', '🌟', '✨']],
]

function rainFor(list) {
  const first = strip(list[0])
  const hit = RAIN.find(([triggers]) => triggers.some((t) => strip(t) === first))
  return hit ? hit[1] : null
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

export function emojiRain(container, list) {
  const drops = list && rainFor(list)
  if (!drops || reducedMotion.matches) return
  const layer = document.createElement('div')
  layer.className = 'emoji-rain'
  layer.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('span')
    s.textContent = drops[i % drops.length]
    s.style.left = Math.random() * 96 + '%'
    s.style.fontSize = 18 + Math.random() * 26 + 'px'
    s.style.animationDelay = Math.random() * 0.9 + 's'
    s.style.animationDuration = 2 + Math.random() * 1.4 + 's'
    s.style.setProperty('--sway', (Math.random() * 80 - 40).toFixed(0) + 'px')
    s.style.setProperty('--turn', (Math.random() * 60 - 30).toFixed(0) + 'deg')
    layer.append(s)
  }
  container.append(layer)
  setTimeout(() => layer.remove(), 4000)
}

// ---------- Painel para escolher ----------

const RECENT_KEY = 'nexo-emoji-recentes'

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || []
  } catch {
    return []
  }
}

function saveRecent(emoji) {
  const list = [emoji, ...loadRecent().filter((e) => e !== emoji)].slice(0, 32)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch {}
  CATEGORIES[0].list = list
}

// Aba "Salvas": imagens que a pessoa guardou neste aparelho (quem guarda é o app.js).
const SAVED = { icon: '⭐', name: 'Salvas', saved: true, list: [] }
CATEGORIES.push(SAVED)

// saved: { load() → [{ id, blob, name, cutout }], pick(id, anim), remove(id), add(), paste() }
export function setupEmojiPicker({ input, button, panel, onSticker, saved }) {
  CATEGORIES[0].list = loadRecent()
  let tone = ''
  try { tone = localStorage.getItem(TONE_KEY) || '' } catch {}
  if (!TONES.includes(tone)) tone = ''
  let savedUrls = []
  let savedTurn = 0
  let anim = loadAnim() // animação escolhida para os recortes

  // Fileira "Animação: Parado · Pulando · …". Trocar muda na hora os recortes do painel.
  function animRow() {
    const row = document.createElement('div')
    row.className = 'anim-row'
    row.setAttribute('role', 'radiogroup')
    row.setAttribute('aria-label', 'Animação dos recortes')
    row.append(Object.assign(document.createElement('small'), { textContent: 'Animação dos recortes:' }))
    for (const [value, label] of CUT_ANIMS) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'anim-chip'
      chip.dataset.anim = value
      chip.textContent = label
      chip.setAttribute('role', 'radio')
      chip.setAttribute('aria-checked', String(value === anim))
      row.append(chip)
    }
    return row
  }

  function applyAnim() {
    grid.querySelectorAll('.anim-chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.anim === anim)))
    // Recortes com animação própria (salvos de uma mensagem) não mudam.
    grid.querySelectorAll('.saved-cell.cutout:not([data-own-anim]) img').forEach((img) => (img.className = cutAnimClass(anim)))
  }

  async function showSaved() {
    const turn = ++savedTurn
    let items = []
    try {
      items = await saved.load()
    } catch {}
    if (turn !== savedTurn || CATEGORIES[current] !== SAVED) return
    savedUrls.forEach((u) => URL.revokeObjectURL(u))
    savedUrls = []
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'emoji-cell saved-cell saved-add'
    add.dataset.add = '1'
    add.title = 'Adicionar imagem do celular'
    add.innerHTML = '<span aria-hidden="true">+</span><small>Adicionar</small>'
    const paste = document.createElement('button')
    paste.type = 'button'
    paste.className = 'emoji-cell saved-cell saved-add'
    paste.dataset.paste = '1'
    paste.title = 'Colar um recorte copiado'
    paste.innerHTML = '<span aria-hidden="true">📋</span><small>Colar</small>'
    const cells = items.map((item) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'emoji-cell saved-cell' + (item.cutout ? ' cutout' : '')
      b.dataset.saved = item.id
      b.title = 'Enviar ' + item.name
      const img = document.createElement('img')
      img.alt = item.name
      if (item.anim) b.dataset.ownAnim = item.anim
      if (item.cutout) img.className = cutAnimClass(item.anim || anim)
      img.src = URL.createObjectURL(item.blob)
      savedUrls.push(img.src)
      const del = document.createElement('span')
      del.className = 'saved-del'
      del.dataset.del = item.id
      del.setAttribute('role', 'button')
      del.setAttribute('aria-label', 'Apagar ' + item.name)
      del.textContent = '×'
      b.append(img, del)
      return b
    })
    grid.replaceChildren(animRow(), add, paste, ...cells)
    if (!items.length) {
      const p = document.createElement('p')
      p.className = 'emoji-empty'
      p.textContent = 'Copie um recorte de foto e toque em Colar (ou cole na caixa de mensagem). Também dá para tocar na ⭐ de uma foto da conversa, ou em + para escolher do celular.'
      grid.append(p)
    }
  }
  const tabs = document.createElement('div')
  tabs.className = 'emoji-tabs'
  tabs.setAttribute('role', 'tablist')
  const grid = document.createElement('div')
  grid.className = 'emoji-grid'
  panel.append(tabs, grid)
  let current = CATEGORIES[0].list.length ? 0 : 1

  function showCategory(i) {
    current = i
    tabs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', String(j === i)))
    grid.replaceChildren()
    const { list, name, stickers } = CATEGORIES[i]
    grid.setAttribute('aria-label', name)
    grid.classList.toggle('stickers', !!stickers || CATEGORIES[i] === SAVED)
    if (CATEGORIES[i] === SAVED) return showSaved()
    if (!list.length) {
      const p = document.createElement('p')
      p.className = 'emoji-empty'
      p.textContent = 'Os emojis que você usar aparecem aqui.'
      grid.append(p)
    }
    const hide = stickers ? null : findMissing()
    for (const emoji of list) {
      if (hide?.has(emoji)) continue
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'emoji-cell'
      if (!stickers && TONEABLE.has(emoji)) {
        // Segurar o dedo abre os tons de pele.
        b.dataset.base = emoji
        b.classList.add('toneable')
        b.textContent = withTone(emoji, tone)
      } else if (stickers) {
        // Figurinha: toca e já envia.
        b.classList.add('sticker-cell')
        b.dataset.fig = emoji
        b.title = stickerLabel(emoji)
        b.innerHTML = stickerSvg(emoji)
      } else b.textContent = emoji
      grid.append(b)
    }
    grid.scrollTop = 0
  }

  CATEGORIES.forEach((c, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'emoji-tab'
    if (c.stickers) b.innerHTML = stickerSvg(c.icon)
    else b.textContent = c.icon
    b.title = c.name
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-label', c.name)
    b.addEventListener('click', () => showCategory(i))
    tabs.append(b)
  })

  // ---------- Segurar um emoji: escolher o tom de pele ----------
  const tonePop = document.createElement('div')
  tonePop.className = 'tone-pop'
  tonePop.hidden = true
  tonePop.setAttribute('role', 'menu')
  tonePop.setAttribute('aria-label', 'Tom de pele')
  panel.append(tonePop)
  let pressTimer = 0
  let pressStart = null
  let skipClick = false

  function closeTones() {
    tonePop.hidden = true
  }

  function openTones(cell) {
    const base = cell.dataset.base
    tonePop.replaceChildren(
      ...TONES.map((t) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'tone-opt'
        b.dataset.tone = t
        b.setAttribute('role', 'menuitem')
        b.setAttribute('aria-pressed', String(t === tone))
        b.textContent = withTone(base, t)
        return b
      })
    )
    tonePop.hidden = false
    const p = panel.getBoundingClientRect()
    const c = cell.getBoundingClientRect()
    const w = tonePop.offsetWidth
    const left = Math.min(Math.max(c.left + c.width / 2 - w / 2 - p.left, 4), p.width - w - 4)
    tonePop.style.left = left + 'px'
    tonePop.style.top = Math.max(c.top - p.top - tonePop.offsetHeight - 4, 4) + 'px'
    navigator.vibrate?.(15)
  }

  tonePop.addEventListener('click', (e) => {
    const opt = e.target.closest('.tone-opt')
    if (!opt) return
    tone = opt.dataset.tone
    try { localStorage.setItem(TONE_KEY, tone) } catch {}
    insert(opt.textContent)
    closeTones()
    showCategory(current) // a categoria passa a mostrar o tom escolhido
  })

  grid.addEventListener('pointerdown', (e) => {
    closeTones()
    skipClick = false
    const cell = e.target.closest('.emoji-cell.toneable')
    if (!cell) return
    pressStart = [e.clientX, e.clientY]
    clearTimeout(pressTimer)
    pressTimer = setTimeout(() => {
      skipClick = true
      openTones(cell)
    }, 420)
  })
  grid.addEventListener('pointermove', (e) => {
    if (pressStart && Math.hypot(e.clientX - pressStart[0], e.clientY - pressStart[1]) > 10) clearTimeout(pressTimer)
  })
  for (const ev of ['pointerup', 'pointercancel', 'scroll']) grid.addEventListener(ev, () => clearTimeout(pressTimer))
  grid.addEventListener('scroll', closeTones)
  grid.addEventListener('contextmenu', (e) => e.target.closest('.emoji-cell') && e.preventDefault())

  function insert(emoji) {
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    input.setRangeText(emoji, start, end, 'end')
    input.dispatchEvent(new Event('input')) // ajusta a altura e avisa "digitando…"
    saveRecent(emoji)
  }

  grid.addEventListener('click', (e) => {
    if (skipClick) {
      skipClick = false // foi um "segurar", não um toque
      return
    }
    const chip = e.target.closest('.anim-chip')
    if (chip) {
      anim = chip.dataset.anim
      saveAnim(anim)
      applyAnim()
      return
    }
    const cell = e.target.closest('.emoji-cell')
    if (!cell) return
    const del = e.target.closest('[data-del]')
    if (del) {
      if (confirm('Apagar esta imagem das salvas?')) saved.remove(del.dataset.del).then(showSaved, showSaved)
      return
    }
    if (cell.dataset.add) return saved.add()
    if (cell.dataset.paste) return saved.paste()
    if (cell.dataset.saved) {
      cell.classList.remove('pop')
      void cell.offsetWidth // reinicia a animação
      cell.classList.add('pop')
      saved.pick(cell.dataset.saved, cell.dataset.ownAnim || anim)
      return
    }
    if (cell.dataset.fig) {
      cell.classList.remove('pop')
      void cell.offsetWidth // reinicia a animação
      cell.classList.add('pop')
      onSticker?.(cell.dataset.fig)
      return
    }
    insert(cell.textContent)
    cell.classList.remove('pop')
    void cell.offsetWidth // reinicia a animação
    cell.classList.add('pop')
    if (current === 0) showCategory(0)
  })

  function toggle(open) {
    panel.hidden = !open
    closeTones()
    button.setAttribute('aria-expanded', String(open))
    button.classList.toggle('active', open)
    if (open) {
      showCategory(current)
      // No celular, fecha o teclado para o painel aparecer no lugar dele.
      if (matchMedia('(pointer: coarse)').matches) input.blur()
    }
  }

  button.addEventListener('click', () => toggle(panel.hidden))
  // Tocar na caixa de mensagem volta para o teclado.
  input.addEventListener('pointerdown', () => matchMedia('(pointer: coarse)').matches && toggle(false))
  return {
    close: () => toggle(false),
    // Atualiza a aba "Salvas" se ela estiver aberta.
    refreshSaved: () => !panel.hidden && CATEGORIES[current] === SAVED && showSaved(),
    // Abre o painel já na aba "Salvas" (depois de colar ou salvar uma imagem).
    openSaved: () => {
      current = CATEGORIES.indexOf(SAVED)
      toggle(true)
    },
  }
}
