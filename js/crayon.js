// Flat Earth website: the book's crayon "hand", ported to the browser.
// Same seeded strokes, hatching, handwriting, paper and grain as crayon-kit/scripts/crayon-kit.js,
// so the website draws exactly the way the printed pages do. The only change is that it draws
// on a <canvas> you pass in, in a logical coordinate space (width x height) scaled to the
// canvas's real pixel size, so maps stay sharp on high-density screens.
//
//   const art = createArt(canvas, { width: 1800, height: 1800, seed: 7, paper: BOOK_PAPER });
//   art.paperBackground(); ...draw... ; art.grain();

export const INK = '#1d1b1e';
export const WATER = ['#b8d6ea', '#a9cce3', '#c5dfee'];
export const WATER2 = ['#9ec3dc', '#bad7ea'];
export const FONT = 'Architect';
export const ORANGE = ['#ff8c1a', '#e8491d']; // the orange-peel accent from the front cover

export function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Same recipe as crayon-kit's makePaper('#f3ecdb', { ink }) used on every interior page.
export function makePaper(base, o = {}) {
  const [r, g, b] = hexToRgb(base);
  const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  const shift = (d, n = [0, 0, 0]) => '#' + [r, g, b].map((c, i) => Math.max(0, Math.min(255, Math.round(c + d + n[i]))))
    .map((c) => c.toString(16).padStart(2, '0')).join('');
  const s = lum < 0.35 ? 1 : -1;
  return {
    base,
    fibers: o.fibers || [[shift(0), shift(3 * s)], [shift(10 * s, [0, 2, 12]), shift(14 * s, [0, 3, 16])],
      [shift(9 * s, [10, 0, 14]), shift(13 * s, [12, 0, 18])], [shift(8 * s, [0, 10, 10]), shift(11 * s, [0, 12, 12])]],
    fiberAlpha: o.fiberAlpha || (lum < 0.35 ? [0.85, 0.65, 0.4] : [0.55, 0.4, 0.25]),
    swirl: o.swirl || [shift(22 * s)],
    ink: o.ink || '#2e2a2f', ink2: o.ink2 || '#3a5a8c', accent: o.accent || '#d9480f',
  };
}
export const BOOK_PAPER = makePaper('#f3ecdb', { ink: INK, ink2: INK, accent: INK });

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = (t) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1), u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => noise2(x, y) * 0.6 + noise2(x * 2.3, y * 2.3) * 0.28 + noise2(x * 5.1, y * 5.1) * 0.12;

export function createArt(canvas, { width: W, height: H, seed = 1, paper = BOOK_PAPER, clear = false }) {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const scale = canvas.width / W;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (clear) ctx.clearRect(0, 0, W, H);

  const rand = mulberry32(seed);

  // Batched ink. The print engine strokes every dash on its own; on screen that is far too slow, so
  // dashes are grouped by colour, pressure (alpha), width and pass, then each group is one stroke.
  // Passes stay separate groups so re-traced lines still darken the way they do on paper.
  let buckets = new Map(), depth = 0;
  const AQ = 6, WQ = 4;
  function dash(x0, y0, x1, y1, color, alpha, width, pass) {
    const a = Math.max(1, Math.round(alpha * AQ)), wq = Math.max(1, Math.round(width * WQ));
    const key = color + '|' + a + '|' + wq + '|' + pass;
    let b = buckets.get(key);
    if (!b) { b = { color, alpha: a / AQ, width: wq / WQ, pts: [] }; buckets.set(key, b); }
    b.pts.push(x0, y0, x1, y1);
  }
  function flush() {
    ctx.lineCap = 'round';
    for (const b of buckets.values()) {
      ctx.strokeStyle = b.color; ctx.globalAlpha = Math.min(1, b.alpha); ctx.lineWidth = b.width;
      ctx.beginPath();
      const p = b.pts;
      for (let i = 0; i < p.length; i += 4) { ctx.moveTo(p[i], p[i + 1]); ctx.lineTo(p[i + 2], p[i + 3]); }
      ctx.stroke();
    }
    buckets = new Map(); ctx.globalAlpha = 1;
  }
  // Run fn with every stroke batched, then ink it all at once. Nest freely; clip changes need a flush first.
  function batch(fn) { depth++; try { fn(); } finally { depth--; if (!depth) flush(); } }
  const R = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  function resample(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    }
    return out;
  }
  function curve(p0, c, p1, n = 30) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); }
    return pts;
  }
  function wobblyEllipse(cx, cy, rx, ry, rot = 0, over = 0.25, wob = 0.03, s0 = R(0, 99)) {
    const pts = [], a0 = R(0, Math.PI * 2), n = Math.max(40, Math.floor((rx + ry) * 0.5));
    for (let i = 0; i <= n; i++) {
      const t = a0 + (Math.PI * 2 + over) * i / n, k = 1 + (fbm(Math.cos(t) * 1.5 + s0, Math.sin(t) * 1.5) - 0.5) * wob * 2;
      const x = Math.cos(t) * rx * k, y = Math.sin(t) * ry * k;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return pts;
  }

  // THE CRAYON: resample, sway with noise, lay down short waxy dashes with varying pressure and skips.
  function crayon(pts, o = {}) {
    const { color = paper.ink, width = 2.2, alpha = 0.85, passes = 3, jitter = 0.9, wobble = 2.2, freq = 0.012,
      breakProb = 0.03, step = 5, colors = null, crumple = 0 } = o;
    if (pts.length < 2) return;
    const base = resample(pts, step);
    ctx.lineCap = 'round';
    for (let p = 0; p < passes; p++) {
      const sd = R(0, 1000), off = R(-jitter, jitter);
      let gap = 0, prev = null, dist = 0;
      for (let i = 0; i < base.length; i++) {
        const [x, y] = base[i];
        const nx = i < base.length - 1 ? base[i + 1][0] - x : x - base[i - 1][0];
        const ny = i < base.length - 1 ? base[i + 1][1] - y : y - base[i - 1][1];
        const len = Math.hypot(nx, ny) || 1, px = -ny / len, py = nx / len;
        dist += len;
        let w = (fbm(dist * freq + sd, sd) - 0.5) * 2 * wobble + off;
        if (crumple > 0) w += (noise2(dist * 0.09 + sd, 3.1) - 0.5) * crumple;
        const q = [x + px * w + R(-jitter, jitter) * 0.5, y + py * w + R(-jitter, jitter) * 0.5];
        if (prev) {
          if (gap > 0) gap--;
          else if (rand() < breakProb) gap = Math.floor(R(1, 4));
          else {
            dash(prev[0], prev[1], q[0], q[1], colors ? pick(colors) : color, alpha * R(0.45, 1), width * R(0.6, 1.25), p);
          }
        }
        prev = q;
      }
    }
    if (!depth) flush();
  }

  // Fill = layered hatching clipped to a shape.
  function hatchFill(clipFn, box, layers) {
    if (depth) flush();
    ctx.save(); ctx.beginPath(); clipFn(); ctx.clip();
    depth++;
    const [bx, by, bw, bh] = box, cx = bx + bw / 2, cy = by + bh / 2, diag = Math.hypot(bw, bh) / 2 + 10;
    for (const L of layers) {
      const a = L.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), pxv = -dy, pyv = dx;
      for (let s = -diag; s <= diag; s += L.spacing * R(0.7, 1.3)) {
        if (L.density && rand() > L.density) continue;
        const ox = cx + pxv * s, oy = cy + pyv * s;
        crayon([[ox - dx * diag, oy - dy * diag], [ox + dx * diag, oy + dy * diag]], {
          colors: L.colors, width: L.width || 2, alpha: L.alpha || 0.7, passes: 1,
          wobble: L.wobble ?? 1.2, jitter: 0.6, breakProb: L.breakProb ?? 0.06, step: L.step || 5,
        });
      }
    }
    depth--; flush();
    ctx.restore();
  }

  // Handwriting: each character jitters in size, tilt and baseline and is traced 3 times.
  function scrawl(text, x, y, o = {}) {
    const { size = 40, color = paper.ink, align = 'left', font = FONT, rot = 0, alpha = 0.95 } = o;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const chars = [...text].map((c) => ({ c, s: size * R(0.94, 1.06), r: R(-0.05, 0.05), dy: R(-1.8, 1.8) * size / 40 }));
    let total = 0;
    for (const ch of chars) { ctx.font = `${ch.s}px ${font}`; ch.w = ctx.measureText(ch.c).width; total += ch.w; }
    let cx = align === 'center' ? -total / 2 : align === 'right' ? -total : 0, drift = 0;
    for (const ch of chars) {
      drift += R(-0.35, 0.35);
      for (let p = 0; p < 3; p++) {
        ctx.save();
        ctx.translate(cx + R(-0.8, 0.8) * size / 40, ch.dy + drift * 0.4 * size / 40 + R(-0.8, 0.8) * size / 40); ctx.rotate(ch.r);
        ctx.font = `${ch.s}px ${font}`; ctx.fillStyle = color; ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * (p === 0 ? 0.85 : 0.45);
        ctx.fillText(ch.c, 0, 0);
        ctx.lineWidth = ch.s * 0.028; ctx.lineJoin = 'round'; ctx.strokeText(ch.c, 0, 0);
        ctx.restore();
      }
      cx += ch.w;
    }
    ctx.restore();
    return total;
  }
  function textWidth(text, size, font = FONT) { ctx.font = `${size}px ${font}`; return ctx.measureText(text).width; }
  function underline(x0, x1, y, color = paper.accent) {
    crayon(curve([x0, y], [(x0 + x1) / 2, y - 12], [x1, y + 4]), { color, width: 3.4, alpha: 0.85, passes: 3, wobble: 3, crumple: 4, breakProb: 0.05 });
  }

  function paperBackground() {
    ctx.fillStyle = paper.base; ctx.fillRect(0, 0, W, H);
    const G = paper.fibers.length;
    const layer = (angle, spacing, alpha, sc, so) => {
      const a = angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), diag = Math.hypot(W, H) / 2 + 20;
      ctx.lineCap = 'round';
      for (let s = -diag; s <= diag; s += spacing * R(0.6, 1.4)) {
        const ox = W / 2 - dy * s, oy = H / 2 + dx * s;
        const pts = resample([[ox - dx * diag, oy - dy * diag], [ox + dx * diag, oy + dy * diag]], 14);
        let prev = null, gap = 0;
        for (const [x, y] of pts) {
          const q = [x + R(-1.5, 1.5), y + R(-1.5, 1.5)];
          if (prev && x > -30 && x < W + 30 && y > -30 && y < H + 30) {
            if (gap > 0) gap--;
            else if (rand() < 0.05) gap = Math.floor(R(1, 3));
            else {
              const n = fbm(x * sc + so, y * sc - so), m = fbm(x * sc * 0.7 - 40, y * sc * 0.7 + so);
              let idx = Math.min(G - 1, Math.floor(Math.max(0, Math.min(0.999, (n - 0.3) / 0.4 * 0.6 + m * 0.4)) * G));
              if (rand() < 0.25) idx = Math.floor(R(0, G));
              dash(prev[0], prev[1], q[0], q[1], pick(paper.fibers[idx]), alpha * R(0.4, 1), R(1.5, 3.5), 0);
            }
          }
          prev = q;
        }
      }
      flush();
    };
    const [a1, a2, a3] = paper.fiberAlpha;
    layer(32, 5, a1, 0.0012, 11); layer(-24, 6, a2, 0.0016, 57); layer(75, 9, a3, 0.0024, 91);
    batch(() => { for (let i = 0; i < Math.round(W * H / 170000); i++) {
      const r = R(80, 260);
      crayon(wobblyEllipse(R(0, W), R(0, H), r, r * R(0.3, 0.7), R(0, 3), R(1, 4), 0.2),
        { colors: paper.swirl, alpha: 0.12, width: 2.5, passes: 1, wobble: 8, breakProb: 0.08 });
    } });
  }

  // The book's 'neatline' map border: a double crumpled rule with alternating hatched bars and inked corner
  // blocks (crayon-kit border()), drawn around a box instead of always the whole sheet.
  function border({ box = [0, 0, W, H], outer = 11, inner = 25, seg = 44, rule = INK, barA = [INK], barB = WATER2, corner = INK } = {}) {
    const [X0, Y0, X1, Y1] = box, o = outer, i = inner, bw = i - o - 3;
    const rect = (m) => [[X0 + m, Y0 + m], [X1 - m, Y0 + m + 1], [X1 - m - 1, Y1 - m], [X0 + m + 1, Y1 - m - 0.5], [X0 + m, Y0 + m - 2]];
    const bar = (x, y, w, h, odd) => hatchFill(() => ctx.rect(x, y, w, h), [x, y, w, h], [
      odd ? { angle: -50, spacing: 2.2, colors: barB, alpha: 0.45, width: 1.6, step: 3 } : { angle: 55, spacing: 1.7, colors: barA, alpha: 0.75, width: 1.6, step: 3 }]);
    let k = 0;
    for (let x = X0 + i; x < X1 - i - 5; x += seg, k++) { const w = Math.min(seg, X1 - i - x); bar(x, Y0 + o + 1.5, w, bw, k % 2); bar(x, Y1 - i + 1.5, w, bw, k % 2); }
    k = 0;
    for (let y = Y0 + i; y < Y1 - i - 5; y += seg, k++) { const h = Math.min(seg, Y1 - i - y); bar(X0 + o + 1.5, y, bw, h, k % 2); bar(X1 - i + 1.5, y, bw, h, k % 2); }
    for (const [cx, cy] of [[X0 + o, Y0 + o], [X1 - i, Y0 + o], [X0 + o, Y1 - i], [X1 - i, Y1 - i]])
      hatchFill(() => ctx.rect(cx + 1.5, cy + 1.5, bw, bw), [cx, cy, i - o, i - o], [{ angle: 30, spacing: 1.5, colors: [corner], alpha: 0.9, width: 1.6 }]);
    batch(() => {
      crayon(rect(o), { color: rule, width: 2.4, alpha: 0.85, passes: 3, wobble: 1.4, crumple: 2.4, breakProb: 0.05, step: 5 });
      crayon(rect(i), { color: rule, width: 2, alpha: 0.75, passes: 2, wobble: 1.4, crumple: 2.4, breakProb: 0.07, step: 5 });
      crayon(rect(i + 6), { color: rule, width: 1.1, alpha: 0.35, passes: 1, wobble: 1.4, crumple: 2, breakProb: 0.2, step: 5 });
    });
  }

  // Wax tooth + fine grain + gentle vignette, on the real pixels. Always last.
  function grain({ tooth = 0.08, noise = 0.12, vignette = 0.1 } = {}) {
    const PW = canvas.width, PH = canvas.height;
    const img = ctx.getImageData(0, 0, PW, PH), d = img.data, [br, bgc, bb] = hexToRgb(paper.base);
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        const i = (y * PW + x) * 4;
        if (d[i + 3] === 0) continue;
        const diff = Math.min(1, (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bgc) + Math.abs(d[i + 2] - bb)) / 300);
        if (hash2(x, y) < tooth * diff) { d[i] = (d[i] + br) / 2; d[i + 1] = (d[i + 1] + bgc) / 2; d[i + 2] = (d[i + 2] + bb) / 2; }
        const vx = x / PW - 0.5, vy = y / PH - 0.5;
        const k = (1 - noise / 2 + noise * hash2(x + 7777, y + 313)) * (1 - vignette * (vx * vx + vy * vy));
        d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  return { canvas, ctx, W, H, paper, rand, R, pick, fbm, resample, curve, wobblyEllipse, crayon, hatchFill, batch, flush, scrawl, textWidth, underline, paperBackground, border, grain };
}
