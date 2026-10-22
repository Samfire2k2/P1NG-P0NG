import { DIFFICULTY_PROFILES, DIFFICULTIES, type Difficulty, type MatchFormat } from '../game/constants'
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
  onFormat: (format: MatchFormat, target: number, duration?: number) => void
  powerups: boolean
  onPowerups: (enabled: boolean) => void
  brickMode: boolean
  onBrickMode: (enabled: boolean) => void
  theme: number
  onTheme: (t: number) => void
  orientation: 'landscape' | 'portrait'
  onOrientation: (o: 'landscape' | 'portrait') => void
  duration: number
  onDuration: (seconds: number) => void
  onGlow: (value: number) => void
  glow: number
  inviteLink: string
  netMessage: string
  onCreateRoom: () => void
  onJoinRoom: (code: string, key: string) => void
  onJoinSpectator?: (code: string, key: string) => void
  onQuitRoom: () => void
  roomCode: string
  initialCode: string
  initialKey: string
  playerName: string
  peerName: string
  history: { date: string; mode: string; format: string; scorePlayer: number; scoreAi: number; difficulty: string; target: number }[]
  leaderboard: { name: string; score: number; date: string }[]
  canStart: boolean
  onNameChange: (name: string) => void
  onStartMatch: () => void
}

const FORMATS: Array<{ id: string; format: MatchFormat; target: number; label: string }> = [
  { id: 'p5', format: 'points', target: 5, label: '5 pts' },
  { id: 'p7', format: 'points', target: 7, label: '7 pts' },
  { id: 'p11', format: 'points', target: 11, label: '11 pts' },
  { id: 'time', format: 'time', target: 11, label: '3 min' },
]

export default function StartOverlay({
  state,
  tab,
  onTabChange,
  onStart,
  onColorChange,
  onColorCommit,
  onDifficulty,
  onFormat,
  powerups,
  onPowerups,
  brickMode,
  onBrickMode,
  theme,
  onTheme,
  orientation,
  onOrientation,
  duration,
  onDuration,
  onGlow,
  glow,
  inviteLink,
  netMessage,
  onCreateRoom,
  onJoinRoom,
  onJoinSpectator,
  onQuitRoom,
  roomCode,
  initialCode,
  initialKey,
  playerName,
  peerName,
  history,
  leaderboard,
  canStart,
  onNameChange,
  onStartMatch,
}: StartOverlayProps) {
  const netStatus: NetStatus = state.netStatus

  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center overflow-y-auto bg-[#05060a]/55 p-4 pt-8 backdrop-blur-md">
      <div className="glass-panel animate-rise my-6 w-full max-w-3xl rounded-3xl p-6 sm:p-8">
        {/* Onglets de mode */}
        <div className="mb-7 grid grid-cols-2 gap-1.5 rounded-xl border border-white/8 bg-black/25 p-1.5">
          {(
            [
              { id: 'ai' as const, label: 'Contre l’IA', hint: '4 niveaux' },
              { id: 'online' as const, label: 'En ligne', hint: 'Duel à deux' },
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
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
                  Le Pong de base, en néon. 4 niveaux de difficulté, une balle qui accélère à
                  chaque rebond et la couleur de ta raquette à choisir. Prêt?
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
                  <span className="block text-2xl sm:text-3xl">1 contre 1</span>
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
                  Crée un salon, envoie le lien. Ton adversaire clique, la partie démarre. La
                  connexion passe en direct entre les deux navigateurs, sans serveur de jeu.
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
                  playerName={playerName}
                  peerName={peerName}
                  canStart={canStart}
                  onNameChange={onNameChange}
                  onStartMatch={onStartMatch}
                  onCreate={onCreateRoom}
                  onJoin={onJoinRoom}
                  onJoinSpectator={onJoinSpectator}
                  leaderboard={leaderboard}
                  onQuit={onQuitRoom}
                />
              </div>
            ) : (
              <>
                {/* Difficulté */}
                <div className="mt-6">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Niveau de l’IA
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

                {/* Format de la manche */}
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Format
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {FORMATS.map((option) => {
                      const active =
                        state.format === option.format &&
                        (option.format === 'time' || state.target === option.target)
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onFormat(option.format, option.target)}
                          className={`glass-button rounded-lg px-2 py-2 text-[11px] font-semibold ${
                            active ? 'text-white' : 'text-zinc-400'
                          }`}
                          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                  {state.format === 'time' && (
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                      Trois minutes. Le meilleur score l’emporte, même si personne n’a atteint 11
                      points.
                    </p>
                  )}
                </div>

                {/* Durée (mode temps) */}
                {state.format === 'time' && (
                  <div className="mt-4">
                    <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                      Durée (secondes)
                    </div>
                    <input
                      type="number"
                      min={30}
                      max={3600}
                      step={30}
                      value={duration}
                      onChange={(e) => onDuration(Number(e.target.value))}
                      className="glass-button w-full rounded-lg px-3 py-2 text-sm text-zinc-200"
                    />
                  </div>
                )}

                {/* Powerups */}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Powerups
                  </span>
                  <button
                    type="button"
                    onClick={() => onPowerups(!powerups)}
                    className={`glass-button rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      powerups ? 'text-white' : 'text-zinc-400'
                    }`}
                    style={powerups ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                  >
                    {powerups ? 'Activés' : 'Désactivés'}
                  </button>
                </div>
                {powerups && (
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-600">
                    Des bonus apparaissent sur le terrain. La balle qui les traverse active
                    l’effet : accélération, ralentissement, agrandissement ou rétrécissement de
                    raquette.
                  </p>
                )}

                {/* Mode casse-brique */}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Casse-brique
                  </span>
                  <button
                    type="button"
                    onClick={() => onBrickMode(!brickMode)}
                    className={`glass-button rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      brickMode ? 'text-white' : 'text-zinc-400'
                    }`}
                    style={brickMode ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                  >
                    {brickMode ? 'Activé' : 'Désactivé'}
                  </button>
                 </div>

                {/* Thème */}
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Thème
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['Néon', 'Synthwave', 'Rétro', 'Minimal'].map((label, i) => {
                      const active = theme === i
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => onTheme(i)}
                          className={`glass-button rounded-lg px-2 py-2 text-xs font-semibold ${
                            active ? 'text-white' : 'text-zinc-400'
                          }`}
                          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Orientation */}
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Orientation
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['landscape', 'portrait'] as const).map((o) => {
                      const active = orientation === o
                      return (
                        <button
                          key={o}
                          type="button"
                          onClick={() => onOrientation(o)}
                          className={`glass-button rounded-lg px-2 py-2 text-xs font-semibold ${
                            active ? 'text-white' : 'text-zinc-400'
                          }`}
                          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {o === 'landscape' ? 'Paysage' : 'Portrait'}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Intensité du glow */}
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                      Glow
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
                    aria-label="Glow"
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
              {history.length > 0 && (
                <div className="mt-6 border-t border-white/5 pt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Historique
                  </div>
                  <div className="space-y-1 text-[11px] text-zinc-400">
                    {history.slice(0, 5).map((h, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span>
                          {h.mode === 'online' ? 'En ligne' : 'Solo'} · {h.difficulty} ·{' '}
                          {h.format === 'time' ? 'temps' : `${h.target} pts`}
                        </span>
                        <span className="font-mono-game">
                          {h.scorePlayer} - {h.scoreAi}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Astuce de contrôle */}
              <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
                Souris ou flèches · <span className="text-zinc-500">Espace</span> = pause
              </p>
              </>
            )}
          </div>

          {/* Colonne droite : la couleur */}
          <div className="flex flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                Ta couleur
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
                Elle colore ta raquette, ta traînée et la lueur du terrain. En solo, l’IA prend la
                couleur complémentaire. En duel, chacun garde la sienne.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
