import type { StoryIllustrationKind } from '../game/lore'

const LABELS: Record<StoryIllustrationKind, string> = {
  relay: 'Relais lunaire NACRE-7 et sa balise',
  echo: 'Deux raquettes se répondent par impulsions',
  archive: 'Fragments de mémoire autour du canal',
  anomaly: 'Paquet de données instable',
  origin: 'Un signal inconnu rejoint le relais',
}

export default function StoryIllustration({ kind, className = '' }: { kind: StoryIllustrationKind; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-cyan-100/10 bg-[#06101b] ${className}`}>
      <svg viewBox="0 0 360 150" className="block h-auto w-full" role="img" aria-label={LABELS[kind]}>
        <defs>
          <linearGradient id="story-sky" x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#0d2440" stopOpacity=".65" />
            <stop offset="1" stopColor="#030811" />
          </linearGradient>
          <linearGradient id="story-beam" x1="0" x2="1">
            <stop stopColor="#56cfff" stopOpacity=".05" />
            <stop offset=".5" stopColor="#a5edff" stopOpacity=".8" />
            <stop offset="1" stopColor="#56cfff" stopOpacity=".05" />
          </linearGradient>
          <filter id="story-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id="story-grid" width="18" height="18" patternUnits="userSpaceOnUse">
            <path d="M18 0H0V18" fill="none" stroke="#8bdcff" strokeOpacity=".08" strokeWidth=".6" />
          </pattern>
        </defs>
        <rect width="360" height="150" fill="url(#story-sky)" />
        <rect width="360" height="150" fill="url(#story-grid)" />
        <path d="M18 122H342" stroke="#76dcff" strokeOpacity=".25" />
        <text x="18" y="22" fill="#99ddf2" fillOpacity=".62" fontFamily="monospace" fontSize="8" letterSpacing="2">NACRE-7 // VISUALISATION DU SIGNAL</text>

        {kind === 'relay' && <g fill="none" stroke="#70d8ff" filter="url(#story-glow)">
          <circle cx="180" cy="86" r="35" fill="#174c72" fillOpacity=".4" strokeWidth="1.4" />
          <path d="M147 94q33 18 66-2M151 70q28 15 58 0" strokeOpacity=".6" />
          <path d="M172 53l17-15 13 7-5 15M188 45l-7-11m16 17 12-4" strokeWidth="2" />
          <path d="M208 49q31 16 47 37M214 43q43 13 62 38" strokeOpacity=".6" />
          <circle cx="280" cy="79" r="3" fill="#d8f7ff" />
          <path d="M70 83q20-24 42 0t42 0" stroke="url(#story-beam)" strokeWidth="2" />
        </g>}

        {kind === 'echo' && <g filter="url(#story-glow)">
          <rect x="54" y="56" width="8" height="46" rx="4" fill="#60d8ff" />
          <rect x="298" y="56" width="8" height="46" rx="4" fill="#ff6bc7" />
          <circle cx="181" cy="77" r="6" fill="#f4fbff" />
          <path d="M70 79h93m34 0h92" stroke="url(#story-beam)" strokeWidth="1.5" />
          <path d="M94 52q18 27 0 54m171-54q-18 27 0 54" fill="none" stroke="#8ce4ff" strokeOpacity=".6" />
          <path d="M115 62q11 17 0 34m129-34q-11 17 0 34" fill="none" stroke="#8ce4ff" strokeOpacity=".35" />
          <text x="44" y="117" fill="#84dcff" fontFamily="monospace" fontSize="8">OPÉRATEUR</text>
          <text x="281" y="117" fill="#ff88d1" fontFamily="monospace" fontSize="8">M-17</text>
        </g>}

        {kind === 'archive' && <g filter="url(#story-glow)" stroke="#85dfff" strokeOpacity=".8" fill="#163c59">
          <path d="M65 52h37v27H65zM111 43h30v36h-30zM146 58h44v21h-44zM197 44h35v35h-35zM240 56h50v23h-50z" />
          <path d="M80 86h50v23H80zM140 87h29v22h-29zM181 87h61v22h-61zM252 87h39v22h-39z" fill="#0d263c" />
          <path d="M102 65l9 8m30-25 8 8m82 4 14-10m-84 47 9-9" stroke="#d5f6ff" strokeWidth="2" />
          <path d="M33 121h294" fill="none" stroke="#66d6ff" />
        </g>}

        {kind === 'anomaly' && <g fill="none" filter="url(#story-glow)">
          <path d="M37 78h46l15-28 19 54 18-37 17 18h29" stroke="#71dfff" strokeWidth="2" />
          <path d="M181 85h28l13-35 20 55 18-27 15 7h48" stroke="#e5a2ff" strokeWidth="2" />
          <rect x="155" y="58" width="50" height="42" rx="5" stroke="#e1bdff" strokeWidth="1.5" fill="#9c54d2" fillOpacity=".16" transform="rotate(8 180 79)" />
          <path d="M166 72h28m-21 11h16" stroke="#f1d5ff" strokeWidth="2" />
          <circle cx="180" cy="79" r="40" stroke="#cb8cff" strokeOpacity=".35" strokeDasharray="3 6" />
        </g>}

        {kind === 'origin' && <g filter="url(#story-glow)">
          <path d="M35 82h67l14-18 12 36 13-20h71l14-15 13 30 14-13h73" fill="none" stroke="#79ddff" strokeWidth="2" />
          <circle cx="180" cy="81" r="36" fill="#12517a" fillOpacity=".13" stroke="#7de3ff" strokeOpacity=".55" />
          <circle cx="180" cy="81" r="5" fill="#e8fbff" />
          <path d="M180 35v-9m0 110v-9m-46-46h-9m110 0h-9" stroke="#b5efff" strokeWidth="2" />
          <path d="M178 81q-34-43-71-4m75 4q34 43 71 4" fill="none" stroke="#d2f6ff" strokeOpacity=".7" strokeDasharray="4 5" />
          <text x="132" y="137" fill="#c4f2ff" fontFamily="monospace" fontSize="8" letterSpacing="1">NOUVELLE SIGNATURE</text>
        </g>}
      </svg>
    </div>
  )
}
