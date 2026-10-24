import { useCallback, useEffect, useRef, useState } from 'react'
import { aiHsvFrom, hsvToRgb, rgbToCss, type Hsv } from './game/colors'
import { audio } from './game/audio'
import { DIFFICULTIES, type Difficulty, type MatchFormat } from './game/constants'
import { GameEngine, type EngineState } from './game/engine'
import { music } from './game/music'
import { normalizeRoomCode } from './net/session'
import EndOverlay from './ui/EndOverlay'
import Hud from './ui/Hud'
import PauseOverlay from './ui/PauseOverlay'
import StartOverlay, { type GameModeTab } from './ui/StartOverlay'
import TutorialOverlay from './ui/TutorialOverlay'
import type { DailyChallenge, ReplayFrame } from './game/arcade'
import { getLoreEntry, LORE_ENTRIES, nextStoryChapter } from './game/lore'

const STORAGE_KEY = 'p1ng-p0ng-settings'
const NAME_KEY = 'p1ng-p0ng-name'
const HISTORY_KEY = 'p1ng-p0ng-history'
const LEADERBOARD_KEY = 'p1ng-p0ng-leaderboard'
const CHALLENGE_KEY = 'p1ng-p0ng-challenges'
const ACHIEVEMENT_KEY = 'p1ng-p0ng-achievements'
const STREAK_KEY = 'p1ng-p0ng-streak'
const LORE_KEY = 'p1ng-p0ng-lore'
const STORY_PROGRESS_KEY = 'p1ng-p0ng-story-progress'
interface LeaderEntry { name: string; score: number; date: string }
function loadLeaderboard(): Record<string, LeaderEntry[]> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY)
    return raw ? (JSON.parse(raw) as Record<string, LeaderEntry[]>) : {}
  } catch {
    return {}
  }
}
function saveLeaderboard(lb: Record<string, LeaderEntry[]>): void {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(lb))
  } catch {
    /* ignore */
  }
}
interface HistoryEntry {
  date: string
  mode: 'ai' | 'online'
  brickMode?: boolean
  format: string
  scorePlayer: number
  scoreAi: number
  result?: 'win' | 'loss' | 'draw'
  difficulty: string
  target: number
  challengeCode?: string
  contractComplete?: boolean
}
function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : []
  } catch {
    return []
  }
}
function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 20)))
  } catch {
    /* ignore */
  }
}
interface Settings {
  color: Hsv
  difficulty: Difficulty
  target: number
  /** Format de la manche : au nombre de points ou chronométré. */
  format: MatchFormat
  /** Durée d'une manche chronométrée (secondes). */
  duration: number
  /** Mode powerups. */
  powerups: boolean
  /** Mode casse-brique. */
  brickMode: boolean
  /** Thème visuel. */
  theme: number
  /** Orientation du terrain. */
  orientation: 'landscape' | 'portrait'
  muted: boolean
  musicMuted: boolean
  sensitivity: number
  reduceMotion: boolean
  highContrast: boolean
  glow: number
}

const DEFAULT_SETTINGS: Settings = {
  color: { h: 186, s: 0.95, v: 1 },
  difficulty: 'moyen',
  target: 11,
  format: 'points',
  duration: 180,
  powerups: false,
  brickMode: false,
  theme: 4,
  orientation: 'landscape',
  muted: false,
  musicMuted: false,
  sensitivity: 1,
  reduceMotion: typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
  highContrast: false,
  glow: 0.8,
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings> & { visualStyleVersion?: number }
    const difficulty = DIFFICULTIES.includes(parsed.difficulty as Difficulty)
      ? (parsed.difficulty as Difficulty)
      : DEFAULT_SETTINGS.difficulty
    return {
      color: { ...DEFAULT_SETTINGS.color, ...parsed.color },
      difficulty,
      target: typeof parsed.target === 'number' ? parsed.target : DEFAULT_SETTINGS.target,
      format: parsed.format === 'time' ? 'time' : 'points',
      duration: typeof parsed.duration === 'number' ? parsed.duration : DEFAULT_SETTINGS.duration,
      powerups: Boolean(parsed.powerups),
      brickMode: Boolean(parsed.brickMode),
      theme: parsed.visualStyleVersion === 2 && typeof parsed.theme === 'number'
        ? Math.max(0, Math.min(4, parsed.theme))
        : DEFAULT_SETTINGS.theme,
      orientation: parsed.brickMode || parsed.orientation === 'portrait' ? 'portrait' : 'landscape',
      muted: Boolean(parsed.muted),
      musicMuted: Boolean(parsed.musicMuted),
      sensitivity: typeof parsed.sensitivity === 'number' ? Math.min(1.5, Math.max(0.5, parsed.sensitivity)) : DEFAULT_SETTINGS.sensitivity,
      reduceMotion: typeof parsed.reduceMotion === 'boolean'
        ? parsed.reduceMotion
        : DEFAULT_SETTINGS.reduceMotion,
      highContrast: Boolean(parsed.highContrast),
      glow: typeof parsed.glow === 'number' ? parsed.glow : DEFAULT_SETTINGS.glow,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, visualStyleVersion: 2 }))
  } catch {
    /* stockage indisponible */
  }
}

/** Pseudo du joueur (persisté d'une session à l'autre). */
function loadName(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (localStorage.getItem(NAME_KEY) ?? '').slice(0, 18)
  } catch {
    return ''
  }
}

/** Paramètres d'invitation présents dans l'URL (?room=CODE&key=CLE). */
function readInviteParams(): { code: string; key: string } {
  if (typeof window === 'undefined') return { code: '', key: '' }
  const params = new URLSearchParams(window.location.search)
  return {
    code: normalizeRoomCode(params.get('room') ?? ''),
    key: params.get('key') ?? '',
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const [state, setState] = useState<EngineState | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [achievements, setAchievements] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY) ?? '[]') as string[] } catch { return [] }
  })
  const [dailyStreak, setDailyStreak] = useState<{ lastDate: string; count: number }>(() => {
    try { return JSON.parse(localStorage.getItem(STREAK_KEY) ?? '{"lastDate":"","count":0}') as { lastDate: string; count: number } }
    catch { return { lastDate: '', count: 0 } }
  })
  const [loreIds, setLoreIds] = useState<string[]>(() => {
    try { return Array.from(new Set(['boot', ...(JSON.parse(localStorage.getItem(LORE_KEY) ?? '[]') as string[])])) }
    catch { return ['boot'] }
  })
  const [latestLoreIds, setLatestLoreIds] = useState<string[]>([])
  const [storyCompleted, setStoryCompleted] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORY_PROGRESS_KEY) ?? '[]') as string[] } catch { return [] }
  })
  const storyChapter = nextStoryChapter(storyCompleted)
  const [challengeRecords, setChallengeRecords] = useState<Record<string, { best: number; contract: boolean; replay?: ReplayFrame[] }>>(() => {
    try { return JSON.parse(localStorage.getItem(CHALLENGE_KEY) ?? '{}') as Record<string, { best: number; contract: boolean; replay?: ReplayFrame[] }> }
    catch { return {} }
  })
  const [leaderboard, setLeaderboard] = useState<Record<string, LeaderEntry[]>>(loadLeaderboard)
  const [splash, setSplash] = useState(true)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [tab, setTab] = useState<GameModeTab>(() => settings.brickMode ? 'brick' : 'ai')
  const [invite] = useState(readInviteParams)
  const [inviteLink, setInviteLink] = useState('')
  const [playerName, setPlayerName] = useState(loadName)
  // Historique des parties
  const lastPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (!state) return
    if (state.phase === 'gameover' && lastPhaseRef.current !== 'gameover') {
      const localScore = state.side === 'left' ? state.scorePlayer : state.scoreAi
      const opponentScore = state.side === 'left' ? state.scoreAi : state.scorePlayer
      const result = state.trainingExercise
        ? state.winner === 'player' ? 'win' : 'loss'
        : state.survivalMode
          ? 'loss'
          : state.brickMode
        ? state.winner === 'player' ? 'win' : 'loss'
        : localScore === opponentScore ? 'draw' : localScore > opponentScore ? 'win' : 'loss'
      const entry: HistoryEntry = {
        date: new Date().toISOString(),
        mode: state.mode,
        brickMode: state.brickMode,
        format: state.brickMode ? 'bricks' : state.format,
        scorePlayer: state.brickMode ? state.bricksBroken : localScore,
        scoreAi: state.brickMode ? 0 : opponentScore,
        result,
        difficulty: state.difficulty,
        target: state.target,
        challengeCode: state.challenge?.code,
        contractComplete: state.contractComplete,
      }
      const earnedLore = ['handshake']
      if (result === 'win') earnedLore.push('mirror')
      if (state.brickMode && state.bricksBroken > 0) earnedLore.push('debris')
      if (state.matchStats.powerups > 0) earnedLore.push('anomaly')
      if (state.survivalMode) earnedLore.push('redline')
      if (state.localDuel || state.mode === 'online') earnedLore.push('two-console')
      if (state.challenge) earnedLore.push('beacon')
      if (state.storyMode && state.storyChapter && state.winner === 'player') earnedLore.push(state.storyChapter.loreUnlock)
      const discovered = new Set([...loreIds, ...earnedLore])
      const milestones = ['handshake', 'mirror', 'debris', 'anomaly', 'redline', 'two-console', 'beacon']
      if (milestones.filter((id) => discovered.has(id)).length >= 4) {
        earnedLore.push('origin')
        discovered.add('origin')
      }
      const freshLore = LORE_ENTRIES.filter((fragment) => earnedLore.includes(fragment.id) && !loreIds.includes(fragment.id))
      if (freshLore.length > 0) setLatestLoreIds(freshLore.map((fragment) => fragment.id))
      setLoreIds((previous) => {
        const next = Array.from(new Set([...previous, ...earnedLore]))
        try { localStorage.setItem(LORE_KEY, JSON.stringify(next.filter((id) => id !== 'boot'))) } catch { /* stockage indisponible */ }
        return next
      })
      if (state.storyMode && state.storyChapter && state.winner === 'player') {
        setStoryCompleted((previous) => {
          if (previous.includes(state.storyChapter!.id)) return previous
          const next = [...previous, state.storyChapter!.id]
          try { localStorage.setItem(STORY_PROGRESS_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
          return next
        })
      }
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, 20)
        saveHistory(next)
        return next
      })
      if (state.challenge) {
        setChallengeRecords((prev) => {
          const old = prev[state.challenge!.id] ?? { best: 0, contract: false }
          const isBest = localScore > old.best
          const updated = { ...prev, [state.challenge!.id]: { best: Math.max(old.best, localScore), contract: old.contract || state.contractComplete, replay: isBest || !old.replay?.length ? state.replayFrames : old.replay } }
          const next = Object.fromEntries(Object.entries(updated).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30)) as typeof updated
          try { localStorage.setItem(CHALLENGE_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
          return next
        })
        const today = new Date().toISOString().slice(0, 10)
        if (state.challenge.date === today) {
          setDailyStreak((previous) => {
            if (previous.lastDate === today) return previous
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
            const next = { lastDate: today, count: previous.lastDate === yesterday ? previous.count + 1 : 1 }
            try { localStorage.setItem(STREAK_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
            return next
          })
        }
      }
      const newBadges: string[] = []
      if (result === 'win') newBadges.push('first-win')
      if (state.matchStats.paddleHits >= 20) newBadges.push('rally-ace')
      if (state.matchStats.powerups >= 3) newBadges.push('collector')
      if (state.survivalMode && state.scorePlayer > 0) newBadges.push('survivor')
      if (state.brickMode && state.bricksBroken >= 20) newBadges.push('brick-breaker')
      if (state.challenge && state.contractComplete) newBadges.push('contract')
      if (history.length >= 9) newBadges.push('veteran')
      if (newBadges.length) setAchievements((previous) => {
        const next = Array.from(new Set([...previous, ...newBadges]))
        try { localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
        return next
      })
      if (state.mode === 'online' && state.roomCode) {
        setLeaderboard((prev) => {
          const code = state.roomCode
          const list = prev[code] ?? []
          const next = [
            { name: state.playerName || 'Toi', score: state.side === 'left' ? state.scorePlayer : state.scoreAi, date: new Date().toISOString() },
            { name: state.peerName || 'Adversaire', score: state.side === 'left' ? state.scoreAi : state.scorePlayer, date: new Date().toISOString() },
            ...list,
          ].slice(0, 20)
          const updated = { ...prev, [code]: next }
          saveLeaderboard(updated)
          return updated
        })
      }
    }
    lastPhaseRef.current = state.phase
  }, [state?.phase])
  useEffect(() => {
    if (state?.phase === 'playing') setLatestLoreIds([])
  }, [state?.phase])
  useEffect(() => {
    if (dailyStreak.count < 3) return
    setAchievements((previous) => {
      if (previous.includes('streak-3')) return previous
      const next = [...previous, 'streak-3']
      try { localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify(next)) } catch { /* stockage indisponible */ }
      return next
    })
  }, [dailyStreak.count])
  const playerNameRef = useRef(playerName)
  playerNameRef.current = playerName

  // Création du moteur (une seule fois)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const initial = settingsRef.current
    let engine: GameEngine
    try {
      engine = new GameEngine(canvas, {
        color: initial.color,
        difficulty: initial.difficulty,
        target: initial.target,
        format: initial.format,
        duration: initial.duration,
        powerups: initial.powerups,
        brickMode: initial.brickMode,
        orientation: initial.orientation,
        muted: initial.muted,
      })
    } catch (error) {
      console.error(error)
      return
    }
    engineRef.current = engine
    const unsubscribe = engine.subscribe(setState)
    engine.run()
    // Crochet de test : permet aux scripts de vérification d'inspecter l'état.
    ;(window as unknown as { __pingPong?: unknown }).__pingPong = { engine, audio, music }
    // Invitation reçue par URL : on rejoint le salon automatiquement.
    if (invite.code) {
      setTab('online')
      engine.joinOnlineRoom(invite.code, invite.key)
    }
    engine.setPlayerName(playerNameRef.current)
    return () => {
      unsubscribe()
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Démarre l'audio (effets + musique) au premier geste utilisateur
  useEffect(() => {
    const kick = () => audio.init()
    window.addEventListener('pointerdown', kick, { once: true })
    window.addEventListener('keydown', kick, { once: true })
    return () => {
      window.removeEventListener('pointerdown', kick)
      window.removeEventListener('keydown', kick)
    }
  }, [])

  // Synchronisation de l'accent visuel : couleur locale et couleur de l'adversaire
  useEffect(() => {
    const root = document.documentElement
    const remote = state?.peerColor ?? aiHsvFrom(settings.color)
    const ai = rgbToCss(hsvToRgb(remote.h, remote.s, remote.v))
    root.style.setProperty('--accent', '#c7edff')
    root.style.setProperty('--accent-ai', ai)
  }, [settings.color, state?.peerColor])

  // Persistance
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    engineRef.current?.setMuted(settings.muted)
  }, [settings.muted])

  useEffect(() => {
    music.setMuted(settings.musicMuted)
  }, [settings.musicMuted])

  useEffect(() => {
    engineRef.current?.setSensitivity(settings.sensitivity)
  }, [settings.sensitivity])

  useEffect(() => {
    const root = document.querySelector('.arcade-shell')
    root?.classList.toggle('reduce-motion', settings.reduceMotion)
    root?.classList.toggle('high-contrast', settings.highContrast)
  }, [settings.reduceMotion, settings.highContrast])

  // Intensité du glow (bloom + aberration chromatique)
  useEffect(() => {
    engineRef.current?.setRenderSettings({
      bloomIntensity: settings.glow,
      chromatic: settings.glow * 0.002,
      theme: settings.theme,
      reducedMotion: settings.reduceMotion,
    })
  }, [settings.glow, settings.theme, settings.reduceMotion])

  // Powerups / orientation / durée
  useEffect(() => {
    engineRef.current?.setPowerups(settings.powerups)
  }, [settings.powerups])
  useEffect(() => {
    engineRef.current?.setBrickMode(settings.brickMode)
  }, [settings.brickMode])
  useEffect(() => {
    engineRef.current?.setOrientation(settings.orientation)
  }, [settings.orientation])
  useEffect(() => {
    engineRef.current?.setDuration(settings.duration)
  }, [settings.duration])

  const handleColorChange = useCallback((h: number, s: number, v: number) => {
    setSettings((prev) => ({ ...prev, color: { h, s, v } }))
    engineRef.current?.setColor({ h, s, v })
  }, [])

  const handleColorCommit = useCallback(() => {
    const { color } = settingsRef.current
    audio.hue(color.h)
  }, [])

  /** Change le pseudo : il est transmis à l'adversaire. */
  const handleNameChange = useCallback((name: string) => {
    setPlayerName(name)
    engineRef.current?.setPlayerName(name)
  }, [])

  const handleCreateRoom = useCallback((publicRoom = false) => {
    audio.init()
    audio.click()
    const link = engineRef.current?.createOnlineRoom(publicRoom) ?? ''
    setInviteLink(link)
  }, [])

  /** L'hôte lance la rencontre en ligne. */
  const handleStartMatch = useCallback(() => {
    audio.init()
    engineRef.current?.startOnlineMatch()
  }, [])

  // Persistance du pseudo
  useEffect(() => {
    try {
      localStorage.setItem(NAME_KEY, playerName)
    } catch {
      /* stockage indisponible */
    }
  }, [playerName])

  const handleDifficulty = useCallback((difficulty: Difficulty) => {
    setSettings((prev) => ({ ...prev, difficulty }))
    engineRef.current?.setDifficulty(difficulty)
    audio.click()
  }, [])

  /** Change le format : au nombre de points, ou round chronométré. */
  const handleFormat = useCallback((format: MatchFormat, target: number, duration?: number) => {
    setSettings((prev) => ({ ...prev, format, target, duration: duration ?? prev.duration }))
    engineRef.current?.setFormat(format, target, duration ?? settingsRef.current.duration)
    audio.click()
  }, [])

  const handlePowerups = useCallback((enabled: boolean) => {
    setSettings((prev) => ({ ...prev, powerups: enabled }))
    engineRef.current?.setPowerups(enabled)
    audio.click()
  }, [])

  const handleModeTabChange = useCallback((nextTab: GameModeTab) => {
    setTab(nextTab)
    engineRef.current?.setArcadeChallenge(null)
    engineRef.current?.setStoryMode(null)
    engineRef.current?.setSurvivalMode(false)
    engineRef.current?.setLocalDuel(false)
    engineRef.current?.setTrainingExercise(null)
    const brickMode = nextTab === 'brick'
    setSettings((prev) => ({
      ...prev,
      brickMode,
      ...(brickMode ? { orientation: 'portrait' as const } : {}),
    }))
    audio.click()
  }, [])

  const handleOrientation = useCallback((orientation: 'landscape' | 'portrait') => {
    setSettings((prev) => ({ ...prev, orientation }))
    engineRef.current?.setOrientation(orientation)
    audio.click()
  }, [])

  const handleToggleMute = useCallback(() => {
    setSettings((prev) => {
      const muted = !prev.muted
      audio.setMuted(muted)
      return { ...prev, muted }
    })
  }, [])

  const handleToggleMusic = useCallback(() => {
    setSettings((prev) => ({ ...prev, musicMuted: !prev.musicMuted }))
  }, [])

  const handleFullscreen = useCallback(() => {
    const element = document.documentElement
    if (!document.fullscreenElement) {
      void element.requestFullscreen?.().catch(() => undefined)
    } else {
      void document.exitFullscreen?.().catch(() => undefined)
    }
  }, [])

  // ------------------------------------------------------------ En ligne

  const handleJoinRoom = useCallback(
    (code: string, key: string) => {
      audio.init()
      audio.click()
      engineRef.current?.joinOnlineRoom(code, key)
    },
    [],
  )

  const handleJoinSpectator = useCallback(
    (code: string, key: string) => {
      audio.init()
      audio.click()
      engineRef.current?.joinSpectatorRoom(code, key)
    },
    [],
  )

  const handleQuitRoom = useCallback(() => {
    audio.click()
    engineRef.current?.backToMenu()
    setInviteLink('')
    setTab('ai')
  }, [])

  // Rejoindre automatiquement quand l'URL contient une invitation
  useEffect(() => {
    if (!invite.code) return
    setTab('online')
  }, [invite.code])

  const online = state?.mode === 'online'

  return (
    <div className={`arcade-shell relative h-full w-full overflow-hidden${settings.reduceMotion ? ' reduce-motion' : ''}${settings.highContrast ? ' high-contrast' : ''}`}>
      {splash && (
        <div
          className="terminal-backdrop startup-splash absolute inset-0 z-50 flex flex-col items-center justify-center"
        >
          <div className="terminal-bar absolute top-6 right-6 left-6 border-0 sm:top-8 sm:right-10 sm:left-10">
            <span>P1NG-P0NG // système d’arcade</span>
            <span className="terminal-status">Prêt</span>
          </div>
          <h1 className="ping-title text-7xl font-extrabold tracking-tight sm:text-8xl">
            P<span className="brand-dark-digit">1</span>NG-P<span className="brand-dark-digit">0</span>NG
          </h1>
          <p className="mt-4 text-[10px] tracking-[0.42em] text-zinc-500 uppercase">Terminal de jeu // pong</p>
          <button
            type="button"
            onClick={() => setSplash(false)}
            id="start-splash"
            className="start-word mt-12 px-6 py-3"
          >
            START
          </button>
        </div>
      )}
      <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" />

      {!state && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#05060a] text-sm tracking-[0.3em] text-zinc-600 uppercase">
          Initialisation du moteur…
        </div>
      )}

      {state && state.phase !== 'menu' && (
        <Hud
          state={state}
          onTogglePause={() => {
            audio.click()
            engineRef.current?.togglePause()
  }}
          onRestart={() => {
            audio.click()
            engineRef.current?.restart()
          }}
          onToggleMute={handleToggleMute}
          musicMuted={settings.musicMuted}
          onToggleMusic={handleToggleMusic}
          onFullscreen={handleFullscreen}
          onMenu={() => {
            audio.click()
            if (online) {
              engineRef.current?.backToMenu()
              setTab('ai')
            } else {
              engineRef.current?.backToMenu()
            }
          }}
          onTouchDirection={(direction, active) => engineRef.current?.setTouchDirection(direction, active)}
        />
      )}

      {state?.phase === 'menu' && (
        <StartOverlay
          state={state}
          tab={tab}
          onTabChange={handleModeTabChange}
          onStart={() => {
            audio.init()
            audio.click()
            if (tab === 'story' && storyChapter) {
              setSettings((previous) => ({ ...previous, difficulty: storyChapter.difficulty, target: storyChapter.target, format: 'points', powerups: storyChapter.powerups, brickMode: false, orientation: 'landscape' }))
              engineRef.current?.setStoryMode(storyChapter)
            }
            engineRef.current?.start()
          }}
          onColorChange={handleColorChange}
          onColorCommit={handleColorCommit}
          onDifficulty={handleDifficulty}
          onFormat={handleFormat}
          powerups={settings.powerups}
          onPowerups={handlePowerups}
          theme={settings.theme}
          onTheme={(t) => setSettings((prev) => ({ ...prev, theme: t }))}
          orientation={settings.orientation}
          onOrientation={handleOrientation}
          duration={settings.duration}
          onGlow={(value) => setSettings((prev) => ({ ...prev, glow: value }))}
          glow={settings.glow}
          inviteLink={inviteLink}
          netMessage={state.netMessage}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onJoinSpectator={handleJoinSpectator}
          onQuitRoom={handleQuitRoom}
          roomCode={state.roomCode}
          initialCode={invite.code}
          initialKey={invite.key}
          playerName={playerName}
          peerName={state.peerName}
          history={history}
          leaderboard={state.roomCode ? (leaderboard[state.roomCode] ?? []) : []}
          canStart={state.mode === 'online' && state.side === 'left' && state.peerConnected}
          onNameChange={handleNameChange}
          onStartMatch={handleStartMatch}
          musicMuted={settings.musicMuted}
          onToggleMusic={handleToggleMusic}
          onToggleEffects={handleToggleMute}
          sensitivity={settings.sensitivity}
          onSensitivity={(value) => {
            setSettings((prev) => ({ ...prev, sensitivity: value }))
            engineRef.current?.setSensitivity(value)
          }}
          reduceMotion={settings.reduceMotion}
          onReduceMotion={(value) => setSettings((prev) => ({ ...prev, reduceMotion: value }))}
          highContrast={settings.highContrast}
          onHighContrast={(value) => setSettings((prev) => ({ ...prev, highContrast: value }))}
          onTutorial={() => setTutorialOpen(true)}
          onDailyChallenge={(challenge: DailyChallenge | null) => {
            if (challenge) {
              engineRef.current?.setBrickMode(false)
              engineRef.current?.setOrientation('landscape')
              engineRef.current?.setPowerups(false)
            }
            engineRef.current?.setArcadeChallenge(challenge, challenge ? (challengeRecords[challenge.id]?.replay ?? []) : [])
            if (challenge) {
              setTab('ai')
              setSettings((prev) => ({ ...prev, difficulty: challenge.difficulty, target: challenge.target, format: 'points', powerups: false, brickMode: false, orientation: 'landscape' }))
              const record = challengeRecords[challenge.id]
              const suffix = record ? ` // RECORD LOCAL ${record.best} POINTS · CONTRATS ${record.contract ? 'VALIDÉ' : 'NON VALIDÉ'}` : ''
              // Retour affiché dans le terminal au prochain rendu par son état de défi.
              console.info(`Défi ${challenge.code}${suffix}`)
            }
          }}
          challengeRecord={state.challenge ? {
            best: challengeRecords[state.challenge.id]?.best ?? 0,
            contract: challengeRecords[state.challenge.id]?.contract ?? false,
            hasReplay: !!challengeRecords[state.challenge.id]?.replay?.length,
          } : undefined}
          achievements={achievements}
          dailyStreak={dailyStreak.count}
          unlockedThemes={[0, 1, 2, 3, 4, ...(achievements.includes('first-win') ? [5] : []), ...(achievements.includes('streak-3') ? [6] : [])]}
          onSurvival={(enabled) => {
            if (enabled) {
              engineRef.current?.setBrickMode(false)
              engineRef.current?.setOrientation('landscape')
            }
            engineRef.current?.setArcadeChallenge(null)
            engineRef.current?.setSurvivalMode(enabled)
            if (enabled) {
              setTab('ai')
              setSettings((prev) => ({ ...prev, difficulty: 'facile', target: 99, format: 'points', powerups: false, brickMode: false, orientation: 'landscape' }))
            }
          }}
          onLocalDuel={(enabled) => {
            if (enabled) {
              engineRef.current?.setBrickMode(false)
              engineRef.current?.setOrientation('landscape')
            }
            engineRef.current?.setArcadeChallenge(null)
            engineRef.current?.setLocalDuel(enabled)
            if (enabled) {
              setTab('ai')
              setSettings((prev) => ({ ...prev, brickMode: false, orientation: 'landscape' }))
            }
          }}
          onTrainingExercise={(exercise) => {
            if (exercise) {
              engineRef.current?.setBrickMode(false)
              engineRef.current?.setOrientation('landscape')
            }
            engineRef.current?.setArcadeChallenge(null)
            engineRef.current?.setTrainingExercise(exercise)
            if (exercise) {
              setTab('ai')
              setSettings((prev) => ({ ...prev, difficulty: 'facile', target: 99, format: 'points', powerups: false, brickMode: false, orientation: 'landscape' }))
            }
          }}
          loreIds={loreIds}
          storyChapter={storyChapter}
          storyCompleted={storyCompleted}
          onStoryMode={(chapter) => engineRef.current?.setStoryMode(chapter)}
        />
      )}

      {tutorialOpen && state?.phase === 'menu' && (
        <TutorialOverlay
          onClose={() => setTutorialOpen(false)}
          startLabel={tab === 'online' ? 'Retour au salon' : 'Lancer une partie'}
          onStart={() => {
            setTutorialOpen(false)
            if (tab === 'online') return
            audio.init()
            if (tab === 'story' && storyChapter) {
              setSettings((previous) => ({ ...previous, difficulty: storyChapter.difficulty, target: storyChapter.target, format: 'points', powerups: storyChapter.powerups, brickMode: false, orientation: 'landscape' }))
              engineRef.current?.setStoryMode(storyChapter)
            }
            engineRef.current?.start()
          }}
        />
      )}

      {state?.phase === 'paused' && (
        <PauseOverlay
          onResume={() => {
            audio.click()
            engineRef.current?.resume()
          }}
          onRestart={() => {
            audio.click()
            engineRef.current?.restart()
          }}
          onMenu={() => {
            audio.click()
            engineRef.current?.backToMenu()
          }}
        />
      )}

      {state?.phase === 'gameover' && (
        <EndOverlay
          state={state}
          storyChapter={state.storyChapter}
          nextStoryChapter={state.storyMode && state.winner === 'player' ? nextStoryChapter(storyCompleted) : null}
          loreReveals={latestLoreIds.flatMap((id) => {
            const entry = getLoreEntry(id)
            return entry ? [entry] : []
          })}
          onRestart={() => {
            audio.click()
            engineRef.current?.restart()
          }}
          onMenu={() => {
            audio.click()
            engineRef.current?.setStoryMode(null)
            engineRef.current?.backToMenu()
            setTab('ai')
          }}
        />
      )}
    </div>
  )
}
