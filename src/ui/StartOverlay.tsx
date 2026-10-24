import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { DIFFICULTY_PROFILES, DIFFICULTIES, type Difficulty, type MatchFormat } from '../game/constants'
import { POWERUP_INFO } from '../game/powerups'
import { POWERUP_TYPES } from '../game/world'
import type { EngineState } from '../game/engine'
import type { NetStatus } from '../net/session'
import ColorPicker from './ColorPicker'
import { IconPalette } from './icons'
import OnlineLobby from './OnlineLobby'
import { CONTRACT_INFO, getDailyChallenge, MODIFIER_INFO, parseChallengeCode, type DailyChallenge } from '../game/arcade'
import { formatLoreLog, LORE_ENTRIES, STORY_CHAPTERS, STORY_SKINS, type StoryChapter } from '../game/lore'
import StoryIllustration from './StoryIllustration'

export type GameModeTab = 'ai' | 'online' | 'brick' | 'story'

const POWERUP_COLOR: Record<(typeof POWERUP_TYPES)[number], string> = {
  speed: '#ffb71b', slow: '#33baff', grow: '#47e875', shrink: '#ff526d',
  multiball: '#bd70ff', shield: '#ffe44a', teleport: '#ff55c8', magnet: '#526fff',
  ghost: '#a8e8ff', double: '#45edca',
}

const ACHIEVEMENT_LABELS: Record<string, string> = {
  'first-win': 'Première victoire', 'rally-ace': 'Maître des échanges', collector: 'Collectionneur',
  survivor: 'Dernier survivant', 'brick-breaker': 'Démolisseur', contract: 'Contrat rempli',
  'streak-3': 'Série de 3 défis', veteran: 'Vétéran',
}

const TERMINAL_COMMANDS = [
  'aide', 'help', '?', 'solo', 'solo facile', 'solo moyen', 'solo difficile', 'solo expert',
  'solo facile 7 pts', 'solo moyen 11 pts', 'solo expert 3 min', 'solo expert 3 min bonus',
  'solo facile 7 pts sans bonus', 'duel', 'en ligne', 'online', 'casse-brique', 'brick',
  'lancer', 'start', 'jouer', 'bonus', 'sans bonus', 'defi', 'lore', 'journal', 'histoire', 'entrainement', 'entrainement rebonds', 'entrainement precision', 'survie', 'duel local',
]

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
  theme: number
  onTheme: (t: number) => void
  orientation: 'landscape' | 'portrait'
  onOrientation: (o: 'landscape' | 'portrait') => void
  duration: number
  onGlow: (value: number) => void
  glow: number
  inviteLink: string
  netMessage: string
  onCreateRoom: (publicRoom: boolean) => void
  onJoinRoom: (code: string, key: string) => void
  onJoinSpectator?: (code: string, key: string) => void
  onQuitRoom: () => void
  roomCode: string
  initialCode: string
  initialKey: string
  playerName: string
  peerName: string
  history: { date: string; mode: string; brickMode?: boolean; format: string; scorePlayer: number; scoreAi: number; result?: 'win' | 'loss' | 'draw'; difficulty: string; target: number; challengeCode?: string; contractComplete?: boolean }[]
  leaderboard: { name: string; score: number; date: string }[]
  canStart: boolean
  onNameChange: (name: string) => void
  onStartMatch: () => void
  musicMuted: boolean
  onToggleMusic: () => void
  onToggleEffects: () => void
  sensitivity: number
  onSensitivity: (value: number) => void
  reduceMotion: boolean
  onReduceMotion: (value: boolean) => void
  highContrast: boolean
  onHighContrast: (value: boolean) => void
  onTutorial: () => void
  onDailyChallenge: (challenge: DailyChallenge | null) => void
  challengeRecord?: { best: number; contract: boolean; hasReplay: boolean }
  achievements: string[]
  dailyStreak: number
  unlockedThemes: number[]
  onSurvival: (enabled: boolean) => void
  onLocalDuel: (enabled: boolean) => void
  onTrainingExercise: (exercise: 'rebonds' | 'precision' | null) => void
  loreIds: string[]
  storyChapter: StoryChapter | null
  storyCompleted: string[]
  onStoryMode: (chapter: StoryChapter | null, theme?: number) => void
}

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
  theme,
  onTheme,
  orientation,
  onOrientation,
  duration,
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
  musicMuted,
  onToggleMusic,
  onToggleEffects,
  sensitivity,
  onSensitivity,
  reduceMotion,
  onReduceMotion,
  highContrast,
  onHighContrast,
  onTutorial,
  onDailyChallenge,
  challengeRecord,
  achievements,
  dailyStreak,
  unlockedThemes,
  onSurvival,
  onLocalDuel,
  onTrainingExercise,
  loreIds,
  storyChapter,
  storyCompleted,
  onStoryMode,
}: StartOverlayProps) {
  const netStatus: NetStatus = state.netStatus
  const [historyFilter, setHistoryFilter] = useState<'all' | 'ai' | 'online' | 'brick'>('all')
  const [command, setCommand] = useState('')
  const [commandFeedback, setCommandFeedback] = useState('')
  const [terminalEntered, setTerminalEntered] = useState(false)
  const [completion, setCompletion] = useState<{ prefix: string; candidates: string[]; index: number } | null>(null)
  const commandHelp = [
    'NACRE-7 // RELAIS LUNAIRE // NOYAU ORION EN LIGNE',
    'La Terre ne répond plus depuis la Grande Coupure. Je surveille seul ce relais.',
    'Je t’envoie un signal sous forme de balle. Renvoyer la balle confirme ta présence.',
    'Je ne reconnais pas ta signature, opérateur. Si tu me lis, joue une partie.',
    '',
    'aide ........................ affiche cette aide',
    'solo [niveau] [format] [bonus] configure Pong contre l’IA',
    '  niveaux : facile | moyen | difficile | expert',
    '  format  : 7 pts (1–99) | 3 min (1–60)',
    '  bonus   : bonus | sans bonus',
    'duel / en ligne ............. ouvre le salon multijoueur',
    'casse-brique ................ lance le mode solo portrait',
    'defi [P1-AAAAMMJJ] ........... lance le défi du jour ou un défi partagé',
    'entrainement ................. partie libre contre une IA facile',
    'entrainement rebonds ......... exercice de 30 rebonds sur les murs',
    'entrainement precision ....... exercice de 20 renvois centraux',
    'survie ....................... tiens le plus longtemps face a une IA qui accelere',
    'duel local ................... deux joueurs : W/S et fleches haut/bas',
    'lore / journal ............... consulte les transmissions restaurées',
    'histoire ...................... lance la campagne de NACRE-7',
    'lancer ...................... démarre la partie configurée',
    '',
    'Exemples : solo facile 7 pts bonus · solo expert 3 min · duel · casse-brique',
  ].join('\n')
  const filteredHistory = history.filter((entry) => historyFilter === 'all'
    || (historyFilter === 'brick' ? entry.brickMode : !entry.brickMode && entry.mode === historyFilter))
  const wins = filteredHistory.filter((entry) => entry.result === 'win').length
  const losses = filteredHistory.filter((entry) => entry.result === 'loss').length
  const draws = filteredHistory.filter((entry) => entry.result === 'draw').length
  const bestScore = filteredHistory.reduce((best, entry) => Math.max(best, entry.scorePlayer), 0)

  const applyCommand = (rawCommand: string) => {
    const value = rawCommand.trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (!value) {
      setCommandFeedback('Saisis une configuration ou choisis un raccourci.')
      return
    }

    if (/^(aide|help|\?)$/.test(value)) {
      setCommandFeedback(commandHelp)
      setCommand('')
      return
    }
    if (/^(lore|journal|archives)$/.test(value)) {
      setCommandFeedback(formatLoreLog(loreIds))
      setCommand('')
      return
    }
    if (/^(histoire|story|campagne)$/.test(value)) {
      onDailyChallenge(null)
      onSurvival(false)
      onLocalDuel(false)
      onTrainingExercise(null)
      onTabChange('story')
      setTerminalEntered(true)
      setCommandFeedback(storyChapter
        ? `CAMPAGNE NACRE-7 // CHAPITRE ${storyChapter.number} : ${storyChapter.title.toUpperCase()} // CHOISIS UN SKIN, PUIS TAPE « LANCER »`
        : 'CAMPAGNE TERMINÉE // TAPE « LORE » POUR RELIRE LE DERNIER JOURNAL D’ORION')
      setCommand('')
      return
    }
    if (/^defi(?:\s+(p1-\d{8}))?$/.test(value)) {
      const code = value.match(/p1-\d{8}/i)?.[0]
      const challenge = code ? parseChallengeCode(code) : getDailyChallenge()
      if (!challenge) {
        setCommandFeedback('Code de défi invalide. Format attendu : P1-AAAAMMJJ')
        return
      }
      onDailyChallenge(challenge)
      onStart()
      setTab('ai')
      setTerminalEntered(true)
      setCommandFeedback(`DÉFI ${challenge.code} // ${challenge.difficulty.toUpperCase()} · ${challenge.target} POINTS · ${MODIFIER_INFO[challenge.modifier].label} · CONTRAT : ${CONTRACT_INFO[challenge.contract].label}`)
      setCommand('')
      return
    }
    if (/^survie$/.test(value)) {
      onDailyChallenge(null)
      onSurvival(true)
      setTab('ai')
      setTerminalEntered(true)
      onStart()
      return
    }
    if (/^(?:duel\s+)?local(?:\s+a\s+deux)?$/.test(value)) {
      onDailyChallenge(null)
      onLocalDuel(true)
      setTab('ai')
      setTerminalEntered(true)
      setCommandFeedback('DUEL LOCAL // JOUEUR 1 : W/S · JOUEUR 2 : ↑/↓')
      onStart()
      return
    }
    if (/^(lancer|start|jouer)$/.test(value)) {
      if (tab === 'online') {
        if (canStart) onStartMatch()
        else setCommandFeedback('Salon en attente // connecte un adversaire avant de lancer.')
      } else if (tab === 'story' && !storyChapter) {
        setCommandFeedback('CAMPAGNE TERMINÉE // aucune mission restante')
      } else {
        onStart()
      }
      return
    }

    let nextTab = tab
    const trainingMatch = value.match(/^entrainement(?:\s+(rebonds|precision|facile))?$/)
    if (trainingMatch) {
      onDailyChallenge(null)
      onTabChange('ai')
      const exercise = trainingMatch[1] === 'rebonds' || trainingMatch[1] === 'precision' ? trainingMatch[1] : null
      onTrainingExercise(exercise)
      if (!exercise) {
        onDifficulty('facile')
        onFormat('time', 0, 10 * 60)
        onPowerups(false)
      }
      setTerminalEntered(true)
      setCommandFeedback(exercise === 'rebonds' ? 'EXERCICE // 30 REBONDS SUR LES MURS · TAPE « LANCER »' : exercise === 'precision' ? 'EXERCICE // 20 RENVOIS AU CENTRE DE LA RAQUETTE · TAPE « LANCER »' : 'ENTRAÎNEMENT // IA FACILE · 10 MIN · SANS BONUS')
      setCommand('')
      return
    }

    const modeCommand = /casse[- ]?brique|\bbrick\b|\b(duel|en ligne|online|solo|ia|ordinateur)\b/.test(value)
    if (/casse[- ]?brique|\bbrick\b/.test(value)) nextTab = 'brick'
    else if (/\b(duel|en ligne|online)\b/.test(value)) nextTab = 'online'
    else if (/\b(solo|ia|ordinateur)\b/.test(value)) nextTab = 'ai'
    const difficulty = DIFFICULTIES.find((item) => value.includes(item))
    const durationMatch = value.match(/(\d+)\s*(?:min(?:ute)?s?|m)\b/)
    const pointsMatch = value.match(/(?:^|\s)(\d+)\s*(?:pt|pts|point|points)\b/)
      ?? value.match(/(?:^|\s)(5|7|11|15)(?=\s|$)/)
    const disablesBonus = /\b(sans (?:les )?bonus|bonus off|bonus d[ée]sactiv[ée]s?)\b/.test(value)
    const bonusCommand = disablesBonus || /\b(bonus|power ?ups?)\b/.test(value)
    if (tab === 'story' && !modeCommand) nextTab = 'ai'
    if (!modeCommand && (difficulty || durationMatch || pointsMatch)) nextTab = 'ai'
    if (!modeCommand && !difficulty && !durationMatch && !pointsMatch && !bonusCommand) {
      setCommandFeedback('Commande inconnue. Exemples : « solo facile 7 points », « duel », « casse-brique ».')
      return
    }
    onDailyChallenge(null)
    onSurvival(false)
    onLocalDuel(false)
    onTrainingExercise(null)
    onStoryMode(null)
    setTerminalEntered(true)
    if (nextTab !== tab) onTabChange(nextTab)

    if (difficulty && nextTab === 'ai') onDifficulty(difficulty)

    if (nextTab !== 'brick' && nextTab !== 'online') {
      if (durationMatch) {
        const minutes = Math.max(1, Math.min(60, Number(durationMatch[1])))
        onFormat('time', state.target, minutes * 60)
      } else if (pointsMatch) {
        onFormat('points', Math.max(1, Math.min(99, Number(pointsMatch[1]))), duration)
      }
    }

    if (disablesBonus) onPowerups(false)
    else if (/\b(bonus|power ?ups?)\b/.test(value)) onPowerups(true)

    const applied: string[] = [nextTab === 'ai' ? 'SOLO' : nextTab === 'online' ? 'DUEL' : 'CASSE-BRIQUE']
    if (difficulty && nextTab === 'ai') applied.push(difficulty.toUpperCase())
    if (durationMatch && nextTab === 'ai') applied.push(`${Math.max(1, Math.min(60, Number(durationMatch[1])))} MIN`)
    else if (pointsMatch && nextTab === 'ai') applied.push(`${Math.max(1, Math.min(99, Number(pointsMatch[1])))} POINTS`)
    if (bonusCommand) applied.push(disablesBonus ? 'SANS BONUS' : 'BONUS')
    setCommandFeedback(`CONFIGURATION APPLIQUÉE // ${applied.join(' · ')}`)
    setCommand('')
  }

  const submitCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    applyCommand(command)
  }

  const completeCommand = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const current = command.trim().toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const cycling = completion?.candidates.includes(current) ? completion : null
    const prefix = cycling?.prefix ?? current
    const candidates = cycling?.candidates ?? TERMINAL_COMMANDS.filter((item) =>
      item.startsWith(prefix) && item !== prefix,
    )
    if (candidates.length === 0) {
      setCommandFeedback('Aucune suggestion. Tape aide pour afficher les commandes.')
      setCompletion(null)
      return
    }
    const index = cycling ? (cycling.index + 1) % candidates.length : 0
    setCommand(candidates[index] ?? '')
    setCompletion({ prefix, candidates, index })
  }

  if (!terminalEntered) {
    return (
      <div className="terminal-backdrop terminal-startup absolute inset-0 z-20 flex items-center justify-center overflow-y-auto p-4">
        <section className="terminal-panel animate-rise w-full max-w-2xl p-5 sm:p-8" aria-labelledby="terminal-welcome">
          <div className="terminal-bar mb-6">
            <span id="terminal-welcome">P1NG-P0NG // CONSOLE DE JEU</span>
            <span className="terminal-status">En attente</span>
          </div>
          <pre className="terminal-help mb-6 overflow-x-auto text-[10px] leading-relaxed text-emerald-100/70 sm:text-xs">{commandHelp}</pre>
          <form onSubmit={submitCommand} className="terminal-start-form border-t border-emerald-300/20 pt-4">
            <label htmlFor="startup-command" className="mb-2 block text-[9px] tracking-[0.2em] text-emerald-300/60 uppercase">Commande d’aide : aide · Tab complète · Entrée exécute</label>
            <div className="flex items-center gap-2 font-mono-game text-sm sm:text-base">
              <span className="text-emerald-300" aria-hidden="true">&gt;</span>
              <input
                id="startup-command"
                autoFocus
                value={command}
                onChange={(event) => { setCommand(event.target.value); setCompletion(null) }}
                onKeyDown={completeCommand}
                placeholder="aide"
                autoComplete="off"
                spellCheck={false}
                className="terminal-input min-w-0 flex-1 bg-transparent py-2 text-emerald-50 outline-none placeholder:text-emerald-100/25"
                aria-describedby="startup-feedback"
              />
            </div>
            <p id="startup-feedback" className="terminal-feedback mt-3 min-h-10 whitespace-pre-line text-[10px] leading-relaxed text-emerald-300/80" role="status" aria-live="polite">{commandFeedback}</p>
          </form>
        </section>
      </div>
    )
  }

  return (
    <div className="terminal-backdrop absolute inset-0 z-20 flex items-start justify-center overflow-y-auto p-4 pt-8 backdrop-blur-md">
      <div className="terminal-panel animate-rise my-6 w-full max-w-3xl p-6 sm:p-8">
        <div className="terminal-bar mb-5">
          <span>Console de configuration // {tab === 'online' ? 'multijoueur' : tab === 'brick' ? 'casse-brique' : 'solo'}</span>
          <span className="terminal-status">Système actif</span>
        </div>
        <form onSubmit={submitCommand} className="mb-5 rounded-lg border border-[var(--accent)]/25 bg-black/35 p-3 sm:p-4">
          <label htmlFor="match-command" className="mb-2 block text-[9px] font-semibold tracking-[0.28em] text-zinc-500 uppercase">
            Configuration rapide // saisis ou sélectionne
          </label>
          <div className="flex items-center gap-2">
            <span className="font-mono-game text-sm font-bold text-[var(--accent)]" aria-hidden="true">&gt;_</span>
            <input
              id="match-command"
              value={command}
              onChange={(event) => { setCommand(event.target.value); setCompletion(null) }}
              onKeyDown={completeCommand}
              placeholder="solo facile 7 points bonus"
              autoComplete="off"
              spellCheck={false}
              className="font-mono-game min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-white outline-none placeholder:text-zinc-700 focus:ring-0"
              aria-describedby="command-help command-feedback"
            />
            <button type="submit" aria-label="Exécuter la commande" className="primary-button rounded-md px-2 py-2 text-sm font-bold">↵</button>
          </div>
          <p id="command-help" className="mt-1 text-[9px] text-zinc-600">Entrée pour exécuter · <code>aide</code> pour la syntaxe · ex. <code>solo facile 7 pts</code>, <code>duel</code>, <code>casse-brique</code>, <code>lancer</code>.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['defi', 'survie', 'duel local', 'entrainement rebonds', 'entrainement precision', 'solo facile 7 pts', 'duel', 'casse-brique'].map((preset) => (
              <button key={preset} type="button" onClick={() => applyCommand(preset)} className="glass-button rounded-md px-2 py-1 text-[9px] text-zinc-400 hover:text-white">
                {preset}
              </button>
            ))}
          </div>
          <p id="command-feedback" className="mt-2 max-h-64 min-h-3 overflow-y-auto whitespace-pre-line text-[9px] leading-relaxed text-[var(--accent)]" role="status" aria-live="polite">{commandFeedback}</p>
        </form>
        {state.challenge && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-200/20 bg-cyan-300/5 px-3 py-2 font-mono-game text-[10px] text-cyan-100/80">
            <span>{state.challengeNotice} · {state.contractComplete ? 'CONTRAT VALIDÉ' : `CONTRAT ${CONTRACT_INFO[state.challenge.contract].label.toUpperCase()}`}
              {challengeRecord && ` · RECORD ${challengeRecord.best} PTS${challengeRecord.contract ? ' · CONTRAT OK' : ''}${challengeRecord.hasReplay ? ' · FANTÔME ACTIF' : ''}`}
            </span>
            <button type="button" className="glass-button rounded px-2 py-1" onClick={() => { void navigator.clipboard?.writeText(state.challenge!.code); setCommandFeedback(`CODE ${state.challenge!.code} COPIÉ // partage-le pour comparer vos scores`) }}>Copier {state.challenge.code}</button>
          </div>
        )}
        <details className="mb-5 rounded-lg border border-cyan-200/10 bg-black/25 p-3">
          <summary className="cursor-pointer font-mono-game text-[10px] tracking-[0.18em] text-cyan-100/70 uppercase">
            Archives NACRE-7 // {loreIds.length}/{LORE_ENTRIES.length} fragments restaurés
          </summary>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
            {LORE_ENTRIES.filter((entry) => loreIds.includes(entry.id)).map((entry) => (
              <article key={entry.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2.5">
                <div className="font-mono-game text-[9px] tracking-wider text-cyan-200/80">[{entry.index}] {entry.title} // {entry.source}</div>
                <p className="mt-1 text-[10px] leading-relaxed text-white/75">{entry.transmission}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{entry.record}</p>
              </article>
            ))}
            {loreIds.length < LORE_ENTRIES.length && <p className="px-2 py-1 font-mono-game text-[9px] text-zinc-600">{LORE_ENTRIES.length - loreIds.length} fragment(s) restent chiffrés. Gagne un match, casse des briques, tiens en survie, lance un défi quotidien et joue en duo pour retrouver les archives.</p>}
          </div>
        </details>
        <div className="terminal-mode-line mb-6 flex items-center gap-2 font-mono-game text-[10px] tracking-[0.16em] text-emerald-300/70 uppercase">
          <span className="terminal-status">Mode actif</span>
          <span>{tab === 'story' ? `HISTOIRE NACRE-7 / ${storyChapter ? `CH. ${storyChapter.number} // ${storyChapter.title}` : 'CAMPAGNE TERMINEE'}` : state.localDuel ? 'DUEL LOCAL / 2 JOUEURS' : state.survivalMode ? 'SURVIE / IA ADAPTATIVE' : state.trainingExercise ? `ENTRAINEMENT / ${state.trainingExercise.toUpperCase()}` : tab === 'online' ? 'DUEL EN LIGNE' : tab === 'brick' ? 'CASSE-BRIQUE / SOLO' : 'PONG / IA'}</span>
        </div>
        {/* Onglets de mode */}
        <div className="mb-7 grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl border border-white/8 bg-black/25 p-1.5">
          {(
            [
              { id: 'ai' as const, label: 'Contre l’IA', hint: '4 niveaux' },
              { id: 'online' as const, label: 'En ligne', hint: 'Duel à deux' },
              { id: 'brick' as const, label: 'Casse-brique', hint: 'Solo · portrait' },
              { id: 'story' as const, label: 'Histoire', hint: 'Campagne NACRE-7' },
            ]
          ).map((item) => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`terminal-mode-tab rounded-lg px-3 py-2.5 text-xs font-bold tracking-[0.15em] uppercase transition-all ${
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
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Colonne gauche */}
          <div className="flex flex-col">
            {tab === 'ai' ? (
              <>
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.4em] text-zinc-500 uppercase">
                  <IconPalette className="h-3.5 w-3.5" />
                  P1NG-P0NG
                </div>
                <h1 className="ping-title mt-3 text-5xl leading-[0.9] font-extrabold tracking-tight sm:text-6xl">
                  P<span className="brand-dark-digit">1</span>NG-P<span className="brand-dark-digit">0</span>NG
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
                  ORION teste la liaison avec toi. Chaque échange confirme que le relais n’est
                  plus seul. Son adversaire reprend les gestes d’une ancienne opératrice. Quatre
                  niveaux, des parties au score ou chronométrées.
                </p>
              </>
            ) : tab === 'brick' ? (
              <>
                <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.4em] text-zinc-500 uppercase">
                  <IconPalette className="h-3.5 w-3.5" />
                  P1NG-P0NG · casse-brique
                </div>
                <h1 className="ping-title mt-3 text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-5xl">
                  CASSE-BRIQUE
                  <span className="block text-2xl leading-tight sm:text-3xl">Contre un mur de briques</span>
                </h1>
                <p className="mt-4 max-w-sm text-sm leading-relaxed text-zinc-400">
                  Ces briques sont des fragments d’archives corrompues qui bloquent la mémoire
                  d’ORION. Dégage le canal, puis rattrape la balle au retour. Trois vies, portrait
                  uniquement.
                </p>
              </>
            ) : tab === 'story' ? (
              <>
                <div className="mb-3 flex items-center gap-2 font-mono-game text-[10px] tracking-[0.3em] text-cyan-100/60 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#67dfff]" /> CAMPAGNE NARRATIVE // NACRE-7
                </div>
                {storyChapter ? (
                  <>
                    <StoryIllustration kind={storyChapter.illustration} className="mb-4" />
                    <div className="font-mono-game text-[9px] tracking-[0.2em] text-cyan-200/60 uppercase">{storyChapter.signal} // CHAPITRE {storyChapter.number}</div>
                    <h1 className="ping-title mt-2 text-3xl leading-tight font-bold sm:text-4xl">{storyChapter.title}</h1>
                    <p className="mt-3 text-xs leading-relaxed text-zinc-300">{storyChapter.narrative}</p>
                    <div className="mt-4 rounded-md border border-cyan-100/10 bg-cyan-100/[0.03] p-3">
                      <div className="font-mono-game text-[9px] tracking-[0.2em] text-cyan-100/50 uppercase">Mission</div>
                      <p className="mt-1 text-xs text-cyan-50">{storyChapter.objective}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <StoryIllustration kind="origin" className="mb-4" />
                    <h1 className="ping-title text-3xl font-bold">Campagne terminee</h1>
                    <p className="mt-3 text-xs leading-relaxed text-zinc-300">ORION a recu ta reponse. Tape « lore » dans le terminal pour relire le journal du relais.</p>
                  </>
                )}
                {storyChapter && (() => {
                  const skin = STORY_SKINS.find((item) => item.theme === storyChapter.theme)
                  return skin ? <div className="mt-4 flex items-center gap-2 rounded-md border border-white/8 bg-black/20 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: skin.color, boxShadow: `0 0 8px ${skin.color}` }} />
                    <span className="font-mono-game text-[9px] tracking-[0.15em] text-zinc-400 uppercase">Skin du niveau // {skin.label}</span>
                  </div> : null
                })()}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {STORY_CHAPTERS.map((chapter) => {
                    const complete = storyCompleted.includes(chapter.id)
                    const current = storyChapter?.id === chapter.id
                    return <span key={chapter.id} className={`rounded border px-2 py-1 font-mono-game text-[8px] ${complete ? 'border-cyan-200/20 text-cyan-100/70' : current ? 'border-cyan-200/40 text-cyan-100' : 'border-white/5 text-zinc-700'}`}>{complete ? 'OK' : current ? 'ACTIF' : 'VERROUILLE'} {String(chapter.number).padStart(2, '0')}</span>
                  })}
                </div>
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
                  Une autre console répond à NACRE-7. Crée un salon et partage le lien pour tenir
                  la relève avec un autre opérateur. La connexion passe directement entre les
                  navigateurs.
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
                {tab === 'ai' && <div className="mt-6">
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
                </div>}

                {tab !== 'brick' && (
                  <>
                    {/* Points */}
                    <div className="mt-4">
                      <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                        Points
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[5, 7, 11, 15].map((target) => {
                          const active = state.format === 'points' && state.target === target
                          return (
                            <button
                              key={target}
                              type="button"
                              onClick={() => onFormat('points', target, duration)}
                              className={`glass-button rounded-lg px-2 py-2 text-[11px] font-semibold ${
                                active ? 'text-white' : 'text-zinc-400'
                              }`}
                              style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                            >
                              {target}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}

                {tab !== 'brick' && (
                  <>
                    {/* Temps */}
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Temps
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={Math.round(duration / 60)}
                      onChange={(e) => onFormat('time', state.target, Math.max(60, Number(e.target.value) * 60))}
                      className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-sm text-zinc-200"
                    />
                    <span className="text-[11px] text-zinc-500">minutes</span>
                    <button
                      type="button"
                      onClick={() => onFormat('time', state.target, duration)}
                      className={`glass-button rounded-lg px-3 py-2 text-xs font-semibold ${
                        state.format === 'time' ? 'text-white' : 'text-zinc-400'
                      }`}
                      style={state.format === 'time' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                    >
                      {state.format === 'time' ? 'Actif' : 'Activer'}
                    </button>
                  </div>
                  {state.format === 'time' && (
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
                      {Math.round(duration / 60)} min. Le meilleur score l’emporte.
                    </p>
                  )}
                </div>
                  </>
                )}

                {tab !== 'story' && (
                <details className="mt-5 rounded-xl border border-white/8 bg-black/20 p-3">
                  <summary className="cursor-pointer text-xs font-semibold tracking-[0.12em] text-zinc-300">
                    Personnaliser le jeu
                  </summary>
                  <div className="mt-3">
                {/* Powerups */}
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Bonus
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
                  <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {POWERUP_TYPES.map((type) => (
                      <li key={type} className="flex gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 text-[10px] leading-relaxed">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: POWERUP_COLOR[type], boxShadow: `0 0 8px ${POWERUP_COLOR[type]}` }} />
                        <span><strong className="text-zinc-200">{POWERUP_INFO[type].label}</strong><span className="block text-zinc-500">{POWERUP_INFO[type].description}</span></span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Thème */}
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                    Thème
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {['Neon', 'Synthwave', 'Retro', 'Minimal', 'Terminal', 'Plasma', 'Aurora'].map((label, i) => {
                      const active = theme === i
                      const unlocked = unlockedThemes.includes(i)
                      return (
                        <button
                          key={label}
                          type="button"
                          disabled={!unlocked}
                          title={unlocked ? label : 'A gagner avec un succes'}
                          onClick={() => unlocked && onTheme(i)}
                          className={`glass-button rounded-lg px-2 py-2 text-xs font-semibold ${active ? 'text-white' : unlocked ? 'text-zinc-400' : 'cursor-not-allowed text-zinc-700'}`}
                          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                          {unlocked ? label : `VERROU · ${label}`}
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
                    {(tab === 'brick' ? ['portrait' as const] : ['landscape', 'portrait'] as const).map((o) => {
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

                <div className="mt-5 border-t border-white/5 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="sensitivity" className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">Sensibilité</label>
                    <span className="font-mono-game text-[10px] text-zinc-500">{Math.round(sensitivity * 100)}%</span>
                  </div>
                  <input id="sensitivity" type="range" min={0.5} max={1.5} step={0.05} value={sensitivity} onChange={(e) => onSensitivity(Number(e.target.value))} className="hue-range" aria-label="Sensibilité des commandes" />
                  <p className="mt-1 text-[10px] text-zinc-600">Ajuste la réactivité de la souris et du glissement tactile.</p>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Options audio et accessibilité">
                  <button type="button" onClick={onToggleEffects} className="glass-button flex items-center justify-between rounded-lg px-3 py-2 text-[10px] text-zinc-300">
                    Effets sonores <span className={state.muted ? 'text-amber-300' : 'text-emerald-300'}>{state.muted ? 'Coupés' : 'Activés'}</span>
                  </button>
                  <button type="button" onClick={onToggleMusic} className="glass-button flex items-center justify-between rounded-lg px-3 py-2 text-[10px] text-zinc-300">
                    Musique <span className={musicMuted ? 'text-amber-300' : 'text-emerald-300'}>{musicMuted ? 'Coupée' : 'Activée'}</span>
                  </button>
                  <button type="button" onClick={() => onReduceMotion(!reduceMotion)} className="glass-button flex items-center justify-between rounded-lg px-3 py-2 text-[10px] text-zinc-300">
                    Animations réduites <span className={reduceMotion ? 'text-emerald-300' : 'text-zinc-500'}>{reduceMotion ? 'Oui' : 'Non'}</span>
                  </button>
                  <button type="button" onClick={() => onHighContrast(!highContrast)} className="glass-button flex items-center justify-between rounded-lg px-3 py-2 text-[10px] text-zinc-300">
                    Contraste renforcé <span className={highContrast ? 'text-emerald-300' : 'text-zinc-500'}>{highContrast ? 'Oui' : 'Non'}</span>
                  </button>
                </div>

                {/* Intensité du glow */}
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
                      Lueur
                    </span>
                    <span className="font-mono-game text-[10px] text-zinc-600">
                      {Math.round(glow * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
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


              <div className="mt-6 border-t border-white/5 pt-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">Statistiques et historique</div>
                    <select value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value as typeof historyFilter)} className="rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] text-zinc-300" aria-label="Filtrer les parties">
                      <option value="all">Tous les modes</option><option value="ai">Solo IA</option><option value="online">En ligne</option><option value="brick">Casse-brique</option>
                    </select>
                  </div>
                  <div className="mb-3 grid grid-cols-5 gap-1.5 text-center">
                    {[
                      ['Parties', filteredHistory.length], ['Victoires', wins], ['Défaites', losses], ['Nuls', draws], ['Record', bestScore],
                    ].map(([label, count]) => (
                      <div key={label} className="rounded-md border border-white/5 bg-black/20 px-1 py-2">
                        <div className="font-mono-game text-sm font-bold text-zinc-200">{count}</div>
                        <div className="text-[8px] tracking-wider text-zinc-500 uppercase">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mb-3 rounded-md border border-cyan-200/10 bg-cyan-200/[0.03] p-3">
                    <div className="mb-2 flex items-center justify-between font-mono-game text-[10px] text-cyan-100/75">
                      <span>Série de défis quotidiens</span><strong>{dailyStreak} jour{dailyStreak === 1 ? '' : 's'}</strong>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {achievements.length === 0 && <span className="text-[9px] text-zinc-600">Aucun succès débloqué pour le moment.</span>}
                      {achievements.map((id) => <span key={id} className="rounded border border-cyan-200/15 bg-cyan-200/[0.06] px-2 py-1 text-[9px] text-cyan-100/80">✦ {ACHIEVEMENT_LABELS[id] ?? id}</span>)}
                    </div>
                  </div>
                  <div className="space-y-1.5 text-[10px] text-zinc-400">
                    {filteredHistory.length === 0 && <p className="py-3 text-center text-zinc-600">Aucune partie pour ce filtre.</p>}
                    {filteredHistory.slice(0, 10).map((h, i) => (
                      <div key={`${h.date}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-black/20 px-2.5 py-2">
                        <span className="min-w-0 truncate">
                          {h.brickMode ? 'Casse-brique · Solo' : `${h.mode === 'online' ? 'En ligne' : 'Solo IA'} · ${h.difficulty} · ${h.format === 'time' ? 'temps' : `${h.target} pts`}`}
                          {h.challengeCode && <span className="ml-2 text-cyan-200/70">Défi {h.challengeCode}{h.contractComplete ? ' · Contrat validé' : ''}</span>}
                          <span className="ml-2 text-zinc-600">{new Date(h.date).toLocaleDateString('fr-FR')}</span>
                        </span>
                        <span className="font-mono-game shrink-0 text-zinc-200">{h.brickMode ? `${h.scorePlayer} briques` : `${h.scorePlayer} - ${h.scoreAi}`}</span>
                        {h.result && <span className={`shrink-0 text-[8px] uppercase ${h.result === 'win' ? 'text-emerald-300' : h.result === 'loss' ? 'text-rose-300' : 'text-amber-300'}`}>{h.result === 'win' ? 'Gagné' : h.result === 'loss' ? 'Perdu' : 'Nul'}</span>}
                      </div>
                    ))}
                  </div>
              </div>
                  </div>
                </details>
                )}

              {/* Astuce de contrôle */}
              <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-600">
                Souris, tactile ou flèches · <span className="text-zinc-500">Espace</span> = pause
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
                Elle colore ta raquette, sa traînée et le terrain. En mode IA, l’adversaire prend
                la couleur complémentaire ; en duel, chaque joueur garde la sienne.
              </div>
            </div>
          </div>
        </div>
        <div className="mt-7 text-center">
          {tab !== 'online' && <div className="mb-3 text-[9px] font-semibold tracking-[0.28em] text-zinc-600 uppercase">{tab === 'story' ? storyChapter ? `NACRE-7 // CHAPITRE ${storyChapter.number} PRÊT` : 'ORION // ARCHIVES COMPLÈTES' : 'Session prête // confirme pour démarrer'}</div>}
          <div className="flex flex-wrap justify-center gap-2">
            {tab !== 'online' && (tab !== 'story' || storyChapter !== null) && (
              <button type="button" onClick={onStart} className="primary-button rounded-xl px-10 py-3 text-sm font-bold tracking-[0.2em] uppercase">&gt; {tab === 'story' ? 'Lancer le chapitre' : 'Lancer la partie'} ↵</button>
            )}
            <button type="button" onClick={onTutorial} className="glass-button rounded-xl px-5 py-3 text-xs font-semibold tracking-[0.12em] text-zinc-300">Aide / tutoriel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

