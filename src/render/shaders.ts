/** Sources GLSL (WebGL2 / GLSL ES 3.00) du moteur de rendu P1NG-P0NG. */

export const SPRITE_VS = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec2 i_center;
layout(location = 2) in vec2 i_size;
layout(location = 3) in vec4 i_color;
layout(location = 4) in vec4 i_shape; // x: type, y: rayon, z: rotation, w: intensité glow

uniform vec2 u_resolution;
uniform vec2 u_origin;
uniform float u_scale;

out vec2 v_local;
out vec2 v_size;
out vec4 v_color;
out vec4 v_shape;

void main() {
  vec2 local = a_corner * i_size;
  float c = cos(i_shape.z);
  float s = sin(i_shape.z);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 world = i_center + rotated;
  vec2 px = world * u_scale + u_origin;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  v_local = local;
  v_size = i_size;
  v_color = i_color;
  v_shape = i_shape;
}
`

export const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_local;
in vec2 v_size;
in vec4 v_color;
in vec4 v_shape;

out vec4 fragColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  int type = int(v_shape.x + 0.5);
  float alpha;
  float d;

  if (type == 2) {
    // Halo radial doux
    vec2 n = v_local / max(v_size, vec2(1e-4));
    float r = length(n);
    alpha = exp(-r * r * 3.4) * (1.0 - smoothstep(0.86, 1.0, r));
  } else if (type == 1) {
    d = length(v_local) - v_shape.y;
    float aa = max(fwidth(d), 1e-4) * 0.75;
    alpha = 1.0 - smoothstep(-aa, aa, d);
  } else if (type == 3) {
    // Tube néon : cœur plein + décroissance exponentielle
    d = sdRoundBox(v_local, v_size, v_shape.y);
    float f = 26.0;
    alpha = d <= 0.0 ? 1.0 : exp(-d / f);
    alpha *= 1.0 - smoothstep(f * 2.6, f * 3.4, d);
  } else {
    d = sdRoundBox(v_local, v_size, v_shape.y);
    float aa = max(fwidth(d), 1e-4) * 0.75;
    alpha = 1.0 - smoothstep(-aa, aa, d);
  }

  if (alpha <= 0.0015) discard;
  vec3 rgb = v_color.rgb * v_shape.w;
  fragColor = vec4(rgb * alpha, alpha * v_color.a);
}
`

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`

export const BACKGROUND_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_origin;
uniform float u_scale;
uniform vec2 u_field;
uniform float u_time;
uniform vec3 u_playerColor;
uniform vec3 u_aiColor;
uniform float u_flash;
uniform float u_lead;        // 0 = égalité, 1 = un joueur mène
uniform vec3 u_leadColor;    // couleur du joueur qui mène
uniform float u_gridPulse;   // impulsion déclenchée à chaque point

float sdRoundBox(vec2 p, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float gridMask(vec2 p, float spacing, float thickness) {
  vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
  vec2 d = g / max(fwidth(p), vec2(1e-5));
  float line = min(d.x, d.y);
  return 1.0 - smoothstep(0.0, thickness, line);
}

void main() {
  vec2 px = v_uv * u_resolution;
  vec2 world = (px - u_origin) / u_scale;

  // Fond profond (espace linéaire)
  vec3 col = vec3(0.0032, 0.0040, 0.0075);
  float vign = 1.0 - smoothstep(0.25, 1.25, length((v_uv - 0.5) * vec2(1.35, 1.0)));
  col += vec3(0.0035, 0.0050, 0.0110) * (1.0 - vign);

  // Halos de couleur sur les côtés
  float dl = 1.0 - smoothstep(0.0, u_field.x * 0.55, world.x);
  float dr = 1.0 - smoothstep(0.0, u_field.x * 0.55, u_field.x - world.x);
  col += u_playerColor * dl * 0.022;
  col += u_aiColor * dr * 0.022;

  // Grille : teinte du joueur qui mène, impulsion lumineuse à chaque point
  vec3 gridColor = mix(vec3(0.10, 0.16, 0.30), u_leadColor * 0.85, u_lead * 0.72);
  float pulse = 1.0 + u_gridPulse * (0.55 + 0.45 * sin(u_time * 9.0));
  float g1 = gridMask(world, 50.0, 1.0);
  float g2 = gridMask(world, 200.0, 1.4);
  col += gridColor * g1 * 0.085 * pulse;
  col += gridColor * g2 * 0.130 * pulse;

  // Léger voile de la couleur du meneur sur tout le terrain
  col += u_leadColor * u_lead * 0.014 * (1.0 + u_gridPulse * 2.0);

  // Arène : rectangle luminescent
  vec2 halfSize = u_field * 0.5;
  vec2 center = u_field * 0.5;
  float d = sdRoundBox(world - center, halfSize, 26.0);
  float border = 1.0 - smoothstep(0.0, 3.0, abs(d));
  float aura = exp(-abs(d) * 0.035);
  vec3 borderColor = mix(vec3(0.30, 0.55, 1.0), u_leadColor, u_lead * 0.5);
  col += borderColor * border * 0.55 * (1.0 + u_gridPulse * 1.1);
  col += vec3(0.16, 0.32, 0.70) * aura * 0.075 * (1.0 + u_gridPulse * 1.6);

  // Ligne médiane pointillée
  float mid = abs(world.x - u_field.x * 0.5);
  float dash = step(0.5, fract(world.y / 110.0));
  float line = (1.0 - smoothstep(0.0, 3.5, mid)) * dash;
  vec3 lineColor = mix(vec3(0.35, 0.60, 1.0), u_leadColor * 1.15, u_lead * 0.6);
  col += lineColor * line * 0.42;
  col += vec3(0.18, 0.30, 0.62) * exp(-mid * 0.08) * dash * 0.075;

  // Impulsion globale
  col += vec3(0.9, 0.95, 1.0) * u_flash * 0.035;

  fragColor = vec4(col, 1.0);
}
`

export const BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform float u_threshold;
uniform float u_knee;

void main() {
  vec3 c = texture(u_texture, v_uv).rgb;
  float br = max(c.r, max(c.g, c.b));
  float soft = br - u_threshold + u_knee;
  soft = clamp(soft, 0.0, 2.0 * u_knee);
  soft = soft * soft / (4.0 * u_knee + 1e-5);
  float contrib = max(soft, br - u_threshold) / max(br, 1e-5);
  fragColor = vec4(c * contrib, 1.0);
}
`

export const DOWNSAMPLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform vec2 u_texel;

void main() {
  vec2 t = u_texel;
  vec3 sum = texture(u_texture, v_uv).rgb * 4.0;
  sum += texture(u_texture, v_uv + vec2(-t.x, -t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(t.x, -t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(-t.x, t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(t.x, t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(-t.x, 0.0)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(t.x, 0.0)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(0.0, -t.y)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(0.0, t.y)).rgb * 2.0;
  fragColor = vec4(sum / 16.0, 1.0);
}
`

export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform vec2 u_direction; // texel * direction

void main() {
  vec3 sum = texture(u_texture, v_uv).rgb * 0.227027;
  vec2 o1 = u_direction * 1.3846153846;
  vec2 o2 = u_direction * 3.2307692308;
  sum += texture(u_texture, v_uv + o1).rgb * 0.3162162162;
  sum += texture(u_texture, v_uv - o1).rgb * 0.3162162162;
  sum += texture(u_texture, v_uv + o2).rgb * 0.0702702703;
  sum += texture(u_texture, v_uv - o2).rgb * 0.0702702703;
  fragColor = vec4(sum, 1.0);
}
`

export const UPSAMPLE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_intensity;

void main() {
  vec2 t = u_texel;
  vec3 sum = texture(u_texture, v_uv).rgb * 4.0;
  sum += texture(u_texture, v_uv + vec2(-t.x, 0.0)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(t.x, 0.0)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(0.0, -t.y)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(0.0, t.y)).rgb * 2.0;
  sum += texture(u_texture, v_uv + vec2(-t.x, -t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(t.x, -t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(-t.x, t.y)).rgb;
  sum += texture(u_texture, v_uv + vec2(t.x, t.y)).rgb;
  fragColor = vec4(sum / 16.0 * u_intensity, 1.0);
}
`

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_bloomIntensity;
uniform float u_chromatic;
uniform float u_vignette;
uniform float u_scanlines;
uniform float u_grain;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = v_uv;
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);

  // Aberration chromatique radiale
  vec2 dir = centered * u_chromatic * (0.4 + r2);
  vec3 scene;
  scene.r = texture(u_scene, uv + dir).r;
  scene.g = texture(u_scene, uv).g;
  scene.b = texture(u_scene, uv - dir).b;

  vec3 bloom = texture(u_bloom, uv).rgb;
  vec3 col = scene + bloom * u_bloomIntensity;

  // Tone mapping (ACES) puis encodage sRGB : la scène est rendue en linéaire.
  col = aces(col * 1.05);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));

  // Vignettage
  float vig = 1.0 - smoothstep(0.18, 0.78, r2 * 1.9);
  col *= mix(1.0, vig, u_vignette);

  // Scanlines
  float scan = sin(uv.y * u_resolution.y * 1.6) * 0.5 + 0.5;
  col *= 1.0 - u_scanlines * scan * 0.5;

  // Grain
  float n = hash(uv * u_resolution + fract(u_time) * 137.0) - 0.5;
  col += n * u_grain;

  fragColor = vec4(col, 1.0);
}
`
