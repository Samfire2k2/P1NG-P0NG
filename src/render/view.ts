import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/constants'

export interface View {
  /** Pixels par unité de monde. */
  scale: number
  /** Position (px) de l'origine du monde dans le canvas. */
  originX: number
  originY: number
  width: number
  height: number
  orientation: 'landscape' | 'portrait'
}

/** Mise en page "contain" : le terrain est centré, le fond occupe le reste. */
export function computeView(
  width: number,
  height: number,
  orientation: 'landscape' | 'portrait' = 'landscape',
): View {
  const fw = orientation === 'portrait' ? FIELD_HEIGHT : FIELD_WIDTH
  const fh = orientation === 'portrait' ? FIELD_WIDTH : FIELD_HEIGHT
  const scale = Math.min(width / fw, height / fh)
  return {
    scale,
    originX: (width - fw * scale) / 2,
    originY: (height - fh * scale) / 2,
    width,
    height,
    orientation,
  }
}

/** Convertit une coordonnée écran (px canvas) en coordonnée monde Y. */
export function screenToWorldY(view: View, canvasY: number): number {
  return (canvasY - view.originY) / view.scale
}
