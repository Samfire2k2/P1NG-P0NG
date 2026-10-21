import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/constants'
import { BALL_RADIUS } from '../game/constants'
import type { NetSnapshot } from './session'

interface TimedSnapshot {
  t: number
  snap: NetSnapshot
}

/**
 * Tampon d'interpolation pour l'invité : les instantanés arrivent à ~60 Hz
 * mais avec du jitter réseau. On restitue l'état avec un léger retard
 * (extrapolation si aucun instantané plus récent n'est arrivé).
 */
export class SnapshotInterpolator {
  private buffer: TimedSnapshot[] = []
  private delay = 90

  setDelay(ms: number): void {
    this.delay = ms
  }

  reset(): void {
    this.buffer.length = 0
  }

  push(snapshot: NetSnapshot): void {
    this.buffer.push({ t: performance.now(), snap: snapshot })
    if (this.buffer.length > 24) this.buffer.shift()
  }

  get latest(): NetSnapshot | null {
    return this.buffer.length ? this.buffer[this.buffer.length - 1].snap : null
  }

  /** Échantillonne l'état à l'instant de rendu (now - delay). */
  sample(now: number): NetSnapshot | null {
    if (this.buffer.length === 0) return null
    const target = now - this.delay

    for (let i = this.buffer.length - 1; i > 0; i--) {
      const a = this.buffer[i - 1]
      const b = this.buffer[i]
      if (target >= a.t && target <= b.t) {
        const span = b.t - a.t
        const k = span > 0 ? (target - a.t) / span : 0
        return {
          ...b.snap,
          ballX: a.snap.ballX + (b.snap.ballX - a.snap.ballX) * k,
          ballY: a.snap.ballY + (b.snap.ballY - a.snap.ballY) * k,
          ballVx: a.snap.ballVx + (b.snap.ballVx - a.snap.ballVx) * k,
          ballVy: a.snap.ballVy + (b.snap.ballVy - a.snap.ballVy) * k,
          hostPaddleY: a.snap.hostPaddleY + (b.snap.hostPaddleY - a.snap.hostPaddleY) * k,
          guestPaddleY: a.snap.guestPaddleY + (b.snap.guestPaddleY - a.snap.guestPaddleY) * k,
        }
      }
    }

    // Aucun instantané ne couvre l'instant demandé : extrapolation.
    const last = this.buffer[this.buffer.length - 1]
    const dt = Math.min((now - last.t) / 1000, 0.12)
    let x = last.snap.ballX + last.snap.ballVx * dt
    let y = last.snap.ballY + last.snap.ballVy * dt
    if (y < BALL_RADIUS) {
      y = BALL_RADIUS
    } else if (y > FIELD_HEIGHT - BALL_RADIUS) {
      y = FIELD_HEIGHT - BALL_RADIUS
    }
    x = Math.max(-40, Math.min(FIELD_WIDTH + 40, x))
    return { ...last.snap, ballX: x, ballY: y }
  }
}
