import { clamp } from './math'

export interface Hsv {
  /** 0-360 */
  h: number
  /** 0-1 */
  s: number
  /** 0-1 */
  v: number
}

export type Rgb = [number, number, number]

/** HSV (0-360, 0-1, 0-1) -> RGB normalisé 0-1. */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = ((h % 360) + 360) % 360 / 60
  const c = v * s
  const x = c * (1 - Math.abs((hue % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (hue < 1) [r, g, b] = [c, x, 0]
  else if (hue < 2) [r, g, b] = [x, c, 0]
  else if (hue < 3) [r, g, b] = [0, c, x]
  else if (hue < 4) [r, g, b] = [0, x, c]
  else if (hue < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m]
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function rgbToCss(rgb: Rgb, alpha = 1): string {
  const r = Math.round(clamp(rgb[0], 0, 1) * 255)
  const g = Math.round(clamp(rgb[1], 0, 1) * 255)
  const b = Math.round(clamp(rgb[2], 0, 1) * 255)
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`
}

/** Couleur de l'IA : hue complémentaire, saturé et lumineux pour contraster. */
export function aiHsvFrom(hsv: Hsv): Hsv {
  return {
    h: (hsv.h + 180) % 360,
    s: clamp(Math.max(hsv.s, 0.72), 0, 1),
    v: clamp(Math.max(hsv.v, 0.9), 0, 1),
  }
}

export function aiColorFrom(hsv: Hsv): Rgb {
  const ai = aiHsvFrom(hsv)
  return hsvToRgb(ai.h, ai.s, ai.v)
}

export const PRESET_HUES = [
  { name: 'Rouge laser', h: 355 },
  { name: 'Orange plasma', h: 28 },
  { name: 'Jaune soleil', h: 52 },
  { name: 'Vert acide', h: 130 },
  { name: 'Menthe', h: 160 },
  { name: 'Cyan', h: 186 },
  { name: 'Azur', h: 205 },
  { name: 'Bleu électrique', h: 222 },
  { name: 'Violet', h: 268 },
  { name: 'Magenta', h: 305 },
  { name: 'Rose', h: 330 },
  { name: 'Arc-en-ciel', h: -1 },
]
