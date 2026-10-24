/**
 * Audio 100% procédural (Web Audio API) : aucun fichier son à charger.
 * Tous les sons sont synthétisés à la volée pour un démarrage instantané.
 */

export type AudioEventType =
  | 'paddleHit'
  | 'wallHit'
  | 'score'
  | 'countdown'
  | 'serve'
  | 'win'
  | 'lose'
  | 'hover'
  | 'click'
  | 'hue'

export interface AudioOptions {
  muted?: boolean
  volume?: number
}

const midiToFreq = (note: number): number => 440 * Math.pow(2, (note - 69) / 12)

  const STORAGE_KEY = 'p1ng-p0ng-audio'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private lastPlay: Record<string, number> = {}

  muted = false
  volume = 0.75

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as { muted?: boolean; volume?: number }
          this.muted = Boolean(parsed.muted)
          if (typeof parsed.volume === 'number') this.volume = parsed.volume
        }
      } catch {
        /* stockage indisponible : on garde les valeurs par défaut */
      }
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: this.muted, volume: this.volume }))
    } catch {
      /* ignore */
    }
  }

  /** Créé/relancé au premier geste utilisateur (politique autoplay). */
  init(): void {
    if (typeof window === 'undefined') return
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor({ latencyHint: 'interactive' })
      this.compressor = this.ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -14
      this.compressor.knee.value = 12
      this.compressor.ratio.value = 8
      this.compressor.attack.value = 0.003
      this.compressor.release.value = 0.18
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : this.volume
      this.compressor.connect(this.master)
      this.master.connect(this.ctx.destination)
      this.noiseBuffer = this.createNoiseBuffer()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private createNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * 0.6)
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02)
    }
    this.persist()
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02)
    }
    this.persist()
  }

  /** Contexte audio partagé (la musique s'y branche). */
  get context(): AudioContext | null {
    return this.ctx
  }

  /** Sortie directe pour que le bus musique ait son propre volume. */
  get output(): AudioNode | null {
    return this.ctx?.destination ?? null
  }

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  /** Anti-spam simple pour les sons répétitifs (hover). */
  private throttle(key: string, ms: number): boolean {
    const t = this.now * 1000
    const last = this.lastPlay[key] ?? -Infinity
    if (t - last < ms) return false
    this.lastPlay[key] = t
    return true
  }

  private tone(
    freq: number,
    dur: number,
    opts: {
      type?: OscillatorType
      gain?: number
      delay?: number
      sweepTo?: number
      attack?: number
      detune?: number
    } = {},
  ): void {
    if (!this.ctx || !this.master || this.muted) return
    const ctx = this.ctx
    const t0 = this.now + (opts.delay ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t0 + dur)
    }
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0)

    const peak = opts.gain ?? 0.2
    const attack = opts.attack ?? 0.005
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

    osc.connect(gain)
    gain.connect(this.compressor!)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private noise(
    dur: number,
    opts: {
      gain?: number
      delay?: number
      freq?: number
      q?: number
      sweepTo?: number
      type?: BiquadFilterType
    } = {},
  ): void {
    if (!this.ctx || !this.compressor || !this.noiseBuffer || this.muted) return
    const ctx = this.ctx
    const t0 = this.now + (opts.delay ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer
    const filter = ctx.createBiquadFilter()
    filter.type = opts.type ?? 'bandpass'
    filter.frequency.setValueAtTime(opts.freq ?? 900, t0)
    if (opts.sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweepTo), t0 + dur)
    }
    filter.Q.value = opts.q ?? 1.2
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(opts.gain ?? 0.12, t0 + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(this.compressor)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  /**
   * Impact de paddle : "thock" + transposition selon la zone touchée.
   * `offset` vaut 0 au centre de la raquette et 1 (ou -1) aux extrémités :
   * plus on frappe près du bord, plus le son est aigu et métallique.
   */
  /** Synthesized paddle impact, pitched by contact position and force. */
  paddleHit(offset: number, power: number, isPlayer: boolean): void {
    if (!this.ctx || this.muted) return
    const edge = Math.min(1, Math.abs(offset))
    const base = isPlayer ? 196 : 164.81
    const freq = base * (1 + edge * 2.2)
    const level = Math.min(1, Math.max(0, power))
    this.tone(freq, 0.105, { type: 'square', gain: 0.1 + level * 0.07, sweepTo: freq * 0.68, attack: 0.001 })
    this.tone(freq * 2.5, 0.065, { type: 'triangle', gain: 0.045 + edge * 0.025, sweepTo: freq * 1.35, delay: 0.004 })
    this.noise(0.035, { gain: 0.025 + level * 0.018, freq: 3200 + edge * 3200, q: 2.8, sweepTo: 900 })
    if (edge > 0.68) this.tone(freq * 4, 0.035, { type: 'square', gain: 0.018 + edge * 0.02, sweepTo: freq * 2.2, delay: 0.008 })
  }

  wallHit(power: number): void {
    if (!this.ctx || this.muted) return
    const freq = 220 + Math.max(0, power) * 85
    this.tone(freq, 0.09, { type: 'triangle', gain: 0.095, sweepTo: freq * 0.62, attack: 0.001 })
    this.tone(freq * 2.76, 0.045, { type: 'sine', gain: 0.035, delay: 0.006, sweepTo: freq * 1.8 })
    this.noise(0.028, { gain: 0.028, freq: 1500, q: 3, sweepTo: 500 })
  }

  score(side: 'player' | 'ai'): void {
    if (!this.ctx || this.muted) return
    const phrase = side === 'player' ? [57, 64, 69, 76] : [69, 64, 60, 57]
    phrase.forEach((note, index) => {
      const delay = index * 0.055
      const freq = midiToFreq(note)
      this.tone(freq, 0.18, { type: 'square', gain: index === 3 ? 0.1 : 0.075, delay, attack: 0.003, sweepTo: freq * 1.015 })
      this.tone(freq * 2, 0.12, { type: 'sine', gain: 0.025, delay: delay + 0.006 })
    })
    this.noise(0.09, { gain: 0.025, freq: 4200, q: 2, sweepTo: 1100 })
  }

  countdown(value: number): void {
    const final = value <= 0
    const freq = final ? 880 : midiToFreq(53 + Math.max(0, 3 - value) * 2)
    this.tone(freq, final ? 0.22 : 0.115, { type: final ? 'triangle' : 'square', gain: final ? 0.11 : 0.075, sweepTo: freq * (final ? 1.5 : 0.92), attack: 0.002 })
    this.tone(freq * 2.01, final ? 0.13 : 0.045, { type: 'sine', gain: final ? 0.045 : 0.018, delay: 0.008 })
    if (final) this.noise(0.045, { gain: 0.035, freq: 5000, q: 2.5, sweepTo: 1800 })
  }

  serve(): void {
    this.noise(0.19, { gain: 0.045, freq: 420, q: 1.4, sweepTo: 4200 })
    this.tone(110, 0.2, { type: 'sawtooth', gain: 0.045, sweepTo: 55, attack: 0.004 })
    this.tone(midiToFreq(76), 0.12, { type: 'triangle', gain: 0.075, delay: 0.075, sweepTo: midiToFreq(84), attack: 0.003 })
    this.tone(midiToFreq(88), 0.08, { type: 'sine', gain: 0.025, delay: 0.12 })
  }

  win(): void {
    if (!this.ctx || this.muted) return
    const phrase = [57, 64, 69, 72, 76, 81, 88]
    phrase.forEach((note, index) => {
      const delay = index * 0.075
      const freq = midiToFreq(note)
      this.tone(freq, 0.36, { type: index % 2 ? 'triangle' : 'square', gain: index > 4 ? 0.09 : 0.07, delay, attack: 0.008 })
      if (index === phrase.length - 1) {
        this.tone(freq * 1.5, 0.62, { type: 'sine', gain: 0.035, delay, attack: 0.02 })
        this.tone(midiToFreq(45), 0.5, { type: 'triangle', gain: 0.07, delay, attack: 0.02 })
      }
    })
    this.noise(0.16, { gain: 0.03, freq: 5200, q: 1.8, sweepTo: 1600 })
  }

  lose(): void {
    if (!this.ctx || this.muted) return
    const notes = [57, 53, 50, 45]
    notes.forEach((note, index) => {
      const freq = midiToFreq(note)
      this.tone(freq, 0.27, { type: 'sawtooth', gain: 0.085, delay: index * 0.105 })
      this.tone(freq / 2, 0.21, { type: 'triangle', gain: 0.035, delay: index * 0.105 + 0.015 })
    })
    this.noise(0.32, { gain: 0.035, freq: 900, q: 0.7, sweepTo: 130 })
  }

  /** Draw signal: a restrained, unresolved two-voice phrase. */
  draw(): void {
    if (!this.ctx || this.muted) return
    const notes = [62, 62, 65, 64]
    notes.forEach((note, index) => {
      const freq = midiToFreq(note)
      this.tone(freq, 0.26, { type: 'triangle', gain: 0.07, delay: index * 0.12, attack: 0.01 })
      this.tone(freq * 1.5, 0.16, { type: 'sine', gain: 0.022, delay: index * 0.12 + 0.01 })
    })
  }

  hover(): void {
    if (!this.throttle('hover', 90)) return
    this.tone(midiToFreq(84), 0.028, { type: 'square', gain: 0.018, sweepTo: midiToFreq(86), attack: 0.001 })
  }

  click(): void {
    this.tone(midiToFreq(72), 0.045, { type: 'square', gain: 0.045, sweepTo: midiToFreq(67), attack: 0.001 })
    this.tone(midiToFreq(84), 0.025, { type: 'triangle', gain: 0.018, delay: 0.008 })
    this.noise(0.018, { gain: 0.012, freq: 6000, q: 3, sweepTo: 3000 })
  }

  /** Each powerup gets its own rising interval signature. */
  powerup(type: number, isPlayer: boolean): void {
    if (!this.ctx || this.muted) return
    const degrees = [0, 3, 7, 10, 12, 15, 19, 22, 24, 27]
    const degree = degrees[((type % degrees.length) + degrees.length) % degrees.length] ?? 12
    const root = midiToFreq(60 + degree)
    const gain = isPlayer ? 0.095 : 0.075
    this.tone(root, 0.12, { type: 'square', gain, attack: 0.002, sweepTo: root * 1.01 })
    this.tone(root * 1.25, 0.105, { type: 'triangle', gain: gain * 0.72, delay: 0.035 })
    this.tone(root * 1.5, 0.12, { type: 'sine', gain: gain * 0.5, delay: 0.07, sweepTo: root * 1.52 })
    this.tone(root * 2, 0.09, { type: 'triangle', gain: gain * 0.4, delay: 0.105 })
    this.noise(0.045, { gain: 0.02, freq: 6500 + type * 180, q: 2.4, sweepTo: 2600 })
  }

  hue(hue: number): void {
    if (!this.ctx || this.muted || !this.throttle('hue', 45)) return
    const semis = (hue / 360) * 24
    const freq = 220 * Math.pow(2, semis / 12)
    this.tone(freq, 0.06, { type: 'triangle', gain: 0.035, sweepTo: freq * 1.015 })
    this.tone(freq * 2, 0.04, { type: 'sine', gain: 0.014, delay: 0.008 })
  }
}

export const audio = new AudioEngine()
