/**
 * Constantes globales du jeu. Unités = "world units" (champ 1600x900).
 */

export const FIELD_WIDTH = 1600
export const FIELD_HEIGHT = 900

export const PADDLE_WIDTH = 20
export const PADDLE_HEIGHT = 132
export const PLAYER_MARGIN = 96
export const AI_MARGIN = 96

/** Vitesse max du paddle joueur (unités/s) — quasi instantanée. */
export const PLAYER_MAX_SPEED = 1900
/** Vitesse max de base des paddles IA (multipliée par la difficulty). */
export const AI_BASE_MAX_SPEED = 980

export const BALL_RADIUS = 12
export const BALL_START_SPEED = 520
export const BALL_MAX_SPEED = 1420
export const BALL_SPEED_GAIN = 1.042
/** Angle max de rebond (radians) : 62° => balle très rasante mais jouable. */
export const MAX_BOUNCE_ANGLE = 1.08
/** Transfert de "l'effet" (English) : part de la vitesse verticale du paddle. */
export const SPIN_TRANSFER = 0.34

export const TRAIL_LENGTH = 64
export const PARTICLE_CAPACITY = 2600

/** Durée de vie d'un échantillon de traînée (secondes). */
export const TRAIL_LIFE = 0.42

/** Pas de simulation fixe (240 Hz) : évite tout tunneling de la balle. */
export const FIXED_DT = 1 / 240
export const MAX_STEPS_PER_FRAME = 12

export const COUNTDOWN_STEP = 0.38
export const POINT_PAUSE = 0.9

/** Format d'une manche : au nombre de points, ou à la durée. */
export type MatchFormat = 'points' | 'time'

/** Durée d'une manche en mode « temps » (3 minutes). */
export const ROUND_DURATION = 180

/** Vies du joueur en mode casse-brique. */
export const BRICK_LIVES = 3

/** Format du mode casse-brique : uniquement « bricks » (pas de score, pas de timer). */
export type BrickFormat = 'bricks'

export const DIFFICULTIES = ['facile', 'moyen', 'difficile', 'expert'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]
export type GameMode = 'ai' | 'online'

export interface DifficultyProfile {
  label: string
  /** Multiplicateur de la vitesse max de l'IA. */
  speed: number
  /** Erreur de visée max (unités) avant aléa : 0 = frappe parfaite. */
  error: number
  /** Délai de réaction (s) entre deux recalculs de cible. */
  reaction: number
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  facile: { label: 'Facile', speed: 0.42, error: 130, reaction: 0.3 },
  moyen: { label: 'Moyen', speed: 0.72, error: 58, reaction: 0.17 },
  difficile: { label: 'Difficile', speed: 0.95, error: 30, reaction: 0.09 },
  expert: { label: 'Expert', speed: 1.12, error: 8, reaction: 0.05 },
}
