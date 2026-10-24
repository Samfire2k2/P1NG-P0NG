import type { PowerupType } from './world'

export const POWERUP_INFO: Record<PowerupType, { label: string; description: string }> = {
  speed: { label: 'Accélération', description: 'La balle accélère.' },
  slow: { label: 'Ralentissement', description: 'La balle ralentit.' },
  grow: { label: 'Raquette agrandie', description: 'Agrandit ta raquette.' },
  shrink: {
    label: 'Raquette réduite',
    description: 'Rétrécit la raquette adverse, ou la tienne en casse-brique.',
  },
  multiball: { label: 'Multi-balle', description: 'Ajoute une balle, jusqu’à quatre en jeu.' },
  shield: { label: 'Bouclier activé', description: 'Protège ta raquette du prochain but.' },
  teleport: { label: 'Téléportation', description: 'Envoie la balle de l’autre côté du terrain.' },
  magnet: { label: 'Aimant activé', description: 'Attire brièvement la balle vers une raquette.' },
  ghost: { label: 'Balle fantôme', description: 'La balle devient presque invisible un instant.' },
  double: { label: 'Double raquette', description: 'Ajoute une deuxième raquette.' },
}
