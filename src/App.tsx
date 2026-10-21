import { useCallback, useEffect, useRef, useState } from 'react'
import { aiColorFrom, hsvToRgb, rgbToCss, type Hsv } from './game/colors'
import { audio } from './game/audio'
import { DIFFICULTIES, type Difficulty } from './game/constants'
import { GameEngine, type EngineState } from './game/engine'
import { normalizeRoomCode } from './net/session'
import EndOverlay from './ui/EndOverlay'
import Hud from './ui/Hud'
import PauseOverlay from './ui/PauseOverlay'
import StartOverlay, { type GameModeTab } from './ui/StartOverlay'

const STORAGE_KEY = 'p1ng-p0ng-settings'

interface Settings {
  color: Hsv
  difficulty: Difficulty
  target: number
  muted: boolean
  glow: number
}

const DEFAULT_SETTINGS: Settings = {
  color: { h: 186, s: 0.95, v: 1 },
  difficulty: 'moyen',
  target: 11,
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
  const [tab, setTab] = useState<GameModeTab>('ai')
  const [invite] = useState(readInviteParams)
  const [inviteLink, setInviteLink] = useState('')
  const settingsRef = useRef(settings)
  settingsRef.current = settings

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
    ;(window as unknown as { __pingPong?: unknown }).__pingPong = { engine, audio }
    // Invitation reçue par URL : on rejoint le salon automatiquement.
    if (invite.code) {
      setTab('online')
      engine.joinOnlineRoom(invite.code, invite.key)
    }
    return () => {
      unsubscribe()
      engine.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Synchronisation de l'accent visuel avec la couleur choisie
  useEffect(() => {
    const root = document.documentElement
    const player = rgbToCss(hsvToRgb(settings.color.h, settings.color.s, settings.color.v))
    const ai = rgbToCss(aiColorFrom(settings.color))
    root.style.setProperty('--accent', player)
    root.style.setProperty('--accent-ai', ai)
  }, [settings.color])

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
    })
  }, [settings.glow])

  const handleColorChange = useCallback((h: number, s: number, v: number) => {
    setSettings((prev) => ({ ...prev, color: { h, s, v } }))
    engineRef.current?.setColor({ h, s, v })
  }, [])

  const handleColorCommit = useCallback(() => {
    const { color } = settingsRef.current
    audio.hue(color.h)
  }, [])

  const handleDifficulty = useCallback((difficulty: Difficulty) => {
    setSettings((prev) => ({ ...prev, difficulty }))
    engineRef.current?.setDifficulty(difficulty)
    audio.click()
  }, [])

  const handleTarget = useCallback((target: number) => {
    setSettings((prev) => ({ ...prev, target }))
    engineRef.current?.setTarget(target)
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

  const handleCreateRoom = useCallback(() => {
    audio.init()
    audio.click()
    const link = engineRef.current?.createOnlineRoom() ?? ''
    setInviteLink(link)
  }, [])

  const handleJoinRoom = useCallback(
    (code: string, key: string) => {
      audio.init()
      audio.click()
      engineRef.current?.joinOnlineRoom(code, key)
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
          onTabChange={setTab}
          onStart={() => {
            audio.init()
            audio.click()
            engineRef.current?.start()
          }}
          onColorChange={handleColorChange}
          onColorCommit={handleColorCommit}
          onDifficulty={handleDifficulty}
          onTarget={handleTarget}
          onGlow={(value) => setSettings((prev) => ({ ...prev, glow: value }))}
          glow={settings.glow}
          inviteLink={inviteLink}
          netMessage={state.netMessage}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuitRoom={handleQuitRoom}
          roomCode={state.roomCode}
          initialCode={invite.code}
          initialKey={invite.key}
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
