// Prisma hexagonal en ASCII con sombreado por luz y z-buffer (estilo donut.c).
export const COLS = 52;
export const ROWS = 22;

const SHADES = '.,-~:;=!*#';
const EDGE = '@'; // las aristas van por encima del sombreado para que la forma se lea
const RADIUS = 1;
const HALF_HEIGHT = 0.42;
const CAMERA = 4;
const SCALE_X = 66;
const SCALE_Y = SCALE_X / 2; // las celdas mono miden ~el doble de alto que de ancho
const LIGHT = normalize([0.5, 0.55, -0.7]);

function normalize([x, y, z]: number[]) {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

// Muestras de superficie precalculadas: x, y, z, nx, ny, nz, esArista por punto.
const STRIDE = 7;
const samples: number[] = [];
for (let i = 0; i < 6; i++) {
  const a0 = (i * Math.PI) / 3;
  const a1 = ((i + 1) * Math.PI) / 3;
  const [x0, z0, x1, z1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)].map((v) => v * RADIUS);
  const mid = (a0 + a1) / 2;

  const [U, V] = [44, 26];
  for (let iu = 0; iu < U; iu++) {
    for (let iv = 0; iv <= V; iv++) {
      const [u, v] = [iu / U, iv / V];
      const edge = iu === 0 || iv === 0 || iv === V ? 1 : 0;
      samples.push(x0 + (x1 - x0) * u, -HALF_HEIGHT + 2 * HALF_HEIGHT * v, z0 + (z1 - z0) * u, Math.cos(mid), 0, Math.sin(mid), edge);
    }
  }

  for (const sign of [-1, 1]) {
    for (let s = 0; s <= 1; s += 1 / 32) {
      for (let t = 0; s + t <= 1; t += 1 / 32) {
        samples.push(s * x0 + t * x1, sign * HALF_HEIGHT, s * z0 + t * z1, 0, sign, 0, 0);
      }
    }
  }
}

/** Devuelve el fotograma con giro `spin` (eje vertical) e inclinación `tilt` (eje horizontal), en radianes. */
export function renderFrame(spin: number, tilt: number): string {
  const chars = new Array<string>(COLS * ROWS).fill(' ');
  const depth = new Float32Array(COLS * ROWS);
  const [cs, ss, ct, st] = [Math.cos(spin), Math.sin(spin), Math.cos(tilt), Math.sin(tilt)];

  for (let i = 0; i < samples.length; i += STRIDE) {
    const [x, y, z, nx, ny, nz, edge] = samples.slice(i, i + STRIDE);

    // Giro sobre Y y luego inclinación sobre X (la cámara mira desde arriba), igual para posición y normal.
    const rx = x * cs + z * ss;
    const rz0 = -x * ss + z * cs;
    const ry = y * ct + rz0 * st;
    const rz = -y * st + rz0 * ct;

    const ooz = 1 / (rz + CAMERA) + edge * 0.02; // sesgo: la arista gana a la cara que la toca
    const col = Math.round(COLS / 2 + SCALE_X * rx * ooz);
    const row = Math.round(ROWS / 2 - 1.5 - SCALE_Y * ry * ooz); // -1.5: la inclinación baja la figura
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;

    const index = row * COLS + col;
    if (ooz <= depth[index]) continue;
    depth[index] = ooz;

    const mx = nx * cs + nz * ss;
    const mz0 = -nx * ss + nz * cs;
    const my = ny * ct + mz0 * st;
    const mz = -ny * st + mz0 * ct;
    const light = 0.12 + 0.88 * Math.max(0, mx * LIGHT[0] + my * LIGHT[1] + mz * LIGHT[2]);
    chars[index] = edge ? EDGE : SHADES[Math.min(SHADES.length - 1, Math.floor(light * SHADES.length))];
  }

  let out = '';
  for (let row = 0; row < ROWS; row++) out += chars.slice(row * COLS, (row + 1) * COLS).join('') + '\n';
  return out;
}
