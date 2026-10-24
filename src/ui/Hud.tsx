import { hsvToRgb, rgbToCss } from '../game/colors'
import type { EngineState } from '../game/engine'
import { POWERUP_INFO } from '../game/powerups'
import { IconExpand, IconHome, IconMusic, IconMute, IconPause, IconPlay, IconRestart, IconVolume } from './icons'

interface HudProps {
  state: EngineState
  onTogglePause: () => void
  onRestart: () => void
  onToggleMute: () => void
  onFullscreen: () => void
  onMenu: () => void
  onTouchDirection: (direction: -1 | 1, active: boolean) => void
  musicMuted: boolean
  onToggleMusic: () => void
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
      className="game-terminal-button glass-button flex h-9 w-9 items-center justify-center rounded-lg text-zinc-300 hover:text-white"
      style={active ? { color: 'var(--accent)' } : undefined}
    >
      {children}
    </button>
  )
}

/** Chronomètre : mm:ss, arrondi au-dessus pour ne jamais afficher 0:00 trop tôt. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Hud({
  state,
  onTogglePause,
  onRestart,
  onToggleMute,
  onFullscreen,
  onMenu,
  onTouchDirection,
  musicMuted,
  onToggleMusic,
}: HudProps) {
  const playerCss = rgbToCss(hsvToRgb(state.color.h, state.color.s, state.color.v))
  const peerCss = rgbToCss(hsvToRgb(state.peerColor.h, state.peerColor.s, state.peerColor.v))
  const online = state.mode === 'online'
  // En ligne, l'hôte est à gauche, l'invité à droite.
  const localIsLeft = state.side === 'left'
  // Manche chronométrée : le compte à rebours remplace l'indication de format.
  const timed = state.timeLeft >= 0
  const urgent = timed && state.timeLeft <= 30
  // Sur les deux écrans, scorePlayer = raquette de gauche, scoreAi = raquette de droite.
  const leftScore = state.scorePlayer
  const rightScore = state.scoreAi
  const leftColor = localIsLeft ? playerCss : peerCss
  const rightColor = localIsLeft ? peerCss : playerCss
  const leftLabel = state.localDuel ? 'Joueur 1' : localIsLeft
    ? state.playerName || 'Toi'
    : state.peerName || 'Adversaire'
  const rightLabel = state.localDuel ? 'Joueur 2' : localIsLeft
    ? state.peerName || 'Adversaire'
    : state.playerName || 'Toi'

  return (
    <div className={`game-terminal-hud pointer-events-none absolute inset-0 z-10 select-none${state.orientation === 'portrait' ? ' portrait-hud' : ''}`}>
      <div className="game-terminal-frame absolute inset-2 sm:inset-3" aria-hidden="true" />
      {/* Score ou vies du joueur */}
      <div className="terminal-readout absolute top-4 left-4 px-3 py-2 sm:top-6 sm:left-6 sm:px-4">
        <div
          className="font-mono-game text-5xl leading-none font-bold sm:text-7xl"
          style={{ color: leftColor, textShadow: `0 0 18px ${leftColor}80, 0 0 48px ${leftColor}40` }}
        >
          {state.brickMode ? state.brickLives : leftScore}
        </div>
        <div className="mt-1 text-[10px] font-semibold tracking-[0.35em] text-zinc-500 uppercase">
          {state.brickMode ? 'Vies restantes' : leftLabel}
        </div>
      </div>

      {/* Score adverse ou progression du casse-brique */}
      {state.brickMode ? (
        <div className="terminal-readout absolute top-4 right-4 px-3 py-2 text-right sm:top-6 sm:right-6 sm:px-4">
          <div className="font-mono-game text-5xl leading-none font-bold text-zinc-300 sm:text-7xl">
            {state.bricksBroken}
          </div>
          <div className="mt-1 text-[10px] font-semibold tracking-[0.35em] text-zinc-500 uppercase">
            Détruites
          </div>
        </div>
      ) : (
        <div className="terminal-readout absolute top-4 right-4 px-3 py-2 text-right sm:top-6 sm:right-6 sm:px-4">
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
      )}

      {/* Info centrale */}
      <div className="terminal-readout absolute top-5 left-1/2 -translate-x-1/2 px-3 py-2 text-center">
        {state.brickMode ? (
          <div className="text-[10px] font-semibold tracking-[0.25em] text-zinc-300 uppercase">
            Archives corrompues · {state.bricksLeft} fragments
          </div>
        ) : state.survivalMode ? (
          <div className="text-[10px] font-semibold tracking-[0.25em] text-cyan-200 uppercase">
            ORION · SURCHAUFFE · {state.survivalLevel + 1}
          </div>
        ) : state.trainingExercise ? (
          <div className="text-[10px] font-semibold tracking-[0.18em] text-cyan-200 uppercase">
            {state.trainingExercise === 'rebonds' ? 'Rebonds' : 'Précision'} · {state.trainingProgress}/{state.trainingExercise === 'rebonds' ? 30 : 20}
          </div>
        ) : timed ? (
          <div
            className="font-mono-game text-3xl leading-none font-bold"
            style={{ color: urgent ? '#fb7185' : 'var(--accent)' }}
          >
            {formatClock(state.timeLeft)}
          </div>
        ) : online ? (
          <div className="flex items-center justify-center gap-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state.peerConnected ? 'bg-emerald-400' : 'bg-amber-400'
              } ${state.peerConnected ? '' : 'animate-pulse-soft'}`}
            />
            Salon {state.roomCode} · {state.latency} ms
          </div>
        ) : state.localDuel ? (
          <div className="text-[10px] font-semibold tracking-[0.3em] text-zinc-300 uppercase">Relève NACRE-7 · W/S · ↑/↓</div>
        ) : (
          <div className="text-[10px] font-semibold tracking-[0.4em] text-zinc-500 uppercase">
            Premier à {state.target}
          </div>
        )}
        {online && timed && (
          <div className="mt-1 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
            Salon {state.roomCode} · {state.latency} ms
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
            {state.brickMode ? 'Prépare-toi' : 'Service '}
            {!state.brickMode && (localIsLeft
              ? state.serveTo === 'player'
                ? 'pour toi'
                : 'pour l’adversaire'
              : state.serveTo === 'ai'
                ? 'pour toi'
                : 'pour l’adversaire')}
          </div>
        </div>
      )}

      {state.powerupNotice && (
        <div role="status" aria-live="polite" className="pointer-events-none absolute top-[20%] left-1/2 -translate-x-1/2 animate-rise">
          <div className="terminal-panel px-6 py-3 text-center">
            <div className="text-[9px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
              {state.powerupNoticeIsOpponent ? 'Bonus adverse' : 'Bonus obtenu'}
            </div>
            <div className="mt-1 font-['Orbitron'] text-sm font-bold tracking-[0.08em] text-white sm:text-base">
              {state.powerupNotice}
            </div>
            {state.powerupDescription && <div className="mt-1 text-[10px] text-zinc-400">{state.powerupDescription}</div>}
          </div>
        </div>
      )}

      {state.gameNotice && (
        <div role="status" aria-live="polite" className="pointer-events-none absolute top-[28%] left-1/2 -translate-x-1/2 animate-rise">
          <div className="terminal-panel px-5 py-2 text-center text-xs font-bold tracking-[0.14em] text-white">
            {state.gameNotice}
          </div>
        </div>
      )}

      {state.activePowerups.length > 0 && (
        <div className="active-powerup-list pointer-events-none absolute top-[20%] left-3 flex max-w-40 flex-col gap-1 sm:left-6" aria-label="Bonus actifs">
          {state.activePowerups.map(({ type, remaining }) => (
            <div key={type} className="active-powerup-chip flex items-center gap-2 px-2 py-1.5">
              <span className="active-powerup-indicator" aria-hidden="true" />
              <span className="min-w-0 truncate">{POWERUP_INFO[type].label}</span>
              {remaining !== null && <span className="shrink-0 text-sky-100/55">{Math.ceil(remaining)}s</span>}
            </div>
          ))}
        </div>
      )}

      {!state.spectator && <div className="touch-controls pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 items-center gap-3">
        {([-1, 1] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            className="touch-control-button pointer-events-auto"
            aria-label={direction < 0 ? 'Déplacer la raquette vers le haut ou la gauche' : 'Déplacer la raquette vers le bas ou la droite'}
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              onTouchDirection(direction, true)
            }}
            onPointerUp={() => onTouchDirection(direction, false)}
            onPointerCancel={() => onTouchDirection(direction, false)}
            onLostPointerCapture={() => onTouchDirection(direction, false)}
          >
            {state.orientation === 'portrait'
              ? direction < 0 ? '◀' : '▶'
              : direction < 0 ? '▲' : '▼'}
          </button>
        ))}
      </div>}

      {/* Contrôles */}
      <div
        className="game-control-bar absolute right-4 bottom-4 flex gap-2 sm:right-6 sm:bottom-6"
        style={state.orientation === 'portrait' ? { top: '50%', right: 'max(0.35rem, env(safe-area-inset-right))', bottom: 'auto', transform: 'translateY(-50%)' } : undefined}
      >
        <div className={`pointer-events-auto flex gap-2${state.orientation === 'portrait' ? ' portrait-control-stack' : ''}`}>
          {!online && (
            <IconButton
              label={state.phase === 'paused' ? 'Reprendre' : 'Pause'}
              onClick={onTogglePause}
            >
              {state.phase === 'paused' ? <IconPlay /> : <IconPause />}
            </IconButton>
          )}
          <IconButton
            label={state.muted ? 'Activer les effets sonores' : 'Couper les effets sonores'}
            onClick={onToggleMute}
            active={!state.muted}
          >
            {state.muted ? <IconMute /> : <IconVolume />}
          </IconButton>
          <IconButton
            label={musicMuted ? 'Activer la musique' : 'Couper la musique'}
            onClick={onToggleMusic}
            active={!musicMuted}
          >
            {musicMuted ? <IconMute /> : <IconMusic />}
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
      <div className="control-hint absolute bottom-4 left-4 text-[10px] tracking-[0.2em] text-zinc-600 uppercase sm:bottom-6 sm:left-6">
        {online ? 'Souris / tactile · ZQSD / WASD' : 'Souris / tactile · ZQSD / WASD · Espace = pause'}
      </div>
    </div>
  )
}
