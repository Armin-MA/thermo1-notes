/**
 * Shared SVG & live physics simulation utilities for Smart Course Notes widgets.
 * Helical spring parametric curve adapted from MIT-licensed ray-pH/diagramatics.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Generates an SVG path string for a vertical helical coil spring between yTop and yBottom at x.
 */
export function buildSpringPath(
  x: number,
  yTop: number,
  yBottom: number,
  coils = 8,
  amp = 13,
  samples = 72
): string {
  const span = Math.max(14, yBottom - yTop);
  const lead = Math.min(5, span * 0.12);
  const usable = span - 2 * lead;
  const rSep = Math.max(0.25, usable / ((2 * coils + 1) * Math.PI));
  const aMax = (2 * coils + 1) * Math.PI;
  const b = (usable - 2 * rSep) / aMax;

  let d = `M ${x.toFixed(1)} ${yTop.toFixed(1)} L ${x.toFixed(1)} ${(yTop + lead).toFixed(1)}`;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * aMax;
    const py = yTop + lead + b * t + rSep - rSep * Math.cos(t);
    const px = x + amp * Math.sin(t);
    d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  d += ` L ${x.toFixed(1)} ${yBottom.toFixed(1)}`;
  return d;
}

/**
 * Generates an SVG path string for a horizontal helical coil spring between xLeft and xRight at y.
 */
export function buildHorizontalSpringPath(
  y: number,
  xLeft: number,
  xRight: number,
  coils = 8,
  amp = 12,
  samples = 72
): string {
  const span = Math.max(14, xRight - xLeft);
  const lead = Math.min(6, span * 0.12);
  const usable = span - 2 * lead;
  const rSep = Math.max(0.25, usable / ((2 * coils + 1) * Math.PI));
  const aMax = (2 * coils + 1) * Math.PI;
  const b = (usable - 2 * rSep) / aMax;

  let d = `M ${xLeft.toFixed(1)} ${y.toFixed(1)} L ${(xLeft + lead).toFixed(1)} ${y.toFixed(1)}`;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * aMax;
    const px = xLeft + lead + b * t + rSep - rSep * Math.cos(t);
    const py = y + amp * Math.sin(t);
    d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  d += ` L ${xRight.toFixed(1)} ${y.toFixed(1)}`;
  return d;
}

export interface Viewport {
  x: (v: number) => number;
  y: (v: number) => number;
  path: (pts: ReadonlyArray<readonly [number, number]>, closed?: boolean) => string;
}

/**
 * Creates a linear coordinate mapper from domain [xMin,xMax] x [yMin,yMax] to SVG pixels.
 */
export function createViewport(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  pxLeft: number,
  pxRight: number,
  pxBottom: number,
  pxTop: number
): Viewport {
  const dx = xMax - xMin || 1;
  const dy = yMax - yMin || 1;
  const x = (v: number) => pxLeft + ((v - xMin) / dx) * (pxRight - pxLeft);
  const y = (v: number) => pxBottom - ((v - yMin) / dy) * (pxBottom - pxTop);
  const path = (pts: ReadonlyArray<readonly [number, number]>, closed = false) => {
    if (!pts.length) return '';
    let d = pts
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${x(pt[0]).toFixed(1)} ${y(pt[1]).toFixed(1)}`)
      .join(' ');
    if (closed) d += ' Z';
    return d;
  };
  return { x, y, path };
}

/**
 * Maps a temperature in Kelvin to a calm academic thermal hue.
 */
export function tempToColor(tempK: number): string {
  if (tempK <= 245) return '#38bdf8';
  if (tempK <= 335) return '#0284c7';
  if (tempK <= 490) return '#f59e0b';
  return '#ef4444';
}

/**
 * Updates a mercury thermometer column height smoothly inside an SVG.
 */
export function setThermometer(
  mercEl: Element | null,
  val: number,
  minVal: number,
  maxVal: number,
  bottomY = 104,
  maxH = 72
): void {
  if (!mercEl) return;
  const norm = Math.max(0.08, Math.min(1, (val - minVal) / (maxVal - minVal || 1)));
  const h = 10 + norm * (maxH - 10);
  mercEl.setAttribute('y', (bottomY - h).toFixed(1));
  mercEl.setAttribute('height', h.toFixed(1));
}

/**
 * Rotates a dial gauge needle (-135 deg to +135 deg) centered at (0, 0).
 */
export function setDialNeedle(
  needleEl: Element | null,
  val: number,
  minVal: number,
  maxVal: number,
  len = 21
): void {
  if (!needleEl) return;
  const ratio = Math.max(0, Math.min(1, (val - minVal) / (maxVal - minVal || 1)));
  const angleDeg = -135 + ratio * 270;
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  needleEl.setAttribute('x2', (Math.cos(rad) * len).toFixed(1));
  needleEl.setAttribute('y2', (Math.sin(rad) * len).toFixed(1));
}

export interface AnimController {
  start: () => void;
  stop: () => void;
  isPlaying: () => boolean;
}

/**
 * Visibility-aware requestAnimationFrame loop controller (zero idle CPU burn).
 */
export function createAnimController(
  root: HTMLElement,
  onStep: (dt: number) => boolean | void
): AnimController {
  let playing = false;
  let visible = true;
  let rafId = 0;
  let lastTs = 0;

  function tick(now: number) {
    if (!playing || !visible) {
      rafId = 0;
      return;
    }
    if (!lastTs) lastTs = now;
    const dt = Math.min((now - lastTs) / 1000, 0.05);
    lastTs = now;

    const keepGoing = onStep(dt);
    if (keepGoing === false) {
      playing = false;
      rafId = 0;
      return;
    }
    if (playing) {
      rafId = requestAnimationFrame(tick);
    }
  }

  if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible && playing && !rafId) {
          lastTs = 0;
          rafId = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.05 }
    );
    obs.observe(root);
  }

  return {
    start() {
      playing = true;
      lastTs = 0;
      if (!rafId && visible) {
        rafId = requestAnimationFrame(tick);
      }
    },
    stop() {
      playing = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    isPlaying() {
      return playing;
    },
  };
}

export interface ParticleBox {
  step: (dt: number, speedScale?: number) => void;
}

/**
 * Creates 2D elastic gas molecules inside an SVG group with dynamic cavity bounds.
 */
export function createParticleBox(
  groupEl: Element | null,
  count: number,
  getBounds: () => { minX: number; maxX: number; minY: number; maxY: number },
  color = 'currentColor',
  radius = 2.4,
  baseSpeed = 48
): ParticleBox {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const b0 = getBounds();
  const particles: Array<{ x: number; y: number; vx: number; vy: number; el: SVGCircleElement }> = [];

  if (groupEl) {
    groupEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const ang = (i * 2.39996 + 0.35) % (Math.PI * 2);
      const px = b0.minX + ((i * 29 + 7) % Math.max(12, Math.floor(b0.maxX - b0.minX)));
      const py = b0.minY + ((i * 19 + 5) % Math.max(12, Math.floor(b0.maxY - b0.minY)));
      const el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('r', String(radius));
      el.setAttribute('fill', color);
      el.setAttribute('fill-opacity', '0.78');
      el.setAttribute('cx', px.toFixed(1));
      el.setAttribute('cy', py.toFixed(1));
      groupEl.appendChild(el);
      particles.push({
        x: px,
        y: py,
        vx: Math.cos(ang) * baseSpeed,
        vy: Math.sin(ang) * baseSpeed,
        el,
      });
    }
  }

  return {
    step(dt: number, speedScale = 1) {
      const b = getBounds();
      for (const p of particles) {
        if (dt > 0) {
          p.x += p.vx * speedScale * dt;
          p.y += p.vy * speedScale * dt;
        }
        if (p.x < b.minX) {
          p.x = b.minX;
          p.vx = Math.abs(p.vx);
        } else if (p.x > b.maxX) {
          p.x = b.maxX;
          p.vx = -Math.abs(p.vx);
        }
        if (p.y < b.minY) {
          p.y = b.minY;
          p.vy = Math.abs(p.vy);
        } else if (p.y > b.maxY) {
          p.y = b.maxY;
          p.vy = -Math.abs(p.vy);
        }
        p.el.setAttribute('cx', p.x.toFixed(1));
        p.el.setAttribute('cy', p.y.toFixed(1));
      }
    },
  };
}
