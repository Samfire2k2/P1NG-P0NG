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

const STORAGE_KEY = 'p1ng-p0ng-settings'
const NAME_KEY = 'p1ng-p0ng-name'
const HISTORY_KEY = 'p1ng-p0ng-history'
const LEADERBOARD_KEY = 'p1ng-p0ng-leaderboard'
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
  format: string
  scorePlayer: number
  scoreAi: number
  difficulty: string
  target: number
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
  theme: 0,
  orientation: 'landscape',
  muted: false,
  glow: 1,
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
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
      theme: typeof parsed.theme === 'number' ? parsed.theme : 0,
      orientation: parsed.orientation === 'portrait' ? 'portrait' : 'landscape',
      muted: Boolean(parsed.muted),
      glow: typeof parsed.glow === 'number' ? parsed.glow : DEFAULT_SETTINGS.glow,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
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
  const [leaderboard, setLeaderboard] = useState<Record<string, LeaderEntry[]>>(loadLeaderboard)
  const [splash, setSplash] = useState(true)
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
      const entry: HistoryEntry = {
        date: new Date().toISOString(),
        mode: state.mode,
        format: state.format,
        scorePlayer: state.scorePlayer,
        scoreAi: state.scoreAi,
        difficulty: state.difficulty,
        target: state.target,
      }
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, 20)
        saveHistory(next)
        return next
      })
      if (state.mode === 'online' && state.roomCode) {
        setLeaderboard((prev) => {
          const code = state.roomCode
          const list = prev[code] ?? []
          const next = [
            { name: state.playerName || 'Toi', score: state.scorePlayer, date: new Date().toISOString() },
            { name: state.peerName || 'Adversaire', score: state.scoreAi, date: new Date().toISOString() },
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
    const player = rgbToCss(hsvToRgb(settings.color.h, settings.color.s, settings.color.v))
    const remote = state?.peerColor ?? aiHsvFrom(settings.color)
    const ai = rgbToCss(hsvToRgb(remote.h, remote.s, remote.v))
    root.style.setProperty('--accent', player)
    root.style.setProperty('--accent-ai', ai)
  }, [settings.color, state?.peerColor])

  // Écran de démarrage (logo)
  useEffect(() => {
    const t = window.setTimeout(() => setSplash(false), 2200)
    return () => window.clearTimeout(t)
  }, [])
  
  // Ajout d'un bouton START au splash screen - user can click to start
  useEffect(() => {
    const startBtn = document.getElementById('start-splash')
    if (startBtn) {
      startBtn.addEventListener('click', () => setSplash(false))
    }
  }, [])

  // Persistance
  useEffect(() => {
    saveSettings(settings)
    engineRef.current?.setMuted(settings.muted)
  }, [settings])

  // Intensité du glow (bloom + aberration chromatique)
  useEffect(() => {
    engineRef.current?.setRenderSettings({
      bloomIntensity: settings.glow,
      chromatic: 0.0008 + settings.glow * 0.0012,
      theme: settings.theme,
    })
  }, [settings.glow, settings.theme])

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
    const brickMode = nextTab === 'brick'
    setSettings((prev) => ({ ...prev, brickMode }))
    engineRef.current?.setBrickMode(brickMode)
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
    <div className="relative h-full w-full overflow-hidden bg-[#05060a]">
      {splash && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#05060a] cursor-pointer"
          onClick={() => setSplash(false)}
        >
          <h1 className="ping-title text-7xl font-extrabold tracking-tight sm:text-8xl">
            P1NG-P0NG
          </h1>
          <p className="mt-4 text-sm tracking-[0.4em] text-zinc-500 uppercase">pong néon</p>
          <button
            className="mt-8 rounded bg-[var(--accent)] px-6 py-2 text-white font-medium hover:bg-opacity-90 transition-colors shadow-lg"
            onClick={() => setSplash(false)}
            id="start-splash"
          >
            <span className="relative inline-block" style={{ textShadow: '0 0 10px rgba(255,255,255,0.8)' }}>START</span>
          </button>
        </div>
      )}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

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
          onRestart={() => {
            audio.click()
            engineRef.current?.restart()
          }}
          onMenu={() => {
            audio.click()
            engineRef.current?.backToMenu()
            setTab('ai')
          }}
        />
      )}
    </div>
  )
}
