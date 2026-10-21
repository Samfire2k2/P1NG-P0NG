import { useState } from 'react'
import type { NetStatus } from '../net/session'
import { IconHome, IconPlay, IconTrophy } from './icons'

interface OnlineLobbyProps {
  status: NetStatus
  roomCode: string
  inviteLink: string
  message: string
  peerConnected: boolean
  initialCode: string
  initialKey: string
  playerName: string
  peerName: string
  canStart: boolean
  onNameChange: (name: string) => void
  onStartMatch: () => void
  onCreate: () => void
  onJoin: (code: string, key: string) => void
  onQuit: () => void
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  )
}

/** Champ de pseudo : partagé par les deux joueurs. */
function NameField({
  value,
  onChange,
}: {
  value: string
  onChange: (name: string) => void
}) {
  return (
    <div className="mb-4">
      <label
        htmlFor="player-name"
        className="mb-2 block text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase"
      >
        Ton pseudo
      </label>
      <input
        id="player-name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={18}
        placeholder="ex. Nova"
        autoComplete="off"
        spellCheck={false}
        className="font-mono-game w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white outline-none focus:border-[var(--accent)]"
        aria-label="Ton pseudo"
      />
    </div>
  )
}

export default function OnlineLobby({
  status,
  roomCode,
  inviteLink,
  message,
  peerConnected,
  initialCode,
  initialKey,
  playerName,
  peerName,
  canStart,
  onNameChange,
  onStartMatch,
  onCreate,
  onJoin,
  onQuit,
}: OnlineLobbyProps) {
  const [code, setCode] = useState(initialCode)
  const [key, setKey] = useState(initialKey)
  const [copied, setCopied] = useState(false)

  const waiting = status === 'waiting' || status === 'connecting'
  const connected = status === 'connected' || peerConnected

  let content: React.ReactNode = null

  if (waiting) {
    content = (
      <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
          <Spinner />
          {status === 'connecting' ? 'Connexion…' : 'En attente d’un joueur'}
        </div>

        {roomCode && (
          <div className="mt-4 text-center">
            <div className="text-[10px] tracking-[0.3em] text-zinc-600 uppercase">Code du salon</div>
            <div
              className="font-mono-game ping-title mt-1 text-4xl font-bold tracking-[0.3em]"
              style={{ color: 'var(--accent)' }}
            >
              {roomCode}
            </div>
          </div>
        )}

        {inviteLink && (
          <div className="mt-4 flex gap-2">
            <input
              readOnly
              value={inviteLink}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono-game min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-zinc-400 outline-none focus:border-[var(--accent)]"
              aria-label="Lien d'invitation"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteLink)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              }}
              className="glass-button shrink-0 rounded-lg px-3 py-2 text-[11px] font-semibold text-zinc-300"
            >
              {copied ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
          Envoie le lien, ou le code et la clé. Ton adversaire n’aura qu’à cliquer.
        </p>

        <button
          type="button"
          onClick={onQuit}
          className="glass-button mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-300"
        >
          <IconHome className="h-3.5 w-3.5" />
          Quitter le salon
        </button>
      </div>
    )
  } else if (connected) {
    content = (
      <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.06] p-5 text-center">
        <IconTrophy className="mx-auto h-6 w-6" style={{ color: 'var(--accent)' }} />
        <p className="mt-2 text-sm font-semibold text-white">
          {peerName ? `${peerName} est connecté` : 'Adversaire connecté'}
        </p>
        <p className="mt-1 text-[11px] text-zinc-500">{message || 'La partie commence…'}</p>
        {canStart ? (
          <button
            type="button"
            onClick={onStartMatch}
            className="primary-button mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold tracking-[0.2em] uppercase"
          >
            <IconPlay className="h-4 w-4" />
            Lancer la partie
          </button>
        ) : (
          <p className="mt-4 text-[11px] tracking-[0.2em] text-zinc-500 uppercase">
            En attente du lancement…
          </p>
        )}
      </div>
    )
  } else if (status === 'closed' || status === 'error') {
    content = (
      <div className="rounded-2xl border border-rose-400/25 bg-rose-500/[0.06] p-5 text-center">
        <p className="text-sm font-semibold text-rose-200">
          {status === 'closed' ? 'Partie interrompue' : 'Connexion impossible'}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          {message || 'Vérifie le code et la clé, puis réessaie.'}
        </p>
        <button
          type="button"
          onClick={onQuit}
          className="glass-button mt-4 w-full rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-300"
        >
          Retour
        </button>
      </div>
    )
  } else {
    content = (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onCreate}
          className="primary-button flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold tracking-[0.2em] uppercase"
        >
          <IconPlay className="h-4 w-4" />
          Créer un salon
        </button>

        <div className="relative flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-[10px] tracking-[0.3em] text-zinc-600 uppercase">ou</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
          <div className="mb-2 text-[10px] font-semibold tracking-[0.3em] text-zinc-500 uppercase">
            Rejoindre un salon
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={8}
            className="font-mono-game w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-sm tracking-[0.3em] text-white outline-none focus:border-[var(--accent)]"
            aria-label="Code du salon"
          />
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Clé (optionnelle)"
            className="font-mono-game mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white outline-none focus:border-[var(--accent)]"
            aria-label="Clé du salon"
          />
          <button
            type="button"
            onClick={() => onJoin(code.trim(), key.trim())}
            disabled={code.trim().length < 3}
            className="glass-button mt-3 w-full rounded-xl px-4 py-2.5 text-xs font-semibold text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Rejoindre
          </button>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
            Le lien contient le code <em>et</em> la clé : colle l’URL complète et les deux champs se
            remplissent tout seuls.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <NameField value={playerName} onChange={onNameChange} />
      {content}
    </div>
  )
}
