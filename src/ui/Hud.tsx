import { hsvToRgb, rgbToCss } from '../game/colors'
import type { EngineState } from '../game/engine'
import { IconExpand, IconHome, IconMute, IconPause, IconPlay, IconRestart, IconVolume } from './icons'

interface HudProps {
  state: EngineState
  onTogglePause: () => void
  onRestart: () => void
  onToggleMute: () => void
  onFullscreen: () => void
  onMenu: () => void
}

function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="glass-button flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 hover:text-white"
      style={active ? { color: 'var(--accent)' } : undefined}
    >
      {children}
    </button>
  )
}

export default function Hud({
  state,
  onTogglePause,
  onRestart,
  onToggleMute,
  onFullscreen,
  onMenu,
}: HudProps) {
  const playerCss = rgbToCss(hsvToRgb(state.color.h, state.color.s, state.color.v))
  const peerCss = rgbToCss(hsvToRgb(state.peerColor.h, state.peerColor.s, state.peerColor.v))
  const online = state.mode === 'online'
  // En ligne, l'hôte est à gauche, l'invité à droite.
  const localIsLeft = state.side === 'left'
  // Sur les deux écrans, scorePlayer = raquette de gauche, scoreAi = raquette de droite.
  const leftScore = state.scorePlayer
  const rightScore = state.scoreAi
  const leftColor = localIsLeft ? playerCss : peerCss
  const rightColor = localIsLeft ? peerCss : playerCss
  const leftLabel = localIsLeft
    ? state.playerName || 'Vous'
    : state.peerName || 'Adversaire'
  const rightLabel = localIsLeft
    ? state.peerName || 'Adversaire'
    : state.playerName || 'Vous'

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* Score gauche */}
      <div className="absolute top-4 left-4 sm:top-6 sm:left-6">
        <div
          className="font-mono-game text-5xl leading-none font-bold sm:text-7xl"
          style={{ color: leftColor, textShadow: `0 0 18px ${leftColor}80, 0 0 48px ${leftColor}40` }}
        >
          {leftScore}
        </div>
        <div className="mt-1 text-[10px] font-semibold tracking-[0.35em] text-zinc-500 uppercase">
          {leftLabel}
        </div>
      </div>

      {/* Score droit */}
      <div className="absolute top-4 right-4 text-right sm:top-6 sm:right-6">
        <div
          className="font-mono-game text-5xl leading-none font-bold sm:text-7xl"
          style={{ color: rightColor, textShadow: `0 0 18px ${rightColor}80, 0 0 48px ${rightColor}40` }}
        >
          {rightScore}
        </div>
        <div className="mt-1 text-[10px] font-semibold tracking-[0.35em] text-zinc-500 uppercase">
          {rightLabel}
        </div>
      </div>

      {/* Info centrale */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 text-center">
        {online ? (
          <div className="flex items-center justify-center gap-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state.peerConnected ? 'bg-emerald-400' : 'bg-amber-400'
              } ${state.peerConnected ? '' : 'animate-pulse-soft'}`}
            />
            Salon {state.roomCode} · {state.latency} ms
          </div>
        ) : (
          <div className="text-[10px] font-semibold tracking-[0.4em] text-zinc-500 uppercase">
            Premier à {state.target}
          </div>
        )}
        <div className="font-mono-game mt-1 text-[10px] text-zinc-600">{state.fps} FPS</div>
      </div>

      {/* Compte à rebours de service */}
      {state.serving && state.phase === 'playing' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <div
            key={state.countdown}
            className="animate-rise font-mono-game text-7xl font-bold sm:text-8xl"
            style={{ color: playerCss, textShadow: `0 0 24px ${playerCss}, 0 0 70px ${playerCss}55` }}
          >
            {state.countdown > 0 ? state.countdown : 'GO'}
          </div>
          <div className="mt-2 text-[11px] tracking-[0.3em] text-zinc-500 uppercase">
            Service{' '}
            {localIsLeft
              ? state.serveTo === 'player'
                ? 'pour vous'
                : 'pour l’adversaire'
              : state.serveTo === 'ai'
                ? 'pour vous'
                : 'pour l’adversaire'}
          </div>
        </div>
      )}

      {/* Contrôles */}
      <div className="absolute right-4 bottom-4 flex gap-2 sm:right-6 sm:bottom-6">
        <div className="pointer-events-auto flex gap-2">
          {!online && (
            <IconButton
              label={state.phase === 'paused' ? 'Reprendre' : 'Pause'}
              onClick={onTogglePause}
            >
              {state.phase === 'paused' ? <IconPlay /> : <IconPause />}
            </IconButton>
          )}
          <IconButton
            label={state.muted ? 'Activer le son' : 'Couper le son'}
            onClick={onToggleMute}
            active={!state.muted}
          >
            {state.muted ? <IconMute /> : <IconVolume />}
          </IconButton>
          <IconButton label={online ? 'Rejouer / revanche' : 'Recommencer'} onClick={onRestart}>
            <IconRestart />
          </IconButton>
          <IconButton label={online ? 'Quitter le salon' : 'Menu'} onClick={onMenu}>
            <IconHome />
          </IconButton>
          <IconButton label="Plein écran" onClick={onFullscreen}>
            <IconExpand />
          </IconButton>
        </div>
      </div>

      {/* Astuce de contrôle */}
      <div className="absolute bottom-4 left-4 text-[10px] tracking-[0.2em] text-zinc-600 uppercase sm:bottom-6 sm:left-6">
        {online ? 'Souris · ZQSD / WASD' : 'Souris · ZQSD / WASD · Espace = pause'}
      </div>
    </div>
  )
}
