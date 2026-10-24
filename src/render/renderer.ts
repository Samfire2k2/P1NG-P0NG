import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  TRAIL_LENGTH,
  TRAIL_LIFE,
} from '../game/constants'
import { clamp, lerp } from '../game/math'
import type { PowerupType, World } from '../game/world'
import { computeView } from './view'
import { SPRITE_CIRCLE, SPRITE_GLOW, SPRITE_ROUNDBOX, SpriteBatch } from './batch'
import {
  createProgram,
  createRenderTarget,
  disposeRenderTarget,
  pickColorFormat,
  Uniforms,
  type RenderTarget,
  type TextureFormat,
} from './gl'
import {
  BACKGROUND_FS,
  BLUR_FS,
  BRIGHT_FS,
  COMPOSITE_FS,
  DOWNSAMPLE_FS,
  FULLSCREEN_VS,
  SPRITE_FS,
  SPRITE_VS,
  UPSAMPLE_FS,
} from './shaders'

const BLOOM_LEVELS = 5

export interface RenderSettings {
  bloomIntensity: number
  chromatic: number
  vignette: number
  scanlines: number
  grain: number
  theme: number
  reducedMotion?: boolean
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  bloomIntensity: 1.0,
  chromatic: 0.0018,
  vignette: 0.5,
  scanlines: 0.055,
  grain: 0.016,
  theme: 0,
}

const mix3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]

/**
 * Couleur de la balle : celle de la raquette qui l'a frappée en dernier.
 * Au service, elle reste neutre.
 */
const ballColorOf = (world: World): [number, number, number] => {
  if (world.ball.owner === 0) {
    return [world.playerColor[0], world.playerColor[1], world.playerColor[2]]
  }
  if (world.ball.owner === 1) {
    return [world.aiColor[0], world.aiColor[1], world.aiColor[2]]
  }
  return [0.95, 0.97, 1]
}

/**
 * Renderer WebGL2 : sprites instanciés + chaîne de bloom (pyramide) + composite
 * (aberration chromatique, tone mapping ACES, vignette, scanlines, grain).
 */
export class Renderer {
  private gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private fmt: TextureFormat

  private width = 1
  private height = 1

  private scene!: RenderTarget
  private bloomA: RenderTarget[] = []
  private bloomB: RenderTarget[] = []

  private progSprite: WebGLProgram
  private uSprite: Uniforms
  private progBg: WebGLProgram
  private uBg: Uniforms
  private progBright: WebGLProgram
  private uBright: Uniforms
  private progDown: WebGLProgram
  private uDown: Uniforms
  private progBlur: WebGLProgram
  private uBlur: Uniforms
  private progUp: WebGLProgram
  private uUp: Uniforms
  private progComposite: WebGLProgram
  private uComposite: Uniforms

  private additive: SpriteBatch
  private core: SpriteBatch
  private fullscreenVao: WebGLVertexArrayObject

  private trailX = new Float32Array(TRAIL_LENGTH)
  private trailY = new Float32Array(TRAIL_LENGTH)
  private trailR = new Float32Array(TRAIL_LENGTH)
  private trailG = new Float32Array(TRAIL_LENGTH)
  private trailB = new Float32Array(TRAIL_LENGTH)
  private trailTime = new Float32Array(TRAIL_LENGTH)
  private trailCount = 0
  private trailHead = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      desynchronized: true,
    })
    if (!gl) throw new Error("WebGL2 n'est pas disponible sur ce navigateur")
    this.gl = gl
    this.fmt = pickColorFormat(gl)

    this.progSprite = createProgram(gl, SPRITE_VS, SPRITE_FS)
    this.uSprite = new Uniforms(gl, this.progSprite)
    this.progBg = createProgram(gl, FULLSCREEN_VS, BACKGROUND_FS)
    this.uBg = new Uniforms(gl, this.progBg)
    this.progBright = createProgram(gl, FULLSCREEN_VS, BRIGHT_FS)
    this.uBright = new Uniforms(gl, this.progBright)
    this.progDown = createProgram(gl, FULLSCREEN_VS, DOWNSAMPLE_FS)
    this.uDown = new Uniforms(gl, this.progDown)
    this.progBlur = createProgram(gl, FULLSCREEN_VS, BLUR_FS)
    this.uBlur = new Uniforms(gl, this.progBlur)
    this.progUp = createProgram(gl, FULLSCREEN_VS, UPSAMPLE_FS)
    this.uUp = new Uniforms(gl, this.progUp)
    this.progComposite = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS)
    this.uComposite = new Uniforms(gl, this.progComposite)

    this.additive = new SpriteBatch(gl, 4096)
    this.core = new SpriteBatch(gl, 256)

    const vao = gl.createVertexArray()
    if (!vao) throw new Error('Allocation GPU impossible')
    this.fullscreenVao = vao

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.clearColor(0, 0, 0, 1)
  }

  get pixelWidth(): number {
    return this.width
  }

  get pixelHeight(): number {
    return this.height
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h

    const gl = this.gl
    if (this.scene) {
      disposeRenderTarget(gl, this.scene)
      this.bloomA.forEach((t) => disposeRenderTarget(gl, t))
      this.bloomB.forEach((t) => disposeRenderTarget(gl, t))
    }
    this.bloomA = []
    this.bloomB = []

    this.scene = createRenderTarget(gl, w, h, this.fmt)
    let bw = Math.max(1, w >> 1)
    let bh = Math.max(1, h >> 1)
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.bloomA.push(createRenderTarget(gl, bw, bh, this.fmt))
      this.bloomB.push(createRenderTarget(gl, bw, bh, this.fmt))
      bw = Math.max(1, bw >> 1)
      bh = Math.max(1, bh >> 1)
    }
  }

  resetTrail(): void {
    this.trailCount = 0
    this.trailHead = 0
  }

  /**
   * Ajoute un échantillon de traînée. Le sillage ne disparaît pas d'un coup :
   * chaque échantillon conserve sa couleur puis s'efface (TRAIL_LIFE).
   */
  private updateTrail(
    x: number,
    y: number,
    color: readonly [number, number, number],
    now: number,
  ): void {
    // Purge des échantillons trop vieux
    while (this.trailCount > 0) {
      if (now - this.trailTime[this.trailHead] <= TRAIL_LIFE) break
      this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH
      this.trailCount--
    }
    if (this.trailCount > 0) {
      const last = (this.trailHead + this.trailCount - 1) % TRAIL_LENGTH
      if (Math.hypot(x - this.trailX[last], y - this.trailY[last]) < 4) return
    }
    if (this.trailCount === TRAIL_LENGTH) {
      this.trailHead = (this.trailHead + 1) % TRAIL_LENGTH
      this.trailCount--
    }
    const idx = (this.trailHead + this.trailCount) % TRAIL_LENGTH
    this.trailX[idx] = x
    this.trailY[idx] = y
    this.trailR[idx] = color[0]
    this.trailG[idx] = color[1]
    this.trailB[idx] = color[2]
    this.trailTime[idx] = now
    this.trailCount++
  }

  private settings: RenderSettings = DEFAULT_RENDER_SETTINGS
  private orientation: 'landscape' | 'portrait' = 'landscape'

  render(world: World, settings: RenderSettings = DEFAULT_RENDER_SETTINGS, orientation: 'landscape' | 'portrait' = 'landscape'): void {
    this.settings = settings
    this.orientation = orientation
    const gl = this.gl
    const w = this.width
    const h = this.height

    const view = computeView(w, h, orientation)
    const scale = view.scale
    const shake = world.shake
    const shakeX = this.settings.reducedMotion ? 0 : Math.sin(world.time * 97) * shake * 14
    const shakeY = this.settings.reducedMotion ? 0 : Math.cos(world.time * 113) * shake * 14
    const originX = view.originX + shakeX
    const originY = view.originY + shakeY

    if (world.phase !== 'over' || world.winner === null) {
      this.updateTrail(world.ball.x, world.ball.y, ballColorOf(world), world.time)
    }

    // ---------- Passe scène ----------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.framebuffer)
    gl.viewport(0, 0, w, h)
    gl.disable(gl.BLEND)
    gl.clear(gl.COLOR_BUFFER_BIT)

    this.drawBackground(world, originX, originY, scale)
    this.drawEntities(world, originX, originY, scale)

    // ---------- Bloom ----------
    this.runBloom()

    // ---------- Composite ----------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.disable(gl.BLEND)
    gl.useProgram(this.progComposite)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.scene.texture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA[0].texture)
    this.uComposite.i('u_scene', 0)
    this.uComposite.i('u_bloom', 1)
    this.uComposite.v2('u_resolution', w, h)
    this.uComposite.f('u_time', world.time)
    this.uComposite.f('u_bloomIntensity', settings.reducedMotion ? Math.min(settings.bloomIntensity, 0.25) : settings.bloomIntensity)
    this.uComposite.f('u_chromatic', settings.reducedMotion ? 0 : settings.chromatic)
    this.uComposite.f('u_vignette', settings.vignette)
    this.uComposite.f('u_scanlines', settings.reducedMotion ? 0 : settings.scanlines)
    this.uComposite.f('u_grain', settings.reducedMotion ? 0 : settings.grain)
    this.drawFullscreen()
  }

  private drawBackground(world: World, originX: number, originY: number, scale: number): void {
    const gl = this.gl
    gl.useProgram(this.progBg)
    this.uBg.v2('u_resolution', this.width, this.height)
    this.uBg.v2('u_origin', originX, originY)
    this.uBg.f('u_scale', scale)
    this.uBg.v2('u_field', this.orientation === 'portrait' ? FIELD_HEIGHT : FIELD_WIDTH, this.orientation === 'portrait' ? FIELD_WIDTH : FIELD_HEIGHT)
    this.uBg.f('u_time', world.time)
    this.uBg.v3('u_playerColor', world.playerColor[0], world.playerColor[1], world.playerColor[2])
    this.uBg.v3('u_aiColor', world.aiColor[0], world.aiColor[1], world.aiColor[2])
    const themes: Array<{ bg: [number, number, number]; grid: [number, number, number]; border: [number, number, number] }> = [
      { bg: [0.02, 0.025, 0.055], grid: [0.10, 0.16, 0.30], border: [0.30, 0.55, 1.0] },
      { bg: [0.08, 0.02, 0.12], grid: [0.4, 0.1, 0.5], border: [1.0, 0.3, 0.6] },
      { bg: [0.0, 0.05, 0.0], grid: [0.0, 0.3, 0.1], border: [0.2, 0.8, 0.3] },
      { bg: [0.05, 0.05, 0.06], grid: [0.15, 0.15, 0.18], border: [0.5, 0.5, 0.6] },
      { bg: [0.004, 0.014, 0.03], grid: [0.08, 0.20, 0.32], border: [0.62, 0.86, 1.0] },
      { bg: [0.035, 0.012, 0.075], grid: [0.28, 0.08, 0.58], border: [0.82, 0.36, 1.0] },
      { bg: [0.004, 0.045, 0.07], grid: [0.03, 0.32, 0.42], border: [0.26, 0.94, 0.82] },
    ]
    const theme = themes[this.settings.theme ?? 0] ?? themes[0]
    this.uBg.v3('u_bgBase', theme.bg[0], theme.bg[1], theme.bg[2])
    this.uBg.v3('u_gridBase', theme.grid[0], theme.grid[1], theme.grid[2])
    this.uBg.v3('u_borderBase', theme.border[0], theme.border[1], theme.border[2])
    // Écho du terrain : la grille prend la teinte du joueur qui mène et
    // pulse à chaque point marqué.
    const diff = world.scorePlayer - world.scoreAi
    const lead = Math.min(1, Math.abs(diff) / 3)
    const leadColor = diff >= 0 ? world.playerColor : world.aiColor
    this.uBg.f('u_lead', lead)
    this.uBg.v3('u_leadColor', leadColor[0], leadColor[1], leadColor[2])
    this.uBg.f('u_gridPulse', world.gridPulse)
    this.drawFullscreen()
  }

  private drawEntities(world: World, originX: number, originY: number, scale: number): void {
    const gl = this.gl
    const player = world.player
    const ai = world.ai
    const ball = world.ball

    gl.useProgram(this.progSprite)
    this.uSprite.v2('u_resolution', this.width, this.height)
    this.uSprite.v2('u_origin', originX, originY)
    this.uSprite.f('u_scale', scale)

    // ---- Passe additive : halos, traînée, particules ----
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    this.additive.begin()

    // Traînée de la balle : dégradé de couleur le long du sillage.
    if (!this.settings.reducedMotion && this.trailCount > 1) {
      const last = this.trailCount - 1
      for (let k = 0; k < last; k++) {
        const i0 = (this.trailHead + k) % TRAIL_LENGTH
        const i1 = (this.trailHead + k + 1) % TRAIL_LENGTH
        const x0w = this.trailX[i0]
        const y0w = this.trailY[i0]
        const x1w = this.trailX[i1]
        const y1w = this.trailY[i1]
        let x0 = x0w
        let y0 = y0w
        let x1 = x1w
        let y1 = y1w
        if (this.orientation === 'portrait') {
          x0 = y0w
          y0 = FIELD_WIDTH - x0w
          x1 = y1w
          y1 = FIELD_WIDTH - x1w
        }
        const dx = x1 - x0
        const dy = y1 - y0
        const len = Math.hypot(dx, dy)
        if (len < 0.001) continue
        const t = k / last
        const age = clamp((world.time - this.trailTime[i0]) / TRAIL_LIFE, 0, 1)
        // Couleur : mélange des deux échantillons voisins, donc dégradé continu
        // le long du sillage (il change quand la balle change de propriétaire).
        const color = mix3(
          [this.trailR[i0], this.trailG[i0], this.trailB[i0]],
          [this.trailR[i1], this.trailG[i1], this.trailB[i1]],
          0.5,
        )
        const thickness = lerp(1.5, 9, t * t) * (1 - age * 0.55)
        const alpha = lerp(0.06, 0.6, t) * (1 - age) * (1 - age)
        this.additive.push(
          (x0 + x1) * 0.5,
          (y0 + y1) * 0.5,
          len * 0.5 + thickness * 0.5,
          thickness * 0.5,
          color[0],
          color[1],
          color[2],
          alpha,
          SPRITE_ROUNDBOX,
          thickness * 0.5,
          Math.atan2(dy, dx),
          1.4,
        )
      }
    }

    // Halos des paddles
    const playerPos = this.orientation === 'portrait'
      ? { x: player.y, y: FIELD_WIDTH - player.x }
      : { x: player.x, y: player.y }
    this.pushGlow(playerPos.x, playerPos.y, PADDLE_WIDTH * 1.9, PADDLE_HEIGHT * 0.82, world.playerColor, 0.34, this.orientation)
    if (!world.brickMode) {
      const aiPos = this.orientation === 'portrait'
        ? { x: ai.y, y: FIELD_WIDTH - ai.x }
        : { x: ai.x, y: ai.y }
      this.pushGlow(aiPos.x, aiPos.y, PADDLE_WIDTH * 1.9, PADDLE_HEIGHT * 0.82, world.aiColor, 0.34, this.orientation)
    }

    // Halo de la balle
    const ballPos = this.orientation === 'portrait'
      ? { x: ball.y, y: FIELD_WIDTH - ball.x }
      : { x: ball.x, y: ball.y }
    const ballTint = ballColorOf(world)
    this.pushGlow(ballPos.x, ballPos.y, ball.r * 3.4, ball.r * 3.4, ballTint, 0.4)

    if (world.ghostPaddleY !== null && world.ghostBall) {
      const ghostPaddle = this.orientation === 'portrait'
        ? { x: world.ghostPaddleY, y: FIELD_WIDTH - player.x }
        : { x: player.x, y: world.ghostPaddleY }
      const ghostBall = this.orientation === 'portrait'
        ? { x: world.ghostBall.y, y: FIELD_WIDTH - world.ghostBall.x }
        : world.ghostBall
      this.pushGlow(ghostPaddle.x, ghostPaddle.y, PADDLE_WIDTH * 1.6, PADDLE_HEIGHT * 0.7, [0.55, 0.82, 1], 0.22, this.orientation)
      this.pushGlow(ghostBall.x, ghostBall.y, ball.r * 2.4, ball.r * 2.4, [0.55, 0.82, 1], 0.18)
    }

    // Particules
    const particles = world.particles
    for (let i = 0; !this.settings.reducedMotion && i < particles.count; i++) {
      const life = particles.life[i] / Math.max(particles.maxLife[i], 0.0001)
      const kind = particles.kind[i]
      if (kind === 2) continue
      let px = particles.x[i]
      let py = particles.y[i]
      if (this.orientation === 'portrait') {
        const t = px
        px = py
        py = FIELD_WIDTH - t
      }
      const size = particles.size[i] * (0.35 + life * 0.9)
      this.additive.push(
        px,
        py,
        size,
        size,
        particles.r[i],
        particles.g[i],
        particles.b[i],
        life * 0.9,
        kind === 1 ? SPRITE_GLOW : SPRITE_CIRCLE,
        size * 0.35,
        0,
        1.6,
      )
    }

    this.additive.flush()

    // ---- Passe opaque (alpha pré-multipliée) : formes principales ----
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    this.core.begin()

    this.pushPaddle(player, world.playerColor, world.paddleFlashPlayer, this.orientation)

    if (world.playerDouble) {
      const p2 = { x: player.x, y: player.y + (this.orientation === 'portrait' ? PADDLE_HEIGHT * 0.6 : PADDLE_HEIGHT * 0.6), height: player.height }
      this.pushPaddle(p2, world.playerColor, 0, this.orientation)
    }

    if (!world.brickMode) this.pushPaddle(ai, world.aiColor, world.paddleFlashAi, this.orientation)

    if (world.aiDouble) {
      const a2 = { x: ai.x, y: ai.y + (this.orientation === 'portrait' ? PADDLE_HEIGHT * 0.6 : PADDLE_HEIGHT * 0.6), height: ai.height }
      this.pushPaddle(a2, world.aiColor, 0, this.orientation)
    }

    const ballColor = ballColorOf(world)
    const hot: [number, number, number] = [
      lerp(ballColor[0], 1, 0.62),
      lerp(ballColor[1], 1, 0.62),
      lerp(ballColor[2], 1, 0.62),
    ]
    const ghostAlpha = world.ghostTimer > 0 ? 0.12 : 1
    for (const b of world.balls) {
      const ballDraw = this.orientation === 'portrait'
        ? { x: b.y, y: FIELD_WIDTH - b.x }
        : { x: b.x, y: b.y }
      this.core.push(
        ballDraw.x,
        ballDraw.y,
        b.r,
        b.r,
        hot[0],
        hot[1],
        hot[2],
        ghostAlpha,
        3,
        b.r,
        0,
        2.1,
      )
      // Halo
      this.pushGlow(ballDraw.x, ballDraw.y, b.r * 3.4, b.r * 3.4, ballColorOf(world), 0.4 * ghostAlpha)
    }

    // Confettis
    for (let i = 0; !this.settings.reducedMotion && i < particles.count; i++) {
      if (particles.kind[i] !== 2) continue
      const life = particles.life[i] / Math.max(particles.maxLife[i], 0.0001)
      const size = particles.size[i]
      let cx = particles.x[i]
      let cy = particles.y[i]
      if (this.orientation === 'portrait') {
        const t = cx
        cx = cy
        cy = FIELD_WIDTH - t
      }
      this.core.push(
        cx,
        cy,
        size,
        size * 0.55,
        particles.r[i],
        particles.g[i],
        particles.b[i],
        clamp(life, 0, 1),
        SPRITE_ROUNDBOX,
        size * 0.22,
        particles.x[i] * 0.01 + world.time * 3,
        1.2,
      )
    }

    // Briques
    for (const brick of world.bricks) {
      if (!brick.alive) continue
      let bx = brick.x
      let by = brick.y
      let bw = brick.w
      let bh = brick.h
      if (this.orientation === 'portrait') {
        bx = by
        by = FIELD_WIDTH - (brick.x + brick.w)
        const tmp = bw
        bw = bh
        bh = tmp
      }
      this.core.push(bx + bw / 2, by + bh / 2, bw / 2, bh / 2, brick.color[0], brick.color[1], brick.color[2], 0.9, 4, Math.min(bw, bh) / 2, 0, 1.2)
    }
    const powerupColors: Record<string, [number, number, number]> = {
      speed: [1, 0.72, 0.12],
      slow: [0.2, 0.72, 1],
      grow: [0.28, 1, 0.48],
      shrink: [1, 0.24, 0.38],
      multiball: [0.72, 0.3, 1],
      shield: [1, 0.92, 0.28],
      teleport: [1, 0.28, 0.82],
      magnet: [0.24, 0.42, 1],
      ghost: [0.66, 0.9, 1],
      double: [0.28, 1, 0.82],
    }
    for (const pu of world.powerups) {
      if (!pu.alive) continue
      let px = pu.x
      let py = pu.y
      if (this.orientation === 'portrait') {
        const t = px
        px = py
        py = FIELD_WIDTH - t
      }
      const col = powerupColors[pu.type] ?? [1, 1, 1]
      this.pushGlow(px, py, 116, 116, col, 0.82)
      this.core.push(px, py, 70, 70, col[0], col[1], col[2], 0.98, SPRITE_CIRCLE, 70, 0, 1.15)
      this.drawPowerupSymbol(px, py, pu.type)
    }

    // La passe opaque doit être envoyée au GPU : sans cet envoi, ni les
    // raquettes, ni la balle, ni les briques ne sont dessinées (seul le
    // halo de la passe additive apparaît).
    this.core.flush()
  }

  private pushGlow(
    x: number,
    y: number,
    halfW: number,
    halfH: number,
    color: readonly [number, number, number],
    alpha: number,
    orientation: 'landscape' | 'portrait' = 'landscape',
  ): void {
    // En mode portrait, inverter les dimensions pour rotation 90°
    const glowHalfW = orientation === 'portrait' ? halfH : halfW
    const glowHalfH = orientation === 'portrait' ? halfW : halfH
    this.additive.push(
      x,
      y,
      glowHalfW,
      glowHalfH,
      color[0],
      color[1],
      color[2],
      alpha,
      SPRITE_GLOW,
      0,
      0,
      1.1,
    )
  }

  private drawPowerupSymbol(x: number, y: number, type: PowerupType): void {
    const scale = 4
    const ink: [number, number, number] = [0.07, 0.12, 0.16]
    const symbolGlow = 0.45
    const line = (x1: number, y1: number, x2: number, y2: number, thickness = 5): void => {
      x1 *= scale
      y1 *= scale
      x2 *= scale
      y2 *= scale
      thickness *= scale
      const dx = x2 - x1
      const dy = y2 - y1
      const length = Math.hypot(dx, dy)
      this.core.push(
        x + (x1 + x2) / 2,
        y + (y1 + y2) / 2,
        length / 2 + thickness * 0.3,
        thickness / 2,
        ink[0], ink[1], ink[2], 1,
        SPRITE_ROUNDBOX,
        thickness / 2,
        Math.atan2(dy, dx),
        symbolGlow,
      )
    }
    const dot = (dx: number, dy: number, radius = 4): void => {
      dx *= scale
      dy *= scale
      radius *= scale
      this.core.push(x + dx, y + dy, radius, radius, ink[0], ink[1], ink[2], 1, SPRITE_CIRCLE, radius, 0, symbolGlow)
    }

    switch (type) {
      case 'speed':
        line(-2, -14, -10, 1, 6)
        line(-10, 1, 0, -1, 6)
        line(0, -1, -3, 14, 6)
        break
      case 'slow':
        {
          const clock: [number, number][] = [
            [0, -13], [9, -9], [13, 0], [9, 9], [0, 13], [-9, 9], [-13, 0], [-9, -9], [0, -13],
          ]
          for (let i = 1; i < clock.length; i++) {
            line(clock[i - 1][0], clock[i - 1][1], clock[i][0], clock[i][1], 4)
          }
          line(0, 0, 0, -8, 4)
          line(0, 0, 6, 3, 4)
        }
        break
      case 'grow':
        line(0, 0, 0, -13, 5)
        line(0, -13, -4, -8, 4)
        line(0, -13, 4, -8, 4)
        line(0, 0, 0, 13, 5)
        line(0, 13, -4, 8, 4)
        line(0, 13, 4, 8, 4)
        line(0, 0, -13, 0, 5)
        line(-13, 0, -8, -4, 4)
        line(-13, 0, -8, 4, 4)
        line(0, 0, 13, 0, 5)
        line(13, 0, 8, -4, 4)
        line(13, 0, 8, 4, 4)
        break
      case 'shrink':
        line(-14, 0, -3, 0, 5)
        line(-3, 0, -8, -5, 4)
        line(-3, 0, -8, 5, 4)
        line(14, 0, 3, 0, 5)
        line(3, 0, 8, -5, 4)
        line(3, 0, 8, 5, 4)
        break
      case 'multiball':
        dot(-8, -6, 4)
        dot(8, -6, 4)
        dot(0, 8, 4)
        break
      case 'shield': {
        const points: [number, number][] = [[0, -14], [11, -8], [9, 4], [0, 13], [-9, 4], [-11, -8], [0, -14]]
        for (let i = 1; i < points.length; i++) {
          line(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 4)
        }
        break
      }
      case 'teleport':
        line(-12, -12, -12, 12, 5)
        line(-12, -12, -7, -8, 4)
        line(-12, 12, -7, 8, 4)
        line(12, -12, 12, 12, 5)
        line(12, -12, 7, -8, 4)
        line(12, 12, 7, 8, 4)
        line(-5, -4, 8, -4, 4)
        line(8, -4, 3, -8, 4)
        line(8, -4, 3, 0, 4)
        line(5, 5, -8, 5, 4)
        line(-8, 5, -3, 1, 4)
        line(-8, 5, -3, 9, 4)
        break
      case 'magnet':
        line(-10, -12, -10, 5, 5)
        line(-10, 5, 10, 5, 5)
        line(10, 5, 10, -12, 5)
        line(-14, -12, -6, -12, 5)
        line(6, -12, 14, -12, 5)
        break
      case 'ghost':
        line(-11, 3, -11, -5, 4)
        line(-11, -5, -6, -12, 4)
        line(-6, -12, 6, -12, 4)
        line(6, -12, 11, -5, 4)
        line(11, -5, 11, 3, 4)
        line(11, 3, 5, 8, 4)
        line(5, 8, 0, 3, 4)
        line(0, 3, -5, 8, 4)
        line(-5, 8, -11, 3, 4)
        dot(-5, -3, 2.5)
        dot(5, -3, 2.5)
        break
      case 'double':
        line(-8, -13, -8, 13, 7)
        line(8, -13, 8, 13, 7)
        line(-13, -13, -3, -13, 4)
        line(3, -13, 13, -13, 4)
        line(-13, 13, -3, 13, 4)
        line(3, 13, 13, 13, 4)
        break
    }
  }

  private pushPaddle(
    paddle: { x: number; y: number; height: number },
    color: readonly [number, number, number],
    flash: number,
    orientation: 'landscape' | 'portrait' = 'landscape',
  ): void {
    const halfH = paddle.height / 2
    const boost = 1.7 + flash * 1.6
    if (orientation === 'portrait') {
      const cx = paddle.y
      const cy = FIELD_WIDTH - paddle.x
      const halfW = halfH
      const halfH2 = PADDLE_WIDTH / 2
      this.core.push(cx, cy, halfW, halfH2, color[0], color[1], color[2], 1, 3, PADDLE_WIDTH / 2, 0, boost)
    } else {
      const halfW = PADDLE_WIDTH / 2
      this.core.push(paddle.x, paddle.y, halfW, halfH, color[0], color[1], color[2], 1, 3, PADDLE_WIDTH / 2, 0, boost)
    }
  }

  private runBloom(): void {
    const gl = this.gl

    // Bright pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA[0].framebuffer)
    gl.viewport(0, 0, this.bloomA[0].width, this.bloomA[0].height)
    gl.disable(gl.BLEND)
    gl.useProgram(this.progBright)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.scene.texture)
    this.uBright.i('u_texture', 0)
    this.uBright.f('u_threshold', 0.72)
    this.uBright.f('u_knee', 0.45)
    this.drawFullscreen()

    // Downsample + blur par niveau
    for (let i = 1; i < BLOOM_LEVELS; i++) {
      const src = this.bloomA[i - 1]
      const dst = this.bloomA[i]
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer)
      gl.viewport(0, 0, dst.width, dst.height)
      gl.useProgram(this.progDown)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, src.texture)
      this.uDown.i('u_texture', 0)
      this.uDown.v2('u_texel', 1 / src.width, 1 / src.height)
      this.drawFullscreen()
    }

    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const target = this.bloomA[i]
      const temp = this.bloomB[i]
      gl.useProgram(this.progBlur)
      gl.activeTexture(gl.TEXTURE0)

      gl.bindFramebuffer(gl.FRAMEBUFFER, temp.framebuffer)
      gl.viewport(0, 0, temp.width, temp.height)
      gl.bindTexture(gl.TEXTURE_2D, target.texture)
      this.uBlur.i('u_texture', 0)
      this.uBlur.v2('u_direction', 1 / target.width, 0)
      this.drawFullscreen()

      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.viewport(0, 0, target.width, target.height)
      gl.bindTexture(gl.TEXTURE_2D, temp.texture)
      this.uBlur.v2('u_direction', 0, 1 / target.height)
      this.drawFullscreen()
    }

    // Upsample additif du plus petit vers le plus grand
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.useProgram(this.progUp)
    gl.activeTexture(gl.TEXTURE0)
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const src = this.bloomA[i + 1]
      const dst = this.bloomA[i]
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer)
      gl.viewport(0, 0, dst.width, dst.height)
      gl.bindTexture(gl.TEXTURE_2D, src.texture)
      this.uUp.i('u_texture', 0)
      this.uUp.v2('u_texel', 1 / src.width, 1 / src.height)
      this.uUp.f('u_intensity', 0.85)
      this.drawFullscreen()
    }
    gl.disable(gl.BLEND)
  }

  private drawFullscreen(): void {
    const gl = this.gl
    gl.bindVertexArray(this.fullscreenVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    this.additive.dispose()
    this.core.dispose()
    if (this.scene) {
      disposeRenderTarget(gl, this.scene)
      this.bloomA.forEach((t) => disposeRenderTarget(gl, t))
      this.bloomB.forEach((t) => disposeRenderTarget(gl, t))
    }
    gl.deleteVertexArray(this.fullscreenVao)
    gl.deleteProgram(this.progSprite)
    gl.deleteProgram(this.progBg)
    gl.deleteProgram(this.progBright)
    gl.deleteProgram(this.progDown)
    gl.deleteProgram(this.progBlur)
    gl.deleteProgram(this.progUp)
    gl.deleteProgram(this.progComposite)
  }
}
