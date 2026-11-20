// Cielo ASCII del hero: estrellas que titilan, cometas y un sistema donde orbita el stack.
// Todo se dibuja en una cuadrícula de caracteres; `back` (estrellas) y `front` (sistema y
// cometas) comparten tamaño para pintarse en dos <pre> superpuestos y alineados.

export const SYSTEM_COLS = 56;
export const SYSTEM_ROWS = 21;

type Grid = { cols: number; rows: number; cells: string[] };

const ORBITS = [
  { rx: 9, ry: 3.4, speed: 0.38, labels: ['React', 'Bun'] },
  { rx: 15.5, ry: 6.2, speed: 0.24, labels: ['Hono', 'Prisma', 'TanStack'] },
  { rx: 22, ry: 9, speed: 0.15, labels: ['PostgreSQL', 'Node.js', 'TypeScript'] },
];
const CORE = [' .--. ', '( vr )', " `--' "];
const TWINKLE = '.+*+';
const COMET_TRAIL = '*=~--..';
const DOT_SPACING = 3.2;
// Espacio duro: se ve como espacio pero ocupa la celda, así ninguna estrella se cuela.
const SOLID_SPACE = ' ';

const createGrid = (cols: number, rows: number): Grid => ({ cols, rows, cells: new Array(cols * rows).fill(' ') });

function put(grid: Grid, x: number, y: number, ch: string) {
  const [col, row] = [Math.round(x), Math.round(y)];
  if (col >= 0 && col < grid.cols && row >= 0 && row < grid.rows && ch !== ' ') grid.cells[row * grid.cols + col] = ch;
}

const write = (grid: Grid, x: number, y: number, text: string) => [...text].forEach((ch, i) => put(grid, x + i, y, ch));

function isFree(grid: Grid, x: number, y: number) {
  const [col, row] = [Math.round(x), Math.round(y)];
  return col < 0 || col >= grid.cols || row < 0 || row >= grid.rows || grid.cells[row * grid.cols + col] === ' ';
}

const toText = (grid: Grid) =>
  Array.from({ length: grid.rows }, (_, row) => grid.cells.slice(row * grid.cols, (row + 1) * grid.cols).join('')).join('\n');

/** Dibuja el sistema con su esquina superior izquierda en (ox, oy). El plano se ve desde arriba: la mitad superior de cada órbita queda detrás del núcleo. */
function drawSystem(grid: Grid, t: number, ox: number, oy: number) {
  const cx = ox + SYSTEM_COLS / 2;
  const cy = oy + Math.floor(SYSTEM_ROWS / 2) - 1;
  const bodies: { x: number; y: number; label: string; front: boolean }[] = [];

  for (const orbit of ORBITS) {
    // Puntos a distancia visual constante (una fila mide ~2 columnas) para que el anillo se vea parejo.
    let travelled = 0;
    for (let a = 0; a < 2 * Math.PI; a += 0.005) {
      travelled += 0.005 * Math.hypot(orbit.rx * Math.sin(a), 2 * orbit.ry * Math.cos(a));
      if (travelled >= DOT_SPACING) {
        travelled = 0;
        put(grid, cx + orbit.rx * Math.cos(a), cy + orbit.ry * Math.sin(a), '.');
      }
    }
    orbit.labels.forEach((label, i) => {
      const a = t * orbit.speed + (i / orbit.labels.length) * 2 * Math.PI + orbit.rx;
      bodies.push({ x: cx + orbit.rx * Math.cos(a), y: cy + orbit.ry * Math.sin(a), label, front: Math.sin(a) >= 0 });
    });
  }

  const drawBody = ({ x, y, label, front }: (typeof bodies)[number]) => {
    put(grid, x, y, front ? 'O' : 'o');
    // Un espacio duro a cada lado separa la etiqueta de los puntos del anillo.
    write(grid, Math.round(x - label.length / 2) - 1, Math.round(y) + 1, `${SOLID_SPACE}${label}${SOLID_SPACE}`);
  };

  bodies.filter((b) => !b.front).forEach(drawBody);
  CORE.forEach((line, i) => write(grid, Math.round(cx - 3), cy - 1 + i, line.replaceAll(' ', SOLID_SPACE)));
  bodies.filter((b) => b.front).forEach(drawBody);
}

/** El sistema solo, como texto (para la consola y la imagen para redes). */
export const renderSystem = (t: number) => {
  const grid = createGrid(SYSTEM_COLS, SYSTEM_ROWS);
  drawSystem(grid, t, 0, 0);
  return toText(grid);
};

type Star = { x: number; y: number; ch: string; phase: number | null };
type Comet = { x: number; y: number; vx: number; vy: number; start: number };

/** `blocked` marca con 1 las celdas tapadas por texto: ahí no hay estrellas y los cometas pasan por detrás. */
export type Sky = { cols: number; rows: number; blocked: Uint8Array; stars: Star[]; comets: Comet[]; nextComet: number };

export function createSky(cols: number, rows: number, blocked = new Uint8Array(cols * rows), random = Math.random): Sky {
  const stars: Star[] = [];
  for (let i = 0; i < cols * rows * 0.012; i++) {
    const [x, y] = [Math.floor(random() * cols), Math.floor(random() * rows)];
    if (blocked[y * cols + x]) continue;
    const twinkles = random() < 0.25;
    stars.push({
      x,
      y,
      ch: random() < 0.85 ? '.' : "'",
      phase: twinkles ? random() * 40 : null,
    });
  }
  return { cols, rows, blocked, stars, comets: [], nextComet: 2 + random() * 4 };
}

/** Lanza un cometa desde (x, y) hacia abajo a la izquierda. */
export function launchComet(sky: Sky, x: number, y: number, t: number) {
  sky.comets.push({ x, y, vx: -26, vy: 9, start: t });
}

export type Scene = { back: string; front: string };

/**
 * Pinta el cielo en el instante `t` (segundos). `system` coloca el sistema en esa celda o lo omite.
 * Con `animate` falso no hay cometas nuevos (movimiento reducido).
 */
export function renderSky(sky: Sky, t: number, system: { x: number; y: number } | null, animate = true): Scene {
  const back = createGrid(sky.cols, sky.rows);
  const front = createGrid(sky.cols, sky.rows);
  if (system) drawSystem(front, t, system.x, system.y);

  for (const star of sky.stars) {
    if (!isFree(front, star.x, star.y)) continue;
    const ch = star.phase === null ? star.ch : TWINKLE[Math.floor(t * 2 + star.phase) % TWINKLE.length];
    put(back, star.x, star.y, ch);
  }

  if (animate && t >= sky.nextComet) {
    launchComet(sky, sky.cols * (0.35 + Math.random() * 0.65), -1, t);
    sky.nextComet = t + 7 + Math.random() * 7;
  }

  sky.comets = sky.comets.filter((comet) => {
    const age = t - comet.start;
    const [hx, hy] = [comet.x + comet.vx * age, comet.y + comet.vy * age];
    // Cola continua, una columna por carácter; pasa por detrás del sistema y del texto.
    [...COMET_TRAIL].forEach((ch, i) => {
      const [x, y] = [hx + i, hy - (comet.vy / -comet.vx) * i];
      if (isFree(front, x, y) && !sky.blocked[Math.round(y) * sky.cols + Math.round(x)]) put(front, x, y, ch);
    });
    return hx > -COMET_TRAIL.length * 2 && hy < sky.rows + COMET_TRAIL.length;
  });

  return { back: toText(back), front: toText(front) };
}
