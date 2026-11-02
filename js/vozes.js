// Vozes engraçadas para o áudio (esquilo, gigante, robô…).
// Tudo feito no próprio aparelho com o Web Audio do navegador: o áudio só sai do celular
// depois de mudado e cifrado, como qualquer outro arquivo.

// speed: fala mais rápida/lenta (muda a duração). reverse: de trás para frente. tail: segundos a mais no fim (eco).
export const VOICES = [
  { id: 'normal', icon: '🙂', name: 'Normal' },
  { id: 'esquilo', icon: '🐿️', name: 'Esquilo' },
  { id: 'ratinho', icon: '🐭', name: 'Ratinho' },
  { id: 'gigante', icon: '👹', name: 'Gigante' },
  { id: 'urso', icon: '🐻', name: 'Ursão' },
  { id: 'dino', icon: '🦖', name: 'Dinossauro', tail: 1.2 },
  { id: 'abelha', icon: '🐝', name: 'Abelha' },
  { id: 'sapo', icon: '🐸', name: 'Sapo' },
  { id: 'papagaio', icon: '🦜', name: 'Papagaio' },
  { id: 'robo', icon: '🤖', name: 'Robô' },
  { id: 'brinquedo', icon: '🧸', name: 'Brinquedo' },
  { id: 'alien', icon: '👽', name: 'Alienígena' },
  { id: 'astronauta', icon: '🚀', name: 'Astronauta', tail: 0.6 },
  { id: 'fantasma', icon: '👻', name: 'Fantasma', tail: 1.6 },
  { id: 'caverna', icon: '🏰', name: 'Caverna', tail: 2.5 },
  { id: 'agua', icon: '🫧', name: 'Debaixo d’água', tail: 0.4 },
  { id: 'coral', icon: '🎶', name: 'Coral' },
  { id: 'tontura', icon: '🌀', name: 'Tontura' },
  { id: 'balao', icon: '🎈', name: 'Gás de balão' },
  { id: 'radio', icon: '📻', name: 'Rádio antigo' },
  { id: 'telefone', icon: '📞', name: 'Telefone' },
  { id: 'rapido', icon: '⚡', name: 'Fita rápida', speed: 1.6 },
  { id: 'lento', icon: '🐢', name: 'Câmera lenta', speed: 0.7 },
  { id: 'contrario', icon: '🔁', name: 'Ao contrário', reverse: true },
]
const voiceOf = (id) => VOICES.find((v) => v.id === id) || VOICES[0]

const RATE = 24000 // qualidade boa para voz e arquivo menor

// ---------- Peças dos efeitos ----------

// Muda o tom sem mudar a velocidade: duas "fitas" com atraso variando, uma entrando
// enquanto a outra sai (o pulo de cada uma fica escondido no silêncio da outra).
function pitch(ctx, input, ratio, t0) {
  const W = 0.08 // tamanho da janela, em segundos
  const N = Math.max(256, Math.round((ctx.sampleRate * W) / Math.abs(ratio - 1)))
  const delayBuf = ctx.createBuffer(1, N, ctx.sampleRate)
  const fadeBuf = ctx.createBuffer(1, N, ctx.sampleRate)
  const d = delayBuf.getChannelData(0)
  const g = fadeBuf.getChannelData(0)
  for (let i = 0; i < N; i++) {
    const p = i / N
    d[i] = ratio > 1 ? W * (1 - p) : W * p
    g[i] = Math.sin(Math.PI * p) ** 2
  }
  const out = new GainNode(ctx)
  for (const offset of [0, N / 2 / ctx.sampleRate]) {
    const delay = new DelayNode(ctx, { maxDelayTime: 1, delayTime: 0 })
    const fade = new GainNode(ctx, { gain: 0 })
    const modDelay = new AudioBufferSourceNode(ctx, { buffer: delayBuf, loop: true })
    const modFade = new AudioBufferSourceNode(ctx, { buffer: fadeBuf, loop: true })
    modDelay.connect(delay.delayTime)
    modFade.connect(fade.gain)
    input.connect(delay).connect(fade).connect(out)
    modDelay.start(t0, offset)
    modFade.start(t0, offset)
  }
  return out
}

// Voz "tremida": o atraso balança devagar.
function wobble(ctx, input, rate, depth, t0) {
  const delay = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: depth * 1.5 })
  const lfo = new OscillatorNode(ctx, { frequency: rate })
  const amount = new GainNode(ctx, { gain: depth })
  lfo.connect(amount).connect(delay.delayTime)
  lfo.start(t0)
  return input.connect(delay)
}

// Multiplica a voz por um tom: som metálico de robô.
function ring(ctx, input, freq, mix, t0) {
  const out = new GainNode(ctx)
  const ringed = new GainNode(ctx, { gain: 0 })
  const osc = new OscillatorNode(ctx, { frequency: freq })
  osc.connect(ringed.gain)
  osc.start(t0)
  input.connect(ringed).connect(new GainNode(ctx, { gain: mix * 1.6 })).connect(out)
  input.connect(new GainNode(ctx, { gain: 1 - mix })).connect(out)
  return out
}

// Eco que se repete.
function echo(ctx, input, time, feedback, wet) {
  const out = new GainNode(ctx)
  const delay = new DelayNode(ctx, { maxDelayTime: 2, delayTime: time })
  const fb = new GainNode(ctx, { gain: feedback })
  input.connect(out)
  input.connect(delay)
  delay.connect(fb).connect(delay)
  delay.connect(new GainNode(ctx, { gain: wet })).connect(out)
  return out
}

// Ressonância curta (lata, alto-falante de robô).
function comb(ctx, input, time, feedback) {
  const out = new GainNode(ctx)
  const delay = new DelayNode(ctx, { maxDelayTime: 0.1, delayTime: time })
  const fb = new GainNode(ctx, { gain: feedback })
  input.connect(out)
  input.connect(delay).connect(fb).connect(delay)
  fb.connect(out)
  return out
}

// Salão grande: "eco cheio" feito com ruído que vai sumindo.
function reverb(ctx, input, seconds, wet) {
  const len = Math.round(ctx.sampleRate * seconds)
  const ir = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = ir.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  const out = new GainNode(ctx)
  input.connect(out)
  input.connect(new ConvolverNode(ctx, { buffer: ir })).connect(new GainNode(ctx, { gain: wet })).connect(out)
  return out
}

// Várias vozes juntas, cada uma num tom.
function chorus(ctx, input, ratios, t0) {
  const out = new GainNode(ctx)
  input.connect(new GainNode(ctx, { gain: 0.6 })).connect(out)
  for (const r of ratios) pitch(ctx, input, r, t0).connect(new GainNode(ctx, { gain: 0.5 })).connect(out)
  return out
}

// "Bip" de rádio de astronauta no fim da fala.
function beep(ctx, out, at) {
  const osc = new OscillatorNode(ctx, { frequency: 1250 })
  const g = new GainNode(ctx, { gain: 0 })
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(0.25, at + 0.01)
  g.gain.setValueAtTime(0.25, at + 0.16)
  g.gain.linearRampToValueAtTime(0, at + 0.18)
  osc.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + 0.2)
}

function filter(ctx, input, type, frequency, extra = {}) {
  return input.connect(new BiquadFilterNode(ctx, { type, frequency, ...extra }))
}

function crunch(ctx, input, amount) {
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x))
  }
  return input.connect(new WaveShaperNode(ctx, { curve, oversample: '2x' }))
}

// Monta o efeito: devolve o último nó (que vai para a saída).
// dur: quanto tempo dura a fala (para o "bip" do astronauta cair no fim).
function build(ctx, src, id, t0, dur) {
  let n = src
  switch (id) {
    case 'ratinho':
      n = pitch(ctx, n, 2.1, t0)
      n = filter(ctx, n, 'highpass', 300)
      break
    case 'urso':
      n = pitch(ctx, n, 0.5, t0)
      n = filter(ctx, n, 'lowpass', 2500)
      n = filter(ctx, n, 'lowshelf', 180, { gain: 6 })
      break
    case 'dino':
      n = pitch(ctx, n, 0.55, t0)
      n = crunch(ctx, n, 8)
      n = n.connect(new GainNode(ctx, { gain: 0.6 }))
      n = reverb(ctx, n, 1.2, 0.35)
      break
    case 'abelha':
      n = pitch(ctx, n, 1.5, t0)
      n = ring(ctx, n, 180, 0.5, t0)
      break
    case 'sapo':
      n = pitch(ctx, n, 0.8, t0)
      n = ring(ctx, n, 28, 0.6, t0)
      break
    case 'papagaio':
      n = pitch(ctx, n, 1.6, t0)
      n = wobble(ctx, n, 11, 0.0015, t0)
      n = filter(ctx, n, 'peaking', 1800, { Q: 0.8, gain: 8 })
      break
    case 'brinquedo':
      n = pitch(ctx, n, 1.55, t0)
      n = comb(ctx, n, 0.004, 0.6)
      n = n.connect(new GainNode(ctx, { gain: 0.6 }))
      break
    case 'astronauta': {
      n = filter(ctx, n, 'highpass', 400)
      n = filter(ctx, n, 'lowpass', 3500)
      n = crunch(ctx, n, 4)
      n = reverb(ctx, n, 0.5, 0.2)
      const out = new GainNode(ctx)
      n.connect(out)
      beep(ctx, out, t0 + dur + 0.1)
      n = out
      break
    }
    case 'caverna':
      n = reverb(ctx, n, 3, 0.6)
      n = echo(ctx, n, 0.4, 0.35, 0.4)
      break
    case 'agua':
      n = filter(ctx, n, 'lowpass', 700)
      n = wobble(ctx, n, 5, 0.004, t0)
      n = echo(ctx, n, 0.06, 0.3, 0.4)
      n = n.connect(new GainNode(ctx, { gain: 1.4 }))
      break
    case 'coral':
      n = chorus(ctx, n, [1.26, 0.75], t0)
      n = reverb(ctx, n, 1, 0.25)
      break
    case 'tontura':
      n = wobble(ctx, n, 2.5, 0.006, t0)
      break
    case 'telefone':
      n = filter(ctx, n, 'bandpass', 1700, { Q: 1.2 })
      n = crunch(ctx, n, 5)
      n = n.connect(new GainNode(ctx, { gain: 1.5 }))
      break
    case 'esquilo':
      n = pitch(ctx, n, 1.75, t0)
      n = filter(ctx, n, 'highpass', 180)
      break
    case 'gigante':
      n = pitch(ctx, n, 0.62, t0)
      n = filter(ctx, n, 'lowshelf', 220, { gain: 7 })
      break
    case 'robo':
      n = ring(ctx, n, 60, 0.7, t0)
      n = comb(ctx, n, 0.011, 0.55)
      break
    case 'alien':
      n = pitch(ctx, n, 1.3, t0)
      n = wobble(ctx, n, 9, 0.0025, t0)
      n = ring(ctx, n, 420, 0.25, t0)
      break
    case 'fantasma':
      n = pitch(ctx, n, 0.85, t0)
      n = wobble(ctx, n, 4, 0.002, t0)
      n = echo(ctx, n, 0.28, 0.5, 0.6)
      break
    case 'radio':
      n = filter(ctx, n, 'highpass', 500)
      n = filter(ctx, n, 'lowpass', 3000)
      n = crunch(ctx, n, 30)
      n = n.connect(new GainNode(ctx, { gain: 0.6 }))
      break
    case 'balao':
      n = pitch(ctx, n, 1.4, t0)
      n = wobble(ctx, n, 6, 0.0012, t0)
      break
  }
  // Segura os picos para nada estourar.
  return n.connect(new DynamicsCompressorNode(ctx, { threshold: -14, ratio: 6, attack: 0.003, release: 0.2 }))
}

const tailFor = (id) => voiceOf(id).tail || 0.15 // o eco precisa de um tempinho no fim

// Quanto tempo a fala dura depois do efeito (fita rápida/lenta muda a duração).
const spokenLength = (buffer, id) => buffer.duration / (voiceOf(id).speed || 1)

const reversed = new WeakMap()
function sourceFor(ctx, buffer, id) {
  const v = voiceOf(id)
  let buf = buffer
  if (v.reverse) {
    buf = reversed.get(buffer)
    if (!buf) {
      buf = new AudioBuffer({ length: buffer.length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate })
      for (let c = 0; c < buffer.numberOfChannels; c++) buf.getChannelData(c).set(buffer.getChannelData(c).slice().reverse())
      reversed.set(buffer, buf)
    }
  }
  return new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: v.speed || 1 })
}

// ---------- Ler, ouvir e gerar o arquivo ----------

const Ctx = window.AudioContext || window.webkitAudioContext
export const voicesSupported = !!(Ctx && window.OfflineAudioContext)

export async function decodeAudio(blob) {
  const ctx = new Ctx()
  try {
    const data = await blob.arrayBuffer()
    return await new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail))
  } finally {
    ctx.close?.()
  }
}

// Toca o áudio com a voz escolhida. Devolve uma função que para.
export function previewVoice(buffer, id, onEnd) {
  const ctx = new Ctx()
  const src = sourceFor(ctx, buffer, id)
  const dur = spokenLength(buffer, id)
  build(ctx, src, id, ctx.currentTime, dur).connect(ctx.destination)
  let done = false
  const stop = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    ctx.close?.()
    onEnd?.()
  }
  const timer = setTimeout(stop, (dur + tailFor(id)) * 1000 + 300)
  src.start()
  return stop
}

// Gera o áudio novo (WAV, toca em todos os celulares). Devolve { blob, duration }.
export async function renderVoice(buffer, id) {
  const dur = spokenLength(buffer, id)
  const length = Math.ceil((dur + tailFor(id)) * RATE)
  const ctx = new OfflineAudioContext(1, length, RATE)
  const src = sourceFor(ctx, buffer, id)
  build(ctx, src, id, 0, dur).connect(ctx.destination)
  src.start(0)
  const rendered = await ctx.startRendering()
  return { blob: toWav(rendered), duration: Math.max(1, Math.round(rendered.duration)) }
}

function toWav(buffer) {
  const samples = buffer.getChannelData(0)
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const text = (pos, s) => [...s].forEach((c, i) => view.setUint8(pos + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

// ---------- Painel "Escolha a voz" ----------
// rec: { blob, duration }. onSend(file) recebe o arquivo pronto; onClose() quando fecha.
export function openVoicePanel(panel, rec, { onSend, onClose, toast }) {
  let chosen = 'normal'
  let stopPlay = null
  let buffer = null
  let closed = false
  const decoding = decodeAudio(rec.blob).then(
    (b) => (buffer = b),
    () => null
  )

  const title = document.createElement('p')
  title.className = 'voice-title'
  title.innerHTML = '<strong>🎭 Escolha a voz</strong> <small>toque para ouvir</small>'
  const grid = document.createElement('div')
  grid.className = 'voice-grid'
  grid.setAttribute('role', 'radiogroup')
  grid.setAttribute('aria-label', 'Voz do áudio')
  for (const v of VOICES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'voice-chip'
    b.dataset.voice = v.id
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(v.id === chosen))
    b.innerHTML = `<span class="voice-icon" aria-hidden="true">${v.icon}</span><span>${v.name}</span>`
    grid.append(b)
  }
  const actions = document.createElement('div')
  actions.className = 'voice-actions'
  const discard = document.createElement('button')
  discard.type = 'button'
  discard.className = 'btn btn-small btn-ghost voice-discard'
  discard.textContent = '🗑️ Apagar'
  const len = document.createElement('span')
  len.className = 'voice-len'
  len.textContent = '🎤 ' + Math.floor(rec.duration / 60) + ':' + String(rec.duration % 60).padStart(2, '0')
  const send = document.createElement('button')
  send.type = 'button'
  send.className = 'btn btn-small voice-send'
  send.textContent = 'Enviar ➤'
  actions.append(discard, len, send)
  panel.replaceChildren(title, grid, actions)
  panel.hidden = false

  function stopPreview() {
    stopPlay?.()
    stopPlay = null
  }

  function close() {
    if (closed) return
    closed = true
    stopPreview()
    panel.hidden = true
    panel.replaceChildren()
    onClose?.()
  }

  grid.addEventListener('click', async (e) => {
    const chip = e.target.closest('.voice-chip')
    if (!chip || send.disabled) return
    chosen = chip.dataset.voice
    grid.querySelectorAll('.voice-chip').forEach((c) => {
      c.setAttribute('aria-checked', String(c === chip))
      c.classList.remove('playing')
    })
    stopPreview()
    await decoding
    if (closed || chosen !== chip.dataset.voice) return
    if (!buffer) return toast('Não deu para abrir este áudio para mudar a voz. Ele pode ser enviado normal.')
    chip.classList.add('playing')
    stopPlay = previewVoice(buffer, chosen, () => chip.classList.remove('playing'))
  })

  discard.addEventListener('click', close)

  send.addEventListener('click', async () => {
    stopPreview()
    const voice = VOICES.find((v) => v.id === chosen)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    if (chosen === 'normal') {
      onSend(new File([rec.blob], `audio-${stamp}.${rec.ext}`, { type: rec.blob.type }))
      return close()
    }
    send.disabled = true
    send.textContent = 'Preparando…'
    try {
      await decoding
      if (!buffer) throw new Error('decode')
      const { blob, duration } = await renderVoice(buffer, chosen)
      if (closed) return
      onSend(new File([blob], `audio-${stamp}-${voice.id}.wav`, { type: 'audio/wav' }), duration)
      close()
    } catch {
      send.disabled = false
      send.textContent = 'Enviar ➤'
      toast('Não deu para mudar a voz deste áudio. Escolha "Normal" para enviar assim mesmo.')
    }
  })

  return close
}
