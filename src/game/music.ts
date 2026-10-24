/**
 * Bande-son électronique 100% procédurale (Web Audio API) : aucune ressource à
 * charger. Deux pistes générées note par note :
 *  - « menu » : séquenceur numérique, bips courts et pulsation basse ;
 *  - « game » : arpège carré rapide, basse et batterie électronique.
 *
 * Le séquenceur utilise la technique du "lookahead" : un minuteur réveille le
 * moteur toutes les 25 ms et programme les notes un peu en avance, ce qui
 * évite les trous de précision de setTimeout.
 */

import { audio } from './audio'
import { clamp } from './math'

export type MusicTrack =
  | 'menu'
  | 'game'
  | 'brick'        // Casse-brique solo
  | 'online'       // Mode duel en ligne 2 joueurs
  | 'portrait'     // Mode portrait (paddle rotated 90°)
  | 'classic'      // Mode classique Pong
  | 'start'        // Écran de démarrage

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

const MENU_BPM = 102
const GAME_BPM = 140
const STEPS_PER_BAR = 16
const BARS_PER_ARRANGEMENT = 8
const LOOKAHEAD = 0.14
const TICK_MS = 25

// Petit thème original en la mineur : la signature mélodique de l’arcade.
const ARCADE_HOOK: Array<number | null> = [0, null, 7, null, 10, null, 7, 3, null, 5, null, 3, 12, null, 10, null]
const ARCADE_HOOK_B: Array<number | null> = [0, null, 7, 10, null, 12, 10, 7, 3, null, 5, 7, null, 3, 0, null]

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

class MusicEngine {
  private ctx: AudioContext | null = null
  private bus: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
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
  private muted = false

  setMuted(muted: boolean): void {
    this.muted = muted
    if (!this.bus || !this.ctx) return
    this.bus.gain.cancelScheduledValues(this.ctx.currentTime)
    this.bus.gain.setTargetAtTime(muted ? 0.0001 : this.busLevel(), this.ctx.currentTime, 0.04)
  }

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
    return this.muted ? 0 : this.level * (0.86 + this.tension * 0.34)
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
      this.compressor = ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -18
      this.compressor.knee.value = 10
      this.compressor.ratio.value = 6
      this.compressor.attack.value = 0.004
      this.compressor.release.value = 0.16
      this.bus.connect(this.compressor)
      this.compressor.connect(out)

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
    const bpm = this.track === 'menu' || this.track === 'start'
      ? MENU_BPM
      : this.track === 'online' ? 148
        : this.track === 'brick' ? 126
          : this.track === 'portrait' ? 156
            : GAME_BPM
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
        this.bar = (this.bar + 1) % BARS_PER_ARRANGEMENT
      }
    }
  }

  // ------------------------------------------------------------ Patterns

  private buildStep(bar: number, step: number): Step {
    if (this.track === 'menu' || this.track === 'start') return this.menuStep(bar, step)
    if (this.track === 'online' || this.track === 'brick' || this.track === 'portrait') {
      return this.dataStep(bar, step)
    }
    return this.gameStep(bar, step)
  }

  /** Menu : thème d’appel, basse syncopée, accords larges et batterie légère. */
  private menuStep(bar: number, step: number): Step {
    const chord = MENU_CHORDS[bar % MENU_CHORDS.length]
    const notes: MusicNote[] = []
    const hits: MusicHit[] = []
    const hook = bar < 4 ? ARCADE_HOOK : ARCADE_HOOK_B
    const hookDegree = hook[step]

    // Accords tenus : la seconde moitié ouvre le filtre pour annoncer la boucle.
    if (step === 0) {
      chord.notes.forEach((midi, index) => notes.push({
        freq: midiToFreq(midi + 12),
        dur: this.stepDuration * 7.6,
        type: index === 1 ? 'triangle' : 'sawtooth',
        gain: 0.008,
        filter: 700 + index * 320,
        filterEnd: 1500 + index * 500,
        attack: 0.08,
        send: 0.16,
      }))
    }

    // Motif de basse en contretemps, avec octave de relance en fin de mesure.
    if ([0, 3, 6, 8, 11, 14].includes(step)) {
      const octave = step === 6 || step === 14 ? 0 : -12
      notes.push({
        freq: midiToFreq(chord.root + octave),
        dur: this.stepDuration * (step % 2 ? 0.72 : 1.55),
        type: 'triangle',
        gain: step % 2 ? 0.032 : 0.048,
        filter: 180,
        filterEnd: 480,
        attack: 0.006,
      })
    }

    // Mélodie-signature, transposée par les accords et doublée à l’octave en jeu.
    if (hookDegree !== null && (step % 2 === 0 || bar >= 4)) {
      notes.push({
        freq: midiToFreq(chord.root + 12 + hookDegree),
        dur: this.stepDuration * (step === 12 ? 1.35 : 0.72),
        type: step % 4 === 0 ? 'square' : 'triangle',
        gain: step === 0 || step === 12 ? 0.026 : 0.019,
        filter: 1200,
        filterEnd: 3100 + bar * 80,
        attack: 0.003,
        send: step === 12 ? 0.24 : 0.12,
      })
    }

    if (step === 0 || step === 8 || (bar % 2 === 1 && step === 14)) {
      hits.push({ dur: 0.12, gain: 0.095, freq: 105, type: 'lowpass', q: 0.8 })
    }
    if (step === 4 || step === 12) {
      hits.push({ dur: 0.085, gain: 0.045, freq: 1900, type: 'bandpass', q: 0.8, send: 0.12 })
    }
    if (step % 2 === 1 || step === 14) {
      hits.push({ dur: step === 15 ? 0.075 : 0.022, gain: step % 4 === 3 ? 0.022 : 0.009, freq: step === 15 ? 5200 : 8500, type: 'highpass', send: step === 15 ? 0.18 : 0 })
    }
    // Boot-like data chirps sit above the main hook in short, clocked bursts.
    if ([1, 5, 7, 9, 13, 15].includes(step) && (bar % 2 === 0 || step === 15)) {
      const bits = [0, 7, 1, 12, 8, 19, 7, 0]
      notes.push({
        freq: midiToFreq(chord.root + 24 + bits[(step + bar) % bits.length]),
        dur: this.stepDuration * 0.22,
        type: 'square',
        gain: 0.009 + (step === 15 ? 0.005 : 0),
        filter: 2200,
        filterEnd: 5800,
        attack: 0.001,
        offset: this.stepDuration * 0.12,
      })
    }
    if (bar === 7 && step === 15) {
      notes.push({
        freq: midiToFreq(chord.root + 24),
        dur: this.stepDuration * 1.8,
        type: 'sawtooth',
        gain: 0.012,
        filter: 900,
        filterEnd: 3600,
        attack: 0.01,
        send: 0.35,
      })
    }

    return { notes, hits }
  }

  /** Separate machine-code grooves for online, brick and portrait sessions. */
  private dataStep(bar: number, step: number): Step {
    const chord = GAME_CHORDS[bar % GAME_CHORDS.length]
    const root = chord.root + this.leadTranspose
    const notes: MusicNote[] = []
    const hits: MusicHit[] = []
    const t = this.tension
    const online = this.track === 'online'
    const brick = this.track === 'brick'
    const kickSteps = online ? [0, 6, 8, 14] : brick ? [0, 3, 8, 10, 14] : [0, 5, 8, 13]
    const bitSteps = online
      ? [0, 2, 3, 6, 8, 10, 11, 14]
      : brick ? [0, 1, 4, 6, 9, 11, 12, 15] : [0, 3, 5, 7, 8, 11, 13, 15]
    const intervals = online
      ? [0, 7, 12, 11, 7, 19, 12, 5]
      : brick ? [0, 1, 12, 13, 7, 8, 19, 20] : [0, 12, 7, 19, 8, 20, 13, 5]
    const index = bitSteps.indexOf(step)

    // Low clock pulse and a dissonant, filtered machine hum on each bar.
    if (step === 0) {
      notes.push({
        freq: midiToFreq(root - (brick ? 19 : 12)),
        dur: this.stepDuration * (brick ? 7.5 : 6.5),
        type: 'square',
        gain: brick ? 0.014 : 0.009,
        filter: brick ? 260 : 420,
        filterEnd: brick ? 680 : 1050,
        attack: 0.025,
      })
      notes.push({
        freq: midiToFreq(root + 1 + (bar % 2 ? 12 : 0)),
        dur: this.stepDuration * 3.2,
        type: 'sawtooth',
        gain: 0.0045,
        filter: 1100,
        filterEnd: 2200,
        attack: 0.08,
        detune: online ? -9 : 7,
      })
    }

    if (kickSteps.includes(step)) {
      const beat = step === 0 || step === 8
      notes.push({
        freq: midiToFreq(root - 12 + (step === 6 || step === 14 ? 7 : 0)),
        dur: this.stepDuration * (brick ? 1.7 : 1.15),
        type: 'square',
        gain: (beat ? 0.048 : 0.032) + t * 0.012,
        filter: 150,
        filterEnd: 720,
        attack: 0.002,
      })
      hits.push({ dur: beat ? 0.11 : 0.07, gain: beat ? 0.12 : 0.075, freq: brick ? 80 : 105, type: 'lowpass', q: 0.9 })
    }

    // Quantized bitstream ostinato. The scale deliberately mixes octaves,
    // semitones and fifths to sound like a musical data terminal.
    if (index >= 0) {
      const phraseIndex = (index + bar * (brick ? 3 : online ? 1 : 2)) % intervals.length
      const interval = intervals[phraseIndex] ?? 0
      const octaves = brick ? 12 : online ? 24 : 19
      const freq = midiToFreq(root + octaves + interval)
      notes.push({
        freq,
        dur: this.stepDuration * (brick ? 0.34 : 0.26),
        type: step % 4 === 0 ? 'square' : 'triangle',
        gain: (brick ? 0.019 : 0.016) + t * 0.006,
        filter: 1100 + t * 1000,
        filterEnd: brick ? 4200 : 6200,
        attack: 0.001,
        detune: online ? (bar % 2 ? 8 : -8) : 0,
        send: step % 4 === 3 ? 0.18 : 0.04,
      })
      if (step === 7 || step === 15) {
        notes.push({
          freq: freq * (bar % 2 ? 1.5 : 2),
          dur: this.stepDuration * 0.16,
          type: 'square',
          gain: 0.008 + t * 0.006,
          filter: 3200,
          filterEnd: 7200,
          attack: 0.001,
          offset: this.stepDuration * 0.18,
        })
      }
    }

    if (step === 4 || step === 12) {
      hits.push({ dur: brick ? 0.11 : 0.075, gain: brick ? 0.07 : 0.055, freq: online ? 2200 : 1450, type: 'bandpass', q: 1.2, send: 0.1 })
    }
    if ((online && step % 2 === 1) || (brick && [2, 7, 11, 15].includes(step)) || (!online && !brick && step % 2 === 1)) {
      hits.push({ dur: 0.018, gain: brick ? 0.012 : 0.016, freq: 6800 + (step % 3) * 500, type: 'highpass', q: 2.5 })
    }

    return { notes, hits }
  }

  /** Partie : version énergique du thème avec arpège, basse syncopée et batterie à couches. */
  private gameStep(bar: number, step: number): Step {
    const baseChord = GAME_CHORDS[bar % GAME_CHORDS.length]
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
          freq: midiToFreq(midi + (bar >= 4 && i === 2 ? 12 : 0)),
          dur: this.stepDuration * 6.8,
          type: i === 1 ? 'triangle' : 'sawtooth',
          gain: 0.009 + t * 0.002,
          filter: 650 + i * 360,
          filterEnd: 1700 + i * 620,
          attack: 0.045,
          send: 0.12,
        })
      })
    }

    // Ligne de basse à huit croches par mesure, avec quelques attaques décalées.
    const bassSteps = [0, 2, 5, 6, 8, 10, 13, 14]
    if (bassSteps.includes(step)) {
      const bassPattern = [0, 0, 12, 7, 0, 12, 10, 7]
      const bassIndex = bassSteps.indexOf(step)
      const jump = bassPattern[(bassIndex + (bar % 2 ? 2 : 0)) % bassPattern.length]
      notes.push({
        freq: midiToFreq(chord.root + jump),
        dur: this.stepDuration * (step % 4 === 0 ? 1.6 : 0.72),
        type: 'sawtooth',
        gain: 0.052 + t * 0.015,
        filter: 220 + t * 280,
        filterEnd: 900 + t * 2100,
        attack: 0.004,
      })
    }

    // Arpège en doubles croches : les notes sautent entre les voix de l’accord.
    const arpPattern = [0, 2, 1, 2, 0, 2, 1, 0, 2, 1, 0, 1, 2, 0, 1, 2]
    if (step % 2 === 0 || (bar >= 4 && step % 4 === 3)) {
      const arpNote = chord.notes[arpPattern[(step + bar) % arpPattern.length]]
      notes.push({
        freq: midiToFreq(arpNote + (step % 4 === 2 ? 24 : 12)),
        dur: this.stepDuration * (step % 4 === 2 ? 0.42 : 0.7),
        type: step % 4 === 0 ? 'square' : 'triangle',
        gain: (0.015 + t * 0.009) * (bar >= 4 ? 1.12 : 1),
        filter: 1400 + t * 500,
        filterEnd: 3200 + t * 1200,
        attack: 0.001,
        send: step % 4 === 2 ? 0.2 : 0.08,
      })
    }

    // Le thème revient au premier plan toutes les deux mesures.
    const hook = bar % 4 < 2 ? ARCADE_HOOK : ARCADE_HOOK_B
    const hookDegree = hook[step]
    if (hookDegree !== null && (step % 2 === 0 || t > 0.55)) {
      notes.push({
        freq: midiToFreq(chord.root + 12 + hookDegree),
        dur: this.stepDuration * ([0, 12].includes(step) ? 1.8 : 0.82),
        type: step % 4 === 0 ? 'sawtooth' : 'square',
        gain: (step === 0 || step === 12 ? 0.026 : 0.018) * (0.75 + t * 0.75),
        filter: 1500 + t * 900,
        filterEnd: 3600 + t * 1500,
        attack: 0.002,
        send: step === 12 ? 0.26 : 0.12,
      })
    }

    // Couche de tension : pulsation aiguë, seulement dans les fins serrées.
    if (t > 0.45 && step % 4 === 2) {
      notes.push({
        freq: midiToFreq(chord.root + 24),
        dur: this.stepDuration * 0.8,
        type: 'square',
        gain: 0.012 * (t - 0.45) * 2.2,
        filter: 2400,
        filterEnd: 4400,
        attack: 0.004,
      })
    }

    // Batterie : kick syncopé, caisse claire, charleston fermé et accent ouvert.
    if ([0, 6, 8, 14].includes(step)) {
      hits.push({ dur: 0.13, gain: (step === 0 || step === 8 ? 0.15 : 0.085) * (0.8 + t * 0.3), freq: 100, type: 'lowpass', q: 0.85 })
    }
    if (step === 4 || step === 12) {
      hits.push({ dur: 0.095, gain: 0.085 * (0.7 + t * 0.5), freq: 1700, type: 'bandpass', q: 0.9, send: 0.08 })
    }
    if (step % 2 === 1) {
      hits.push({ dur: 0.02, gain: (step % 4 === 3 ? 0.022 : 0.012) * (0.5 + t), freq: 7600, type: 'highpass' })
    }
    if (step === 15 && bar % 4 === 3) {
      hits.push({ dur: 0.13, gain: 0.035 + t * 0.03, freq: 4800, type: 'highpass', send: 0.24 })
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
