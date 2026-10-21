import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/constants'

export interface View {
  /** Pixels par unité de monde. */
  scale: number
  /** Position (px) de l'origine du monde dans le canvas. */
  originX: number
  originY: number
  width: number
  height: number
}

/** Mise en page "contain" : le terrain 16:9 est centré, le fond occupe le reste. */
export function computeView(width: number, height: number): View {
  const scale = Math.min(width / FIELD_WIDTH, height / FIELD_HEIGHT)
  return {
    scale,
    originX: (width - FIELD_WIDTH * scale) / 2,
    originY: (height - FIELD_HEIGHT * scale) / 2,
    width,
    height,
  }
}

/** Convertit une coordonnée écran (px canvas) en coordonnée monde Y. */
export function screenToWorldY(view: View, canvasY: number): number {
  return (canvasY - view.originY) / view.scale
}
