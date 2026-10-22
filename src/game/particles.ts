import { PARTICLE_CAPACITY } from './constants'
import { TAU } from './math'

/**
 * Système de particules "SoA" (structure of arrays) : zéro allocation par frame,
 * suppression par swap-remove pour garder les données contiguës.
 */
export class ParticleSystem {
  readonly capacity = PARTICLE_CAPACITY
  readonly x = new Float32Array(PARTICLE_CAPACITY)
  readonly y = new Float32Array(PARTICLE_CAPACITY)
  readonly vx = new Float32Array(PARTICLE_CAPACITY)
  readonly vy = new Float32Array(PARTICLE_CAPACITY)
  readonly life = new Float32Array(PARTICLE_CAPACITY)
  readonly maxLife = new Float32Array(PARTICLE_CAPACITY)
  readonly size = new Float32Array(PARTICLE_CAPACITY)
  readonly r = new Float32Array(PARTICLE_CAPACITY)
  readonly g = new Float32Array(PARTICLE_CAPACITY)
  readonly b = new Float32Array(PARTICLE_CAPACITY)
  readonly drag = new Float32Array(PARTICLE_CAPACITY)
  /** 0 = étincelle, 1 = halo doux, 2 = confetti carré */
  readonly kind = new Uint8Array(PARTICLE_CAPACITY)
  count = 0
  /**
   * Source d'aléatoire. Par défaut `Math.random` (rendu temps réel) ; la
   * simulation headless injecte un générateur déterministe.
   */
  rng: () => number = Math.random

  clear(): void {
    this.count = 0
  }

  private push(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
    drag: number,
    kind: number,
  ): void {
    if (this.count >= this.capacity) return
    const i = this.count++
    this.x[i] = x
    this.y[i] = y
    this.vx[i] = vx
    this.vy[i] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.size[i] = size
    this.r[i] = r
    this.g[i] = g
    this.b[i] = b
    this.drag[i] = drag
    this.kind[i] = kind
  }

  /** Gerbe d'étincelles radiales. */
  burst(
    x: number,
    y: number,
    amount: number,
    color: [number, number, number],
    opts: {
      speed?: number
      spread?: number
      angle?: number
      life?: number
      size?: number
      drag?: number
      kind?: number
    } = {},
  ): void {
    const speed = opts.speed ?? 320
    const spread = opts.spread ?? TAU
    const angle = opts.angle ?? 0
    const life = opts.life ?? 0.55
    const size = opts.size ?? 5
    const drag = opts.drag ?? 2.4
    const kind = opts.kind ?? 0
    for (let i = 0; i < amount; i++) {
      const a = angle + (this.rng() - 0.5) * spread
      const s = speed * (0.35 + this.rng() * 0.85)
      this.push(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        life * (0.6 + this.rng() * 0.7),
        size * (0.6 + this.rng() * 0.8),
        color[0],
        color[1],
        color[2],
        drag,
        kind,
      )
    }
  }

  /** Éclat d'impact : anneau + étincelles rapides. */
  impact(
    x: number,
    y: number,
    nx: number,
    ny: number,
    color: [number, number, number],
    power: number,
  ): void {
    const angle = Math.atan2(ny, nx)
    this.burst(x, y, Math.round(10 + power * 22), color, {
      speed: 220 + power * 620,
      spread: 1.9,
      angle,
      life: 0.42,
      size: 4.5,
    })
    this.burst(x, y, 4, [1, 1, 1], {
      speed: 140 + power * 260,
      spread: 2.6,
      angle,
      life: 0.24,
      size: 6.5,
    })
  }

  /** Confettis de fin de match. */
  confetti(x: number, y: number, color: [number, number, number], amount = 120): void {
    for (let i = 0; i < amount; i++) {
      const a = this.rng() * TAU
      const s = 180 + this.rng() * 720
      this.push(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s - 220,
        1.6 + this.rng() * 1.4,
        7 + this.rng() * 9,
        color[0],
        color[1],
        color[2],
        1.1,
        2,
      )
    }
  }

  update(dt: number): void {
    let i = 0
    while (i < this.count) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        const last = --this.count
        if (i !== last) {
          this.x[i] = this.x[last]
          this.y[i] = this.y[last]
          this.vx[i] = this.vx[last]
          this.vy[i] = this.vy[last]
          this.life[i] = this.life[last]
          this.maxLife[i] = this.maxLife[last]
          this.size[i] = this.size[last]
          this.r[i] = this.r[last]
          this.g[i] = this.g[last]
          this.b[i] = this.b[last]
          this.drag[i] = this.drag[last]
          this.kind[i] = this.kind[last]
        }
        continue
      }
      const d = Math.exp(-this.drag[i] * dt)
      this.vx[i] *= d
      this.vy[i] *= d
      this.x[i] += this.vx[i] * dt
      this.y[i] += this.vy[i] * dt
      i++
    }
  }
}
