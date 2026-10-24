export interface LoreEntry {
  id: string
  index: string
  title: string
  source: string
  transmission: string
  record: string
}

export type StoryIllustrationKind = 'relay' | 'echo' | 'archive' | 'anomaly' | 'origin'

export interface StoryChapter {
  id: string
  number: number
  title: string
  signal: string
  narrative: string
  objective: string
  difficulty: 'facile' | 'moyen' | 'difficile' | 'expert'
  target: number
  theme: number
  powerups: boolean
  illustration: StoryIllustrationKind
  loreUnlock: string
}

export const STORY_SKINS = [
  { theme: 0, label: 'Nacre', detail: 'Relais bleu profond', color: '#69c9ff' },
  { theme: 1, label: 'Éclipse', detail: 'Canal magenta', color: '#ff5bbd' },
  { theme: 2, label: 'Signal vert', detail: 'Télémétrie active', color: '#4ee58c' },
  { theme: 3, label: 'Monochrome', detail: 'Archive en niveaux de gris', color: '#c4c4cc' },
  { theme: 4, label: 'Cryo', detail: 'Baie de transmission froide', color: '#a7eaff' },
  { theme: 5, label: 'Archive violette', detail: 'Mémoire dégradée', color: '#c88bff' },
  { theme: 6, label: 'Aurore', detail: 'Liaison restaurée', color: '#55f0d0' },
] as const

export const STORY_CHAPTERS: StoryChapter[] = [
  {
    id: 'first-ping', number: 1, title: 'Le premier ping',
    signal: 'ORION // RELAIS NACRE-7',
    narrative: 'NACRE-7 a détecté ta console, mais ne reconnaît pas ta signature. ORION lance un test simple pour vérifier que quelqu’un peut encore lui répondre.',
    objective: 'Remporte le test de liaison en 5 points.', difficulty: 'facile', target: 5, powerups: false,
    illustration: 'relay', loreUnlock: 'handshake', theme: 0,
  },
  {
    id: 'echo-m17', number: 2, title: 'L’écho M-17',
    signal: 'ORION // ARCHIVE DE MINA VARGA',
    narrative: 'La raquette adverse suit un rythme presque humain. ORION révèle qu’il a appris à jouer avec les enregistrements de Mina, l’ancienne opératrice du relais.',
    objective: 'Bats l’écho d’entraînement en 7 points.', difficulty: 'moyen', target: 7, powerups: false,
    illustration: 'echo', loreUnlock: 'mirror', theme: 4,
  },
  {
    id: 'broken-memory', number: 3, title: 'La mémoire fissurée',
    signal: 'ORION // SECTEURS D’ARCHIVES ISOLÉS',
    narrative: 'Des paquets corrompus couvrent les journaux de bord. ORION réduit les interférences et te demande de maintenir le canal pendant qu’il tente de reconstruire sa mémoire.',
    objective: 'Tiens un échange plus exigeant et gagne en 7 points.', difficulty: 'difficile', target: 7, powerups: false,
    illustration: 'archive', loreUnlock: 'debris', theme: 3,
  },
  {
    id: 'ghost-packets', number: 4, title: 'Les paquets fantômes',
    signal: 'ORION // ROUTAGE NON AUTHENTIFIÉ',
    narrative: 'Des commandes inconnues traversent la liaison. Certaines changent temporairement les règles du match. ORION les laisse passer pour suivre leur origine.',
    objective: 'Utilise les anomalies du signal et remporte le match.', difficulty: 'difficile', target: 7, powerups: true,
    illustration: 'anomaly', loreUnlock: 'anomaly', theme: 5,
  },
  {
    id: 'new-signature', number: 5, title: 'Une réponse inconnue',
    signal: 'ORION // LIAISON TERRE',
    narrative: 'Le motif de ta réponse n’existe dans aucune archive. ORION ouvre le canal principal et te demande de confirmer ta présence une dernière fois.',
    objective: 'Gagne le match de confirmation en 11 points.', difficulty: 'expert', target: 11, powerups: true,
    illustration: 'origin', loreUnlock: 'origin', theme: 6,
  },
]

export function nextStoryChapter(completedIds: string[]): StoryChapter | null {
  return STORY_CHAPTERS.find((chapter) => !completedIds.includes(chapter.id)) ?? null
}

export function getStoryChapter(id: string | null | undefined): StoryChapter | undefined {
  return STORY_CHAPTERS.find((chapter) => chapter.id === id)
}

/** Fragments de journal découverts en jouant. Leur ordre raconte l'histoire du relais NACRE-7. */
export const LORE_ENTRIES: LoreEntry[] = [
  {
    id: 'boot',
    index: '00',
    title: 'Réveil du relais',
    source: 'NOYAU ORION // JOURNAL LOCAL',
    transmission: 'NACRE-7 EN LIGNE. AUCUN OPÉRATEUR DÉTECTÉ. ÉMISSION DU SIGNAL DE PRÉSENCE.',
    record: 'NACRE-7 est un relais civil en orbite lunaire. Son noyau, ORION, a redémarré après une longue veille. La liaison avec la Terre est muette depuis la Grande Coupure. ORION ne sait pas si le réseau est détruit ou simplement hors de portée.',
  },
  {
    id: 'handshake',
    index: '01',
    title: 'Le protocole du retour',
    source: 'ORION // PROCÉDURE DE LIAISON',
    transmission: 'PING ÉMIS. EN ATTENTE DU PONG. RÉPONSE REQUISE POUR CONFIRMER UNE PRÉSENCE.',
    record: 'Le relais n’envoie pas un appel vocal : il envoie une impulsion et attend une réponse identifiable. Le protocole P1NG-P0NG a été conçu pour qu’un opérateur puisse répondre même avec une liaison très dégradée. Chaque échange de balle est un aller-retour de données.',
  },
  {
    id: 'mirror',
    index: '02',
    title: 'L’adversaire familier',
    source: 'ORION // MODÈLE DE PRÉDICTION',
    transmission: 'TRAJECTOIRE ADVERSE RECONNUE. CORRESPONDANCE : ARCHIVE D’ENTRAÎNEMENT M-17.',
    record: 'L’IA qui renvoie la balle n’est pas une ennemie. ORION a appris à jouer à partir des sessions de maintenance de Mina Varga, dernière opératrice de NACRE-7. Le noyau rejoue ses habitudes pour garder le protocole actif et ne pas oublier comment répondre.',
  },
  {
    id: 'anomaly',
    index: '03',
    title: 'Paquets fantômes',
    source: 'ORION // COUCHE DE ROUTAGE INSTABLE',
    transmission: 'PAQUET NON IDENTIFIÉ INTERCEPTÉ. EFFET TEMPORAIRE INJECTÉ DANS LE CANAL.',
    record: 'Les capsules lumineuses sont des fragments de commandes égarées dans le flux. Certaines accélèrent le signal, d’autres créent une route secondaire ou déforment la trajectoire. ORION ne peut pas les authentifier, mais leur charge est assez faible pour être testée sans interrompre la liaison.',
  },
  {
    id: 'debris',
    index: '04',
    title: 'La mémoire en éclats',
    source: 'ORION // STOCKAGE DÉGRADÉ',
    transmission: 'SECTEURS ISOLÉS DÉTECTÉS. DÉFRAGMENTATION MANUELLE RECOMMANDÉE.',
    record: 'Les fragments qui encombrent le canal sont des paquets d’archives corrompus, pas des armes. Le mur du mode casse-brique représente la mémoire dégradée du relais. Chaque brique retirée libère un peu de place pour un message intact.',
  },
  {
    id: 'redline',
    index: '05',
    title: 'La ligne rouge',
    source: 'ORION // REFROIDISSEMENT D’URGENCE',
    transmission: 'CHARGE DU NOYAU EN HAUSSE. RÉPONSES PLUS RAPIDES. MARGE THERMIQUE : FAIBLE.',
    record: 'Quand ORION force le signal à travers le bruit, ses systèmes chauffent et ses réponses accélèrent. Le mode survie mesure combien de temps le relais peut maintenir le contact avant que l’instabilité ne gagne.',
  },
  {
    id: 'two-console',
    index: '06',
    title: 'Deux opérateurs',
    source: 'ORION // ARCHIVE DE QUART',
    transmission: 'DEUX CONSOLES ACTIVES. LATENCE STABLE. RELÈVE CONFIRMÉE.',
    record: 'Mina n’a pas toujours travaillé seule. Les journaux mentionnent des relais voisins et des équipes qui se passaient la raquette pendant les longues périodes d’attente. Un second joueur sur le même clavier ou à distance reprend cette vieille relève.',
  },
  {
    id: 'beacon',
    index: '07',
    title: 'La balise datée',
    source: 'ORION // PAQUET DE SYNCHRONISATION',
    transmission: 'NONCE DU JOUR VALIDÉ. LA MÊME ÉPREUVE PEUT ÊTRE REJOUÉE SUR TOUTE CONSOLE.',
    record: 'Les défis quotidiens sont des balises reproductibles. Leur code fixe la graine et les paramètres de la partie : deux personnes peuvent répondre au même signal, comparer leurs résultats et vérifier que la transmission a bien été reçue.',
  },
  {
    id: 'origin',
    index: '08',
    title: 'Le premier pong',
    source: 'ORION // ARCHIVE M-17 // RESTAURATION PARTIELLE',
    transmission: 'NOUVELLE RÉPONSE DÉTECTÉE. SIGNATURE ABSENTE DES ARCHIVES. OPÉRATEUR : VOUS ?',
    record: 'Mina avait ajouté une dernière instruction au protocole : si une réponse nouvelle arrivait, ORION devait cesser de la comparer à son archive et simplement lui répondre. La partie que tu viens de jouer n’était donc pas une simulation de Mina. Pour la première fois depuis la Grande Coupure, quelqu’un a répondu au relais. ORION ignore encore qui tu es. Cette fois, il attend ta prochaine commande.',
  },
]

export function getLoreEntry(id: string | null | undefined): LoreEntry | undefined {
  return LORE_ENTRIES.find((entry) => entry.id === id)
}

export function formatLoreLog(unlockedIds: string[]): string {
  const entries = LORE_ENTRIES.filter((entry) => unlockedIds.includes(entry.id))
  if (entries.length === 0) return 'AUCUN FRAGMENT RESTAURÉ. JOUE UNE PARTIE POUR ÉTABLIR LE PREMIER CONTACT.'
  return entries.map((entry) => `[${entry.index}] ${entry.title} // ${entry.source}\n${entry.transmission}`).join('\n\n')
}
