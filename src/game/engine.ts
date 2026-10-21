import { audio } from './audio'
import type { Hsv } from './colors'
import { FIXED_DT, MAX_STEPS_PER_FRAME, type Difficulty } from './constants'
import { lerp } from './math'
import { World, type GameEvent, type Side } from './world'
import { SnapshotInterpolator } from '../net/interpolator'
import { CTRL, NET_EVENT, NetSession, type NetSnapshot, type NetStatus } from '../net/session'
import { DEFAULT_RENDER_SETTINGS, Renderer, type RenderSettings } from '../render/renderer'
import { computeView, screenToWorldY } from '../render/view'

export type EnginePhase = 'menu' | 'playing' | 'paused' | 'gameover'
export type GameMode = 'ai' | 'online'

export interface EngineState {
  phase: EnginePhase
  scorePlayer: number
  scoreAi: number
  target: number
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
  netStatus: NetStatus
  roomCode: string
  latency: number
  peerConnected: boolean
  netMessage: string
}

export interface EngineOptions {
  color: Hsv
  difficulty: Difficulty
  target: number
  muted: boolean
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
    case 'countdown':
      return NET_EVENT.COUNTDOWN
    case 'win':
      return NET_EVENT.WIN
    case 'lose':
      return NET_EVENT.LOSE
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
  private pointerWorldY = 450

  private session: NetSession | null = null
  private interpolator = new SnapshotInterpolator()
  private mode: GameMode = 'ai'
  private netStatus: NetStatus = 'idle'
  private netMessage = ''
  private latency = 0
  private peerConnected = false
  private rematchRequested = false
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
    this.muted = options.muted

    this.renderer = new Renderer(canvas)
    this.world.setPlayerColor(this.color)
    this.world.difficulty = this.difficulty
    this.world.target = this.target
    this.world.reset(this.target)
    this.world.frozen = true

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
      netStatus: this.netStatus,
      roomCode: this.session?.roomId ?? '',
      latency: this.latency,
      peerConnected: this.peerConnected,
      netMessage: this.netMessage,
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
    if (this.phase === 'playing') this.pause()
    else if (this.phase === 'paused') this.resume()
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
    this.world.frozen = false
    this.renderer.resetTrail()
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
    this.world.setPlayerColor(this.color)
    this.emit(true)
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
      onPeerJoin: () => this.onPeerJoin(),
      onPeerLeave: () => this.onPeerLeave(),
    })
  }

  /** Crée un salon et attend l'adversaire. Retourne le lien d'invitation. */
  createOnlineRoom(): string {
    const session = this.buildSession()
    session.create()
    this.attachSession(session)
    return this.inviteLink()
  }

  /** Rejoint un salon existant. */
  joinOnlineRoom(code: string, key: string): void {
    const session = this.buildSession()
    session.join(code, key)
    this.attachSession(session)
  }

  /** Lien d'invitation (contient le code du salon et sa clé de chiffrement). */
  inviteLink(): string {
    const session = this.session
    if (!session) return ''
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('room', session.roomId)
    url.searchParams.set('key', session.password)
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
    this.phase = 'menu'
    this.emit(true)
  }

  detachSession(): void {
    this.session = null
    this.mode = 'ai'
    this.netStatus = 'idle'
    this.netMessage = ''
    this.peerConnected = false
    this.latency = 0
    this.world.aiRemote = false
    this.world.playerRemote = false
    this.world.netPaddleY = null
    this.phase = 'menu'
    this.emit(true)
  }

  /** L'hôte démarre la partie quand l'invité arrive. */
  private onPeerJoin(): void {
    this.peerConnected = true
    if (this.session?.role !== 'host') return
    this.world.frozen = false
    this.world.reset(this.world.target)
    this.phase = 'playing'
    this.emit(true)
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

  private onRemoteInput = (paddleY: number): void => {
    this.world.netPaddleY = paddleY
  }

  private onControl = (code: number): void => {
    if (code === CTRL.REMATCH_REQUEST) {
      this.rematchRequested = true
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
    } else {
      this.session.sendControl(CTRL.REMATCH_REQUEST)
      this.netMessage = 'Demande de revanche envoyée…'
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
    if (world.phase === 'over') world.winner = snap.scoreHost > snap.scoreGuest ? 'player' : 'ai'
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
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true })
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: true })
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
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect()
    const view = computeView(this.renderer.pixelWidth, this.renderer.pixelHeight)
    const canvasY = (event.clientY - rect.top) * (this.renderer.pixelHeight / Math.max(rect.height, 1))
    this.pointerWorldY = screenToWorldY(view, canvasY)
    this.pointerActive = true
    this.localPaddleTarget = this.pointerWorldY
  }

  private onPointerDown = (): void => {
    audio.init()
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
      case 'KeyR':
        this.restart()
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

    // Entrées clavier
    if (!this.pointerActive) {
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
        }
        this.session.sendState(this.buildSnapshot())
      } else {
        this.session.sendInput(this.world.netPaddleY ?? this.world.ai.y)
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
    this.renderer.render(this.world, this.settings)
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
      default:
        break
    }
  }

  private syncPhase(): void {
    if (this.mode === 'online') {
      const over = this.world.phase === 'over'
      if (over && this.phase !== 'gameover') {
        this.phase = 'gameover'
        this.emit(true)
      } else if (!over && this.phase === 'gameover') {
        this.phase = 'playing'
        this.emit(true)
      } else if (!over && this.phase === 'menu' && this.peerConnected) {
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

  private emit(force = false): void {
    const state = this.getState()
    const signature = [
      state.phase,
      state.scorePlayer,
      state.scoreAi,
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
