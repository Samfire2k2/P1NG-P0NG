/** Helpers WebGL2 : compilation, programmes, textures, cibles de rendu. */

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Impossible de créer le shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'erreur inconnue'
    gl.deleteShader(shader)
    throw new Error(`Compilation shader échouée : ${log}`)
  }
  return shader
}

export function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
  if (!program) throw new Error('Impossible de créer le programme')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'erreur inconnue'
    gl.deleteProgram(program)
    throw new Error(`Édition de liens échouée : ${log}`)
  }
  return program
}

/** Cache des locations d'uniformes d'un programme. */
export class Uniforms {
  private cache = new Map<string, WebGLUniformLocation | null>()
  private gl: WebGL2RenderingContext
  private program: WebGLProgram

  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl
    this.program = program
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.cache.has(name)) {
      this.cache.set(name, this.gl.getUniformLocation(this.program, name))
    }
    return this.cache.get(name) ?? null
  }

  f(name: string, v: number): void {
    const l = this.loc(name)
    if (l) this.gl.uniform1f(l, v)
  }

  i(name: string, v: number): void {
    const l = this.loc(name)
    if (l) this.gl.uniform1i(l, v)
  }

  v2(name: string, x: number, y: number): void {
    const l = this.loc(name)
    if (l) this.gl.uniform2f(l, x, y)
  }

  v3(name: string, x: number, y: number, z: number): void {
    const l = this.loc(name)
    if (l) this.gl.uniform3f(l, x, y, z)
  }
}

export interface RenderTarget {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
}

export interface TextureFormat {
  internalFormat: number
  format: number
  type: number
}

export function pickColorFormat(gl: WebGL2RenderingContext): TextureFormat {
  const halfFloat = gl.getExtension('EXT_color_buffer_float')
  const halfFloatLinear = gl.getExtension('EXT_color_buffer_half_float')
  if (halfFloat || halfFloatLinear) {
    return {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
    }
  }
  return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  fmt: TextureFormat,
): RenderTarget {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Impossible de créer la texture')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, width, height, 0, fmt.format, fmt.type, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) throw new Error('Impossible de créer le framebuffer')
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindTexture(gl.TEXTURE_2D, null)

  return { framebuffer, texture, width, height }
}

export function disposeRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget): void {
  gl.deleteFramebuffer(target.framebuffer)
  gl.deleteTexture(target.texture)
}
