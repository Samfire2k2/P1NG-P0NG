import { audio } from './audio'
import type { Hsv } from './colors'
import { aiHsvFrom, hsvToRgb } from './colors'
import { FIELD_HEIGHT, FIXED_DT, MAX_STEPS_PER_FRAME, type Difficulty, type MatchFormat } from './constants'
import { clamp, lerp } from './math'
import { music } from './music'
import { POWERUP_TYPES, World, type GameEvent, type PowerupType, type Side } from './world'
import { POWERUP_INFO } from './powerups'
import { SnapshotInterpolator } from '../net/interpolator'
import { CTRL, NET_EVENT, NetSession, type NetMeta, type NetSnapshot, type NetStatus } from '../net/session'
import { DEFAULT_RENDER_SETTINGS, Renderer, type RenderSettings } from '../render/renderer'
import { computeView } from '../render/view'
import type { DailyChallenge, ReplayFrame } from './arcade'
import type { StoryChapter } from './lore'

export type EnginePhase = 'menu' | 'playing' | 'paused' | 'gameover'
export type GameMode = 'ai' | 'online'

export interface EngineState {
  phase: EnginePhase
  scorePlayer: number
  scoreAi: number
  target: number
  /** Format de la manche : au nombre de points ou chronométrée. */
  format: MatchFormat
  /** Temps restant en mode « temps » ; -1 sinon. */
  timeLeft: number
  /** La manche s'est terminée par une égalité. */
  draw: boolean
  countdown: number
  serving: boolean
  serveTo: Side
  winner: Side | null
  difficulty: Difficulty
  color: Hsv
  muted: boolean
  fps: number
  mode: GameMode
  /** Côté du joueur local : gauche = hôte, droite = invité. */
  side: 'left' | 'right'
  /** Pseudo du joueur local. */
  playerName: string
  /** Pseudo de l'adversaire (vide si inconnu). */
  peerName: string
  /** Couleur de l'adversaire (ou de l'IA en solo). */
  peerColor: Hsv
  netStatus: NetStatus
  roomCode: string
  latency: number
  peerConnected: boolean
  netMessage: string
  /** Mode spectateur (lecture seule). */
  spectator: boolean
  /** Mode powerups actif. */
  powerups: boolean
  /** Mode casse-brique actif. */
  brickMode: boolean
  /** Vies et briques restantes en mode casse-brique. */
  brickLives: number
  bricksLeft: number
  bricksBroken: number
  /** Nom du dernier bonus obtenu localement, affiché brièvement. */
  powerupNotice: string | null
  powerupDescription: string | null
  powerupNoticeIsOpponent: boolean
  activePowerups: Array<{ type: PowerupType; remaining: number | null }>
  /** Dernier événement de jeu, affiché brièvement. */
  gameNotice: string | null
  /** Orientation du terrain. */
  orientation: 'landscape' | 'portrait'
  /** Durée d'une manche chronométrée (secondes). */
  duration: number
  challenge: DailyChallenge | null
  contractProgress: number
  contractComplete: boolean
  challengeNotice: string | null
  replayFrames: ReplayFrame[]
  survivalMode: boolean
  localDuel: boolean
  trainingExercise: 'rebonds' | 'precision' | null
  trainingProgress: number
  survivalLevel: number
  matchStats: { duration: number; paddleHits: number; wallHits: number; powerups: number }
  storyMode: boolean
  storyChapter: StoryChapter | null
  storyTheme: number
}

export interface EngineOptions {
  color: Hsv
  difficulty: Difficulty
  target: number
  format: MatchFormat
  muted: boolean
  powerups?: boolean
  brickMode?: boolean
  orientation?: 'landscape' | 'portrait'
  duration?: number
}

const KEYBOARD_SPEED = 1500

/** Traduit un type d'événement du monde en code réseau. */
function netEventType(type: GameEvent['type']): number {
  switch (type) {
    case 'paddleHit':
      return NET_EVENT.PADDLE
    case 'wallHit':
      return NET_EVENT.WALL
    case 'score':
      return NET_EVENT.SCORE
    case 'serve':
      return NET_EVENT.SERVE
    case 'powerup':
      return NET_EVENT.POWERUP
    case 'countdown':
      return NET_EVENT.COUNTDOWN
    case 'win':
      return NET_EVENT.WIN
    case 'lose':
      return NET_EVENT.LOSE
    case 'draw':
      return NET_EVENT.DRAW
    default:
      return NET_EVENT.NONE
  }
}

/**
 * Colle la simulation (sans DOM) au renderer WebGL, à l'audio et aux entrées
 * utilisateur. React ne fait que lire l'état publié par le moteur.
 */
export class GameEngine {
  readonly canvas: HTMLCanvasElement
  private renderer: Renderer
  private world = new World()
  private settings: RenderSettings = { ...DEFAULT_RENDER_SETTINGS }

  private raf = 0
  private lastTime = 0
  private accumulator = 0
  private disposed = false

  private phase: EnginePhase = 'menu'
  private color: Hsv
  private difficulty: Difficulty
  private target: number
  private format: MatchFormat = 'points'
  private powerups = false
  private brickMode = false
  private orientation: 'landscape' | 'portrait' = 'landscape'
  private duration = 180
  private challenge: DailyChallenge | null = null
  private contractProgress = 0
  private replayFrames: ReplayFrame[] = []
  private replayAccumulator = 0
  private ghostReplay: ReplayFrame[] = []
  private survivalMode = false
  private localDuel = false
  private trainingExercise: 'rebonds' | 'precision' | null = null
  private trainingProgress = 0
  private matchStats = { paddleHits: 0, wallHits: 0, powerups: 0 }
  private matchDuration = 0
  private storyMode = false
  private storyChapter: StoryChapter | null = null
  private storyTheme = 0
  private muted: boolean
  private fps = 60
  private frameEma = 16.7
  private lastQualityCheck = 0
  private renderScale = 1
  private dpr = 1
  private lastEmitted = ''

  private keyUp = false
  private keyDown = false
  private pointerActive = false
  private pointerClientX = 0
  private pointerClientY = 0
  private sensitivity = 1
  private touchUp = false
  private touchDown = false
  private localRightUp = false
  private localRightDown = false

  private session: NetSession | null = null
  private interpolator = new SnapshotInterpolator()
  private mode: GameMode = 'ai'
  private netStatus: NetStatus = 'idle'
  private spectator = false
  private netMessage = ''
  private latency = 0
  private peerConnected = false
  private rematchRequested = false
  /** La rencontre a été lancée (hôte) ou confirmée (invité). */
  private matchStarted = false
  private playerName = ''
  private peerName = ''
  private peerColor: Hsv = { h: 0, s: 0.9, v: 1 }
  private powerupNotice: string | null = null
  private powerupDescription: string | null = null
  private powerupNoticeIsOpponent = false
  private powerupNoticeTimer = 0
  private activePowerups = new Set<PowerupType>()
  private gameNotice: string | null = null
  private gameNoticeTimer = 0
  /** Effet sonore à relayer à l'invité (hôte uniquement). */
  private netEvent: { id: number; type: number; side: number; power: number; offset: number } | null = null
  private netEventId = 0
  private lastPlayedEventId = 0

  private listeners = new Set<(state: EngineState) => void>()
  private resizeObserver: ResizeObserver | null = null

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this.canvas = canvas
    this.color = options.color
    this.difficulty = options.difficulty
    this.target = options.target
    this.format = options.format
    this.powerups = options.powerups ?? false
    this.brickMode = options.brickMode ?? false
    this.orientation = options.orientation ?? 'landscape'
    this.duration = options.duration ?? 180
    this.muted = options.muted

    this.renderer = new Renderer(canvas)
    this.world.setPlayerColor(this.color)
    this.world.difficulty = this.difficulty
    this.world.format = this.format
    this.world.powerupsEnabled = this.powerups
    this.world.brickMode = this.brickMode
    this.world.roundDuration = this.duration
    this.world.target = this.target
    this.world.reset(this.target)
    this.world.frozen = true
    // En solo, la raquette de gauche est celle du joueur : elle suit la souris.
    this.world.player.snappy = true

    this.attachListeners()
    this.handleResize()
    this.emit(true)
  }

  // ---------------------------------------------------------------- API

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): EngineState {
    return {
      phase: this.phase,
      scorePlayer: this.world.scorePlayer,
      scoreAi: this.world.scoreAi,
      target: this.world.target,
      format: this.world.format,
      timeLeft: this.world.timeLeft,
      draw: this.world.draw,
      countdown: this.world.countdown,
      serving: this.world.phase === 'serve',
      serveTo: this.world.serveTo,
      winner: this.world.winner,
      difficulty: this.difficulty,
      color: this.color,
      muted: this.muted,
      fps: Math.round(this.fps),
      mode: this.mode,
      side: this.session?.role === 'guest' ? 'right' : 'left',
      playerName: this.playerName,
      peerName: this.peerName,
      peerColor: this.mode === 'online' ? this.peerColor : aiHsvFrom(this.color),
      netStatus: this.netStatus,
      roomCode: this.session?.roomId ?? '',
      latency: this.latency,
      peerConnected: this.peerConnected,
      netMessage: this.netMessage,
      powerups: this.powerups,
      brickMode: this.brickMode,
      brickLives: this.world.brickLives,
      bricksLeft: this.world.bricksLeft,
      bricksBroken: this.world.bricksBroken,
      powerupNotice: this.powerupNotice,
      powerupDescription: this.powerupDescription,
      powerupNoticeIsOpponent: this.powerupNoticeIsOpponent,
      activePowerups: this.getActivePowerups(),
      gameNotice: this.gameNotice,
      spectator: this.spectator,
      orientation: this.orientation,
      duration: this.duration,
      challenge: this.challenge,
      contractProgress: this.contractProgress,
      contractComplete: !!this.challenge && this.contractProgress >= this.challenge.contractTarget,
      challengeNotice: this.challenge ? `DÉFI ${this.challenge.code} // ${this.contractProgress}/${this.challenge.contractTarget}` : null,
      replayFrames: this.replayFrames,
      survivalMode: this.survivalMode,
      localDuel: this.localDuel,
      trainingExercise: this.trainingExercise,
      trainingProgress: this.trainingProgress,
      survivalLevel: this.world.survivalLevel,
      matchStats: { duration: this.matchDuration, ...this.matchStats },
      storyMode: this.storyMode,
      storyChapter: this.storyChapter,
      storyTheme: this.storyTheme,
    }
  }

  start(): void {
    audio.init()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    if (this.challenge) {
      this.world.setSeed(this.challenge.seed)
      this.world.reset(this.challenge.target)
      this.replayFrames = []
      this.replayAccumulator = 0
      this.contractProgress = 0
    }
    this.world.frozen = false
    this.matchStats = { paddleHits: 0, wallHits: 0, powerups: 0 }
    this.matchDuration = 0
    this.trainingProgress = 0
    this.phase = 'playing'
    this.emit(true)
  }

  setSurvivalMode(enabled: boolean): void {
    this.survivalMode = enabled
    this.world.survivalMode = enabled
    if (enabled) {
      this.storyMode = false
      this.storyChapter = null
      this.localDuel = false
      this.trainingExercise = null
      this.world.aiRemote = false
      this.world.ai.snappy = false
      this.world.target = 99
      this.world.format = 'points'
      this.target = 99
      this.format = 'points'
      this.world.difficulty = this.difficulty = 'facile'
      this.world.powerupsEnabled = this.powerups = false
    }
    this.world.reset(this.target)
    this.world.frozen = true
    this.phase = 'menu'
    this.emit(true)
  }

  setLocalDuel(enabled: boolean): void {
    this.localDuel = enabled
    if (enabled) {
      this.storyMode = false
      this.storyChapter = null
      this.survivalMode = false
      this.trainingExercise = null
      this.world.survivalMode = false
      this.world.aiRemote = true
      this.world.ai.snappy = true
      this.world.netPaddleY = FIELD_HEIGHT / 2
      this.world.powerupsEnabled = this.powerups
    } else if (!this.session) {
      this.world.aiRemote = false
      this.world.ai.snappy = false
    }
    this.localRightUp = false
    this.localRightDown = false
    this.world.reset(this.target)
    this.world.frozen = true
    this.phase = 'menu'
    this.emit(true)
  }

  setTrainingExercise(exercise: 'rebonds' | 'precision' | null): void {
    this.storyMode = false
    this.storyChapter = null
    this.trainingExercise = exercise
    this.trainingProgress = 0
    this.survivalMode = false
    this.world.survivalMode = false
    this.localDuel = false
    this.world.aiRemote = false
    if (exercise) {
      this.difficulty = this.world.difficulty = 'facile'
      this.powerups = this.world.powerupsEnabled = false
      this.target = this.world.target = 99
      this.format = this.world.format = 'points'
    }
    this.world.reset(this.target)
    this.world.frozen = true
    this.phase = 'menu'
    this.emit(true)
  }

  setStoryMode(chapter: StoryChapter | null, theme = chapter?.theme ?? this.storyTheme): void {
    this.storyMode = !!chapter
    this.storyChapter = chapter
    this.storyTheme = theme
    if (!chapter) {
      this.world.ghostPaddleY = null
      this.world.ghostBall = null
      this.emit(true)
      return
    }
    this.challenge = null
    this.survivalMode = false
    this.localDuel = false
    this.trainingExercise = null
    this.brickMode = false
    this.world.brickMode = false
    this.world.survivalMode = false
    this.world.aiRemote = false
    this.world.ai.snappy = false
    this.world.setChallengeModifier(null)
    this.difficulty = chapter.difficulty
    this.target = chapter.target
    this.format = 'points'
    this.powerups = chapter.powerups
    this.orientation = 'landscape'
    this.world.difficulty = chapter.difficulty
    this.world.target = chapter.target
    this.world.format = 'points'
    this.world.powerupsEnabled = chapter.powerups
    this.world.powerups = []
    this.world.reset(chapter.target)
    this.world.frozen = true
    this.phase = 'menu'
    this.renderer.resetTrail()
    this.emit(true)
  }

  setArcadeChallenge(challenge: DailyChallenge | null, ghostReplay: ReplayFrame[] = []): void {
    this.challenge = challenge
    if (challenge) {
      this.storyMode = false
      this.storyChapter = null
      this.survivalMode = false
      this.world.survivalMode = false
      this.localDuel = false
      this.trainingExercise = null
      this.world.aiRemote = false
    }
    this.contractProgress = 0
    this.replayFrames = []
    this.replayAccumulator = 0
    this.ghostReplay = ghostReplay
    this.world.setChallengeModifier(challenge?.modifier ?? null)
    if (challenge) {
      this.world.setSeed(challenge.seed)
      this.difficulty = challenge.difficulty
      this.target = challenge.target
      this.format = 'points'
      this.powerups = false
      this.world.powerupsEnabled = false
      this.world.difficulty = challenge.difficulty
      this.world.target = challenge.target
      this.world.format = 'points'
      this.world.powerups = []
      this.world.reset(challenge.target)
      this.world.frozen = true
      this.phase = 'menu'
      this.renderer.resetTrail()
    }
    if (!challenge) {
      this.world.ghostPaddleY = null
      this.world.ghostBall = null
      this.world.reset(this.target)
      this.world.frozen = true
      this.phase = 'menu'
      this.renderer.resetTrail()
    }
    this.emit(true)
  }

  pause(): void {
    if (this.phase !== 'playing') return
    this.phase = 'paused'
    this.world.frozen = true
    this.emit(true)
  }

  resume(): void {
    if (this.phase !== 'paused') return
    this.phase = 'playing'
    this.world.frozen = false
    this.accumulator = 0
    this.emit(true)
  }

  togglePause(): void {
    if (this.phase === 'playing') {
      // Le compte à rebours de service n'est pas interruptible : la partie ne
      // peut pas se retrouver figée en plein décompte.
      if (this.world.phase === 'serve') return
      this.pause()
    } else if (this.phase === 'paused') {
      this.resume()
    }
  }

  restart(): void {
    if (this.mode === 'online') {
      this.requestRematch()
      return
    }
    this.restartLocal()
  }

  private restartLocal(): void {
    if (this.challenge) {
      this.world.setSeed(this.challenge.seed)
      this.replayFrames = []
      this.replayAccumulator = 0
      this.contractProgress = 0
    }
    this.world.reset(this.target)
    this.matchStats = { paddleHits: 0, wallHits: 0, powerups: 0 }
    this.matchDuration = 0
    this.trainingProgress = 0
    this.activePowerups.clear()
    // L'invité ne simule pas la physique : l'hôte reste autoritatif.
    this.world.frozen = this.mode === 'online' && this.session?.role === 'guest'
    this.renderer.resetTrail()
    this.matchStarted = true
    this.phase = 'playing'
    this.accumulator = 0
    audio.init()
    this.emit(true)
  }

  backToMenu(): void {
    if (this.mode === 'online') {
      this.session?.leave()
      this.detachSession()
      return
    }
    this.world.reset(this.target)
    this.activePowerups.clear()
    this.world.frozen = true
    this.renderer.resetTrail()
    this.phase = 'menu'
    this.emit(true)
  }

  setColor(color: Hsv): void {
    this.color = { ...color }
    this.applyColors()
    this.sendMeta()
    this.emit(true)
  }

  /** Change le pseudo du joueur local et le transmet à l'adversaire. */
  setPlayerName(name: string): void {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 18)
    if (clean === this.playerName) return
    this.playerName = clean
    this.sendMeta()
    this.emit(true)
  }

  /**
   * Applique les couleurs aux deux raquettes : en solo l'adversaire porte la
   * couleur complémentaire, en ligne il porte la couleur qu'il a choisie.
   */
  private applyColors(): void {
    const local = this.color
    if (this.mode === 'online') {
      const peer = this.peerColor
      const peerRgb = hsvToRgb(peer.h, peer.s, peer.v)
      const localRgb = hsvToRgb(local.h, local.s, local.v)
      const isGuest = this.session?.role === 'guest'
      this.world.setColors(isGuest ? peerRgb : localRgb, isGuest ? localRgb : peerRgb)
    } else {
      this.world.setPlayerColor(local)
    }
  }

  /** Transmet pseudo + couleur à l'adversaire. */
  private sendMeta(): void {
    if (!this.session || this.mode !== 'online') return
    this.session.sendMeta({
      name: this.playerName,
      h: this.color.h,
      s: this.color.s,
      v: this.color.v,
    })
  }

  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty
    this.world.difficulty = difficulty
    this.emit(true)
  }

  setTarget(target: number): void {
    this.target = target
    this.world.target = target
    this.emit(true)
  }

  setFormat(format: MatchFormat, target: number, duration?: number): void {
    this.format = format
    this.target = target
    this.world.format = format
    this.world.target = target
    if (duration !== undefined) this.duration = duration
    if (format === 'time') {
      this.world.roundDuration = this.duration
      this.world.timeLeft = this.duration
    } else {
      this.world.timeLeft = -1
    }
    this.emit(true)
  }

  setPowerups(enabled: boolean): void {
    this.powerups = enabled
    this.world.powerupsEnabled = enabled
    if (!enabled) {
      this.world.powerups = []
      this.activePowerups.clear()
    }
    this.emit(true)
  }

  setBrickMode(enabled: boolean): void {
    if (this.brickMode === enabled) return
    this.brickMode = enabled
    this.world.brickMode = enabled
    this.world.reset(this.target)
    this.renderer.resetTrail()
    this.accumulator = 0
    this.emit(true)
  }

  setOrientation(orientation: 'landscape' | 'portrait'): void {
    this.orientation = orientation
    this.emit(true)
  }

  setDuration(seconds: number): void {
    this.duration = Math.max(30, Math.min(3600, Math.round(seconds)))
    this.world.roundDuration = this.duration
    if (this.format === 'time') this.world.timeLeft = this.duration
    this.emit(true)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    audio.setMuted(muted)
    this.emit(true)
  }

  setRenderSettings(settings: Partial<RenderSettings>): void {
    this.settings = { ...this.settings, ...settings }
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(value, 0.5, 1.5)
  }

  setTouchDirection(direction: -1 | 1, active: boolean): void {
    if (direction < 0) this.touchUp = active
    else this.touchDown = active
    if (active) this.pointerActive = false
  }

  // ------------------------------------------------------------ En ligne

  /** Crée la session P2P avec les handlers du moteur. */
  private buildSession(): NetSession {
    return new NetSession({
      onStatus: this.onNetStatus,
      onSnapshot: this.onSnapshot,
      onInput: this.onRemoteInput,
      onControl: this.onControl,
      onMeta: this.onMeta,
      onPeerJoin: () => this.onPeerJoin(),
      onPeerLeave: () => this.onPeerLeave(),
    })
  }

  /** Crée un salon et attend l'adversaire. Retourne le lien d'invitation. */
  createOnlineRoom(publicRoom = false): string {
    const session = this.buildSession()
    session.create(undefined, publicRoom ? '' : undefined)
    this.attachSession(session)
    return this.inviteLink()
  }

  /** Rejoint un salon existant. */
  joinOnlineRoom(code: string, key: string): void {
    this.spectator = false
    const session = this.buildSession()
    session.join(code, key)
    this.attachSession(session)
  }

  joinSpectatorRoom(code: string, key: string): void {
    this.spectator = true
    const session = this.buildSession()
    session.joinSpectator(code, key)
    this.attachSession(session)
  }

  /** Lien d'invitation (contient le code du salon et sa clé de chiffrement). */
  inviteLink(): string {
    const session = this.session
    if (!session) return ''
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', session.roomId)
    if (session.password) url.searchParams.set('key', session.password)
    return url.toString()
  }

  /** Branche une session P2P : le moteur bascule en mode « en ligne ». */
  attachSession(session: NetSession): void {
    this.session = session
    this.mode = 'online'
    this.netStatus = session.status
    this.interpolator.reset()
    this.world.aiRemote = true
    this.world.playerRemote = session.role === 'guest'
    this.world.netPaddleY = session.role === 'guest' ? this.world.ai.y : null
    // La raquette pilotée à la souris est celle du joueur local : à gauche
    // pour l'hôte, à droite pour l'invité.
    const guest = session.role === 'guest'
    this.world.player.snappy = !guest
    this.world.ai.snappy = guest
    this.matchStarted = false
    this.phase = 'menu'
    this.applyColors()
    this.emit(true)
  }

  detachSession(): void {
    this.session = null
    this.activePowerups.clear()
    this.mode = 'ai'
    this.netStatus = 'idle'
    this.netMessage = ''
    this.peerConnected = false
    this.peerName = ''
    this.latency = 0
    this.world.aiRemote = false
    this.world.playerRemote = false
    this.world.netPaddleY = null
    this.world.player.snappy = true
    this.world.ai.snappy = false
    this.phase = 'menu'
    this.applyColors()
    this.emit(true)
  }

  /** L'hôte démarre la partie quand l'invité arrive. */
  private onPeerJoin(): void {
    this.peerConnected = true
    this.sendMeta()
    if (this.session?.role !== 'host') return
    // La partie attend d'être lancée par l'hôte : l'invité peut encore
    // choisir son pseudo et sa couleur.
    this.world.frozen = false
    this.world.reset(this.world.target)
    this.emit(true)
  }

  /** Lancement de la rencontre par l'hôte. */
  startOnlineMatch(): void {
    if (this.mode !== 'online' || this.session?.role !== 'host') return
    this.restartLocal()
    this.session.sendControl(CTRL.START)
  }
  private onPeerLeave(): void {
    this.peerConnected = false
    this.emit(true)
  }

  private onNetStatus = (status: NetStatus, detail?: string): void => {
    this.netStatus = status
    if (detail) this.netMessage = detail
    this.emit(true)
  }

  private onMeta = (meta: NetMeta): void => {
    this.peerName = meta.name
    this.peerColor = { h: meta.h, s: meta.s, v: meta.v }
    this.applyColors()
    this.emit(true)
  }

  private onRemoteInput = (paddleY: number): void => {
    this.world.netPaddleY = paddleY
  }

  private onControl = (code: number): void => {
    if (code === CTRL.REMATCH_REQUEST) {
      this.rematchRequested = true
      return
    }
    if (code === CTRL.START) {
      // L'hôte lance la rencontre : l'invité démarre en même temps.
      this.restartLocal()
    }
  }

  private onSnapshot = (snapshot: NetSnapshot): void => {
    this.interpolator.push(snapshot)
  }

  /** Invite l'adversaire à rejouer (invité) ou relance la partie (hôte). */
  requestRematch(): void {
    if (this.mode !== 'online' || !this.session) return
    if (this.session.role === 'host') {
      this.restartLocal()
      this.session.sendControl(CTRL.START)
    } else {
      this.session.sendControl(CTRL.REMATCH_REQUEST)
      this.netMessage = 'Revanche demandée…'
      this.emit(true)
    }
  }

  /** Applique l'état reçu du réseau à la vue locale (invité). */
  private applyRemoteState(): void {
    const snap = this.interpolator.sample(performance.now())
    if (!snap) return
    const world = this.world
    world.ball.x = snap.ballX
    world.ball.y = snap.ballY
    world.ball.vx = snap.ballVx
    world.ball.vy = snap.ballVy
    world.ball.speed = Math.hypot(snap.ballVx, snap.ballVy)
    // La raquette de l'hôte (gauche) est rendue avec un léger lissage.
    world.player.y = lerp(world.player.y, snap.hostPaddleY, 0.35)
    // Correction douce de notre propre raquette sur la vue de l'hôte.
    world.ai.y = lerp(world.ai.y, snap.guestPaddleY, 0.08)
    world.scorePlayer = snap.scoreHost
    world.scoreAi = snap.scoreGuest
    world.countdown = snap.countdown
    world.serveTo = snap.serveTo === 0 ? 'player' : 'ai'
    world.phase = (['serve', 'play', 'point', 'over'] as const)[snap.phase] ?? 'play'
    // Chronomètre : l'hôte fait foi, l'invité se contente de refléter.
    world.timeLeft = snap.timeLeft
    world.format = snap.timeLeft >= 0 ? 'time' : 'points'
    // La balle porte la couleur de la raquette qui l'a frappée.
    world.ball.owner = snap.ballOwner
    if (world.phase === 'over') {
      world.draw = snap.winner === 2
      world.winner = snap.winner === 0 ? 'player' : snap.winner === 1 ? 'ai' : null
    }
    this.playRemoteEvent(snap)
  }

  /** Rejoue localement l'effet sonore annoncé par l'hôte. */
  private playRemoteEvent(snap: NetSnapshot): void {
    if (!snap.eventId || snap.eventId === this.lastPlayedEventId) return
    this.lastPlayedEventId = snap.eventId
    const side = snap.eventSide === 0 ? 'player' : 'ai'
    switch (snap.eventType) {
      case NET_EVENT.PADDLE:
        audio.paddleHit(snap.eventOffset, snap.eventPower, side === 'player')
        break
      case NET_EVENT.WALL:
        audio.wallHit(snap.eventPower)
        break
      case NET_EVENT.SCORE:
        audio.score(side)
        if (!this.spectator) this.showGameNotice(side === 'ai' ? 'Point pour toi' : 'Point adverse')
        break
      case NET_EVENT.SERVE:
        audio.serve()
        break
      case NET_EVENT.COUNTDOWN:
        audio.countdown(Math.round(snap.eventPower))
        break
      case NET_EVENT.WIN:
        // L'hôte a gagné : du point de vue de l'invité, c'est une défaite.
        audio.lose()
        break
      case NET_EVENT.LOSE:
        audio.win()
        break
      case NET_EVENT.DRAW:
        audio.draw()
        break
      case NET_EVENT.POWERUP:
        audio.powerup(snap.eventOffset, snap.eventSide !== 0)
        if (!this.spectator) this.showPowerupNotice(Math.round(snap.eventOffset), snap.eventSide !== 0)
        break
      default:
        break
    }
  }

  /** Construit l'instantané envoyé à l'invité. */
  private buildSnapshot(): NetSnapshot {
    const world = this.world
    const phaseCode = { serve: 0, play: 1, point: 2, over: 3 }[world.phase]
    const event = this.netEvent
    this.netEvent = null
    return {
      ballX: world.ball.x,
      ballY: world.ball.y,
      ballVx: world.ball.vx,
      ballVy: world.ball.vy,
      hostPaddleY: world.player.y,
      guestPaddleY: world.ai.y,
      scoreHost: world.scorePlayer,
      scoreGuest: world.scoreAi,
      phase: phaseCode,
      countdown: world.countdown,
      serveTo: world.serveTo === 'player' ? 0 : 1,
      eventId: event?.id ?? 0,
      eventType: event?.type ?? NET_EVENT.NONE,
      eventSide: event?.side ?? 0,
      eventPower: event?.power ?? 0,
      eventOffset: event?.offset ?? 0,
      timeLeft: world.timeLeft,
      ballOwner: world.ball.owner,
      winner: world.draw ? 2 : world.winner === 'player' ? 0 : world.winner === 'ai' ? 1 : -1,
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.listeners.clear()
    this.detachListeners()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.session?.leave()
    this.session = null
    this.renderer.dispose()
  }

  // ------------------------------------------------------------ Entrées

  /** Cible de la raquette locale : à gauche en solo/hôte, à droite en invité. */
  get localPaddleTarget(): number {
    if (this.mode === 'online' && this.session?.role === 'guest') {
      return this.world.netPaddleY ?? this.world.ai.y
    }
    return this.world.playerTargetY
  }

  set localPaddleTarget(value: number) {
    if (this.mode === 'online' && this.session?.role === 'guest') {
      this.world.netPaddleY = value
    } else {
      this.world.playerTargetY = value
    }
  }

  private attachListeners(): void {
    // Le pointeur est suivi au niveau de la fenêtre : la position reste
    // connue même quand le curseur passe sur les menus.
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: true })
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: true })
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    document.addEventListener('visibilitychange', this.onVisibilityChange)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize())
      this.resizeObserver.observe(this.canvas)
    }
  }

  private detachListeners(): void {
    window.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || this.localDuel) return
    this.pointerClientX = event.clientX
    this.pointerClientY = event.clientY
    this.pointerActive = true
  }

  /**
   * Convertit la position du curseur en cible monde. Appelé à chaque frame :
   * la raquette reste ainsi exactement sous la souris, même si la mise en page
   * change (redimensionnement, passage en plein écran).
   */
  private updatePointerTarget(): void {
    const rect = this.canvas.getBoundingClientRect()
    const view = computeView(this.renderer.pixelWidth, this.renderer.pixelHeight, this.orientation)
    const cx = (this.pointerClientX - rect.left) * (this.renderer.pixelWidth / Math.max(rect.width, 1))
    const cy = (this.pointerClientY - rect.top) * (this.renderer.pixelHeight / Math.max(rect.height, 1))
    let worldY: number
    if (this.orientation === 'portrait') {
      worldY = (cx - view.originX) / view.scale
    } else {
      worldY = (cy - view.originY) / view.scale
    }
    const center = FIELD_HEIGHT / 2
    const normalized = clamp((worldY - center) / center, -1, 1)
    const adjusted = Math.sign(normalized) * Math.pow(Math.abs(normalized), 1 / this.sensitivity)
    this.localPaddleTarget = center + adjusted * center
  }

  private onTouchStart = (event: TouchEvent): void => {
    if (this.localDuel) return
    audio.init()
    const t = event.touches[0]
    if (t) {
      this.pointerClientX = t.clientX
      this.pointerClientY = t.clientY
      this.pointerActive = true
    }
    if (this.phase === 'paused') this.resume()
  }

  private onTouchMove = (event: TouchEvent): void => {
    if (this.localDuel) return
    const t = event.touches[0]
    if (t) {
      this.pointerClientX = t.clientX
      this.pointerClientY = t.clientY
      this.pointerActive = true
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.localDuel) return
    audio.init()
    this.pointerClientX = event.clientX
    this.pointerClientY = event.clientY
    this.pointerActive = true
    if (this.phase === 'paused') this.resume()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (target instanceof Element && (
      target.isContentEditable
      || target.closest('input, textarea, select, button, [role="textbox"]')
    )) return

    if (event.repeat) return
    if (this.localDuel && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
      event.preventDefault()
      if (event.code === 'ArrowUp') this.localRightUp = true
      else this.localRightDown = true
      return
    }
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        // En mode portrait, ArrowUp ne fait rien (on utilise les flèches gauche/droite)
        if (this.orientation === 'portrait') break
        this.keyUp = true
        this.pointerActive = false
        break
      case 'ArrowDown':
      case 'KeyS':
        // En mode portrait, ArrowDown ne fait rien (on utilise les flèches gauche/droite)
        if (this.orientation === 'portrait') break
        this.keyDown = true
        this.pointerActive = false
        break
      case 'ArrowLeft':
        // En mode portrait, flèche gauche = monter
        if (this.orientation === 'portrait') {
          this.keyUp = true
          this.pointerActive = false
          break
        }
        // En mode paysage, flèche gauche n'est pas utilisée par défaut
        break
      case 'ArrowRight':
        // En mode portrait, flèche droite = descendre
        if (this.orientation === 'portrait') {
          this.keyDown = true
          this.pointerActive = false
          break
        }
        // En mode paysage, flèche droite n'est pas utilisée par défaut
        break
      case 'Space':
        event.preventDefault()
        audio.init()
        if (this.phase === 'menu') this.start()
        else this.togglePause()
        break
      case 'KeyM':
        this.setMuted(!this.muted)
        break
      default:
        break
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (this.localDuel && (event.code === 'ArrowUp' || event.code === 'ArrowDown')) {
      if (event.code === 'ArrowUp') this.localRightUp = false
      else this.localRightDown = false
      return
    }
    // En mode portrait, utiliser les flèches gauche/droite
    if (this.orientation === 'portrait') {
      if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.keyUp = false
      if (event.code === 'ArrowRight' || event.code === 'KeyD') this.keyDown = false
    } else {
      if (event.code === 'ArrowUp' || event.code === 'KeyW') this.keyUp = false
      if (event.code === 'ArrowDown' || event.code === 'KeyS') this.keyDown = false
    }
  }

  private onWindowBlur = (): void => {
    if (this.phase === 'playing') this.pause()
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      if (this.phase === 'playing') this.pause()
    } else if (!this.raf && !this.disposed) {
      this.lastTime = performance.now()
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  // -------------------------------------------------------------- Rendu

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect()
    const cssWidth = Math.max(1, rect.width || this.canvas.clientWidth || 1)
    const cssHeight = Math.max(1, rect.height || this.canvas.clientHeight || 1)
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.floor(cssWidth * this.dpr * this.renderScale)
    const h = Math.floor(cssHeight * this.dpr * this.renderScale)
    this.renderer.resize(w, h)
  }

  private updateQuality(now: number, dtMs: number): void {
    this.frameEma = this.frameEma * 0.92 + dtMs * 0.08
    this.fps = 1000 / Math.max(this.frameEma, 1)
    if (now - this.lastQualityCheck < 1200) return
    this.lastQualityCheck = now

    let next = this.renderScale
    if (this.frameEma > 21 && this.renderScale > 0.6) next = Math.max(0.6, this.renderScale - 0.1)
    else if (this.frameEma < 12.5 && this.renderScale < 1) next = Math.min(1, this.renderScale + 0.05)

    if (next !== this.renderScale) {
      this.renderScale = next
      this.handleResize()
    }
  }

  private loop = (now: number): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)

    const rawDt = now - this.lastTime
    this.lastTime = now
    const dt = Math.min(rawDt / 1000, 0.1)
    if (this.phase === 'playing') this.matchDuration += dt

    let noticesChanged = false
    if (this.powerupNoticeTimer > 0) {
      this.powerupNoticeTimer = Math.max(0, this.powerupNoticeTimer - dt)
      if (this.powerupNoticeTimer === 0) {
        this.powerupNotice = null
        this.powerupDescription = null
        noticesChanged = true
      }
    }
    if (this.gameNoticeTimer > 0) {
      this.gameNoticeTimer = Math.max(0, this.gameNoticeTimer - dt)
      if (this.gameNoticeTimer === 0) {
        this.gameNotice = null
        noticesChanged = true
      }
    }

    this.updateQuality(now, rawDt)

    // Entrées clavier / souris
    if (this.pointerActive && !this.localDuel) {
      // La raquette suit le curseur, image par image.
      this.updatePointerTarget()
    } else {
      const dir = (this.keyUp || this.touchUp ? -1 : 0) + (this.keyDown || this.touchDown ? 1 : 0)
      if (dir !== 0) this.localPaddleTarget += dir * KEYBOARD_SPEED * this.sensitivity * dt
    }
    if (this.localDuel) {
      const dir = (this.localRightUp ? -1 : 0) + (this.localRightDown ? 1 : 0)
      if (dir !== 0) this.world.netPaddleY = clamp((this.world.netPaddleY ?? this.world.ai.y) + dir * KEYBOARD_SPEED * dt, this.world.ai.height / 2, FIELD_HEIGHT - this.world.ai.height / 2)
    }

    // Mode en ligne : échanges réseau
    if (this.session) {
      this.session.tick(dt)
      this.latency = this.session.latency
      if (this.session.role === 'host') {
        if (this.rematchRequested) {
          this.rematchRequested = false
          this.restartLocal()
          this.session.sendControl(CTRL.START)
        }
        this.session.sendState(this.buildSnapshot())
        } else {
          if (!this.spectator) this.session.sendInput(this.world.netPaddleY ?? this.world.ai.y)
          this.applyRemoteState()
        }
    }

    // Simulation à pas fixe
    const brickScoreBeforeStep = this.world.bricksBroken
    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(FIXED_DT)
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0

    this.handleEvents()
    if (this.challenge && this.phase === 'playing') {
      this.replayAccumulator += dt
      if (this.replayAccumulator >= 0.1) {
        this.replayAccumulator %= 0.1
        if (this.replayFrames.length < 3600) this.replayFrames.push({ t: this.world.time, playerY: this.world.player.y, ballX: this.world.ball.x, ballY: this.world.ball.y })
      }
      let left: ReplayFrame | undefined
      for (const frame of this.ghostReplay) {
        if (frame.t > this.world.time) break
        left = frame
      }
      const right = this.ghostReplay.find((frame) => frame.t >= this.world.time)
      if (left && right) {
        const mix = right.t === left.t ? 0 : (this.world.time - left.t) / (right.t - left.t)
        this.world.ghostPaddleY = left.playerY + (right.playerY - left.playerY) * mix
        this.world.ghostBall = { x: left.ballX + (right.ballX - left.ballX) * mix, y: left.ballY + (right.ballY - left.ballY) * mix }
      } else {
        this.world.ghostPaddleY = null
        this.world.ghostBall = null
      }
    }
    const activePowerupsChanged = this.syncActivePowerups()
    this.syncPhase()
    const renderSettings = this.storyMode ? { ...this.settings, theme: this.storyTheme } : this.settings
    this.renderer.render(this.world, renderSettings, this.orientation)
    const brickScoreChanged = this.brickMode && brickScoreBeforeStep !== this.world.bricksBroken
    this.emit(brickScoreChanged || noticesChanged || activePowerupsChanged)
  }

  private handleEvents(): void {
    const events = this.world.drainEvents()
    for (const ev of events) {
      try {
        this.handleEvent(ev)
      } catch (error) {
        // Un son défaillant ne doit jamais interrompre la boucle de jeu.
        console.warn('Effet sonore ignoré', error)
      }
    }
  }

  private handleEvent(ev: GameEvent): void {
    if (ev.type === 'paddleHit') this.matchStats.paddleHits++
    if (ev.type === 'wallHit') this.matchStats.wallHits++
    if (ev.type === 'powerup') this.matchStats.powerups++
    if (this.trainingExercise) {
      if (this.trainingExercise === 'rebonds' && ev.type === 'wallHit') this.trainingProgress++
      if (this.trainingExercise === 'precision' && ev.type === 'paddleHit' && ev.side === 'player' && Math.abs(ev.offset ?? 1) <= 0.35) this.trainingProgress++
      const goal = this.trainingExercise === 'rebonds' ? 30 : 20
      if (this.trainingProgress >= goal) {
        this.world.phase = 'over'
        this.world.winner = 'player'
        this.world.draw = false
      }
    }
    if (this.challenge && this.phase === 'playing') {
      if (this.challenge.contract === 'rallies' && ev.type === 'paddleHit' && ev.side === 'player') this.contractProgress++
      if (this.challenge.contract === 'wall-taps' && ev.type === 'wallHit') this.contractProgress++
      if (this.challenge.contract === 'win' && ev.type === 'win' && ev.side === 'player') this.contractProgress = 1
    }
    const onlineHost = this.mode === 'online' && this.session?.role === 'host'
    if (onlineHost) {
      this.netEventId++
      this.netEvent = {
        id: this.netEventId,
        type: netEventType(ev.type),
        side: ev.side === 'ai' ? 1 : 0,
        power: ev.power ?? 0,
        offset: ev.offset ?? ev.value ?? 0,
      }
    }
    switch (ev.type) {
      case 'paddleHit':
        audio.paddleHit(ev.offset ?? 0, ev.power ?? 0, ev.side === 'player')
        break
      case 'wallHit':
        audio.wallHit(ev.power ?? 0)
        break
      case 'score':
        audio.score(ev.side ?? 'ai')
        if (!this.spectator) {
          if (this.world.brickMode) {
            const notice = ev.side === 'player'
              ? 'Bouclier : vie protégée'
              : `Vie perdue · ${this.world.brickLives} restante${this.world.brickLives > 1 ? 's' : ''}`
            this.showGameNotice(notice)
          } else {
            const localSide = this.mode === 'online' && this.session?.role === 'guest' ? 'ai' : 'player'
            this.showGameNotice(ev.side === localSide ? 'Point pour toi' : 'Point adverse')
          }
        }
        break
      case 'countdown':
        audio.countdown(ev.value ?? 3)
        break
      case 'serve':
        audio.serve()
        break
      case 'powerup':
        audio.powerup(ev.value ?? 0, ev.side === 'player')
        if (!this.spectator) {
          const isLocalPlayer = this.mode === 'online'
            ? this.session?.role === 'guest'
              ? ev.side === 'ai'
              : ev.side === 'player'
            : ev.side === 'player'
          this.showPowerupNotice(ev.value ?? 0, isLocalPlayer)
        }
        break
      case 'win':
        audio.win()
        this.world.particles.confetti(
          this.world.player.x + 160,
          this.world.player.y,
          this.world.playerColor,
          160,
        )
        break
      case 'lose':
        audio.lose()
        this.world.particles.confetti(
          this.world.brickMode ? this.world.player.x + 160 : this.world.ai.x - 160,
          this.world.brickMode ? this.world.player.y : this.world.ai.y,
          this.world.brickMode ? this.world.playerColor : this.world.aiColor,
          160,
        )
        break
      case 'draw':
        audio.draw()
        break
      default:
        break
    }
  }

  private showPowerupNotice(index: number, isLocalPlayer: boolean): void {
    const type = POWERUP_TYPES[index]
    if (!type) return
    this.powerupNoticeIsOpponent = !isLocalPlayer
    this.powerupNotice = isLocalPlayer
      ? POWERUP_INFO[type].label
      : `${this.mode === 'online' ? this.peerName || 'Adversaire' : 'IA'} · ${POWERUP_INFO[type].label}`
    this.powerupDescription = POWERUP_INFO[type].description
    this.powerupNoticeTimer = 2.2
    if (isLocalPlayer && type !== 'teleport') this.activePowerups.add(type)
  }

  private syncActivePowerups(): boolean {
    let changed = false
    for (const type of this.activePowerups) {
      let active = false
      switch (type) {
        case 'speed': active = this.world.ballSpeedMul > 1.001; break
        case 'slow': active = this.world.ballSpeedMul < 0.999; break
        case 'grow': active = this.world.playerHeightMul > 1.001; break
        case 'shrink': active = (this.world.brickMode ? this.world.playerHeightMul : this.world.aiHeightMul) < 0.999; break
        case 'shield': active = this.world.playerShield; break
        case 'magnet': active = this.world.playerMagnet > 0 || this.world.aiMagnet > 0; break
        case 'ghost': active = this.world.ghostTimer > 0; break
        case 'double': active = this.world.playerDouble; break
        case 'multiball': active = this.world.balls.length > 1; break
        case 'teleport': break
      }
      if (!active) {
        this.activePowerups.delete(type)
        changed = true
      }
    }
    return changed
  }

  private getActivePowerups(): EngineState['activePowerups'] {
    return Array.from(this.activePowerups, (type) => ({
      type,
      remaining: type === 'magnet'
        ? Math.max(this.world.playerMagnet, this.world.aiMagnet)
        : type === 'ghost'
          ? this.world.ghostTimer
          : null,
    }))
  }

  private showGameNotice(message: string): void {
    this.gameNotice = message
    this.gameNoticeTimer = 2
  }

  private syncPhase(): void {
    // Musique : piste de jeu pendant la partie, piste du menu sinon.
    music.setTrack(
    this.phase === 'playing'
      ? this.world.brickMode
        ? 'brick'
        : this.world.mode === 'online'
        ? 'online'
        : this.world.orientation === 'portrait'
        ? 'portrait'
        : 'classic'
      : 'menu'
  )
    music.setTension(this.musicTension())
    const lead =
      this.world.scorePlayer > this.world.scoreAi ? 'player' : this.world.scorePlayer < this.world.scoreAi ? 'ai' : 'none'
    music.setLead(lead)

    if (this.mode === 'online') {
      const over = this.world.phase === 'over'
      if (over && this.phase !== 'gameover') {
        this.phase = 'gameover'
        this.emit(true)
      } else if (!over && this.phase === 'gameover') {
        this.phase = 'playing'
        this.emit(true)
      } else if (!over && this.phase === 'menu' && this.matchStarted) {
        this.phase = 'playing'
        this.emit(true)
      }
      return
    }
    if (this.world.phase === 'over' && this.phase !== 'gameover') {
      this.phase = 'gameover'
      this.emit(true)
    }
  }

  /**
   * Tension musicale : monte quand le score est serré, et dans la dernière
   * demi-minute d'un round chronométré. Au début de la partie elle reste
   * basse : l'écart au score n'a de sens qu'une fois la manche engagée.
   */
  private musicTension(): number {
    if (this.phase !== 'playing') return 0
    const diff = Math.abs(this.world.scorePlayer - this.world.scoreAi)
    const closeness = clamp(1 - diff / 3, 0, 1)
    const played = this.world.scorePlayer + this.world.scoreAi
    const progress = clamp(played / 6, 0, 1)
    const scoreTension = closeness * (0.35 + 0.65 * progress)
    const timeLeft = this.world.timeLeft
    const clockTension = timeLeft >= 0 ? clamp(1 - timeLeft / 30, 0, 1) : 0
    return Math.max(scoreTension, clockTension)
  }

  private emit(force = false): void {
    const state = this.getState()
    const signature = [
      state.phase,
      state.scorePlayer,
      state.scoreAi,
      state.brickMode,
      state.brickLives,
      state.bricksLeft,
      state.bricksBroken,
      state.contractProgress,
      state.trainingProgress,
      state.survivalLevel,
      state.powerupNotice,
      state.powerupDescription,
      state.powerupNoticeIsOpponent,
      state.activePowerups.map(({ type, remaining }) => `${type}:${remaining === null ? '' : Math.ceil(remaining)}`).join(','),
      state.gameNotice,
      state.format,
      Math.round(state.timeLeft),
      state.draw,
      state.countdown,
      state.serving,
      state.serveTo,
      state.winner,
      state.difficulty,
      state.color.h.toFixed(1),
      state.color.s.toFixed(2),
      state.color.v.toFixed(2),
      state.muted,
      state.mode,
      state.netStatus,
      state.roomCode,
      state.peerConnected,
      state.netMessage,
      state.playerName,
      state.peerName,
      state.peerColor.h.toFixed(1),
      Math.round(state.latency / 3),
      Math.round(state.fps / 4),
    ].join('|')
    if (!force && signature === this.lastEmitted) return
    this.lastEmitted = signature
    for (const listener of this.listeners) listener(state)
  }

  /** Démarre la boucle de rendu. */
  run(): void {
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }
}
