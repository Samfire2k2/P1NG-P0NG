/// <reference types="vite/client" />

interface PingPongHook {
  engine: unknown
  audio: {
    ctx: AudioContext | null
    muted: boolean
    master: unknown
    compressor: unknown
    paddleHit: (offset: number, power: number, isPlayer: boolean) => void
    wallHit: (power: number) => void
    score: (side: 'player' | 'ai') => void
    countdown: (value: number) => void
    serve: () => void
    win: () => void
    lose: () => void
    hover: () => void
    click: () => void
    hue: (hue: number) => void
  }
}

declare global {
  interface Window {
    __pingPong?: PingPongHook
  }
}

export {}
