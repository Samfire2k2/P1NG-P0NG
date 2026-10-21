import { joinRoom, selfId, type MessageAction, type Room } from 'trystero'

export type NetRole = 'host' | 'guest'
export type NetStatus = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error' | 'closed'

/** Codes de contrôle échangés entre les deux joueurs. */
export const CTRL = {
  REMATCH_REQUEST: 1,
  REMATCH_ACCEPT: 2,
  START: 3,
  PING: 4,
  PONG: 5,
  HELLO: 6,
} as const

/** Instantané de l'état de la partie, envoyé par l'hôte à 60 Hz. */
export interface NetSnapshot {
  ballX: number
  ballY: number
  ballVx: number
  ballVy: number
  hostPaddleY: number
  guestPaddleY: number
  scoreHost: number
  scoreGuest: number
  /** 0 = service, 1 = jeu, 2 = point, 3 = fin */
  phase: number
  countdown: number
  /** 0 = service au joueur de gauche, 1 = service au joueur de droite */
  serveTo: number
  /** Identifiant du dernier effet sonore (incrémenté par l'hôte). */
  eventId: number
  /** Type d'effet sonore (voir NET_EVENT). */
  eventType: number
  /** 0 = raquette de gauche, 1 = raquette de droite. */
  eventSide: number
  eventPower: number
  eventOffset: number
}

/** Effets sonores relayés par l'hôte vers l'invité. */
export const NET_EVENT = {
  NONE: 0,
  PADDLE: 1,
  WALL: 2,
  SCORE: 3,
  SERVE: 4,
  COUNTDOWN: 5,
  WIN: 6,
  LOSE: 7,
} as const

/** Profil du joueur transmis à l'adversaire (pseudo + couleur). */
export interface NetMeta {
  name: string
  h: number
  s: number
  v: number
}

const SNAPSHOT_FLOATS = 16
const SNAPSHOT_BYTES = SNAPSHOT_FLOATS * 4

export interface NetSessionHandlers {
  onStatus?: (status: NetStatus, detail?: string) => void
  onSnapshot?: (snapshot: NetSnapshot) => void
  onInput?: (paddleY: number) => void
  onControl?: (code: number) => void
  onMeta?: (meta: NetMeta) => void
  onPeerJoin?: () => void
  onPeerLeave?: () => void
}

const APP_ID = 'p1ng-p0ng-arena-v1'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Génère un code de salon lisible (sans caractères ambigus). */
export function generateRoomCode(length = 5): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

/** Génère un secret de session (chiffre les échanges WebRTC en AES-GCM). */
export function generateSessionKey(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

/**
 * Session P2P : la signalisation passe par des relais Nostr publics
 * (aucun serveur à héberger), les données de jeu voyagent en WebRTC.
 */
export class NetSession {
  role: NetRole = 'host'
  roomId = ''
  password = ''
  status: NetStatus = 'idle'
  latency = 0
  peerId: string | null = null

  private room: Room | null = null
  private handlers: NetSessionHandlers
  private stateAction: MessageAction<Uint8Array> | null = null
  private inputAction: MessageAction<Uint8Array> | null = null
  private ctrlAction: MessageAction<Uint8Array> | null = null
  private metaAction: MessageAction<string> | null = null
  private snapshotBytes = new Uint8Array(SNAPSHOT_BYTES)
  private snapshotFloats = new Float32Array(this.snapshotBytes.buffer)
  private pingTimer = 0
  private pingSentAt = 0

  constructor(handlers: NetSessionHandlers = {}) {
    this.handlers = handlers
  }

  private setStatus(status: NetStatus, detail?: string): void {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatus?.(status, detail)
  }

  private buildRoom(): Room {
    const relayUrls = (import.meta.env.VITE_NOSTR_RELAYS as string | undefined)
      ?.split(',')
      .map((u) => u.trim())
      .filter(Boolean)

    return joinRoom(
      {
        appId: APP_ID,
        password: this.password,
        relayConfig: relayUrls?.length ? { urls: relayUrls, redundancy: 3 } : undefined,
      },
      this.roomId,
      { onJoinError: ({ error }) => this.setStatus('error', error) },
    )
  }

  private setupActions(): void {
    const room = this.room!
    this.stateAction = room.makeAction<Uint8Array>('state')
    this.inputAction = room.makeAction<Uint8Array>('input')
    this.ctrlAction = room.makeAction<Uint8Array>('ctrl')
    this.metaAction = room.makeAction<string>('meta')

    this.metaAction.onMessage = (data) => this.handleMeta(data)

    this.stateAction.onMessage = (data) => this.handleState(data)
    this.inputAction.onMessage = (data) => {
      if (data.byteLength < 4) return
      const view = new Float32Array(data.buffer, data.byteOffset, 1)
      this.handlers.onInput?.(view[0])
    }
    this.ctrlAction.onMessage = (data) => {
      if (data.byteLength < 1) return
      const code = data[0]
      if (code === CTRL.PING) {
        this.sendControl(CTRL.PONG)
        return
      }
      if (code === CTRL.PONG) {
        this.latency = Math.round(performance.now() - this.pingSentAt)
        return
      }
      this.handlers.onControl?.(code)
    }
  }

  /** Crée un salon et attend qu'un adversaire le rejoigne. */
  create(roomId?: string, password?: string): void {
    this.leave()
    this.role = 'host'
    this.roomId = roomId ?? generateRoomCode()
    this.password = password ?? generateSessionKey()
    this.setStatus('connecting')
    this.room = this.buildRoom()
    this.setupActions()

    this.room.onPeerJoin = (peerId) => {
      this.peerId = peerId
      this.setStatus('connected')
      this.handlers.onPeerJoin?.()
      this.sendControl(CTRL.HELLO)
    }

    this.room.onPeerLeave = () => {
      this.peerId = null
        this.setStatus('waiting', 'Ton adversaire a quitté la partie.')
      this.handlers.onPeerLeave?.()
    }

    this.setStatus('waiting')
  }

  /** Rejoint un salon existant. */
  join(roomId: string, password: string): void {
    this.leave()
    this.role = 'guest'
    this.roomId = normalizeRoomCode(roomId)
    this.password = password
    this.setStatus('connecting')
    this.room = this.buildRoom()
    this.setupActions()

    this.room.onPeerJoin = (peerId) => {
      this.peerId = peerId
      this.setStatus('connected')
      this.handlers.onPeerJoin?.()
    }

    this.room.onPeerLeave = () => {
      this.peerId = null
        this.setStatus('closed', 'Ton adversaire a quitté la partie.')
      this.handlers.onPeerLeave?.()
    }
  }

  /** Pseudo + couleur du joueur : envoyés à l'adversaire. */
  private handleMeta(data: string): void {
    try {
      const parsed = JSON.parse(data) as Partial<NetMeta>
      if (typeof parsed?.name !== 'string' || typeof parsed?.h !== 'number') return
      this.handlers.onMeta?.({
        name: parsed.name.slice(0, 18),
        h: parsed.h,
        s: typeof parsed.s === 'number' ? parsed.s : 0.9,
        v: typeof parsed.v === 'number' ? parsed.v : 1,
      })
    } catch {
      /* profil illisible : on l'ignore */
    }
  }

  /** Envoie le profil (pseudo + couleur) à l'adversaire. */
  sendMeta(meta: NetMeta): void {
    if (!this.metaAction || !this.peerId) return
    void this.metaAction.send(JSON.stringify(meta), { target: this.peerId })
  }

  private handleState(data: Uint8Array): void {
    if (data.byteLength < SNAPSHOT_BYTES) return
    const view = new Float32Array(data.buffer, data.byteOffset, SNAPSHOT_FLOATS)
    this.handlers.onSnapshot?.({
      ballX: view[0],
      ballY: view[1],
      ballVx: view[2],
      ballVy: view[3],
      hostPaddleY: view[4],
      guestPaddleY: view[5],
      scoreHost: view[6],
      scoreGuest: view[7],
      phase: view[8],
      countdown: view[9],
      serveTo: view[10],
      eventId: view[11],
      eventType: view[12],
      eventSide: view[13],
      eventPower: view[14],
      eventOffset: view[15],
    })
  }

  /** Hôte → invité : état complet de la partie. */
  sendState(snapshot: NetSnapshot): void {
    if (!this.stateAction || this.role !== 'host' || !this.peerId) return
    const view = this.snapshotFloats
    view[0] = snapshot.ballX
    view[1] = snapshot.ballY
    view[2] = snapshot.ballVx
    view[3] = snapshot.ballVy
    view[4] = snapshot.hostPaddleY
    view[5] = snapshot.guestPaddleY
    view[6] = snapshot.scoreHost
    view[7] = snapshot.scoreGuest
    view[8] = snapshot.phase
    view[9] = snapshot.countdown
    view[10] = snapshot.serveTo
    view[11] = snapshot.eventId
    view[12] = snapshot.eventType
    view[13] = snapshot.eventSide
    view[14] = snapshot.eventPower
    view[15] = snapshot.eventOffset
    void this.stateAction.send(this.snapshotBytes.slice(), { target: this.peerId })
  }

  /** Invité → hôte : position cible de la raquette distante. */
  sendInput(paddleY: number): void {
    if (!this.inputAction || this.role !== 'guest' || !this.peerId) return
    const bytes = new Uint8Array(new Float32Array([paddleY]).buffer)
    void this.inputAction.send(bytes, { target: this.peerId })
  }

  sendControl(code: number): void {
    if (!this.ctrlAction || !this.peerId) return
    void this.ctrlAction.send(new Uint8Array([code]), { target: this.peerId })
  }

  /** Mesure la latence aller-retour toutes les 2 s. */
  tick(dt: number): void {
    if (this.status !== 'connected' || !this.peerId) return
    this.pingTimer -= dt
    if (this.pingTimer <= 0) {
      this.pingTimer = 2
      this.pingSentAt = performance.now()
      this.sendControl(CTRL.PING)
    }
  }

  leave(): void {
    if (this.room) {
      void this.room.leave()
      this.room = null
    }
    this.stateAction = null
    this.inputAction = null
    this.ctrlAction = null
    this.metaAction = null
    this.peerId = null
    this.latency = 0
    if (this.status !== 'idle') this.setStatus('idle')
  }

  get selfId(): string {
    return selfId
  }
}
