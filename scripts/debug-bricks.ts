/**
 * Diagnostic : pourquoi les briques ne s'affichent pas et pourquoi
 * on ne voit que le glow des raquettes.
 */
import { World } from '../src/game/world.ts'

const w = new World()
w.brickMode = true
w.buildBricks()
console.log(`bricks: ${w.bricks.length}`)
const b = w.bricks[0]
console.log(`brick[0]: x=${b.x} y=${b.y} w=${b.w} h=${b.h}`)

// Ce que le renderer calcule pour la premiere brique (paysage) :
const bx = b.x
const by = b.y
const bw = b.w
const bh = b.h
console.log(`\nPasse opaque : core.push(${bx + bw / 2}, ${by + bh / 2}, ${bw / 2}, ${bh / 2}, ..., type=4, radius=${Math.min(bw, bh) / 2})`)

// Le shader ne connait que les types 0,1,2,3 : le type 4 tombe dans
// la branche "else" (boite arrondie) -- mais avec une intensite glow.
console.log(`\nTypes reconnus par le shader : 0 (roundbox), 1 (cercle), 2 (glow), 3 (tube neon)`)
console.log(`type=4 utilise pour les briques => retombe sur la branche else (roundbox)`)

// La raquette utilise le type 3 (tube neon) :
console.log(`\nRaquette : core.push(..., type=3, radius=${20 / 2}, glow=${1.7})`)

// Quel est le champ "glow" (i_shape.w) ? Il multiplie la couleur.
console.log(`\nFormule du shader : rgb = v_color.rgb * v_shape.w ; fragColor = vec4(rgb*alpha, alpha*v_color.a)`)

// Verifions ce qui se passe si on rend une brique avec le type 0 (roundbox normal)
console.log(`\nChamps i_shape : x=type, y=radius, z=rotation, w=intensite glow`)
