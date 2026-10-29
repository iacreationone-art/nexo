// Emojis do Nexo: painel para escolher, emojis grandes e animados nas mensagens
// e "chuva" de emojis. Tudo local (sem baixar imagens de fora), então nada vaza da criptografia.

const CATEGORIES = [
  { icon: '🕘', name: 'Recentes', list: [] },
  { icon: '😀', name: 'Carinhas', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🫠 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😹 😻' },
  { icon: '👋', name: 'Gestos', list: '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💪 🫡 🫢 🫣 🙈 🙉 🙊 👀 🧠 💃 🕺 🙋 🤷 🤦 🙆 🙅' },
  { icon: '❤️', name: 'Corações', list: '❤️ 🧡 💛 💚 💙 🩵 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💋 💌 💯 💢 💥 💫 💦 💨 💬 💭 💤' },
  { icon: '🐶', name: 'Natureza', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🦖 🐙 🦀 🐠 🐬 🐳 🦈 🐊 🦒 🐘 🌸 🌹 🌻 🌷 🌵 🌴 🍀 🌈 ⭐ 🌟 🌙 ☀️ ⛅ 🌧️ ⚡ 🔥 ❄️ ☃️ 🌊' },
  { icon: '🍕', name: 'Comida', list: '🍎 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🌽 🥕 🍞 🧀 🥚 🍳 🥓 🍔 🍟 🍕 🌭 🌮 🌯 🍝 🍜 🍣 🍤 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍿 ☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷 🍹' },
  { icon: '🎉', name: 'Festa', list: '🎉 🎊 🥳 🎈 🎁 🎂 🎄 🎃 ✨ 🎆 🎇 🏆 🥇 ⚽ 🏀 🏐 🎾 🎮 🎲 🎯 🎸 🎤 🎧 🎬 🚀 ✈️ 🚗 🏖️ 🏝️ ⛰️ 🏠 💡 📱 💻 📷 ⏰ 💰 💸 📌 ✅ ❌ ⚠️ ❓ ❗ 🆗 🆒 🆕 🇧🇷' },
]
for (const c of CATEGORIES) if (typeof c.list === 'string') c.list = c.list.split(' ')

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

export function setupEmojiPicker({ input, button, panel }) {
  CATEGORIES[0].list = loadRecent()
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
    const { list, name } = CATEGORIES[i]
    grid.setAttribute('aria-label', name)
    if (!list.length) {
      const p = document.createElement('p')
      p.className = 'emoji-empty'
      p.textContent = 'Os emojis que você usar aparecem aqui.'
      grid.append(p)
    }
    for (const emoji of list) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'emoji-cell'
      b.textContent = emoji
      grid.append(b)
    }
    grid.scrollTop = 0
  }

  CATEGORIES.forEach((c, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'emoji-tab'
    b.textContent = c.icon
    b.title = c.name
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-label', c.name)
    b.addEventListener('click', () => showCategory(i))
    tabs.append(b)
  })

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.emoji-cell')
    if (!cell) return
    const emoji = cell.textContent
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    input.setRangeText(emoji, start, end, 'end')
    input.dispatchEvent(new Event('input')) // ajusta a altura e avisa "digitando…"
    cell.classList.remove('pop')
    void cell.offsetWidth // reinicia a animação
    cell.classList.add('pop')
    saveRecent(emoji)
    if (current === 0) showCategory(0)
  })

  function toggle(open) {
    panel.hidden = !open
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
  return { close: () => toggle(false) }
}
