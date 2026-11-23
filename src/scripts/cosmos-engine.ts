// Motor híbrido ASCII + Canvas 2D con proyección 3D real, física gravitacional
// y estelas luminosas para el Hero. Cero dependencias externas, 60fps y adaptable
// automáticamente al tema claro/oscuro y a `prefers-reduced-motion`.

type Vec2 = { x: number; y: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };

interface Star {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number; // profundidad [0.25, 1.0]
  glyph: string;
  phase: number;
  twinkleSpeed: number;
  accentTint: boolean;
}

interface OrbitSpec {
  radius: number;
  tiltX: number; // inclinación en X (rad)
  tiltZ: number; // rotación del plano en Z (rad)
  speed: number;
  labels: string[];
}

interface ProjectedBody {
  x: number;
  y: number;
  z: number;
  scale: number;
  label: string;
  orbitIndex: number;
  angle: number;
  highlighted: boolean;
}

interface Comet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  trail: Vec2[];
  boosted: boolean;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface Palette {
  accent: string;
  accentStrong: string;
  ink: string;
  muted: string;
  subtle: string;
  bg: string;
  isDark: boolean;
}

const ORBITS: OrbitSpec[] = [
  { radius: 74, tiltX: 1.08, tiltZ: -0.22, speed: 0.48, labels: ['React', 'Bun'] },
  { radius: 126, tiltX: 1.15, tiltZ: 0.16, speed: -0.3, labels: ['Hono', 'Prisma', 'TanStack'] },
  { radius: 182, tiltX: 1.04, tiltZ: -0.09, speed: 0.19, labels: ['PostgreSQL', 'Node.js', 'TypeScript'] },
];

const STAR_GLYPHS = ['.', '·', "'", '+', '*'];
const COMET_ASCII = '*=~-·.';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const isDark = document.documentElement.dataset.theme === 'dark';
  return {
    accent: get('--accent', isDark ? '#b39bff' : '#6d28d9'),
    accentStrong: get('--accent-strong', isDark ? '#cbbaff' : '#5b21b6'),
    ink: get('--ink', isDark ? '#eeeaf4' : '#17141f'),
    muted: get('--muted', isDark ? '#a39dae' : '#5d5868'),
    subtle: get('--subtle', isDark ? '#7a7486' : '#858091'),
    bg: get('--bg', isDark ? '#0e0c12' : '#f7f6f3'),
    isDark,
  };
}

function projectOrbitPoint(
  orbit: OrbitSpec,
  angle: number,
  extraTiltX: number,
  extraTiltY: number,
  scaleFactor: number,
) {
  const r = orbit.radius * scaleFactor;
  // Punto en el plano XZ de la órbita
  let x = Math.cos(angle) * r;
  let y = 0;
  let z = Math.sin(angle) * r;

  // Inclinación en X (tiltX)
  const tx = orbit.tiltX + extraTiltX;
  const cosX = Math.cos(tx);
  const sinX = Math.sin(tx);
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  y = y1;
  z = z1;

  // Rotación en Y por el cursor (paralaje 3D)
  const cosY = Math.cos(extraTiltY);
  const sinY = Math.sin(extraTiltY);
  const x2 = x * cosY + z * sinY;
  const z2 = -x * sinY + z * cosY;
  x = x2;
  z = z2;

  // Rotación en Z (tiltZ)
  const cosZ = Math.cos(orbit.tiltZ);
  const sinZ = Math.sin(orbit.tiltZ);
  const x3 = x * cosZ - y * sinZ;
  const y3 = x * sinZ + y * cosZ;

  // Perspectiva
  const fov = 540 * Math.max(0.75, scaleFactor);
  const persp = fov / (fov + z2 + 120);

  return {
    x: x3 * persp,
    y: y3 * persp,
    z: z2,
    scale: persp,
  };
}

export function mountCosmos(container: HTMLElement, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy() {} };

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let palette = readPalette();
  let monoFont = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';

  let width = 0;
  let height = 0;
  let dpr = 1;
  let stars: Star[] = [];
  let comets: Comet[] = [];
  let shockwaves: Shockwave[] = [];
  let textRects: Rect[] = [];

  // Posición y escala del sistema orbital
  let systemCenter: Vec2 = { x: 0, y: 0 };
  let systemScale = 1;
  let systemOpacity = 1;

  // Estado del puntero y física suave
  const pointer = { x: 0, y: 0, active: false, overSystem: false };
  let camX = 0;
  let camY = 0;
  let time = 6;
  let speed = 1;
  let targetSpeed = 1;
  let nextCometAt = 2.2;
  let rafId = 0;
  let visible = true;
  let lastNow = performance.now();

  const measureTextRects = () => {
    const origin = container.getBoundingClientRect();
    const nodes = container.querySelectorAll('.eyebrow, .title, .bio, .cta, .meta');
    textRects = [...nodes].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x0: r.left - origin.left - 18,
        y0: r.top - origin.top - 14,
        x1: r.right - origin.left + 18,
        y1: r.bottom - origin.top + 14,
      };
    });
  };

  const textFadeAt = (x: number, y: number): number => {
    for (const r of textRects) {
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
        return 0.16;
      }
    }
    return 1;
  };

  const buildStars = () => {
    const area = width * height;
    const count = clamp(Math.round(area / 5200), 55, 165);
    stars = [];
    for (let i = 0; i < count; i++) {
      const homeX = Math.random() * width;
      const homeY = Math.random() * height;
      const z = 0.28 + Math.random() * 0.72;
      const glyphIndex = z > 0.85 ? (Math.random() < 0.45 ? 3 : 4) : Math.floor(Math.random() * 3);
      stars.push({
        homeX,
        homeY,
        x: homeX,
        y: homeY,
        vx: 0,
        vy: 0,
        z,
        glyph: STAR_GLYPHS[glyphIndex],
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: 1.2 + Math.random() * 2.4,
        accentTint: Math.random() < 0.24,
      });
    }
  };

  const updateLayout = () => {
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const title = container.querySelector<HTMLElement>('.title');
    const titleMidY = title ? title.offsetTop + title.offsetHeight * 0.48 : height * 0.4;

    if (width >= 1040) {
      systemScale = clamp(width / 1180, 0.88, 1.08);
      systemCenter = { x: width * 0.77, y: Math.max(185, titleMidY + 8) };
      systemOpacity = 1;
    } else if (width >= 700) {
      systemScale = 0.72;
      systemCenter = { x: width * 0.8, y: Math.max(150, titleMidY - 4) };
      systemOpacity = 0.82;
    } else {
      systemScale = 0.52;
      systemCenter = { x: width * 0.82, y: Math.max(115, titleMidY - 22) };
      systemOpacity = 0.46;
    }

    monoFont = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace';
    measureTextRects();
    buildStars();
    renderFrame(0);
  };

  const spawnComet = (x: number, y: number, vx: number, vy: number, boosted = false) => {
    comets.push({
      x,
      y,
      vx,
      vy,
      life: 0,
      maxLife: boosted ? 2.6 : 3.2,
      trail: [{ x, y }],
      boosted,
    });
  };

  const triggerPulse = (x: number, y: number) => {
    shockwaves.push({
      x,
      y,
      radius: 6,
      maxRadius: 210,
      alpha: 0.75,
    });

    // Impulso radial sobre las estrellas cercanas
    for (const s of stars) {
      const dx = s.x - x;
      const dy = s.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1 && dist < 240) {
        const force = ((240 - dist) / 240) * 180 * s.z;
        s.vx += (dx / dist) * force;
        s.vy += (dy / dist) * force;
      }
    }

    // Lanza un cometa dirigido ligeramente hacia el núcleo para que la gravedad lo curve
    const dx = systemCenter.x - x;
    const dy = systemCenter.y - y;
    const baseAngle = Math.atan2(dy, dx) + (Math.random() < 0.5 ? 0.55 : -0.55);
    const vel = 260 + Math.random() * 90;
    spawnComet(x, y, Math.cos(baseAngle) * vel, Math.sin(baseAngle) * vel, true);
  };

  const stepPhysics = (dt: number) => {
    speed += (targetSpeed - speed) * Math.min(1, dt * 4.5);
    time += dt * speed;

    // Cámara suave hacia el cursor
    const targetCamX = pointer.active ? (pointer.x / width - 0.5) * 2 : 0;
    const targetCamY = pointer.active ? (pointer.y / height - 0.5) * 2 : 0;
    camX += (targetCamX - camX) * Math.min(1, dt * 4);
    camY += (targetCamY - camY) * Math.min(1, dt * 4);

    // Física de estrellas: atracción gravitacional al cursor + resorte al origen
    const gravityRadius = 175;
    for (const s of stars) {
      const parallaxX = s.homeX - camX * 22 * s.z;
      const parallaxY = s.homeY - camY * 16 * s.z;

      // Resorte hacia su posición base con paralaje
      s.vx += (parallaxX - s.x) * 5.2 * dt;
      s.vy += (parallaxY - s.y) * 5.2 * dt;

      if (pointer.active) {
        const dx = pointer.x - s.x;
        const dy = pointer.y - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 14 && dist < gravityRadius) {
          const pull = ((gravityRadius - dist) / gravityRadius) * 210 * s.z;
          s.vx += (dx / dist) * pull * dt;
          s.vy += (dy / dist) * pull * dt;
        }
      }

      const damping = Math.exp(-4.6 * dt);
      s.vx *= damping;
      s.vy *= damping;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }

    // Cometas ambientales
    if (time >= nextCometAt && comets.length < 4) {
      const startX = width * (0.4 + Math.random() * 0.65);
      const startY = -10;
      spawnComet(startX, startY, -(190 + Math.random() * 90), 85 + Math.random() * 55, false);
      nextCometAt = time + 4.5 + Math.random() * 5.5;
    }

    // Física gravitacional de los cometas alrededor del núcleo ( vr )
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      c.life += dt;

      const gx = systemCenter.x - c.x;
      const gy = systemCenter.y - c.y;
      const distSq = gx * gx + gy * gy + 6400;
      const dist = Math.sqrt(distSq);
      const gForce = (c.boosted ? 980000 : 520000) / distSq;
      c.vx += (gx / dist) * gForce * dt;
      c.vy += (gy / dist) * gForce * dt;

      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.trail.unshift({ x: c.x, y: c.y });
      if (c.trail.length > (c.boosted ? 22 : 15)) c.trail.pop();

      const outOfBounds = c.x < -120 || c.x > width + 120 || c.y < -120 || c.y > height + 120;
      if (c.life >= c.maxLife || outOfBounds) {
        comets.splice(i, 1);
      }
    }

    // Ondas de choque
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const sw = shockwaves[i];
      sw.radius += (sw.maxRadius - sw.radius) * Math.min(1, dt * 5.5) + 45 * dt;
      sw.alpha = Math.max(0, (1 - sw.radius / sw.maxRadius) * 0.65);
      if (sw.radius >= sw.maxRadius - 1) shockwaves.splice(i, 1);
    }
  };

  const drawOrbitRing = (orbit: OrbitSpec, extraTiltX: number, extraTiltY: number, isFront: boolean) => {
    const segments = 68;
    ctx.save();
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 0.52) / segments) * Math.PI * 2;
      const p0 = projectOrbitPoint(orbit, a0, extraTiltX, extraTiltY, systemScale);
      const p1 = projectOrbitPoint(orbit, a1, extraTiltX, extraTiltY, systemScale);
      if (isFront ? p0.z > 0 : p0.z <= 0) continue;

      const depthAlpha = clamp(0.14 + (p0.scale - 0.6) * 0.65, 0.1, 0.45) * systemOpacity;
      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = depthAlpha;
      ctx.lineWidth = Math.max(0.8, 1.15 * p0.scale);
      ctx.beginPath();
      ctx.moveTo(systemCenter.x + p0.x, systemCenter.y + p0.y);
      ctx.lineTo(systemCenter.x + p1.x, systemCenter.y + p1.y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawCore = () => {
    const cx = systemCenter.x;
    const cy = systemCenter.y;
    const pulse = 1 + Math.sin(time * 2.2) * 0.055;
    const r = 30 * systemScale * pulse;

    ctx.save();
    ctx.globalAlpha = systemOpacity;

    // Aura radial suave
    const aura = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 2.7);
    aura.addColorStop(0, palette.accent);
    aura.addColorStop(0.45, palette.isDark ? 'rgba(179, 155, 255, 0.12)' : 'rgba(109, 40, 217, 0.10)');
    aura.addColorStop(1, 'transparent');
    ctx.fillStyle = aura;
    ctx.globalAlpha = (palette.isDark ? 0.34 : 0.24) * systemOpacity;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.7, 0, Math.PI * 2);
    ctx.fill();

    // Anillo hexagonal giratorio alrededor del núcleo
    ctx.globalAlpha = 0.55 * systemOpacity;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    const hexR = r * 1.05;
    for (let i = 0; i <= 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + time * 0.22;
      const hx = cx + Math.cos(ang) * hexR;
      const hy = cy + Math.sin(ang) * hexR;
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.stroke();

    // Disco interior sólido para que las órbitas traseras queden ocluidas
    ctx.globalAlpha = 0.92 * systemOpacity;
    ctx.fillStyle = palette.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.85 * systemOpacity;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Emblema ASCII `( vr )` en el centro
    ctx.globalAlpha = systemOpacity;
    ctx.fillStyle = palette.accent;
    ctx.font = `600 ${Math.round(12 * systemScale)}px ${monoFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('( vr )', cx, cy + 0.5);

    ctx.restore();
  };

  const drawBody = (body: ProjectedBody, orbit: OrbitSpec, extraTiltX: number, extraTiltY: number) => {
    const bx = systemCenter.x + body.x;
    const by = systemCenter.y + body.y;
    const depthAlpha = clamp(0.38 + (body.scale - 0.62) * 1.15, 0.32, 1) * systemOpacity;

    ctx.save();

    // Estela orbital luminosa detrás del planeta
    const dir = orbit.speed >= 0 ? -1 : 1;
    const trailSteps = 10;
    ctx.beginPath();
    for (let i = 0; i <= trailSteps; i++) {
      const a = body.angle + dir * i * 0.065;
      const p = projectOrbitPoint(orbit, a, extraTiltX, extraTiltY, systemScale);
      const px = systemCenter.x + p.x;
      const py = systemCenter.y + p.y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = depthAlpha * (body.highlighted ? 0.75 : 0.35);
    ctx.lineWidth = Math.max(1.2, 2.2 * body.scale);
    ctx.lineCap = 'round';
    ctx.stroke();

    // Rayo de conexión al núcleo cuando se hace hover en un planeta
    if (body.highlighted) {
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = palette.accentStrong;
      ctx.globalAlpha = 0.55 * systemOpacity;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(systemCenter.x, systemCenter.y);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    }

    // Halo del planeta
    const dotR = (body.highlighted ? 5.2 : 3.6) * body.scale * systemScale;
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, dotR * 3.8);
    glow.addColorStop(0, palette.accent);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.globalAlpha = depthAlpha * (body.highlighted ? 0.75 : 0.4);
    ctx.beginPath();
    ctx.arc(bx, by, dotR * 3.8, 0, Math.PI * 2);
    ctx.fill();

    // Núcleo del planeta
    ctx.fillStyle = body.highlighted ? palette.accentStrong : palette.accent;
    ctx.globalAlpha = depthAlpha;
    ctx.beginPath();
    ctx.arc(bx, by, dotR, 0, Math.PI * 2);
    ctx.fill();

    // Etiqueta monospace del stack
    const fontSize = Math.max(9.5, Math.round(11 * body.scale * Math.max(0.82, systemScale)));
    ctx.font = `${body.highlighted ? 600 : 500} ${fontSize}px ${monoFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = by + dotR + 5;

    // Fondo sutil tipo píldora invisible para máxima legibilidad sobre estrellas
    const textW = ctx.measureText(body.label).width;
    ctx.fillStyle = palette.bg;
    ctx.globalAlpha = depthAlpha * 0.72;
    ctx.fillRect(bx - textW / 2 - 4, labelY - 1, textW + 8, fontSize + 3);

    ctx.fillStyle = body.highlighted ? palette.accentStrong : body.z < 0 ? palette.ink : palette.muted;
    ctx.globalAlpha = depthAlpha;
    ctx.fillText(body.label, bx, labelY);

    ctx.restore();
  };

  const renderFrame = (dt: number) => {
    if (dt > 0) stepPhysics(dt);

    ctx.clearRect(0, 0, width, height);

    // 1. Estrellas ASCII con profundidad y constelación cerca del cursor
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const nearPointer: Star[] = [];
    for (const s of stars) {
      const fade = textFadeAt(s.x, s.y);
      const twinkle = 0.55 + 0.45 * Math.sin(time * s.twinkleSpeed + s.phase);
      const alpha = (0.24 + s.z * 0.56) * twinkle * fade;

      ctx.font = `${Math.round(9 + s.z * 5)}px ${monoFont}`;
      ctx.fillStyle = s.accentTint ? palette.accent : palette.subtle;
      ctx.globalAlpha = alpha;
      ctx.fillText(s.glyph, s.x, s.y);

      if (pointer.active) {
        const d = Math.hypot(pointer.x - s.x, pointer.y - s.y);
        if (d < 135 && fade > 0.5) nearPointer.push(s);
      }
    }

    // Filamentos gravitacionales sutiles hacia el cursor
    if (pointer.active && nearPointer.length > 0) {
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 0.85;
      for (const s of nearPointer.slice(0, 9)) {
        const d = Math.hypot(pointer.x - s.x, pointer.y - s.y);
        ctx.globalAlpha = (1 - d / 135) * (palette.isDark ? 0.28 : 0.2);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 2. Cometas con estela luminosa + caracteres ASCII
    ctx.save();
    ctx.font = `11px ${monoFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of comets) {
      const fadeLife = Math.min(1, (c.maxLife - c.life) * 1.4);
      if (c.trail.length > 1) {
        for (let i = 0; i < c.trail.length - 1; i++) {
          const p0 = c.trail[i];
          const p1 = c.trail[i + 1];
          const ratio = 1 - i / c.trail.length;
          const textFade = textFadeAt(p0.x, p0.y);
          ctx.strokeStyle = palette.accent;
          ctx.globalAlpha = ratio * 0.65 * fadeLife * textFade;
          ctx.lineWidth = Math.max(0.8, ratio * (c.boosted ? 2.8 : 2));
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();

          if (i % 2 === 0 && i / 2 < COMET_ASCII.length) {
            ctx.fillStyle = palette.accentStrong;
            ctx.globalAlpha = ratio * 0.85 * fadeLife * textFade;
            ctx.fillText(COMET_ASCII[i / 2], p0.x, p0.y);
          }
        }
      }
    }
    ctx.restore();

    // 3. Ondas de choque al hacer clic
    ctx.save();
    for (const sw of shockwaves) {
      ctx.strokeStyle = palette.accent;
      ctx.globalAlpha = sw.alpha;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Sistema orbital 3D (mitad trasera → núcleo → mitad delantera)
    const extraTiltX = camY * 0.22;
    const extraTiltY = camX * 0.28;

    const bodies: ProjectedBody[] = [];
    let closestBody: ProjectedBody | null = null;
    let closestDist = 42;

    ORBITS.forEach((orbit, orbitIndex) => {
      orbit.labels.forEach((label, i) => {
        const angle = time * orbit.speed + (i / orbit.labels.length) * Math.PI * 2 + orbitIndex * 1.4;
        const p = projectOrbitPoint(orbit, angle, extraTiltX, extraTiltY, systemScale);
        const body: ProjectedBody = {
          x: p.x,
          y: p.y,
          z: p.z,
          scale: p.scale,
          label,
          orbitIndex,
          angle,
          highlighted: false,
        };
        bodies.push(body);

        if (pointer.active) {
          const d = Math.hypot(systemCenter.x + p.x - pointer.x, systemCenter.y + p.y - pointer.y);
          if (d < closestDist) {
            closestDist = d;
            closestBody = body;
          }
        }
      });
    });

    if (closestBody) (closestBody as ProjectedBody).highlighted = true;

    // Anillos traseros
    ORBITS.forEach((orbit) => drawOrbitRing(orbit, extraTiltX, extraTiltY, false));

    // Planetas traseros ordenados por profundidad
    bodies
      .filter((b) => b.z > 0)
      .sort((a, b) => b.z - a.z)
      .forEach((b) => drawBody(b, ORBITS[b.orbitIndex], extraTiltX, extraTiltY));

    // Núcleo central
    drawCore();

    // Anillos delanteros
    ORBITS.forEach((orbit) => drawOrbitRing(orbit, extraTiltX, extraTiltY, true));

    // Planetas delanteros ordenados por profundidad
    bodies
      .filter((b) => b.z <= 0)
      .sort((a, b) => b.z - a.z)
      .forEach((b) => drawBody(b, ORBITS[b.orbitIndex], extraTiltX, extraTiltY));
  };

  const loop = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
    lastNow = now;
    renderFrame(dt);
    rafId = requestAnimationFrame(loop);
  };

  const startLoop = () => {
    if (reducedMotion || rafId) return;
    lastNow = performance.now();
    rafId = requestAnimationFrame(loop);
  };

  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  // Observadores
  const resizeObserver = new ResizeObserver(updateLayout);
  resizeObserver.observe(container);

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) startLoop();
    else stopLoop();
  });
  intersectionObserver.observe(container);

  const themeObserver = new MutationObserver(() => {
    palette = readPalette();
    if (reducedMotion) renderFrame(0);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Eventos de puntero
  const onPointerMove = (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    pointer.active = true;

    const distToCore = Math.hypot(pointer.x - systemCenter.x, pointer.y - systemCenter.y);
    pointer.overSystem = distToCore < 205 * systemScale;
    targetSpeed = pointer.overSystem ? 0.24 : 1;
  };

  const onPointerLeave = () => {
    pointer.active = false;
    pointer.overSystem = false;
    targetSpeed = 1;
  };

  const onClick = (e: MouseEvent) => {
    if (reducedMotion) return;
    if ((e.target as Element).closest('a, button') || String(getSelection())) return;
    const rect = container.getBoundingClientRect();
    triggerPulse(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onAnimEnd = () => {
    measureTextRects();
  };

  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerleave', onPointerLeave);
  container.addEventListener('click', onClick);
  container.addEventListener('animationend', onAnimEnd);

  updateLayout();
  document.fonts.ready.then(updateLayout);
  if (!reducedMotion && visible) startLoop();

  return {
    destroy() {
      stopLoop();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      themeObserver.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('click', onClick);
      container.removeEventListener('animationend', onAnimEnd);
    },
  };
}
