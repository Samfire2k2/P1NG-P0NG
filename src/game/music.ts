/**
 * Musique synthwave 100% procédurale (Web Audio API) : aucune ressource à
 * charger. Deux pistes générées note par note :
 *  - « menu » : arpège lent et nappes, ambiance décontractée ;
 *  - « game » : basse pilotée, arpège rapide et batterie, plus énergique.
 *
 * Le séquenceur utilise la technique du "lookahead" : un minuteur réveille le
 * moteur toutes les 25 ms et programme les notes un peu en avance, ce qui
 * évite les trous de précision de setTimeout.
 */

import { audio } from './audio'
import { clamp } from './math'

export type MusicTrack = 'menu' | 'game'

interface MusicNote {
  /** Fréquence en Hz. */
  freq: number
  /** Décalage de départ (en secondes, relatif au pas). */
  offset?: number
  /** Durée en secondes. */
  dur: number
  type: OscillatorType
  gain: number
  detune?: number
  filter?: number
  filterEnd?: number
  /** Envoi vers le delay (0-1). */
  send?: number
  attack?: number
}

interface MusicHit {
  offset?: number
  dur: number
  gain: number
  /** Fréquence de coupure du filtre de bruit. */
  freq: number
  type: BiquadFilterType
  q?: number
  send?: number
}

interface Step {
  notes: MusicNote[]
  hits: MusicHit[]
}

/** Accord : racine grave + trois notes de l'accord (MIDI). */
interface Chord {
  root: number
  notes: number[]
}

const MENU_CHORDS: Chord[] = [
  { root: 45, notes: [57, 60, 64] }, // Am
  { root: 41, notes: [53, 57, 60] }, // F
  { root: 48, notes: [60, 64, 67] }, // C
  { root: 43, notes: [55, 59, 62] }, // G
]

const GAME_CHORDS: Chord[] = [
  { root: 45, notes: [57, 60, 64] }, // Am
  { root: 45, notes: [57, 60, 64] }, // Am
  { root: 41, notes: [53, 57, 60] }, // F
  { root: 43, notes: [55, 59, 62] }, // G
]

const MENU_BPM = 84
const GAME_BPM = 128
const STEPS_PER_BAR = 16
const LOOKAHEAD = 0.14
const TICK_MS = 25

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

class MusicEngine {
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null
  private delay: DelayNode | null = null
  private delayFeedback: GainNode | null = null
  private noise: AudioBuffer | null = null

  private timer = 0
  private nextTime = 0
  private step = 0
  private bar = 0
  private track: MusicTrack = 'menu'
  private target: MusicTrack = 'menu'
  private switchTimer = 0
  private level = 0.42
  /** Tension de jeu : 0 = calme, 1 = score serré. */
  private tension = 0
  /** Transposition selon qui mène : +2 si le joueur mène, -2 si l'IA mène. */
  private leadTranspose = 0
  private switching = false

  /** Le joueur qui mène impose sa couleur harmonique à la piste. */
  setLead(lead: 'player' | 'ai' | 'none'): void {
    const next = lead === 'player' ? 2 : lead === 'ai' ? -2 : 0
    if (next === this.leadTranspose) return
    this.leadTranspose = next
  }

  /** Change de piste (fondu sortant puis entrée). */
  setTrack(track: MusicTrack): void {
    if (track === this.target) {
      this.ensureRunning()
      return
    }
    this.target = track
    this.startSwitch()
  }

  /**
   * Monte la tension musicale : le moteur l'appelle selon l'écart au score
   * et le temps restant. La partie serrée pousse les aigus et la batterie.
   */
  setTension(tension: number): void {
    const value = clamp(tension, 0, 1)
    if (Math.abs(value - this.tension) < 0.01) return
    this.tension = value
    this.applyTension()
  }

  get currentTension(): number {
    return this.tension
  }

  /** Volume du bus : plus on est tendu, plus la piste sort. */
  private busLevel(): number {
    return this.level * (0.86 + this.tension * 0.34)
  }

  private applyTension(): void {
    if (!this.bus || !this.ctx || this.switching) return
    this.bus.gain.setTargetAtTime(this.busLevel(), this.ctx.currentTime, 0.3)
  }

  get currentTrack(): MusicTrack {
    return this.target
  }

  /** État du séquenceur (diagnostic). */
  get status(): { track: MusicTrack; running: boolean; level: number } {
    return {
      track: this.target,
      running: Boolean(this.timer) && this.ctx?.state === 'running',
      level: this.bus?.gain.value ?? 0,
    }
  }

  /** Démarre le séquenceur dès que le contexte audio est prêt. */
  private ensureRunning(): void {
    const ctx = audio.context
    if (!ctx) return
    if (!this.ctx) {
      this.ctx = ctx
      const out = audio.output
      if (!out) return
      this.bus = ctx.createGain()
      this.bus.gain.value = 0
      this.bus.connect(out)

      // Delay avec feedback : donne l'espace caractéristique du synthwave.
      this.delay = ctx.createDelay(1)
      this.delay.delayTime.value = 0.28
      this.delayFeedback = ctx.createGain()
      this.delayFeedback.gain.value = 0.34
      const delayTone = ctx.createBiquadFilter()
      delayTone.type = 'lowpass'
      delayTone.frequency.value = 2600
      this.delay.connect(delayTone)
      delayTone.connect(this.delayFeedback)
      this.delayFeedback.connect(this.delay)
      delayTone.connect(this.bus)

      this.noise = this.createNoise()
      this.nextTime = ctx.currentTime + 0.08
      this.fadeIn()
    }
    if (ctx.state !== 'running') return
    if (!this.timer) {
      this.timer = window.setInterval(() => this.tick(), TICK_MS)
    }
  }

  private createNoise(): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * 0.4)
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    return buffer
  }

  private fadeIn(): void {
    if (!this.bus || !this.ctx) return
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime)
    this.bus.gain.setValueAtTime(0.0001, this.ctx.currentTime)
    this.bus.gain.linearRampToValueAtTime(this.busLevel(), this.ctx.currentTime + 1.2)
  }

  /** Fondu : on baisse le bus, on change de motif, on remonte. */
  private startSwitch(): void {
    this.ensureRunning()
    if (!this.bus || !this.ctx) {
      this.track = this.target
      return
    }
    const now = this.ctx.currentTime
    this.switching = true
    this.bus.gain.cancelScheduledValues(now)
    this.bus.gain.setValueAtTime(this.bus.gain.value, now)
    this.bus.gain.linearRampToValueAtTime(0.0001, now + 0.35)
    window.clearTimeout(this.switchTimer)
    this.switchTimer = window.setTimeout(() => {
      this.track = this.target
      this.bar = 0
      this.step = 0
      this.switching = false
      if (this.ctx) this.nextTime = this.ctx.currentTime + 0.05
      this.fadeIn()
    }, 400)
  }

  private get stepDuration(): number {
    const bpm = this.track === 'game' ? GAME_BPM : MENU_BPM
    return 60 / bpm / 4
  }

  private tick(): void {
    const ctx = this.ctx
    if (!ctx || !this.bus) return
    if (ctx.state !== 'running') return
    const horizon = ctx.currentTime + LOOKAHEAD
    let guard = 0
    while (this.nextTime < horizon && guard++ < 32) {
      const step = this.buildStep(this.bar, this.step)
      const t0 = this.nextTime
      for (const note of step.notes) this.playNote(note, t0 + (note.offset ?? 0))
      for (const hit of step.hits) this.playHit(hit, t0 + (hit.offset ?? 0))
      this.nextTime += this.stepDuration
      this.step++
      if (this.step >= STEPS_PER_BAR) {
        this.step = 0
        this.bar = (this.bar + 1) % 4
      }
    }
  }

  // ------------------------------------------------------------ Patterns

  private buildStep(bar: number, step: number): Step {
    return this.track === 'game' ? this.gameStep(bar, step) : this.menuStep(bar, step)
  }

  /** Piste du menu : nappe, arpège lent, basse douce. */
  private menuStep(bar: number, step: number): Step {
    const chord = MENU_CHORDS[bar]
    const notes: MusicNote[] = []
    const hits: MusicHit[] = []

    if (step === 0) {
      // Nappe : les trois notes de l'accord, légèrement désaccordées.
      chord.notes.forEach((midi, i) => {
        notes.push({
          freq: midiToFreq(midi),
          dur: this.stepDuration * STEPS_PER_BAR * 0.98,
          type: 'sawtooth',
          gain: 0.028,
          detune: i % 2 === 0 ? -7 : 7,
          filter: 1100,
          filterEnd: 1500,
          attack: 0.5,
        })
      })
      // Basse ronde.
      notes.push({
        freq: midiToFreq(chord.root),
        dur: this.stepDuration * 6,
        type: 'sine',
        gain: 0.1,
        attack: 0.02,
      })
      notes.push({
        freq: midiToFreq(chord.root),
        dur: this.stepDuration * 3,
        type: 'triangle',
        gain: 0.05,
      })
      hits.push({ dur: 0.22, gain: 0.16, freq: 120, type: 'lowpass', q: 1 })
    }

    if (step % 2 === 0) {
      // Arpège : les notes de l'accord en boucle, une octave au-dessus.
      const pattern = [0, 1, 2, 1]
      const index = pattern[(step / 2) % pattern.length]
      notes.push({
        freq: midiToFreq(chord.notes[index] + 12),
        dur: this.stepDuration * 1.6,
        type: 'triangle',
        gain: 0.05,
        send: 0.4,
        attack: 0.005,
      })
    }

    if (step === 4 || step === 12) {
      hits.push({ dur: 0.05, gain: 0.028, freq: 7200, type: 'highpass' })
    }

    return { notes, hits }
  }

  /** Piste de jeu : basse pilotée, arpège 16e, batterie. */
  private gameStep(bar: number, step: number): Step {
    const baseChord = GAME_CHORDS[bar]
    const chord = {
      root: baseChord.root + this.leadTranspose,
      notes: baseChord.notes.map((n) => n + this.leadTranspose),
    }
    const notes: MusicNote[] = []
    const hits: MusicHit[] = []
    const t = this.tension

    if (step === 0) {
      chord.notes.forEach((midi, i) => {
        notes.push({
          freq: midiToFreq(midi),
          dur: this.stepDuration * STEPS_PER_BAR * 0.9,
          type: 'sawtooth',
          gain: 0.022,
          detune: i % 2 === 0 ? -9 : 9,
          filter: 800,
          filterEnd: 1200,
          attack: 0.3,
        })
      })
    }

    // Basse : croches avec sauts d'octave. Plus c'est tendu, plus elle crie.
    if (step % 2 === 0) {
      const jump = [0, 0, 12, 0, 0, 12, 0, 7][(step / 2) % 8]
      notes.push({
        freq: midiToFreq(chord.root + jump),
        dur: this.stepDuration * 1.7,
        type: 'sawtooth',
        gain: 0.11,
        filter: 260 + t * 240,
        filterEnd: 1400 + t * 1700,
        attack: 0.004,
      })
      notes.push({
        freq: midiToFreq(chord.root + jump),
        dur: this.stepDuration * 0.8,
        type: 'square',
        gain: 0.035,
        filter: 700 + t * 400,
        attack: 0.004,
      })
    }

    // Arpège rapide.
    const arpPattern = [0, 1, 2, 1, 2, 1, 0, 1]
    notes.push({
      freq: midiToFreq(chord.notes[arpPattern[step % arpPattern.length]] + 12),
      dur: this.stepDuration * 0.9,
      type: 'square',
      gain: 0.022 * (0.55 + t * 0.95),
      send: 0.28,
      attack: 0.003,
    })

    // Mélodie simple sur les temps pairs (plus souvent quand c'est serré).
    if (step % 4 === 0 && (bar % 2 === 0 || t > 0.45)) {
      notes.push({
        freq: midiToFreq(chord.notes[2] + 24),
        dur: this.stepDuration * 3,
        type: 'triangle',
        gain: 0.045 * (0.7 + t * 0.7),
        send: 0.42,
        attack: 0.01,
      })
    }

    // Couche de tension : pulsation aiguë, seulement dans les fins serrées.
    if (t > 0.45 && step % 4 === 2) {
      notes.push({
        freq: midiToFreq(chord.root + 24),
        dur: this.stepDuration * 0.8,
        type: 'sawtooth',
        gain: 0.014 * (t - 0.45) * 2.2,
        filter: 2400,
        filterEnd: 4400,
        attack: 0.004,
      })
    }

    // Batterie.
    if (step % 4 === 0) {
      hits.push({ dur: 0.2, gain: 0.24 * (0.72 + t * 0.45), freq: 150, type: 'lowpass', q: 1 })
    }
    if (step === 4 || step === 12) {
      hits.push({ dur: 0.14, gain: 0.12 * (0.55 + t * 0.8), freq: 1900, type: 'bandpass', q: 0.8, send: 0.2 })
    }
    if (step % 2 === 1) {
      hits.push({ dur: 0.03, gain: 0.03 * (0.35 + t * 1.3), freq: 8200, type: 'highpass' })
    }

    return { notes, hits }
  }

  // ------------------------------------------------------------- Synthèse

  private playNote(note: MusicNote, time: number): void {
    const ctx = this.ctx
    const bus = this.bus
    if (!ctx || !bus) return
    const osc = ctx.createOscillator()
    osc.type = note.type
    osc.frequency.setValueAtTime(note.freq, time)
    if (note.detune) osc.detune.setValueAtTime(note.detune, time)

    const gain = ctx.createGain()
    const peak = Math.max(note.gain, 0.0005)
    const attack = note.attack ?? 0.01
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(peak, time + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + note.dur)

    let chain: AudioNode = osc
    if (note.filter) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(note.filter, time)
      if (note.filterEnd) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(60, note.filterEnd), time + note.dur)
      }
      filter.Q.value = 5
      osc.connect(filter)
      chain = filter
    }
    chain.connect(gain)
    gain.connect(bus)

    if (note.send && this.delay) {
      const send = ctx.createGain()
      send.gain.value = note.send
      gain.connect(send)
      send.connect(this.delay)
    }

    osc.start(time)
    osc.stop(time + note.dur + 0.05)
  }

  private playHit(hit: MusicHit, time: number): void {
    const ctx = this.ctx
    const bus = this.bus
    if (!ctx || !bus || !this.noise) return
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const filter = ctx.createBiquadFilter()
    filter.type = hit.type
    filter.frequency.setValueAtTime(hit.freq, time)
    filter.Q.value = hit.q ?? 1
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(Math.max(hit.gain, 0.001), time + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + hit.dur)

    src.connect(filter)
    filter.connect(gain)
    gain.connect(bus)
    if (hit.send && this.delay) {
      const send = ctx.createGain()
      send.gain.value = hit.send
      gain.connect(send)
      send.connect(this.delay)
    }
    src.start(time)
    src.stop(time + hit.dur + 0.02)
  }
}

export const music = new MusicEngine()
