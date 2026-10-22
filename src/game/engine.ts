import { audio } from './audio'
import type { Hsv } from './colors'
import { aiHsvFrom, hsvToRgb } from './colors'
import { FIXED_DT, MAX_STEPS_PER_FRAME, type Difficulty, type MatchFormat } from './constants'
import { clamp, lerp } from './math'
import { music } from './music'
import { World, type GameEvent, type Side } from './world'
import { SnapshotInterpolator } from '../net/interpolator'
import { CTRL, NET_EVENT, NetSession, type NetMeta, type NetSnapshot, type NetStatus } from '../net/session'
import { DEFAULT_RENDER_SETTINGS, Renderer, type RenderSettings } from '../render/renderer'
import { computeView } from '../render/view'

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
  /** Orientation du terrain. */
  orientation: 'landscape' | 'portrait'
  /** Durée d'une manche chronométrée (secondes). */
  duration: number
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
      spectator: this.spectator,
      orientation: this.orientation,
      duration: this.duration,
    }
  }

  start(): void {
    audio.init()
    this.world.frozen = false
    this.phase = 'playing'
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
    this.world.reset(this.target)
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
    if (!enabled) this.world.powerups = []
    this.emit(true)
  }

  setBrickMode(enabled: boolean): void {
    this.brickMode = enabled
    this.world.brickMode = enabled
    if (enabled) this.world.buildBricks?.()
    else this.world.bricks = []
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
        audio.powerup(snap.eventOffset, snap.eventSide === 0)
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
    this.localPaddleTarget = worldY
  }

  private onTouchStart = (event: TouchEvent): void => {
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
    const t = event.touches[0]
    if (t) {
      this.pointerClientX = t.clientX
      this.pointerClientY = t.clientY
      this.pointerActive = true
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    audio.init()
    this.pointerClientX = event.clientX
    this.pointerClientY = event.clientY
    this.pointerActive = true
    if (this.phase === 'paused') this.resume()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.keyUp = true
        this.pointerActive = false
        break
      case 'ArrowDown':
      case 'KeyS':
        this.keyDown = true
        this.pointerActive = false
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
    if (event.code === 'ArrowUp' || event.code === 'KeyW') this.keyUp = false
    if (event.code === 'ArrowDown' || event.code === 'KeyS') this.keyDown = false
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

    this.updateQuality(now, rawDt)

    // Entrées clavier / souris
    if (this.pointerActive) {
      // La raquette suit le curseur, image par image.
      this.updatePointerTarget()
    } else {
      const dir = (this.keyUp ? -1 : 0) + (this.keyDown ? 1 : 0)
      if (dir !== 0) this.localPaddleTarget += dir * KEYBOARD_SPEED * dt
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
    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(FIXED_DT)
      this.accumulator -= FIXED_DT
      steps++
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0

    this.handleEvents()
    this.syncPhase()
    this.renderer.render(this.world, this.settings, this.orientation)
    this.emit()
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
        break
      case 'countdown':
        audio.countdown(ev.value ?? 3)
        break
      case 'serve':
        audio.serve()
        break
      case 'powerup':
        audio.powerup(ev.value ?? 0, ev.side === 'player')
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
          this.world.ai.x - 160,
          this.world.ai.y,
          this.world.aiColor,
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

  private syncPhase(): void {
    // Musique : piste de jeu pendant la partie, piste du menu sinon.
    music.setTrack(this.phase === 'playing' ? 'game' : 'menu')
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
