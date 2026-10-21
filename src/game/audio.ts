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

  /** Bus d'entrée du compresseur : la musique y est routée. */
  get output(): AudioNode | null {
    return this.compressor
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

  /** Impact de paddle : "thock" + transposition selon le point touché. */
  paddleHit(offset: number, power: number, isPlayer: boolean): void {
    if (!this.ctx || this.muted) return
    const base = isPlayer ? 300 : 240
    const freq = base * (1 + Math.abs(offset) * 0.55)
    this.tone(freq, 0.13, {
      type: 'triangle',
      gain: 0.16 + power * 0.1,
      sweepTo: freq * 0.55,
      attack: 0.002,
    })
    this.tone(freq * 2.02, 0.08, { type: 'square', gain: 0.05 + power * 0.04, sweepTo: freq * 1.2 })
    this.noise(0.09, { gain: 0.1 + power * 0.07, freq: 1400 + power * 1600, q: 0.9, sweepTo: 420 })
  }

  wallHit(power: number): void {
    if (!this.ctx || this.muted) return
    const freq = 150 + power * 70
    this.tone(freq, 0.11, { type: 'sine', gain: 0.13, sweepTo: freq * 0.5 })
    this.noise(0.06, { gain: 0.07, freq: 700, q: 1.4, sweepTo: 220 })
  }

  score(side: 'player' | 'ai'): void {
    if (!this.ctx || this.muted) return
    const notes = side === 'player' ? [523.25, 659.25, 783.99, 1046.5] : [392, 329.63, 261.63]
    notes.forEach((f, i) => {
      this.tone(f, 0.3, { type: 'triangle', gain: 0.13, delay: i * 0.07, attack: 0.008 })
      this.tone(f * 2, 0.18, { type: 'sine', gain: 0.05, delay: i * 0.07 })
    })
    this.noise(0.3, { gain: 0.05, freq: 3200, q: 0.7, sweepTo: 900 })
  }

  countdown(value: number): void {
    this.tone(440 + (3 - value) * 90, 0.12, { type: 'square', gain: 0.08, sweepTo: 330 })
  }

  serve(): void {
    this.noise(0.28, { gain: 0.07, freq: 260, q: 0.8, sweepTo: 2400 })
    this.tone(520, 0.16, { type: 'sine', gain: 0.09, sweepTo: 880 })
  }

  win(): void {
    if (!this.ctx || this.muted) return
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]
    notes.forEach((f, i) => {
      this.tone(f, 0.42, { type: 'triangle', gain: 0.15, delay: i * 0.09, attack: 0.01 })
      this.tone(f * 1.5, 0.3, { type: 'sine', gain: 0.05, delay: i * 0.09 })
    })
  }

  lose(): void {
    if (!this.ctx || this.muted) return
    const notes = [523.25, 415.3, 349.23, 261.63]
    notes.forEach((f, i) => {
      this.tone(f, 0.4, { type: 'sine', gain: 0.13, delay: i * 0.12 })
    })
  }

  hover(): void {
    if (!this.throttle('hover', 60)) return
    this.tone(1180, 0.05, { type: 'sine', gain: 0.035 })
  }

  click(): void {
    this.tone(760, 0.06, { type: 'square', gain: 0.07, sweepTo: 1240 })
    this.tone(1520, 0.05, { type: 'sine', gain: 0.035, delay: 0.01 })
  }

  /** Bip dont la hauteur suit la teinte choisie : l'arc-en-ciel devient une gamme. */
  hue(hue: number): void {
    if (!this.ctx || this.muted) return
    const semis = (hue / 360) * 24
    const freq = 220 * Math.pow(2, semis / 12)
    this.tone(freq, 0.12, { type: 'sine', gain: 0.075, sweepTo: freq * 1.01 })
    this.tone(freq * 2, 0.07, { type: 'triangle', gain: 0.028, delay: 0.015 })
  }
}

export const audio = new AudioEngine()
