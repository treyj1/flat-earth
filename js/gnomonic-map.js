// Flat Earth website: the airplane map (gnomonic projection), drawn in crayon and centered on any place.
// Follows gno-map.js (book pages G1, G2, G4, G5a): a square map, a faint 10-degree graticule with the equator a
// little darker, dashed distance rings from the center lettered in open water, and each flight a straight line
// with a tick every 500 miles (longer every 1,000). The ticks spread apart away from the center: that is the stretch.
//
// How it works (the book's "lamp in a glass globe"): every place throws its shadow from the globe's middle onto a flat
// sheet touching the center. Every great circle lies in a plane through the globe's middle, so its shadow is a
// straight line: on this map every straight line is a shortest route, between ANY two places. The equator of the
// center (90 degrees away) would land infinitely far out, so an airplane map can never show half the world.
//
// Scales (how far the map reaches from the center to the middle of each edge):
//   wide 60 degrees of arc, medium 35, close 15.
// Places: a straight route from the center to each place in range, with ticks; a dashed straight route between
// places next to each other in the list (when both are in range); places out of range are listed in a small note.
import { INK, FONT, ORANGE, createArt } from './crayon.js';
import {
  BaseMap, renderBase, MAP_W, EDGE, PAPER, seedOf, toV, fromV, ang, fmt, displayName, shapePath, inShape,
  projectLines, placeLabels, centerDot, drawPlaceLayer, pickLabelBox, roundRect, LINE, D2R, EARTH_MI, distanceMi, wrapLon,
} from './map-common.js';

export const SCALES = [
  { id: 'wide', label: 'Wide' },
  { id: 'medium', label: 'Medium' },
  { id: 'close', label: 'Close' },
];
// half: degrees of arc from the center to the middle of each edge. rings: dashed rings every `main` miles, faint
// rings every `faint`. grat: graticule step in degrees. states: state lines and names (loaded on demand).
const CFG = {
  wide: { half: 60, main: 1000, faint: 500, grat: 10, labelRank: 5, lakeRank: 3, sizes: [11, 30], states: false },
  medium: { half: 35, main: 500, faint: 250, grat: 10, labelRank: 7, lakeRank: 99, sizes: [12, 34], states: true },
  close: { half: 15, main: 200, faint: 100, grat: 5, labelRank: 10, lakeRank: 99, sizes: [13, 40], states: true },
};
const W = MAP_W, H = MAP_W, CX = W / 2, CY = H / 2, HALF_PX = W / 2 - EDGE;
const TICK_MI = 500;            // a tick every 500 miles along each route, longer every 1,000
const RING_SIZE = 22;
const ringText = (mi) => fmt(mi) + ' MI';
const nameOf = (p) => p.short || p.name.split(',')[0];

// ---------- the projection ----------
// Gnomonic around a center, on the unit tangent plane: fwd(lon, lat) -> [x, y] (y north) or null on the far half;
// inv(x, y) -> [lon, lat]. Built from vectors, so it works at the poles too (there the center's meridian points down).
export function gnomonic(center) {
  const cv = toV([center.lon, center.lat]), l = center.lon * D2R;
  const e = [-Math.sin(l), Math.cos(l), 0];
  const n = [cv[1] * e[2] - cv[2] * e[1], cv[2] * e[0] - cv[0] * e[2], cv[0] * e[1] - cv[1] * e[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    cv,
    fwd(lon, lat) { const v = toV([lon, lat]), d = dot(v, cv); return d < 1e-6 ? null : [dot(v, e) / d, dot(v, n) / d]; },
    inv(x, y) { const [lon, lat] = fromV([cv[0] + x * e[0] + y * n[0], cv[1] + x * e[1] + y * n[1], cv[2] + x * e[2] + y * n[2]]); return [wrapLon(lon), lat]; },
  };
}
// a great circle from a to b ({ lat, lon }): its length in miles, and at(mi) -> [lon, lat]
export function along(a, b) {
  const va = toV([a.lon, a.lat]), vb = toV([b.lon, b.lat]), d = ang(va, vb), s = Math.sin(d);
  return {
    mi: d * EARTH_MI,
    at: (m) => {
      if (d < 1e-9) return [a.lon, a.lat];
      const t = m / (d * EARTH_MI), p = Math.sin((1 - t) * d) / s, q = Math.sin(t * d) / s;
      return fromV([va[0] * p + vb[0] * q, va[1] * p + vb[1] * q, va[2] * p + vb[2] * q]);
    },
  };
}

// a rotated text box: its four corners, for a label of width w and height h centered on (x, y) at angle rot
const rotRect = (x, y, w, h, rot, pad = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2 + pad, hh = h / 2 + pad;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
};
const bboxOf = (pts) => ({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) });
const segDist = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
// is (x, y) inside the convex quad Q (corners in order), or within pad px of it?
const inQuad = (x, y, Q, pad = 0) => {
  let pos = 0, neg = 0;
  for (let i = 0; i < 4; i++) { const [ax, ay] = Q[i], [bx, by] = Q[(i + 1) % 4], c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c > 0) pos++; else if (c < 0) neg++; }
  if (!pos || !neg) return true;
  return pad > 0 && Q.some((a, i) => segDist(x, y, a, Q[(i + 1) % 4]) < pad);
};
// do segments ab and cd cross?
const crosses = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};
// how close segment ab comes to the quad Q (0 when it touches or crosses it)
const segQuadDist = (a, b, Q) => {
  if (inQuad(a[0], a[1], Q) || inQuad(b[0], b[1], Q)) return 0;
  for (let i = 0; i < 4; i++) if (crosses(a, b, Q[i], Q[(i + 1) % 4])) return 0;
  let d = Infinity;
  for (let i = 0; i < 4; i++) { const p = Q[i], q = Q[(i + 1) % 4]; d = Math.min(d, segDist(p[0], p[1], a, b), segDist(a[0], a[1], p, q), segDist(b[0], b[1], p, q)); }
  return d;
};
// sample points over a quad (its corners, edges and middle), for clearance tests
const quadSamples = (Q, nu = 8, nv = 2) => {
  const out = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv;
    out.push([Q[0][0] + (Q[1][0] - Q[0][0]) * u + (Q[3][0] - Q[0][0]) * v, Q[0][1] + (Q[1][1] - Q[0][1]) * u + (Q[3][1] - Q[0][1]) * v]);
  }
  return out;
};
const overlaps = (a, b, m = 0) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
// a polyline with its ends cut back: the part more than r0 px from p0 at the start and r1 px from p1 at the end
// (cut exactly, between samples, so a line always reaches its dot)
function trimLine(pts, p0, r0, p1, r1) {
  const cut = (line, [cx, cy], r) => {
    let i = 0;
    while (i < line.length && Math.hypot(line[i][0] - cx, line[i][1] - cy) <= r) i++;
    if (i === 0 || i >= line.length) return i >= line.length ? [] : line;
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    let lo = 0, hi = 1; // bisect for the point where the line leaves the circle
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (Math.hypot(ax + (bx - ax) * m - cx, ay + (by - ay) * m - cy) <= r) lo = m; else hi = m; }
    return [[ax + (bx - ax) * hi, ay + (by - ay) * hi], ...line.slice(i)];
  };
  return cut(cut(pts, p0, r0).reverse(), p1, r1).reverse();
}
// greedy word wrap at a given size
function wrap(art, text, size, maxW) {
  const lines = []; let cur = '';
  for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (cur && art.textWidth(t, size) > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

export class GnomonicMap extends BaseMap {
  constructor(base, overlay, data) {
    super(base, overlay, data);
    this.extra = null;
    this.originMark = 'none'; this.originSub = 'CENTER'; // the base map marks the center with the book's ringed dot
  }

  async prepare(origin, scale = 'wide') {
    const S = CFG[scale] ? scale : 'wide', C = CFG[S];
    this.origin = origin; this.scale = S; this.ringQuads = []; // (drawBase sets them again)
    if (C.states && !this.extra) {
      const [admin1, admin1Lines] = await Promise.all(['admin1', 'admin1-lines'].map((n) => this.data.load(n)));
      this.extra = { admin1, admin1Lines };
    }
    this.view = this.buildView(origin, S);
    const name = displayName(origin), edgeMi = fmt(Math.round(C.half * D2R * EARTH_MI / 10) * 10);
    const stretch = 1 / Math.cos(C.half * D2R) ** 2; // how much more the map is stretched at the middle of an edge than at the center
    return {
      scale: S, title: 'THE SHORTEST WAY', subtitle: 'AN AIRPLANE MAP CENTERED ON ' + name.toUpperCase(),
      prose: ['Centered on ', { strong: name }, '. Every straight line on this map is a shortest route (a great circle), between any two places, ' +
        'not only lines from the center. Ticks mark every 500 miles along each route. They spread apart because the map stretches more and more ' +
        `away from the center: at the middle of each edge, about ${edgeMi} miles out, it is stretched ${stretch < 1.25 ? 'a little' : 'about ' + (Math.round(stretch * 10) / 10) + ' times'} more. ` +
        'An airplane map can never show half the world.'],
      legend: `Rings every ${fmt(C.main)} miles from ${nameOf(origin)}; faint rings every ${fmt(C.faint)}. Ticks every 500 miles along each route. ` +
        'Dashed lines: the shortest route between places next to each other in your list.',
    };
  }

  buildView(origin, scale) {
    const C = CFG[scale], G = gnomonic(origin), T = Math.tan(C.half * D2R), k = HALF_PX / T;
    const shape = { type: 'rect', x0: EDGE, y0: EDGE, x1: W - EDGE, y1: H - EDGE };
    const maxC = Math.atan(T * Math.SQRT2) + 1.5 * D2R; // past the corners (the frame clips the rest); always under 90 degrees
    const fwd = (lon, lat) => { const q = G.fwd(lon, lat); return q ? [CX + q[0] * k, CY - q[1] * k] : null; };
    const P = {
      shape, k, G, maxC,
      geo: { type: 'cap', center: { lon: origin.lon, lat: origin.lat }, maxC, fwd, rim: { cx: CX, cy: CY, r: k * Math.tan(maxC) } },
      inverse: (x, y) => G.inv((x - CX) / k, -(y - CY) / k),
      R: (mi) => k * Math.tan(mi / EARTH_MI),          // a ring's radius in px
    };
    return { W, H, panels: [P], scale, C, k };
  }

  // a place is on this map when it lands inside the frame (with room for its dot)
  locate(p) {
    const P = this.view.panels[0];
    if (p.isOrigin) return { x: CX, y: CY, cx: CX, cy: CY };
    const q = ang(P.G.cv, toV([p.lon, p.lat])) <= P.maxC ? P.geo.fwd(p.lon, p.lat) : null;
    return q && inShape(P.shape, q[0], q[1], 8) ? { x: q[0], y: q[1], cx: CX, cy: CY } : null;
  }

  // ---------------- the base map ----------------
  drawBase(origin) {
    this.origin = origin;
    const V = this.view, C = V.C, P = V.panels[0];
    const states = C.states && this.extra;
    renderBase(this, {
      seed: seedOf('gnomonic' + origin.name + origin.lat.toFixed(2) + origin.lon.toFixed(2) + V.scale),
      labelRank: C.labelRank, lakeRank: C.lakeRank, sizes: C.sizes,
      admin: states ? this.extra.admin1Lines : [],
      reserve: [{ x0: CX - 24, y0: CY - 24, x1: CX + 24, y1: CY + 24 }],
      hooks: {
        beforeLines: (env) => {
          if (states && env.show) { // state and province names, after the countries
            const list = this.extra.admin1.map((s) => ({ n: s.n, x: s.x, y: s.y, a: s.a, rank: 0 })).sort((a, b) => b.a - a.a);
            const n0 = env.placed.length;
            placeLabels(env.art, P, env.isLand, env.placed, list, [11, 24], 0.8);
            env.texts.push(...env.placed.slice(n0).filter((b) => b.text));
          }
          this.graticule(env, P, C);
          this.rings(env, P, C);
        },
        afterText: (env) => {
          this.ringQuads = [];
          if (env.show) for (const [mi, a] of this.ringLabels) {
            const { box, Q } = this.labelOnRing(env.art, ringText(mi), P.R(mi), a, RING_SIZE);
            env.texts.push({ ...box, text: null }); // in map.placedLabels, so leg labels and the note prefer to keep off it
            this.ringQuads.push(Q);                 // its true (turned) outline: routes break only there, names keep off it
          }
          centerDot(env.art, CX, CY);
        },
      },
    });
  }

  // The book's underlay: a faint graticule (meridians stop at 80 degrees, as on the book pages, so they do not
  // bunch up at the poles), the equator a little darker. Clipped around the lettering.
  graticule(env, P, C) {
    // near a pole the meridians fan out from it: fewer of them (every 30 degrees, or 15 at the close scale)
    const { ctx, texts } = env, step = C.grat, lonStep = Math.abs(this.origin.lat) > 60 ? (step >= 10 ? 30 : 15) : step;
    const lines = [];
    for (let lon = -180; lon < 180; lon += lonStep) { const l = []; for (let lat = -80; lat <= 80; lat += 0.5) l.push([lon, lat]); lines.push([l, false]); }
    for (let lat = -80; lat <= 80; lat += step) { const l = []; for (let lon = -180; lon <= 180; lon += 0.5) l.push([lon, lat]); lines.push([l, lat === 0]); }
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape);
    for (const b of texts) ctx.rect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
    ctx.clip('evenodd'); ctx.strokeStyle = INK; ctx.lineCap = 'round';
    for (const [l, eq] of lines) {
      ctx.globalAlpha = eq ? 0.3 : 0.18; ctx.lineWidth = eq ? 1.8 : 1.3;
      ctx.beginPath();
      for (const run of projectLines(l, P.geo, { cuts: false, maxStep: 12, bounds: [P.shape.x0, P.shape.y0, P.shape.x1, P.shape.y1] })) run.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.restore();
  }

  // Distance rings from the center (true miles; on this map they spread apart), as azimuthal-map.js draws them:
  // faint plain rings, then dashed crayon rings broken where their label sits in open water.
  rings(env, P, C) {
    const { art, ctx, isLand, hitsLabel, show } = env, { crayon, batch } = art;
    const corner = HALF_PX * Math.SQRT2;
    const list = []; for (let mi = C.main; P.R(mi) < corner && mi / EARTH_MI < P.maxC; mi += C.main) list.push(mi);
    const vis = list.filter((mi) => P.R(mi) > 4);
    ctx.font = RING_SIZE + 'px ' + FONT;
    const TARGET = 118 * D2R, around = (k) => TARGET + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * D2R;
    const halfOf = (mi) => (ctx.measureText(ringText(mi)).width / 2 + 16) / P.R(mi);
    const clearArc = (r, a, half, onLand) => {
      for (let t = -half; t <= half; t += 3 / r) for (const dr of [-18, -9, 0, 9, 18]) {
        const x = CX + Math.cos(a + t) * (r + dr), y = CY + Math.sin(a + t) * (r + dr);
        if (!inShape(P.shape, x, y, 14) || (!onLand && isLand(x, y)) || hitsLabel(x, y, 10)) return false;
      }
      return true;
    };
    const at = {};
    if (show) for (const onLand of [false, true]) {
      const todo = vis.filter((mi) => at[mi] == null);
      if (!todo.length) break;
      let shared = null;
      for (let k = 0; k < 160 && shared === null; k++) if (todo.every((mi) => clearArc(P.R(mi), around(k), halfOf(mi), onLand))) shared = around(k);
      for (const mi of todo) {
        let best = shared;
        for (let k = 0; best === null && k < 360; k++) if (clearArc(P.R(mi), around(k), halfOf(mi), onLand)) best = around(k);
        at[mi] = best;
      }
    }
    // faint rings
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape);
    for (const b of env.texts) ctx.rect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
    for (const mi of vis) if (at[mi] != null) {
      const r = P.R(mi), a = at[mi], hw = ctx.measureText(ringText(mi)).width / 2 + 14, lx = CX + Math.cos(a) * (r + 8), ly = CY + Math.sin(a) * (r + 8);
      ctx.moveTo(lx + hw, ly); ctx.arc(lx, ly, hw, 0, Math.PI * 2);
    }
    ctx.clip('evenodd');
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.1; ctx.setLineDash([5, 7]); ctx.lineCap = 'round';
    for (let mi = C.faint; P.R(mi) < corner && mi / EARTH_MI < P.maxC; mi += C.faint) {
      if (mi % C.main === 0) continue;
      ctx.beginPath(); ctx.arc(CX, CY, P.R(mi), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
    // main rings
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
    batch(() => { for (const mi of vis) {
      const r = P.R(mi), la = at[mi] ?? 0, gap = at[mi] != null ? (ctx.measureText(ringText(mi)).width / 2 + 12) / r : 0;
      const dash = 16 / r, space = 10 / r;
      for (let t = la + gap; t < la + 2 * Math.PI - gap - dash * 0.5; t += dash + space) {
        const end = Math.min(t + dash, la + 2 * Math.PI - gap), pts = [];
        for (let u = t; u <= end + 1e-9; u += (end - t) / 5) pts.push([CX + Math.cos(u) * r, CY + Math.sin(u) * r]);
        if (!pts.some(([x, y]) => inShape(P.shape, x, y, -20)) || pts.some(([x, y]) => hitsLabel(x, y, 3))) continue;
        crayon(pts, { color: INK, width: 1.7, alpha: 0.72, passes: 2, wobble: 0.4, crumple: 0.5, breakProb: 0.03, step: 3, jitter: 0.4 });
      }
    } });
    ctx.restore();
    this.ringLabels = vis.filter((mi) => at[mi] != null).map((mi) => [mi, at[mi]]);
  }
  // set tangent to the ring and straddling it; in the top half turned over so it never reads upside down
  labelOnRing(art, text, r, a, size) {
    const flip = Math.sin(a) < -0.05, rr = flip ? r - size * 0.36 : r + size * 0.36;
    const x = CX + Math.cos(a) * rr, y = CY + Math.sin(a) * rr, rot = a - Math.PI / 2 + (flip ? Math.PI : 0);
    art.scrawl(text, x, y, { size, color: INK, align: 'center', rot, font: FONT });
    // its outline and box (the letters sit above the baseline at (x, y))
    const Q = rotRect(x + Math.sin(rot) * size * 0.36, y - Math.cos(rot) * size * 0.36, art.textWidth(text, size), size * 0.8, rot, 2);
    return { Q, box: bboxOf(Q) };
  }

  // ---------------- places ----------------
  // projected points along a great circle (every ~step px), as straight as the projection makes it
  pathOf(a, b, stepMi) {
    const P = this.view.panels[0], g = along(a, b), pts = [];
    const n = Math.max(2, Math.ceil(g.mi / stepMi));
    for (let i = 0; i <= n; i++) { const q = P.geo.fwd(...g.at(g.mi * i / n)); if (q) pts.push(q); }
    return { g, pts };
  }
  // the route from the center to a place in range: a straight line, with a tick every 500 miles
  drawRoute(art, p, hot, at) {
    if (!at || !this.view) return;
    const P = this.view.panels[0], { g, pts } = this.pathOf(this.origin, p, Math.max(2, 8 / P.k * EARTH_MI));
    if (g.mi < 1) return;
    const ctx = art.ctx;
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
    // break at the center's ring and at the place's dot
    const line = trimLine(pts, [CX, CY], 17, [at.x, at.y], 9);
    if (line.length > 1) for (const run of this.breakAround(art, line)) art.crayon(run, LINE.route(hot));
    for (let m = TICK_MI; m < g.mi - 1; m += TICK_MI) {
      const c = P.geo.fwd(...g.at(m)), a = P.geo.fwd(...g.at(m - 5)), b = P.geo.fwd(...g.at(m + 5));
      if (!c || !a || !b) continue;
      if (Math.hypot(c[0] - CX, c[1] - CY) < 24 || Math.hypot(c[0] - at.x, c[1] - at.y) < 16 || this.underLettering(c[0], c[1], 8)) continue;
      if ((this.dots || []).some((d) => Math.hypot(c[0] - d.x, c[1] - d.y) < 16)) continue; // not across another place's dot
      const t = Math.atan2(b[1] - a[1], b[0] - a[0]), L = m % 1000 ? 9 : 15, nx = -Math.sin(t), ny = Math.cos(t);
      art.crayon([[c[0] - nx * L, c[1] - ny * L], [c[0] + nx * L, c[1] + ny * L]], { color: INK, width: hot ? 2.6 : 2.2, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
    }
    ctx.restore();
  }

  // Is (x, y) under a ring label (its turned outline, not its box)? Lines break there, as on the book pages. (Not under
  // country names: a route broken at every name it crosses would look dashed, and dashed lines mean routes between places.)
  underLettering(x, y, pad = 3) { return (this.ringQuads || []).some((Q) => inQuad(x, y, Q, pad)); }
  // a row of small boxes along each ring label, for keeping place names off it (one box would be far too big when it turns)
  ringBoxes() {
    const out = [];
    for (const Q of this.ringQuads || []) {
      const len = Math.hypot(Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]), n = Math.max(1, Math.ceil(len / 14));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, at = (t, s) => [Q[0][0] + (Q[1][0] - Q[0][0]) * t + (Q[3][0] - Q[0][0]) * s, Q[0][1] + (Q[1][1] - Q[0][1]) * t + (Q[3][1] - Q[0][1]) * s];
        out.push(bboxOf([at(t0, 0), at(t1, 0), at(t1, 1), at(t0, 1)]));
      }
    }
    return out;
  }
  // a polyline split into the runs that stay clear of the lettering
  breakAround(art, pts) {
    const runs = []; let run = [];
    for (const p of art.resample(pts, 3)) { if (this.underLettering(p[0], p[1])) { if (run.length > 1) runs.push(run); run = []; } else run.push(p); }
    if (run.length > 1) runs.push(run);
    return runs;
  }

  drawPlaces(places, { highlight = null } = {}) {
    if (!this.view) return super.drawPlaces(places, { highlight });
    const V = this.view, P = V.panels[0], o = this.overlay;
    const found = places.map((p) => ({ p, at: this.locate(p) }));
    const far = found.filter((f) => !f.at).map((f) => f.p);
    const dots = [{ x: CX, y: CY, r: 20 }, ...found.filter((f) => f.at).map((f) => ({ x: f.at.x, y: f.at.y, r: 12 }))];
    // routes as straight segments on the canvas, for keeping lettering off them
    const segs = found.filter((f) => f.at).map((f) => [[CX, CY], [f.at.x, f.at.y]]);
    const legs = [];
    for (let i = 1; i < found.length; i++) {
      const A = found[i - 1], B = found[i];
      if (!A.at || !B.at || distanceMi(A.p, B.p) < 1) continue;
      legs.push({ a: A.p, b: B.p, A: A.at, B: B.at, mi: distanceMi(A.p, B.p) });
      segs.push([[A.at.x, A.at.y], [B.at.x, B.at.y]]);
    }
    // a scratch art for measuring (drawPlaceLayer clears the overlay before it draws)
    const meas = createArt(o, { width: V.W, height: V.H, seed: 1 });
    this.dots = dots; // ticks keep off every dot
    // What place labels must keep off ("core"): the center, the ring labels, every place's dot (a small box, so a label
    // can still sit beside its own dot but a name that has to move away never lands beside someone else's), the note,
    // the leg labels, and the routes and legs themselves.
    const soft = this.placedLabels || [], names = soft.filter((b) => b.text);
    const core = [{ x0: CX - 18, y0: CY - 18, x1: CX + 18, y1: CY + 18 }, ...this.ringBoxes(),
      ...dots.slice(1).map((d) => ({ x0: d.x - 8, y0: d.y - 8, x1: d.x + 8, y1: d.y + 8 }))];
    // the note for places out of range: in the corner with the fewest dots, routes and names under it
    const note = far.length ? this.planNote(meas, far, dots, segs, soft) : null;
    if (note) core.push(note.box);
    // a label along each dashed leg: "TOKYO TO LONDON, 5,960 MI", where it is clear
    if (this.showLabels) for (const L of legs) {
      L.label = this.planLegLabel(meas, L, dots, segs, soft, [...core, ...names]);
      if (L.label) core.push(...L.label.boxes);
    }
    // keep every name off the routes: small boxes along each straight line
    for (const [[ax, ay], [bx, by]] of segs) {
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 12; d < len - 10; d += 12) { const x = ax + (bx - ax) * d / len, y = ay + (by - ay) * d / len; core.push({ x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 }); }
    }
    // Names on the base map (countries, states, provinces) are usually hard for place labels too: with routes fanning
    // out from the center the near spots are often taken, and a paper patch half over a name looks worse than a label
    // set off with a leader line. But when a crowded spot leaves a label no clear place at all, drawPlaceLayer falls
    // back to its first spot whatever is under it (a route, a tick, a name). So both ways are tried on paper first,
    // and the one that covers less is drawn.
    const withNames = [...core, ...names];
    const hard = !this.showLabels || this.labelCost(meas, places, withNames, soft, core, names) <= this.labelCost(meas, places, core, soft, core, names) ? withNames : core;
    this.placeHits = drawPlaceLayer(o, {
      W: V.W, H: V.H, edge: EDGE, origin: this.origin, places, highlight, showLabels: this.showLabels,
      locate: (p) => this.locate(p),
      // the dashed legs go down first, under every dot and name (drawn with the first place's route)
      route: (art, p, hot, at) => {
        if (p === places[0]) for (const L of legs) this.drawLeg(art, L, highlight === L.a.id || highlight === L.b.id);
        this.drawRoute(art, p, hot, at);
      },
      soft, hard, originMark: this.originMark, originSub: this.originSub,
    });
    const art = createArt(o, { width: V.W, height: V.H, seed: seedOf('gnomonic-notes') });
    for (const L of legs) if (L.label) this.drawLegLabel(art, L.label);
    if (note) this.drawNote(art, note);
  }
  // How much drawPlaceLayer's lettering would cover with these hard boxes: its own placement rules, played out on
  // paper (keep in step with drawPlaceLayer in map-common.js). A label over a route, dot or other lettering costs 10,
  // each name it covers 3, a label set off with a leader line 2.
  labelCost(meas, places, hard, soft, core, names) {
    const boxes = [...soft.map((b) => ({ ...b, soft: true })), ...hard], edge = EDGE;
    const hit = (c, b, mx = 4, my = 2) => c.x0 < b.x1 + mx && c.x1 > b.x0 - mx && c.y0 < b.y1 + my && c.y1 > b.y0 - my;
    const placed = [];
    let cost = 0;
    for (const p of [{ ...this.origin, isOrigin: true }, ...places]) {
      const at = this.locate(p);
      if (!at) continue;
      const { x, y } = at, name = nameOf(p).toUpperCase();
      const dist = p.isOrigin ? this.originSub : Math.round(distanceMi(this.origin, p)).toLocaleString('en-US') + ' MI';
      const s1 = 22, s2 = 17, w = Math.max(meas.textWidth(name, s1), dist ? meas.textWidth(dist, s2) : 0), h = dist ? s1 + s2 + 6 : s1 + 4;
      const dx = x - CX, dl = Math.hypot(dx, y - CY), side = dl > 1 && dx < 0 ? -1 : 1, cands = [];
      for (const g of p.isOrigin ? [22, 50, 90] : [14, 44, 80]) for (const [sx, sy] of [[side, 0], [-side, 0], [0, -1], [0, 1], [side, -1], [side, 1], [-side, -1], [-side, 1]]) {
        const bx = sx > 0 ? x + g : sx < 0 ? x - g - w : x - w / 2, by = sy < 0 ? y - g - h : sy > 0 ? y + g : y - h / 2 - 2;
        cands.push({ x0: bx, y0: by, x1: bx + w, y1: by + h, far: g > 30 });
      }
      const hitsHard = (c) => boxes.some((b) => !b.soft && hit(c, b));
      const hitsSoft = (c) => boxes.some((b) => b.soft && hit(c, b, 0, 0));
      const inside = (c) => c.x0 > edge + 4 && c.x1 < W - edge - 4 && c.y0 > edge + 4 && c.y1 < H - edge - 4;
      const box = pickLabelBox(cands, inside, hitsHard, hitsSoft);
      if (core.some((b) => hit(box, b, 0, 0)) || placed.some((b) => hit(box, b, 0, 0))) cost += 10;
      cost += names.filter((b) => hit(box, b, 0, 0)).length * 3 + (box.far ? 2 : 0);
      boxes.push(box); placed.push(box);
    }
    return cost;
  }
  // a dashed straight line between two places (orange, lighter than a route from the center)
  drawLeg(art, L, hot) {
    const P = this.view.panels[0], { pts } = this.pathOf(L.a, L.b, Math.max(2, 8 / P.k * EARTH_MI));
    const run = trimLine(pts, [L.A.x, L.A.y], 10, [L.B.x, L.B.y], 10);
    if (run.length < 2) return;
    // dashes 14 px long with 10 px gaps, measured along the line
    const cum = [0]; for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
    const total = cum[cum.length - 1], pt = (d) => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [run[i - 1][0] + (run[i][0] - run[i - 1][0]) * t, run[i - 1][1] + (run[i][1] - run[i - 1][1]) * t]; };
    const opts = { colors: ORANGE, width: hot ? 2.4 : 1.8, alpha: hot ? 0.9 : 0.72, passes: 2, wobble: 0.3, crumple: 0.3, breakProb: 0, step: 3 };
    const ctx = art.ctx;
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
    art.batch(() => { for (let d = 0; d < total; d += 24) for (const dash of this.breakAround(art, [pt(d), pt(d + 7), pt(Math.min(total, d + 14))])) art.crayon(dash, opts); });
    ctx.restore();
  }
  planLegLabel(meas, L, dots, segs, soft, hard) {
    const text = `${nameOf(L.a)} TO ${nameOf(L.b)}, ${fmt(L.mi)} MI`.toUpperCase(), size = 17, w = meas.textWidth(text, size), h = size * 0.8;
    const len = Math.hypot(L.B.x - L.A.x, L.B.y - L.A.y);
    if (len < w + 60) return null;
    let rot = Math.atan2(L.B.y - L.A.y, L.B.x - L.A.x); if (Math.cos(rot) < 0) rot += Math.PI;
    const nx = -Math.sin(rot), ny = Math.cos(rot), P = this.view.panels[0], own = segs.findIndex((s) => s[0][0] === L.A.x && s[0][1] === L.A.y && s[1][0] === L.B.x && s[1][1] === L.B.y);
    // (never over a name on the base map: a leg label is a nice extra, so it is left out when there is no clear spot)
    const spots = [0.5]; for (let s = 0.04; s <= 0.3; s += 0.04) spots.push(0.5 - s, 0.5 + s);
    for (const f of spots) for (const side of [-1, 1]) {
      const mx = L.A.x + (L.B.x - L.A.x) * f, my = L.A.y + (L.B.y - L.A.y) * f, off = side * (h / 2 + 9);
      const x = mx + nx * off, y = my + ny * off, Q = rotRect(x, y, w, h, rot, 3), box = bboxOf(Q);
      // exact tests against lines and dots (a sparse grid of samples let a crossing line slip between them),
      // and a dense grid (every 4 px or less) against boxes
      if (!Q.every(([px, py]) => inShape(P.shape, px, py, 10))) continue;
      if (dots.some((d) => inQuad(d.x, d.y, Q, d.r + 4))) continue;
      if (segs.some((s, i) => i !== own && segQuadDist(s[0], s[1], Q) < 5)) continue;
      const S = quadSamples(Q, Math.ceil(w / 4), Math.ceil(h / 4));
      const under = (list, m) => S.some(([px, py]) => list.some((b) => px > b.x0 - m && px < b.x1 + m && py > b.y0 - m && py < b.y1 + m));
      if (under(hard, 3) || under(soft, 0)) continue;
      // the boxes it keeps other lettering out of: a row of small squares along it (one big box would be far too big when it slants)
      const n = Math.max(1, Math.ceil(w / h)), boxes = [];
      for (let i = 0; i < n; i++) { const u = -w / 2 + (i + 0.5) * w / n; boxes.push(bboxOf(rotRect(x + Math.cos(rot) * u, y + Math.sin(rot) * u, w / n, h, rot, 3))); }
      return { text, x, y, rot, size, box, Q, boxes };
    }
    return null;
  }
  drawLegLabel(art, lab) {
    const { ctx } = art;
    ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = PAPER; ctx.beginPath();
    rotRect(lab.x, lab.y, art.textWidth(lab.text, lab.size), lab.size * 0.8, lab.rot, 4).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fill(); ctx.restore();
    // scrawl's baseline sits at y; center the letters' body on the box
    const bx = lab.x - Math.sin(lab.rot) * lab.size * 0.36, by = lab.y + Math.cos(lab.rot) * lab.size * 0.36;
    art.scrawl(lab.text, bx, by, { size: lab.size, color: INK, align: 'center', rot: lab.rot, font: FONT, alpha: 0.85 });
  }
  // "Too far for this map: Tokyo, Sydney. An airplane map can never show half the world."
  planNote(meas, far, dots, segs, soft) {
    const names = far.map(nameOf), wideOK = this.scale !== 'wide' && far.some((p) => ang(this.view.panels[0].G.cv, toV([p.lon, p.lat])) < 60 * D2R);
    const text = `Too far for this map: ${names.join(', ')}. ` + (wideOK ? 'The wide scale shows more. ' : '') + 'An airplane map can never show half the world.';
    const size = 19, lh = 25, maxW = 520, lines = wrap(meas, text, size, maxW);
    const w = Math.max(...lines.map((t) => meas.textWidth(t, size))) + 32, h = lines.length * lh + 22, m = EDGE + 14;
    const corners = [[m, H - m - h], [W - m - w, H - m - h], [m, m], [W - m - w, m]];
    let best = null;
    for (const [x0, y0] of corners) {
      const box = { x0, y0, x1: x0 + w, y1: y0 + h };
      let score = 0;
      for (const d of dots) if (d.x > box.x0 - d.r - 30 && d.x < box.x1 + d.r + 30 && d.y > box.y0 - d.r - 30 && d.y < box.y1 + d.r + 30) score += 100;
      for (const s of segs) for (let t = 0; t <= 1; t += 0.02) { const x = s[0][0] + (s[1][0] - s[0][0]) * t, y = s[0][1] + (s[1][1] - s[0][1]) * t; if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) { score += 10; break; } }
      for (const b of soft) if (overlaps(box, b)) score += 1;
      if (!best || score < best.score) best = { box, score, lines, size, lh };
    }
    return best;
  }
  drawNote(art, n) {
    const { ctx } = art, { x0, y0, x1, y1 } = n.box;
    ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = PAPER; roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 6); ctx.fill(); ctx.restore();
    art.crayon([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0], [x1, y0]], { color: INK, width: 1.6, alpha: 0.7, passes: 2, wobble: 0.6, crumple: 0.8, breakProb: 0.02, step: 4 });
    n.lines.forEach((t, i) => art.scrawl(t, x0 + 16, y0 + 11 + n.size + i * n.lh - 2, { size: n.size, color: INK, font: FONT, alpha: 0.9 }));
  }
}
