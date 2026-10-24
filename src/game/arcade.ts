import type { Difficulty } from './constants'

export type ArcadeModifier = 'fast-ball' | 'compact-paddles' | 'orbital-ball'
export type ContractId = 'win' | 'rallies' | 'wall-taps'

export interface DailyChallenge {
  date: string
  id: string
  code: string
  seed: number
  difficulty: Difficulty
  target: number
  modifier: ArcadeModifier
  contract: ContractId
  contractTarget: number
}

export interface ReplayFrame {
  t: number
  playerY: number
  ballX: number
  ballY: number
}

export const MODIFIER_INFO: Record<ArcadeModifier, { label: string; description: string }> = {
  'fast-ball': { label: 'Surcadence', description: 'La balle démarre plus vite.' },
  'compact-paddles': { label: 'Micro-raquettes', description: 'Les deux raquettes sont plus courtes.' },
  'orbital-ball': { label: 'Orbite instable', description: 'La balle dérive légèrement au fil du temps.' },
}

export const CONTRACT_INFO: Record<ContractId, { label: string; target: number }> = {
  win: { label: 'Remporte le match', target: 1 },
  rallies: { label: 'Renvois du joueur', target: 18 },
  'wall-taps': { label: 'Rebonds sur les murs', target: 12 },
}

function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

export function getDailyChallenge(date = new Date()): DailyChallenge {
  const dateKey = date.toISOString().slice(0, 10)
  const seed = hash(`P1NG-P0NG:${dateKey}`)
  const difficulty: Difficulty[] = ['facile', 'moyen', 'difficile', 'expert']
  const targets = [5, 7, 11]
  const modifiers: ArcadeModifier[] = ['fast-ball', 'compact-paddles', 'orbital-ball']
  const contracts: ContractId[] = ['win', 'rallies', 'wall-taps']
  const code = `P1-${dateKey.replaceAll('-', '')}`
  const contract = contracts[(seed >>> 16) % contracts.length] ?? 'win'
  return {
    date: dateKey,
    id: `daily-${dateKey}`,
    code,
    seed,
    difficulty: difficulty[(seed >>> 4) % difficulty.length] ?? 'moyen',
    target: targets[(seed >>> 9) % targets.length] ?? 7,
    modifier: modifiers[(seed >>> 12) % modifiers.length] ?? 'fast-ball',
    contract,
    contractTarget: CONTRACT_INFO[contract].target,
  }
}

export function parseChallengeCode(raw: string): DailyChallenge | null {
  const match = raw.trim().toUpperCase().match(/^P1-(\d{4})(\d{2})(\d{2})$/)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (date.toISOString().slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) return null
  return getDailyChallenge(date)
}
