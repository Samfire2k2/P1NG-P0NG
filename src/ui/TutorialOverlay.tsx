import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { POWERUP_INFO } from '../game/powerups'
import { POWERUP_TYPES } from '../game/world'

interface TutorialOverlayProps {
  onClose: () => void
  onStart: () => void
  startLabel?: string
}

const STEPS = [
  { title: 'Bienvenue dans l’arène', text: 'P1NG-P0NG se joue en duel contre l’IA ou un autre joueur. En casse-brique, renvoie la balle dans le mur et rattrape-la : tu as trois vies.' },
  { title: 'Déplace ta raquette', text: 'À la souris, déplace le curseur sur le terrain. Sur écran tactile, fais glisser le doigt ou maintiens les boutons fléchés. Tu peux aussi utiliser ZQSD ou les flèches du clavier.' },
  { title: 'Lis les bonus', text: 'Quand les bonus sont activés, attrape les capsules colorées pour appliquer leur effet. Voici leur fonction :' },
  { title: 'Suis la manche', text: 'Le score, le temps et l’état de connexion restent visibles pendant la partie. En casse-brique, surveille tes vies et les briques restantes. Mets le jeu en pause à tout moment.' },
]

export default function TutorialOverlay({ onClose, onStart, startLabel = 'Jouer' }: TutorialOverlayProps) {
  const [step, setStep] = useState(0)
  const [paddlePosition, setPaddlePosition] = useState(50)
  const [controlTried, setControlTried] = useState(false)
  const last = step === STEPS.length - 1

  const moveDemoPaddle = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setPaddlePosition(Math.max(8, Math.min(92, ((event.clientY - rect.top) / rect.height) * 100)))
    setControlTried(true)
  }

  return (
    <div className="terminal-backdrop absolute inset-0 z-40 flex items-center justify-center overflow-y-auto p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <section className="terminal-panel my-4 w-full max-w-xl p-5 sm:p-7">
        <div className="terminal-bar mb-5">
          <span>Programme d’entraînement // étape {step + 1}/{STEPS.length}</span>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Fermer le tutoriel">Fermer ×</button>
        </div>
        <div className="mb-5 flex gap-1.5" aria-hidden="true">
          {STEPS.map((item, index) => <span key={item.title} className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]' : 'bg-white/10'}`} />)}
        </div>
        <h2 id="tutorial-title" className="ping-title text-2xl font-bold sm:text-3xl">{STEPS[step].title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">{STEPS[step].text}</p>

        {step === 1 && (
          <div className="mt-5">
            <div
              className="relative h-48 overflow-hidden rounded-lg border border-[var(--accent)]/30 bg-[#050b12] touch-none"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                moveDemoPaddle(event)
              }}
              onPointerMove={(event) => { if (event.buttons > 0 || event.pointerType === 'touch') moveDemoPaddle(event) }}
              aria-label="Zone de démonstration : fais glisser pour déplacer la raquette"
            >
              <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/10" />
              <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_white]" />
              <div className="absolute left-5 h-12 w-2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-[0_0_14px_var(--accent)]" style={{ top: `${paddlePosition}%` }} />
              <div className="absolute right-5 top-1/2 h-12 w-2 -translate-y-1/2 rounded-full bg-pink-400/80 shadow-[0_0_12px_#f472b6]" />
              <div className="absolute right-2 bottom-2 text-[8px] tracking-[0.2em] text-zinc-600 uppercase">Zone de test</div>
            </div>
            <p className={`mt-2 text-[10px] ${controlTried ? 'text-emerald-300' : 'text-zinc-500'}`} role="status">
              {controlTried ? 'Contrôle testé : la raquette suit ton mouvement.' : 'Fais glisser le pointeur ou ton doigt dans la zone.'}
            </p>
          </div>
        )}

        {step === 2 && (
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {POWERUP_TYPES.map((type) => (
              <li key={type} className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <div className="text-xs font-bold text-[var(--accent)]">{POWERUP_INFO[type].label}</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">{POWERUP_INFO[type].description}</div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-7 flex flex-wrap justify-between gap-2">
          <button type="button" onClick={onClose} className="glass-button rounded-lg px-4 py-2.5 text-xs text-zinc-300">Retour au menu</button>
          <div className="flex gap-2">
            {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="glass-button rounded-lg px-4 py-2.5 text-xs text-zinc-300">Précédent</button>}
            {last ? (
              <button type="button" onClick={onStart} className="primary-button rounded-lg px-5 py-2.5 text-xs font-bold tracking-wider uppercase">{startLabel}</button>
            ) : (
              <button type="button" onClick={() => setStep((current) => current + 1)} className="primary-button rounded-lg px-5 py-2.5 text-xs font-bold tracking-wider uppercase">Suivant</button>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
