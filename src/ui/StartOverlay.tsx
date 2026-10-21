import { DIFFICULTY_PROFILES, DIFFICULTIES, type Difficulty } from '../game/constants'
import type { EngineState } from '../game/engine'
import type { NetStatus } from '../net/session'
import ColorPicker from './ColorPicker'
import { IconPalette, IconPlay } from './icons'
import OnlineLobby from './OnlineLobby'

export type GameModeTab = 'ai' | 'online'

interface StartOverlayProps {
  state: EngineState
  tab: GameModeTab
  onTabChange: (tab: GameModeTab) => void
  onStart: () => void
  onColorChange: (h: number, s: number, v: number) => void
  onColorCommit: () => void
  onDifficulty: (d: Difficulty) => void
  onTarget: (t: number) => void
  onGlow: (value: number) => void
  glow: number
  inviteLink: string
  netMessage: string
  onCreateRoom: () => void
  onJoinRoom: (code: string, key: string) => void
  onQuitRoom: () => void
  roomCode: string
  initialCode: string
  initialKey: string
}

const TARGETS = [5, 7, 11]

export default function StartOverlay({
  state,
  tab,
  onTabChange,
  onStart,
  onColorChange,
  onColorCommit,
  onDifficulty,
  onTarget,
  onGlow,
  glow,
  inviteLink,
  netMessage,
  onCreateRoom,
  onJoinRoom,
  onQuitRoom,
  roomCode,
  initialCode,
  initialKey,
}: StartOverlayProps) {
  const netStatus: NetStatus = state.netStatus

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-[#05060a]/55 p-4 backdrop-blur-md">
      <div className="glass-panel animate-rise my-6 w-full max-w-3xl rounded-3xl p-6 sm:p-8">
        {/* Onglets de mode */}
        <div className="mb-7 grid grid-cols-2 gap-1.5 rounded-xl border border-white/8 bg-black/25 p-1.5">
          {(
            [
              { id: 'ai' as const, label: 'Contre l’IA', hint: 'Difficulté moyenne' },
              { id: 'online' as const, label: 'En ligne', hint: 'Salon 1 vs 1' },
            ]
          ).map((item) => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`rounded-lg px-3 py-2.5 text-xs font-bold tracking-[0.15em] uppercase transition-all ${
                  active ? 'text-black' : 'text-zinc-400 hover:text-white'
                }`}
                style={
                  active
                    ? {
                        background: 'var(--accent)',
                        boxShadow: '0 0 22px -6px var(--accent)',
                      }
                    : undefined
                }
              >
                <span className="block">{item.label}</span>
                <span
                  className={`mt-0.5 block text-[9px] font-medium tracking-normal normal-case ${
                    active ? 'text-black/60' : 'text-zinc-600'
                  }`}
                >
                  {item.hint}
                </span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-7 md:grid-cols-[1.05fr_1fr]">
          {/* Colonne gauche */}
          <div className="flex flex-col">
            {tab === 'ai' ? (
              <>
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.4em] text-zinc-500 uppercase">
                  <IconPalette className="h-3.5 w-3.5" />
                  P1NG-P0NG
                </div>
                <h1 className="ping-title mt-3 text-5xl leading-[0.9] font-extrabold tracking-tight sm:text-6xl">
                  P1NG-P0NG
                  <span className="block text-3xl sm:text-4xl">glow arena</span>
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
                  Un Pong néon propulsé par WebGL2 : bloom multi-niveaux, physique à pas fixe et
                  une IA de difficulté <span className="text-zinc-200">moyenne</span> qui lit votre
                  rythme. Choisissez votre couleur, le reste est une question de réflexes.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.4em] text-zinc-500 uppercase">
                  <IconPalette className="h-3.5 w-3.5" />
                  P1NG-P0NG · en ligne
                </div>
                <h1 className="ping-title mt-3 text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
                  DUEL
                  <span className="block text-2xl sm:text-3xl">peer to peer</span>
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
                  Créez un salon, transmettez le lien : votre adversaire le rejoint et le duel
                  démarre. Connexion directe WebRTC, aucun serveur de jeu.
                </p>
              </>
            )}

            {tab === 'online' ? (
              <div className="mt-6">
                <OnlineLobby
                  status={netStatus}
                  roomCode={roomCode}
                  inviteLink={inviteLink}
                  message={netMessage}
                  peerConnected={state.peerConnected}
                  initialCode={initialCode}
                  initialKey={initialKey}
                  onCreate={onCreateRoom}
                  onJoin={onJoinRoom}
                  onQuit={onQuitRoom}
                />
              </div>
            ) : (
              <>
                {/* Difficulté */}
                <div className="mt-6">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Difficulté de l’IA
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {DIFFICULTIES.map((difficulty) => {
                      const active = state.difficulty === difficulty
                      return (
                        <button
                          key={difficulty}
                          type="button"
                          onClick={() => onDifficulty(difficulty)}
                          className={`glass-button rounded-lg px-2 py-2 text-xs font-semibold ${
                            active ? 'text-white' : 'text-zinc-400'
                          }`}
                          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {DIFFICULTY_PROFILES[difficulty].label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Format */}
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Format
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {TARGETS.map((target) => {
                      const active = state.target === target
                      return (
                        <button
                          key={target}
                          type="button"
                          onClick={() => onTarget(target)}
                          className={`glass-button rounded-lg px-2 py-2 text-xs font-semibold ${
                            active ? 'text-white' : 'text-zinc-400'
                          }`}
                          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {target} points
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Intensité du glow */}
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                      Intensité du glow
                    </span>
                    <span className="font-mono-game text-[10px] text-zinc-600">
                      {Math.round(glow * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.3}
                    max={1.8}
                    step={0.05}
                    value={glow}
                    onChange={(e) => onGlow(Number(e.target.value))}
                    className="hue-range"
                    style={{
                      background:
                        'linear-gradient(90deg, rgba(53,224,255,0.25), rgba(53,224,255,1), rgba(255,255,255,0.9))',
                    }}
                    aria-label="Intensité du glow"
                  />
                </div>

                <button
                  type="button"
                  onClick={onStart}
                  className="primary-button mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold tracking-[0.2em] uppercase"
                >
                  <IconPlay className="h-4 w-4" />
                  Jouer
                </button>
                <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
                  Souris ou flèches pour bouger · <span className="text-zinc-500">Espace</span> pause ·{' '}
                  <span className="text-zinc-500">R</span> recommencer
                </p>
              </>
            )}
          </div>

          {/* Colonne droite : la couleur */}
          <div className="flex flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                Couleur du joueur
              </div>
              <div className="font-mono-game text-[10px] text-zinc-600">
                H {Math.round(state.color.h)}° · S {Math.round(state.color.s * 100)}% · V{' '}
                {Math.round(state.color.v * 100)}%
              </div>
            </div>
            <ColorPicker
              color={state.color}
              onChange={(c) => onColorChange(c.h, c.s, c.v)}
              onCommit={onColorCommit}
            />
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3">
              <div
                className="h-9 w-3 rounded-full"
                style={{
                  background: `var(--accent)`,
                  boxShadow: '0 0 14px var(--accent), 0 0 34px color-mix(in srgb, var(--accent) 60%, transparent)',
                }}
              />
              <div className="text-[11px] leading-snug text-zinc-500">
                Votre raquette, votre traînée et l’ambiance de la salle. L’IA joue toujours en
                couleur complémentaire.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
