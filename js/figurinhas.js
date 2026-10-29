// Figurinhas animadas do Nexo: a Turma do Nexo (Bolota, Tuca e Faísca), desenhada aqui mesmo
// em SVG e animada com CSS. Nada vem de fora, então a criptografia continua valendo.
// A mensagem leva só o código da figurinha, por exemplo ":fig:bolota-oi:".

const INK = '#1e2a52'
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`

// Peças posicionadas ficam num <g transform>, e a animação vai no elemento de dentro
// (senão o transform da animação apaga a posição).
const at = (x, y, inner) => `<g transform="translate(${x} ${y})">${inner}</g>`
const delay = (s) => `style="animation-delay:${s}s"`

const eye = (x, y, px, py) =>
  `<ellipse cx="${x}" cy="${y}" rx="8.5" ry="10.5" fill="#fff" ${S}/>` +
  `<circle cx="${x + px}" cy="${y + py}" r="4.2" fill="${INK}"/>` +
  `<circle cx="${x + px + 1.5}" cy="${y + py - 1.8}" r="1.3" fill="#fff"/>`
const eyes = ({ y = 56, dx = 13, px = 0, py = 0, cls = 'fg-blink' } = {}) =>
  `<g class="${cls}">${eye(60 - dx, y, px, py)}${eye(60 + dx, y, px, py)}</g>`
const happyEyes = (y = 58, dx = 13) =>
  `<path d="M${52 - dx} ${y}q8-9 16 0M${52 + dx} ${y}q8-9 16 0" fill="none" ${S}/>`
const sleepyEyes = (y = 58, dx = 13) =>
  `<path d="M${52 - dx} ${y}q8 6 16 0M${52 + dx} ${y}q8 6 16 0" fill="none" ${S}/>`
const blush = (y = 70, dx = 26) =>
  `<ellipse cx="${60 - dx}" cy="${y}" rx="6" ry="3.5" fill="#ff7aa2" opacity=".6"/>` +
  `<ellipse cx="${60 + dx}" cy="${y}" rx="6" ry="3.5" fill="#ff7aa2" opacity=".6"/>`
const heart = (cls = '', extra = '') =>
  `<path class="${cls}" ${extra} d="M0 4C-6-4-14 2-8 9L0 16 8 9C14 2 6-4 0 4z" fill="#ff4d7a" ${S} stroke-width="2.5"/>`
const drop = (cls = '', extra = '') =>
  `<path class="${cls}" ${extra} d="M0 0C3 5 5 8 5 10.5A5 5 0 0 1-5 10.5C-5 8-3 5 0 0z" fill="#7cc8ff" ${S} stroke-width="2"/>`
// Braço com contorno: um traço escuro grosso por baixo e a cor do corpo por cima.
const limb = (d, color) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`
const word = (text, size, fill, cls = '', extra = '') =>
  `<text class="${cls}" ${extra} font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="1.5" paint-order="stroke">${text}</text>`

// ---------- A turma ----------

const BLUE = '#4f8cff'
const GREEN = '#3fbf6f'
const ORANGE = '#ff9a3c'

// Bolota: bolinha azul com anteninhas.
const bolota = (face, { cls = 'fg-bounce', front = '', back = '' } = {}) => `<g class="${cls}">
  ${back}
  <path d="M48 27 40 11M72 27 80 11" ${S}/>
  <circle cx="40" cy="10" r="5" fill="#ffd23f" ${S}/><circle cx="80" cy="10" r="5" fill="#ffd23f" ${S}/>
  <path d="M60 24c27 0 42 22 42 48s-17 36-42 36-42-10-42-36 15-48 42-48z" fill="${BLUE}" ${S}/>
  <ellipse cx="60" cy="93" rx="22" ry="11" fill="#8db5ff"/>
  ${face}${front}</g>`

// Tuca: sapinho verde de olhos saltados.
const tuca = (face, { cls = 'fg-bounce', front = '', back = '', eyesUp = '' } = {}) => `<g class="${cls}">
  ${back}
  <path d="M14 82c0-22 20-34 46-34s46 12 46 34-20 26-46 26-46-4-46-26z" fill="${GREEN}" ${S}/>
  <ellipse cx="60" cy="95" rx="26" ry="9" fill="#9be7b4"/>
  <g class="${eyesUp}"><circle cx="40" cy="46" r="17" fill="${GREEN}" ${S}/><circle cx="80" cy="46" r="17" fill="${GREEN}" ${S}/>
  ${face.eyes}</g>
  ${face.mouth}${front}</g>`

// Faísca: gatinho laranja de rabo listrado.
const faisca = (face, { cls = 'fg-bounce', front = '', back = '', head = '' } = {}) => `<g class="${cls}">
  ${back}
  <g class="fg-tail">${limb('M92 98c18-2 24-20 12-32', ORANGE)}</g>
  <g class="${head}">
    <path d="M26 48 30 14 54 32zM94 48 90 14 66 32z" fill="${ORANGE}" ${S}/>
    <path d="M32 40 34 24 45 33zM88 40 86 24 75 33z" fill="#ffb3c7"/>
    <circle cx="60" cy="66" r="38" fill="${ORANGE}" ${S}/>
  </g>
  <ellipse cx="60" cy="82" rx="18" ry="12" fill="#ffd8b0"/>
  <path d="M56 74h8l-4 4.5z" fill="#ff5d8f" ${S} stroke-width="2"/>
  <path d="M40 80 22 77M40 85 23 88M80 80 98 77M80 85 97 88" ${S} stroke-width="2"/>
  ${face}${front}</g>`

// ---------- As figurinhas ----------

const STICKERS = {
  'bolota-oi': ['Bolota dando oi', () => bolota(
    eyes() + blush() + `<path d="M48 72q12 14 24 0z" fill="${INK}" ${S}/>`,
    {
      back: limb('M24 82 12 92', BLUE),
      front: at(94, 70, `<g class="fg-wave">${limb('M0 0 13-22', BLUE)}<circle cx="13" cy="-22" r="7" fill="${BLUE}" ${S}/></g>`),
    })],

  'bolota-kkk': ['Bolota rindo', () => bolota(
    happyEyes() + `<path d="M42 68q18 28 36 0z" fill="${INK}" ${S}/><ellipse cx="60" cy="80" rx="8" ry="4" fill="#ff6b8b"/>` +
    at(26, 52, drop('fg-tear-l')) + at(94, 52, drop('fg-tear-r')),
    { cls: 'fg-laugh' })],

  'bolota-amo': ['Bolota apaixonada', () => bolota(
    at(47, 48, `<g class="fg-beat">${heart()}</g>`) + at(73, 48, `<g class="fg-beat">${heart()}</g>`) +
    blush(72) + `<path d="M48 74q12 10 24 0" fill="none" ${S}/>` +
    at(18, 30, heart('fg-rise', delay(0))) + at(100, 26, heart('fg-rise', delay(0.7))) + at(60, 12, heart('fg-rise', delay(1.4))),
    { cls: 'fg-sway' })],

  'bolota-zzz': ['Bolota dormindo', () => bolota(
    sleepyEyes() + `<ellipse cx="60" cy="78" rx="5" ry="6" fill="${INK}"/>` +
    at(86, 34, word('Z', 16, '#fff', 'fg-zz', delay(0))) +
    at(94, 22, word('Z', 13, '#fff', 'fg-zz', delay(1))) +
    at(102, 12, word('z', 11, '#fff', 'fg-zz', delay(2))),
    { cls: 'fg-breathe' })],

  'tuca-uau': ['Tuca de queixo caído', () => tuca(
    {
      eyes: eye(40, 46, 0, 0) + eye(80, 46, 0, 0),
      mouth: `<g class="fg-jaw"><ellipse cx="60" cy="80" rx="11" ry="12" fill="${INK}" ${S}/><ellipse cx="60" cy="86" rx="6" ry="3.5" fill="#ff6b8b"/></g>` +
        at(10, 30, word('!', 22, '#ffd23f', 'fg-flash', delay(0))) + at(104, 30, word('!', 22, '#ffd23f', 'fg-flash', delay(0.25))),
    },
    { cls: '', eyesUp: 'fg-pop' })],

  'tuca-danca': ['Tuca dançando', () => tuca(
    { eyes: eye(40, 46, 3, 1) + eye(80, 46, 3, 1), mouth: `<path d="M38 74q22 18 44 0" fill="none" ${S}/>` + blush(80, 30) },
    {
      cls: 'fg-dance',
      back: at(18, 76, `<g class="fg-arm-a">${limb('M0 0-8-24', GREEN)}</g>`) + at(102, 76, `<g class="fg-arm-b">${limb('M0 0 8-24', GREEN)}</g>`),
      front: at(4, 22, word('♪', 20, '#b86bff', 'fg-rise', delay(0))) + at(98, 16, word('♫', 20, '#ff4d7a', 'fg-rise', delay(0.8))),
    })],

  'tuca-joia': ['Tuca fazendo joinha', () => tuca(
    { eyes: eye(40, 46, 0, 0) + `<path d="M72 48q8 6 16 0" fill="none" ${S}/>`, mouth: `<path d="M40 74q20 16 40 0" fill="none" ${S}/>` },
    {
      front: at(98, 74, `<g class="fg-pump"><rect x="-9" y="-6" width="18" height="16" rx="6" fill="${GREEN}" ${S}/><rect x="-6" y="-20" width="7" height="16" rx="3.5" fill="${GREEN}" ${S}/></g>`) +
        at(104, 40, `<path class="fg-flash" d="M0-8 2-2 8 0 2 2 0 8-2 2-8 0-2-2z" fill="#ffd23f" ${S} stroke-width="1.5"/>`),
    })],

  'tuca-choro': ['Tuca chorando', () => tuca(
    {
      eyes: eye(40, 46, 0, 3) + eye(80, 46, 0, 3) + `<path d="M30 30l16 6M90 30l-16 6" ${S}/>`,
      mouth: `<path d="M44 82q16-12 32 0" fill="none" ${S}/>` +
        at(34, 58, drop('fg-drop', delay(0))) + at(86, 58, drop('fg-drop', delay(0.6))) + at(40, 58, drop('fg-drop', delay(1.1))),
    },
    { cls: 'fg-sob' })],

  'faisca-bravo': ['Faísca bravo', () => faisca(
    eyes({ y: 58, dx: 15, py: 1, cls: '' }) + `<path d="M36 44l18 8M84 44l-18 8" ${S} stroke-width="4"/>` +
    `<path d="M48 90l4-5 4 5 4-5 4 5 4-5 4 5" fill="none" ${S}/>`,
    {
      cls: 'fg-shake',
      head: 'fg-hot',
      back: at(22, 14, `<circle class="fg-steam" r="7" fill="#e8ecf5" ${S} stroke-width="2"/>`) +
        at(98, 14, `<circle class="fg-steam" ${delay(0.5)} r="7" fill="#e8ecf5" ${S} stroke-width="2"/>`),
    })],

  'faisca-festa': ['Faísca em festa', () => faisca(
    happyEyes(60, 15) + `<path d="M48 86q12 14 24 0z" fill="${INK}" ${S}/>` + blush(74, 28),
    {
      cls: 'fg-jump',
      front: `<path d="M48 32 60 0 72 32z" fill="#b86bff" ${S}/><path d="M53 20h14M56 11h8" stroke="#ffd23f" stroke-width="3"/><circle cx="60" cy="0" r="4" fill="#ffd23f" ${S} stroke-width="2"/>` +
        at(16, 0, `<rect class="fg-confetti" width="6" height="10" fill="#ff4d7a" ${delay(0)}/>`) +
        at(34, -6, `<rect class="fg-confetti" width="6" height="10" fill="#4f8cff" ${delay(0.5)}/>`) +
        at(86, -4, `<rect class="fg-confetti" width="6" height="10" fill="#3fbf6f" ${delay(0.25)}/>`) +
        at(104, 2, `<rect class="fg-confetti" width="6" height="10" fill="#ffd23f" ${delay(0.8)}/>`),
    })],

  'faisca-beijo': ['Faísca mandando beijo', () => faisca(
    eye(45, 58, 0, 0) + `<path d="M67 60q8-7 16 0" fill="none" ${S}/>` + blush(72, 28) +
    `<path d="M57 86q3-3 6 0q-3 2-6 0zM57 89q3 3 6 0" fill="#ff4d7a" ${S} stroke-width="2"/>`,
    { cls: 'fg-sway', front: at(76, 82, heart('fg-kiss')) })],

  'faisca-hmm': ['Faísca pensando', () => faisca(
    eyes({ y: 58, dx: 15, px: 2, py: -3 }) + `<path d="M34 42q10-6 18-2M70 46h16" fill="none" ${S}/>` +
    `<path d="M50 89q5-3 10 0t10 0" fill="none" ${S}/>`,
    {
      cls: '',
      front: `<g class="fg-tap">${limb('M40 108 52 94', ORANGE)}</g>` + at(98, 16, word('?', 26, '#b86bff', 'fg-wobble')),
    })],
}

export const STICKER_NAMES = Object.keys(STICKERS)

const CODE = /^:fig:([a-z-]+):$/

// Nome da figurinha se a mensagem for uma; senão, null.
export function stickerOf(text) {
  const name = CODE.exec((text || '').trim())?.[1]
  return name && STICKERS[name] ? name : null
}

export const stickerText = (name) => `:fig:${name}:`
export const stickerLabel = (name) => STICKERS[name][0]

export function stickerSvg(name) {
  const [label, draw] = STICKERS[name]
  return `<svg class="fig" viewBox="-6 -10 132 128" role="img" aria-label="${label}">${draw()}</svg>`
}

// Algumas figurinhas também fazem chover emojis.
export function stickerRain(text) {
  const name = stickerOf(text)
  return name === 'bolota-amo' || name === 'faisca-beijo' ? ['❤️'] : name === 'faisca-festa' ? ['🎉'] : null
}
