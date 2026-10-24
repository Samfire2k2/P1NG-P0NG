import { rgbToCss, hsvToRgb } from '../game/colors'
import type { EngineState } from '../game/engine'
import { IconHome, IconPlay, IconTrophy } from './icons'
import type { LoreEntry, StoryChapter } from '../game/lore'
import StoryIllustration from './StoryIllustration'

interface EndOverlayProps {
  state: EngineState
  onRestart: () => void
  onContinue?: () => void
  onMenu: () => void
  loreReveals?: LoreEntry[]
  storyChapter?: StoryChapter | null
  nextStoryChapter?: StoryChapter | null
}

export default function EndOverlay({ state, onRestart, onContinue, onMenu, loreReveals = [], storyChapter = null, nextStoryChapter = null }: EndOverlayProps) {
  const online = state.mode === 'online'
  const localIsLeft = state.side === 'left'
  const localScore = localIsLeft ? state.scorePlayer : state.scoreAi
  const otherScore = localIsLeft ? state.scoreAi : state.scorePlayer
  const brickMode = state.brickMode
  const won = brickMode || state.trainingExercise ? state.winner === 'player' : localScore > otherScore
  const draw = !brickMode && !state.trainingExercise && !state.survivalMode && (state.draw || localScore === otherScore)
  const accent = draw
    ? '#a1a1aa'
    : won
      ? rgbToCss(hsvToRgb(state.color.h, state.color.s, state.color.v))
      : brickMode
        ? '#fb7185'
        : rgbToCss(hsvToRgb(state.peerColor.h, state.peerColor.s, state.peerColor.v))

  return (
    <div className="terminal-backdrop absolute inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="terminal-panel animate-rise max-h-[90dvh] w-full max-w-sm overflow-y-auto p-6 text-center sm:p-8">
        <div className="terminal-bar mb-6">
          <span>Rapport de session</span>
          <span className="terminal-status">Partie terminée</span>
        </div>
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
          {brickMode ? (won ? 'Mur détruit' : 'Plus de vies') : state.survivalMode ? 'Survie terminée' : state.trainingExercise ? 'Exercice terminé' : draw ? 'Match nul' : won ? 'Match gagné' : 'Match perdu'}
        </p>

        {state.storyMode && storyChapter && (
          <article className="mt-5 overflow-hidden rounded-lg border border-cyan-200/15 bg-cyan-200/[0.03] text-left">
            <StoryIllustration kind={storyChapter.illustration} />
            <div className="p-3">
              <div className="font-mono-game text-[9px] tracking-[0.2em] text-cyan-200/60 uppercase">Transmission NACRE-7 // Chapitre {storyChapter.number}</div>
              <h3 className="mt-1 font-mono-game text-sm font-bold text-cyan-100">{storyChapter.title}</h3>
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-300">{storyChapter.narrative}</p>
              <p className="mt-2 font-mono-game text-[9px] text-cyan-100/70">{won ? nextStoryChapter ? `Signal validé. Chapitre suivant : ${nextStoryChapter.title}.` : 'Signal validé. La liaison avec la Terre est rétablie.' : 'Liaison interrompue. Recommence ce chapitre pour poursuivre la transmission.'}</p>
            </div>
          </article>
        )}

        {brickMode ? (
          <div className="font-mono-game mt-6 text-2xl font-bold sm:text-3xl" style={{ color: accent }}>
            {state.bricksBroken} briques détruites
          </div>
        ) : <div className="font-mono-game mt-6 flex items-center justify-center gap-5 text-4xl font-bold">
          <span style={{ color: rgbToCss(hsvToRgb(state.color.h, state.color.s, state.color.v)) }}>
            {state.scorePlayer}
          </span>
          <span className="text-zinc-700">—</span>
          <span style={{ color: rgbToCss(hsvToRgb(state.peerColor.h, state.peerColor.s, state.peerColor.v)) }}>
            {state.scoreAi}
          </span>
        </div>}

        {loreReveals.length > 0 && (
          <div className="mt-5 max-h-48 space-y-2 overflow-y-auto text-left">
            {loreReveals.map((fragment) => (
              <article key={fragment.id} className="rounded-lg border border-cyan-200/20 bg-cyan-200/[0.04] p-3">
                <div className="font-mono-game text-[9px] tracking-[0.2em] text-cyan-200/70 uppercase">Archive restaurée // {fragment.source}</div>
                <h3 className="mt-1 font-mono-game text-sm font-bold text-cyan-100">[{fragment.index}] {fragment.title}</h3>
                <p className="mt-2 font-mono-game text-[10px] leading-relaxed text-white/80">{fragment.transmission}</p>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-400">{fragment.record}</p>
              </article>
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-white/8 bg-black/25 p-3 text-left font-mono-game text-[10px] text-zinc-400">
          <span>Durée</span><span className="text-right text-zinc-200">{Math.floor(state.matchStats.duration / 60)}:{Math.floor(state.matchStats.duration % 60).toString().padStart(2, '0')}</span>
          <span>Renvois de raquette</span><span className="text-right text-zinc-200">{state.matchStats.paddleHits}</span>
          <span>Rebonds sur les murs</span><span className="text-right text-zinc-200">{state.matchStats.wallHits}</span>
          <span>Bonus ramassés</span><span className="text-right text-zinc-200">{state.matchStats.powerups}</span>
          {state.survivalMode && <><span>Niveau atteint</span><span className="text-right text-cyan-200">{state.survivalLevel + 1}</span></>}
          {state.trainingExercise && <><span>Objectif d’entraînement</span><span className="text-right text-cyan-200">{state.trainingProgress}/{state.trainingExercise === 'rebonds' ? 30 : 20}</span></>}
        </div>

        {state.storyMode && won && onContinue ? (
          <button
            type="button"
            onClick={onContinue}
            className="primary-button mt-7 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-[0.2em] uppercase"
          >
            <IconPlay className="h-4 w-4" />
            Continuer
          </button>
        ) : (
          <button
            type="button"
            onClick={onRestart}
            className="primary-button mt-7 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-[0.2em] uppercase"
          >
            <IconPlay className="h-4 w-4" />
            {online ? (localIsLeft ? 'Rejouer' : 'Demander revanche') : 'Rejouer'}
          </button>
        )}

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
