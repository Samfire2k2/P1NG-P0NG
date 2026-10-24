import { IconHome, IconPlay, IconRestart } from './icons'

interface PauseOverlayProps {
  onResume: () => void
  onRestart: () => void
  onMenu: () => void
}

export default function PauseOverlay({ onResume, onRestart, onMenu }: PauseOverlayProps) {
  return (
    <div className="terminal-backdrop absolute inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="terminal-panel animate-rise w-full max-w-sm p-8 text-center">
        <div className="terminal-bar mb-6">
          <span>Contrôle de partie</span>
          <span className="terminal-status">En pause</span>
        </div>
        <h2 className="ping-title text-4xl font-extrabold tracking-tight">Pause</h2>
        <p className="mt-2 text-xs tracking-[0.3em] text-zinc-500 uppercase">La balle attend</p>

        <button
          type="button"
          onClick={onResume}
          className="primary-button mt-7 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-[0.2em] uppercase"
        >
          <IconPlay className="h-4 w-4" />
          Reprendre
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRestart}
            className="glass-button flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-300"
          >
            <IconRestart className="h-3.5 w-3.5" />
            Recommencer
          </button>
          <button
            type="button"
            onClick={onMenu}
            className="glass-button flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-300"
          >
            <IconHome className="h-3.5 w-3.5" />
            Menu
          </button>
        </div>
      </div>
    </div>
  )
}
