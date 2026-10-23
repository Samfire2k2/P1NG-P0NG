import { useCallback, useEffect, useRef } from 'react'
import { hsvToRgb, PRESET_HUES, rgbToCss, type Hsv } from '../game/colors'

interface ColorPickerProps {
  color: Hsv
  onChange: (color: Hsv) => void
  /** Appelé quand l'utilisateur valide (relâchement) — utile pour le son. */
  onCommit?: (color: Hsv) => void
}

const SV_WIDTH = 108
const SV_HEIGHT = 72

/**
 * Sélecteur de couleur : carré saturation/luminosité + dégradé de teinte
 * (les 360 teintes de l'arc-en-ciel) + préréglages.
 */
export default function ColorPicker({ color, onChange, onCommit }: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const image = ctx.createImageData(SV_WIDTH, SV_HEIGHT)
    for (let y = 0; y < SV_HEIGHT; y++) {
      const v = 1 - y / (SV_HEIGHT - 1)
      for (let x = 0; x < SV_WIDTH; x++) {
        const s = x / (SV_WIDTH - 1)
        const [r, g, b] = hsvToRgb(color.h, s, v)
        const i = (y * SV_WIDTH + x) * 4
        image.data[i] = r * 255
        image.data[i + 1] = g * 255
        image.data[i + 2] = b * 255
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
  }, [color.h, color.s, color.v])

  const applyFromPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = event.currentTarget
      const rect = canvas.getBoundingClientRect()
      const s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      const v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
      onChange({ ...color, s, v })
    },
    [color, onChange],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    applyFromPointer(event)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    applyFromPointer(event)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    onCommit?.(color)
  }

  const rgb = hsvToRgb(color.h, color.s, color.v)
  const markerLeft = `${color.s * 100}%`
  const markerTop = `${(1 - color.v) * 100}%`

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full overflow-hidden rounded-xl border border-white/10 shadow-lg">
        <canvas
          ref={canvasRef}
          width={SV_WIDTH}
          height={SV_HEIGHT}
          className="block h-28 w-full cursor-crosshair sm:h-32"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label="Saturation et luminosité"
        />
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"
          style={{ left: markerLeft, top: markerTop, background: rgbToCss(rgb) }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(color.h)}
        onChange={(e) => onChange({ ...color, h: Number(e.target.value) })}
        onPointerUp={() => onCommit?.(color)}
        onKeyUp={() => onCommit?.(color)}
        className="hue-range"
        style={{
          background:
            'linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
        }}
        aria-label="Teinte (arc-en-ciel)"
      />

      <div className="grid grid-cols-12 gap-1.5">
        {PRESET_HUES.map((preset) => {
          const isRainbow = preset.h < 0
          const presetColor = isRainbow
            ? 'conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
            : rgbToCss(hsvToRgb(preset.h, 0.92, 1))
          const active = isRainbow ? false : Math.abs(preset.h - color.h) < 4 && color.s > 0.6
          return (
            <button
              key={preset.name}
              type="button"
              title={preset.name}
              aria-label={preset.name}
              onClick={() => {
                if (isRainbow) {
                const rainbow = { h: Math.random() * 360, s: 0.95, v: 1 }
                onChange(rainbow)
                onCommit?.(rainbow)
              } else {
                const presetValue = { h: preset.h, s: 0.92, v: 1 }
                onChange(presetValue)
                onCommit?.(presetValue)
              }
              }}
              className={`group relative aspect-square rounded-md border transition-all duration-150 hover:scale-110 ${
                active ? 'border-white shadow-[0_0_12px_rgba(255,255,255,0.6)]' : 'border-white/15'
              }`}
              style={{ background: presetColor }}
            >
              {isRainbow && (
                <span className="absolute inset-0 rounded-md bg-[conic-gradient(from_0deg,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
