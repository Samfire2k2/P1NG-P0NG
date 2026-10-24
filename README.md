# P1NG-P0NG

Un jeu de Pong néon qui se joue dans le navigateur. Affronte l’IA, détruis un mur de briques en solo ou joue en duel en ligne.

## Fonctionnalités

- **Contre l’IA** : quatre niveaux de difficulté, parties au score ou chronométrées.
- **Survie** : le match s’arrête à la première balle manquée ; l’IA accélère au fil des points et du temps.
- **Défi local** : deux joueurs sur le même clavier, avec `W/S` et les flèches haut/bas.
- **Entraînement** : exercices de 30 rebonds sur les murs ou 20 renvois précis au centre.
- **Défi quotidien** : partie reproductible avec code partageable, contrat, record local et fantôme de la meilleure tentative.
- **Progression** : série de défis, succès, thèmes cosmétiques à débloquer et rapport détaillé après chaque partie.
- **Mode histoire** : progresse à travers cinq chapitres pour découvrir pourquoi le relais lunaire NACRE-7 est seul et qui répond à son signal. Chaque mission possède une illustration et débloque une transmission dans le journal (`lore`).
- **Skins d’histoire** : change l’apparence du terrain dans la campagne, du relais bleu aux archives dégradées et à la liaison restaurée.
- **Casse-brique** : mode solo sans IA. Envoie la balle vers un grand mur trapézoïdal, puis rattrape-la à son retour. Jouable uniquement en portrait, avec trois vies.
- **En ligne** : crée un salon privé ou public, invite un adversaire avec un lien ou un code, et regarde une partie en spectateur.
- **Personnalisation** : couleur des raquettes, bonus, thèmes, orientation et intensité de la lueur.
- **Audio et interface** : effets sonores, musique, commandes de pause, plein écran et historique local des parties.
- **Préférences mémorisées** : réglages et pseudo sont conservés dans le stockage local du navigateur.

## Prérequis

- Node.js et npm
- Un navigateur récent avec prise en charge de WebGL 2

## Installation et lancement

Depuis le dossier `P1NG-P0NG` :

```bash
npm install
npm run dev
```

Vite affiche l’adresse locale à ouvrir dans le navigateur (par défaut `http://localhost:5173`). Pour rendre le serveur de développement accessible sur le réseau local, Vite est configuré pour écouter sur toutes les interfaces.

## Commandes

Depuis le terminal du jeu, `aide` liste les commandes disponibles. Essaie `defi`, `survie`, `duel local`, `entrainement rebonds` ou `entrainement precision`.

| Action | Commande |
| --- | --- |
| Déplacer la raquette | Souris ou pointeur |
| Déplacer en paysage | Flèches haut et bas ou `W` et `S` |
| Déplacer en portrait | Flèches gauche et droite |
| Démarrer une partie ou mettre en pause | `Espace` |
| Activer ou couper le son | `M` |

Les boutons à l’écran permettent aussi de gérer la partie. En mode en ligne, les deux joueurs déplacent leur raquette avec les commandes locales.

## Jouer en ligne

Crée un salon depuis l’onglet **En ligne**, puis partage le lien d’invitation ou le code du salon. L’adversaire peut ouvrir le lien ou saisir le code et la clé dans le jeu. Les salons publics peuvent être rejoints sans clé. Le créateur lance la partie une fois l’adversaire connecté.

La connexion utilise Trystero : la signalisation passe par des relais Nostr et les données de jeu transitent entre les navigateurs avec WebRTC. Une connexion Internet est nécessaire pour créer ou rejoindre un salon.

## Scripts disponibles

```bash
npm run dev        # Démarre le serveur de développement
npm run build      # Vérifie les types et crée la version de production dans dist/
npm run preview    # Sert localement la version de production
npm run lint       # Analyse le code avec oxlint
npm run typecheck  # Vérifie les types TypeScript
npm run sim        # Lance la vérification de simulation
```

## Technologies

- React et TypeScript
- Vite et Tailwind CSS
- Rendu du jeu avec WebGL 2
- Trystero et WebRTC pour les parties en ligne
