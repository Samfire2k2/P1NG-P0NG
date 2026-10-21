import {
  AI_BASE_MAX_SPEED,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_SPEED_GAIN,
  BALL_START_SPEED,
  COUNTDOWN_STEP,
  DIFFICULTY_PROFILES,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  MAX_BOUNCE_ANGLE,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  PLAYER_MARGIN,
  PLAYER_MAX_SPEED,
  AI_MARGIN,
  POINT_PAUSE,
  SPIN_TRANSFER,
  type Difficulty,
} from './constants'
import { clamp, createRng, randRange, TAU } from './math'
import { ParticleSystem } from './particles'
import { aiColorFrom, hsvToRgb, type Hsv, type Rgb } from './colors'

export type Side = 'player' | 'ai'
export type Phase = 'serve' | 'play' | 'point' | 'over'

export type GameEventType =
  | 'paddleHit'
  | 'wallHit'
  | 'score'
  | 'countdown'
  | 'serve'
  | 'win'
  | 'lose'
  | 'pointEnd'

export interface GameEvent {
  type: GameEventType
  side?: Side
  power?: number
  offset?: number
  value?: number
  x?: number
  y?: number
}

export interface Paddle {
  x: number
  y: number
  vy: number
  height: number
  color: Rgb
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  speed: number
}

export interface AiState {
  targetY: number
  reactionTimer: number
  /** Erreur de visée figée pour l'échange en cours (unités). */
  aimError: number
  aimLocked: boolean
}

/**
 * Monde de simulation : purement déterministe et sans dépendance au DOM.
 * Le renderer et l'audio lisent l'état ; ils ne le modifient pas.
 */
export class World {
  phase: Phase = 'serve'
  time = 0
  frame = 0

  player: Paddle
  ai: Paddle
  ball: Ball

  scorePlayer = 0
  scoreAi = 0
  target = 11

  serveTimer = 0
  serveTo: Side = 'player'
  countdown = 2
  countdownStep = 0
  winner: Side | null = null
  lastScorer: Side | null = null

  shake = 0
  flash = 0
  paddleFlashPlayer = 0
  paddleFlashAi = 0

  particles = new ParticleSystem()
  events: GameEvent[] = []

  playerTargetY = FIELD_HEIGHT / 2
  playerColor: Rgb = [0.2, 0.9, 1]
  aiColor: Rgb = [1, 0.3, 0.7]
  difficulty: Difficulty = 'moyen'
  /** En mode menu / pause : la balle reste garée, le joueur peut tester sa raquette. */
  frozen = true
  /** La raquette gauche est pilotée par le réseau (vue de l'invité). */
  playerRemote = false
  /** La raquette droite est pilotée par le réseau au lieu de l'IA. */
  aiRemote = false
  /** Cible reçue du réseau pour la raquette pilotée à distance. */
  netPaddleY: number | null = null

  aiState: AiState = { targetY: FIELD_HEIGHT / 2, reactionTimer: 0, aimError: 0, aimLocked: false }
  private rng: () => number = createRng(0x9e3779b9)

  constructor() {
    this.player = { x: PLAYER_MARGIN, y: FIELD_HEIGHT / 2, vy: 0, height: PADDLE_HEIGHT, color: this.playerColor }
    this.ai = { x: FIELD_WIDTH - AI_MARGIN, y: FIELD_HEIGHT / 2, vy: 0, height: PADDLE_HEIGHT, color: this.aiColor }
    this.ball = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, r: BALL_RADIUS, speed: BALL_START_SPEED }
  }

  setSeed(seed: number): void {
    this.rng = createRng(seed >>> 0)
  }

  setPlayerColor(hsv: Hsv): void {
    this.playerColor = hsvToRgb(hsv.h, hsv.s, hsv.v)
    this.player.color = this.playerColor
    const ai = aiColorFrom(hsv)
    this.aiColor = ai
    this.ai.color = ai
  }

  /**
   * Couleurs par raquette (gauche / droite). En ligne, la raquette distante
   * porte la couleur choisie par l'adversaire.
   */
  setColors(left: Rgb, right: Rgb): void {
    this.playerColor = left
    this.player.color = left
    this.aiColor = right
    this.ai.color = right
  }

  reset(target = this.target): void {
    this.phase = 'serve'
    this.time = 0
    this.scorePlayer = 0
    this.scoreAi = 0
    this.target = target
    this.winner = null
    this.lastScorer = null
    this.player.y = FIELD_HEIGHT / 2
    this.player.vy = 0
    this.ai.y = FIELD_HEIGHT / 2
    this.ai.vy = 0
    this.playerTargetY = FIELD_HEIGHT / 2
    this.aiState.targetY = FIELD_HEIGHT / 2
    this.aiState.reactionTimer = 0
    this.aiState.aimError = 0
    this.aiState.aimLocked = false
    this.particles.clear()
    this.shake = 0
    this.flash = 0
    this.parkBall()
    this.countdown = 2
    this.countdownStep = 0
    this.serveTimer = 0
    this.serveTo = this.rng() < 0.5 ? 'player' : 'ai'
  }

  private parkBall(): void {
    this.ball.x = FIELD_WIDTH / 2
    this.ball.y = FIELD_HEIGHT / 2
    this.ball.vx = 0
    this.ball.vy = 0
    this.ball.speed = BALL_START_SPEED
  }

  private push(ev: GameEvent): void {
    this.events.push(ev)
  }

  drainEvents(): GameEvent[] {
    if (this.events.length === 0) return EMPTY_EVENTS
    const out = this.events
    this.events = []
    return out
  }

  /** Avance la simulation d'un pas fixe. */
  step(dt: number): void {
    this.time += dt
    this.frame++

    this.shake = Math.max(0, this.shake - dt * 3.2)
    this.flash = Math.max(0, this.flash - dt * 3.6)
    this.paddleFlashPlayer = Math.max(0, this.paddleFlashPlayer - dt * 4)
    this.paddleFlashAi = Math.max(0, this.paddleFlashAi - dt * 4)

    if (!this.playerRemote) this.updatePlayer(dt)
    if (this.aiRemote) this.updateNetPaddle(dt)
    else this.updateAi(dt)
    if (this.frozen) {
      this.particles.update(dt)
      return
    }
    if (this.phase === 'serve') {
      this.updateServe(dt)
    } else if (this.phase === 'play') {
      this.updateBall(dt)
    } else if (this.phase === 'point') {
      this.serveTimer -= dt
      if (this.serveTimer <= 0) {
        this.phase = 'serve'
        this.countdown = 2
        this.countdownStep = 0
        this.serveTimer = 0
        this.serveTo = this.lastScorer === 'player' ? 'ai' : 'player'
        this.parkBall()
      }
    }

    this.particles.update(dt)
  }

  private updatePlayer(dt: number): void {
    const p = this.player
    const half = p.height / 2
    const target = clamp(this.playerTargetY, half, FIELD_HEIGHT - half)
    const dy = target - p.y
    const maxStep = PLAYER_MAX_SPEED * dt
    const move = clamp(dy, -maxStep, maxStep)
    p.y = clamp(p.y + move, half, FIELD_HEIGHT - half)
    p.vy = dt > 0 ? move / dt : 0
  }

  private updateServe(dt: number): void {
    this.serveTimer -= dt
    if (this.serveTimer <= 0) {
      this.countdown--
      if (this.countdown > 0) {
        this.serveTimer = COUNTDOWN_STEP
        this.push({ type: 'countdown', value: this.countdown })
      } else {
        this.serveTimer = 0
        this.launchServe()
      }
    }
  }

  private launchServe(): void {
    const dir = this.serveTo === 'player' ? -1 : 1
    const angle = randRange(-0.36, 0.36)
    this.ball.x = FIELD_WIDTH / 2
    this.ball.y = FIELD_HEIGHT / 2
    this.ball.speed = BALL_START_SPEED
    this.ball.vx = Math.cos(angle) * this.ball.speed * dir
    this.ball.vy = Math.sin(angle) * this.ball.speed
    this.phase = 'play'
    this.push({ type: 'serve' })
  }

  private updateBall(dt: number): void {
    const b = this.ball
    b.x += b.vx * dt
    b.y += b.vy * dt

    // Murs haut / bas
    if (b.y - b.r <= 0) {
      b.y = b.r
      b.vy = Math.abs(b.vy)
      this.onWallHit(b.x, 0, b)
    } else if (b.y + b.r >= FIELD_HEIGHT) {
      b.y = FIELD_HEIGHT - b.r
      b.vy = -Math.abs(b.vy)
      this.onWallHit(b.x, FIELD_HEIGHT, b)
    }

    // Paddles
    if (b.vx < 0) {
      const front = this.player.x + PADDLE_WIDTH / 2
      if (b.x - b.r <= front && b.x > this.player.x - PADDLE_WIDTH) {
        if (this.paddleOverlap(this.player, b)) this.onPaddleHit(this.player, b, 1)
      }
    } else if (b.vx > 0) {
      const front = this.ai.x - PADDLE_WIDTH / 2
      if (b.x + b.r >= front && b.x < this.ai.x + PADDLE_WIDTH) {
        if (this.paddleOverlap(this.ai, b)) this.onPaddleHit(this.ai, b, -1)
      }
    }

    // But
    if (b.x + b.r < 0) this.onGoal('ai')
    else if (b.x - b.r > FIELD_WIDTH) this.onGoal('player')
  }

  private paddleOverlap(p: Paddle, b: Ball): boolean {
    const halfH = p.height / 2
    const halfW = PADDLE_WIDTH / 2
    const dx = b.x - p.x
    const dy = b.y - p.y
    if (Math.abs(dy) > halfH + b.r) return false
    // Rectangle arrondi (coin = rayon de la balle)
    const cx = Math.abs(dx) - (halfW - b.r)
    const cy = Math.abs(dy) - (halfH - b.r)
    if (cx <= 0 && cy <= 0) return true
    return Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) <= b.r
  }

  private onPaddleHit(p: Paddle, b: Ball, dir: number): void {
    const halfH = p.height / 2
    const offset = clamp((b.y - p.y) / halfH, -1, 1)

    // Point de contact sur la face du paddle
    b.x = p.x + dir * (PADDLE_WIDTH / 2 + b.r)

    const angle = offset * MAX_BOUNCE_ANGLE
    const speed = Math.min(b.speed * BALL_SPEED_GAIN, BALL_MAX_SPEED)
    b.speed = speed
    let vx = Math.cos(angle) * speed * dir
    let vy = Math.sin(angle) * speed

    // Effet : la vitesse verticale du paddle déforme slightly la trajectoire
    vy += p.vy * SPIN_TRANSFER
    const mag = Math.hypot(vx, vy) || 1
    vx = (vx / mag) * speed
    vy = (vy / mag) * speed
    b.vx = vx
    b.vy = vy

    const power = clamp((speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED), 0, 1)
    this.shake = Math.max(this.shake, 0.25 + power * 0.75)
    this.flash = Math.max(this.flash, 0.2 + power * 0.4)
    if (p === this.player) this.paddleFlashPlayer = 1
    else this.paddleFlashAi = 1

    this.particles.impact(b.x - dir * b.r, b.y, -dir, 0, p.color, power)
    this.push({
      type: 'paddleHit',
      side: p === this.player ? 'player' : 'ai',
      power,
      offset,
      x: b.x,
      y: b.y,
    })
  }

  private onWallHit(x: number, y: number, b: Ball): void {
    const power = clamp((b.speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED), 0, 1)
    this.shake = Math.max(this.shake, 0.12 + power * 0.3)
    this.particles.burst(x, y, 8, [0.75, 0.88, 1], {
      speed: 120 + power * 200,
      spread: 1.4,
      angle: y === 0 ? Math.PI / 2 : -Math.PI / 2,
      life: 0.32,
      size: 3.4,
    })
    this.push({ type: 'wallHit', x, y, power })
  }

  private onGoal(scorer: Side): void {
    if (scorer === 'player') this.scorePlayer++
    else this.scoreAi++
    this.lastScorer = scorer
    this.phase = 'point'
    this.serveTimer = POINT_PAUSE
    this.shake = 1
    this.flash = 1

    const color = scorer === 'player' ? this.playerColor : this.aiColor
    const x = scorer === 'player' ? FIELD_WIDTH + 20 : -20
    this.particles.burst(x, this.ball.y, 90, color, {
      speed: 420,
      spread: TAU,
      life: 1.1,
      size: 7,
      drag: 1.6,
    })

    this.push({ type: 'score', side: scorer, value: scorer === 'player' ? this.scorePlayer : this.scoreAi })

    if (this.scorePlayer >= this.target || this.scoreAi >= this.target) {
      this.phase = 'over'
      this.winner = this.scorePlayer > this.scoreAi ? 'player' : 'ai'
      this.push({ type: this.winner === 'player' ? 'win' : 'lose', side: this.winner })
    }
  }

  /** Raquette pilotée à distance : suit la cible reçue du réseau. */
  private updateNetPaddle(dt: number): void {
    const paddle = this.ai
    const half = paddle.height / 2
    if (this.netPaddleY === null) return
    const desired = clamp(this.netPaddleY, half, FIELD_HEIGHT - half)
    const dy = desired - paddle.y
    const maxStep = PLAYER_MAX_SPEED * dt
    const move = clamp(dy, -maxStep, maxStep)
    paddle.y = clamp(paddle.y + move, half, FIELD_HEIGHT - half)
    paddle.vy = dt > 0 ? move / dt : 0
  }

  /** IA : prédiction d'interception + délai de réaction + erreur humaine. */
  private updateAi(dt: number): void {
    const profile = DIFFICULTY_PROFILES[this.difficulty]
    const state = this.aiState
    const paddle = this.ai

    state.reactionTimer -= dt
    if (state.reactionTimer <= 0) {
      state.reactionTimer = profile.reaction * randRange(0.75, 1.35)

      if (this.ball.vx > 0) {
        // Balle en approche : on fige une erreur de visée pour tout l'échange,
        // comme un joueur humain qui vise un point (parfois raté).
        if (!state.aimLocked) {
          const sign = this.rng() < 0.5 ? -1 : 1
          state.aimError = sign * profile.error * (0.5 + this.rng() * 0.9)
          state.aimLocked = true
        }
        const intercept = this.predictIntercept()
        state.targetY = intercept + state.aimError
      } else {
        // Balle chez le joueur : recentrage, comme un humain qui attend.
        state.aimLocked = false
        state.aimError = 0
        state.targetY = FIELD_HEIGHT / 2 + randRange(-40, 40)
      }
    }

    const half = paddle.height / 2
    const desired = clamp(state.targetY, half, FIELD_HEIGHT - half)
    const maxSpeed = AI_BASE_MAX_SPEED * profile.speed
    const dy = desired - paddle.y
    const maxStep = maxSpeed * dt
    const move = clamp(dy, -maxStep, maxStep)
    paddle.y = clamp(paddle.y + move, half, FIELD_HEIGHT - half)
    paddle.vy = dt > 0 ? move / dt : 0
  }

  /** Prédit la Y d'interception de la balle (simulation grossière, sans rebonds de paddle). */
  private predictIntercept(): number {
    const b = this.ball
    if (b.vx <= 0) return FIELD_HEIGHT / 2
    const targetX = this.ai.x
    let x = b.x
    let y = b.y
    let vx = b.vx
    let vy = b.vy
    const dt = 1 / 120
    for (let i = 0; i < 240; i++) {
      x += vx * dt
      y += vy * dt
      if (y < b.r) {
        y = b.r
        vy = -vy
      } else if (y > FIELD_HEIGHT - b.r) {
        y = FIELD_HEIGHT - b.r
        vy = -vy
      }
      if (x >= targetX) break
    }
    return clamp(y, 0, FIELD_HEIGHT)
  }
}

const EMPTY_EVENTS: GameEvent[] = []
