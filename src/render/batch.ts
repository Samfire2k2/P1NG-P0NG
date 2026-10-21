/** Batch de sprites instanciés (quads) : une seule instance = 12 floats. */

export const SPRITE_ROUNDBOX = 0
export const SPRITE_CIRCLE = 1
export const SPRITE_GLOW = 2

const FLOATS_PER_INSTANCE = 12
const STRIDE = FLOATS_PER_INSTANCE * 4

export class SpriteBatch {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject
  private quadBuffer: WebGLBuffer
  private instanceBuffer: WebGLBuffer
  private data: Float32Array
  private count = 0

  constructor(gl: WebGL2RenderingContext, capacity = 4096) {
    this.gl = gl
    this.data = new Float32Array(capacity * FLOATS_PER_INSTANCE)

    const vao = gl.createVertexArray()
    const quadBuffer = gl.createBuffer()
    const instanceBuffer = gl.createBuffer()
    if (!vao || !quadBuffer || !instanceBuffer) throw new Error('Allocation GPU impossible')
    this.vao = vao
    this.quadBuffer = quadBuffer
    this.instanceBuffer = instanceBuffer

    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
    const attribs: Array<[number, number, number]> = [
      [1, 2, 0],
      [2, 2, 8],
      [3, 4, 16],
      [4, 4, 32],
    ]
    for (const [loc, size, offset] of attribs) {
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset)
      gl.vertexAttribDivisor(loc, 1)
    }

    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  begin(): void {
    this.count = 0
  }

  push(
    cx: number,
    cy: number,
    halfW: number,
    halfH: number,
    r: number,
    g: number,
    b: number,
    a: number,
    type: number,
    radius: number,
    rotation: number,
    glow: number,
  ): void {
    const max = this.data.length / FLOATS_PER_INSTANCE
    if (this.count >= max) return
    const o = this.count * FLOATS_PER_INSTANCE
    const d = this.data
    d[o] = cx
    d[o + 1] = cy
    d[o + 2] = halfW
    d[o + 3] = halfH
    d[o + 4] = r
    d[o + 5] = g
    d[o + 6] = b
    d[o + 7] = a
    d[o + 8] = type
    d[o + 9] = radius
    d[o + 10] = rotation
    d[o + 11] = glow
    this.count++
  }

  flush(): void {
    if (this.count === 0) return
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS_PER_INSTANCE)
    gl.bindVertexArray(this.vao)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteBuffer(this.quadBuffer)
    gl.deleteBuffer(this.instanceBuffer)
    gl.deleteVertexArray(this.vao)
  }
}
