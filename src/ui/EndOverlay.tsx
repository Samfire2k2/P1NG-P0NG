import { rgbToCss, hsvToRgb } from '../game/colors'
import type { EngineState } from '../game/engine'
import { IconHome, IconPlay, IconTrophy } from './icons'

interface EndOverlayProps {
  state: EngineState
  onRestart: () => void
  onMenu: () => void
}

export default function EndOverlay({ state, onRestart, onMenu }: EndOverlayProps) {
  const online = state.mode === 'online'
  const localIsLeft = state.side === 'left'
  const localScore = localIsLeft ? state.scorePlayer : state.scoreAi
  const otherScore = localIsLeft ? state.scoreAi : state.scorePlayer
  const won = localScore > otherScore
  const draw = state.draw || localScore === otherScore
  const accent = draw
    ? '#a1a1aa'
    : won
      ? rgbToCss(hsvToRgb(state.color.h, state.color.s, state.color.v))
      : rgbToCss(hsvToRgb(state.peerColor.h, state.peerColor.s, state.peerColor.v))

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#05060a]/60 p-4 backdrop-blur-md">
      <div className="glass-panel animate-rise w-full max-w-sm rounded-3xl p-8 text-center">
        <div className="flex justify-center" style={{ color: accent }}>
          <IconTrophy className="h-9 w-9" />
        </div>
        <h2
          className="mt-3 text-4xl font-extrabold tracking-tight"
          style={{ color: accent, textShadow: `0 0 22px ${accent}99, 0 0 60px ${accent}44` }}
        >
          {draw ? 'Égalité' : won ? 'Victoire' : 'Défaite'}
        </h2>
        <p className="mt-2 text-xs tracking-[0.3em] text-zinc-500 uppercase">
          {draw ? 'Match nul' : won ? 'Match gagné' : 'Match perdu'}
        </p>

        <div className="font-mono-game mt-6 flex items-center justify-center gap-5 text-4xl font-bold">
          <span style={{ color: rgbToCss(hsvToRgb(state.color.h, state.color.s, state.color.v)) }}>
            {state.scorePlayer}
          </span>
          <span className="text-zinc-700">—</span>
          <span style={{ color: rgbToCss(hsvToRgb(state.peerColor.h, state.peerColor.s, state.peerColor.v)) }}>
            {state.scoreAi}
          </span>
        </div>

        <button
          type="button"
          onClick={onRestart}
          className="primary-button mt-7 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-[0.2em] uppercase"
        >
          <IconPlay className="h-4 w-4" />
          {online ? (localIsLeft ? 'Rejouer' : 'Demander revanche') : 'Rejouer'}
        </button>

        <button
          type="button"
          onClick={onMenu}
          className="glass-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-300"
        >
          <IconHome className="h-3.5 w-3.5" />
          {online ? 'Quitter le salon' : 'Menu'}
        </button>
      </div>
    </div>
  )
}
