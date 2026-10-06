// Flat Earth website: the azimuthal equidistant map, drawn in crayon from any origin, at five scales.
// Follows world-azimuthal.js (book sheet 1) and hemi-map.js (sheets 4a/4b) step by step: paper,
// blue-hatched water, paper laid back over land, dashed distance rings labelled in open water, lakes,
// borders, coastlines, rims, lettering, the hatched centre dot, and the book's neatline border.
// The shared steps (paper, water, lettering, lines, places) come from map-common.js; what is azimuthal
// lives here: the projection, the panels, the regions for the zoomed views, and the distance rings.
//
// A view is made of panels. Each panel is one azimuthal equidistant projection clipped to a shape:
//   earth        one disk: the whole world, the rim is the antipode
//   hemispheres  two disks: the near half centred on the origin, the far half centred on its antipode
//   continent / country / state   one box fitted to the region the origin is in, still centred on the origin
// Places the reader adds are drawn on a separate transparent canvas on top.
import { createArt, INK, FONT } from './crayon.js';
import { azimuthal, projectLine, ringContains, EARTH_MI, HALF_EARTH_MI, D2R, greatCircle } from './projection.js';
import {
  BaseMap, EDGE, seedOf, isCut, toV, ang, capOf, kmBetween, shapePath, inShape, boundsOf, clipRuns, splitAt,
  paperUnderPanels, waterAndLand, landMask, placeLabels, countryLabels, drawLinework, drawRim, letterLabels, centerDot,
  drawPlaceLayer, crayonAround, LINE, fmt, displayName, antipodeText,
} from './map-common.js';

export const SCALES = [
  { id: 'earth', label: 'Earth' },
  { id: 'hemispheres', label: 'Hemispheres' },
  { id: 'continent', label: 'Continent' },
  { id: 'country', label: 'Country' },
  { id: 'state', label: 'State / province' },
];
const W = 1800;                 // logical width; height depends on the view
const RING_SIZE = 24;
const NICE = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];
const FAINT = { 5: 1, 10: 2, 25: 5, 50: 10, 100: 20, 250: 50, 500: 100, 1000: 200, 2500: 500 };
const ringText = (mi) => mi.toLocaleString('en-US') + ' MI';
const HALF_MI = Math.round(HALF_EARTH_MI / 10) * 10;   // 12,440
const QUARTER_MI = Math.round(HALF_EARTH_MI / 20) * 10; // 6,220

// ---------- regions: which continent / country / state the origin is in, and which rings to fit ----------
const continentOf = (country, lon) => (country.n === 'Russia' ? (lon > 60 ? 'Asia' : 'Europe') : country.c);
const containsLL = (rings, ll) => rings.some((r) => ringContains(r.r || r, ll));
// Chain outward from one piece of land: add every ring within gapKm of land already kept.
// Keeps island chains together (all of Japan, Corsica with France, Alaska with North America)
// and drops far-flung pieces (Hawaii from the US, French Guiana from France).
// The seed is the ring the origin is on, or else the biggest ring.
function mainCluster(rings, originLL, gapKm = 300) {
  if (!rings.length) return [];
  const seed = (originLL && rings.find((r) => ringContains(r.r, originLL))) || rings.reduce((a, b) => (b.a > a.a ? b : a));
  const caps = new Map(rings.map((r) => [r, capOf(r.r)]));
  const gap = (a, b) => { const A = caps.get(a), B = caps.get(b); return kmBetween(A.v, B.v) - (A.r + B.r) * 6371; };
  const kept = [seed], left = new Set(rings); left.delete(seed);
  for (let i = 0; i < kept.length; i++) for (const r of [...left]) if (gap(kept[i], r) < gapKm) { kept.push(r); left.delete(r); }
  return kept;
}
function nearest(items, ov, test = () => true) {
  let best = null, bd = Infinity;
  for (const it of items) {
    if (!test(it)) continue;
    for (const { r } of it.p) for (let i = 0; i < r.length; i += 4) { const d = ang(ov, toV(r[i])); if (d < bd) { bd = d; best = it; } }
  }
  return best;
}
function findRegion(scale, origin, x) {
  const ll = [origin.lon, origin.lat], ov = toV(ll);
  const real = (c) => c.c !== 'Seven seas (open ocean)'; // tiny ocean islands have no continent
  let country = x.countries.find((c) => containsLL(c.p, ll)), note = '';
  if (!country || (scale === 'continent' && !real(country))) {
    country = nearest(x.countries, ov, scale === 'continent' ? real : undefined);
    note = `${origin.short || origin.name} is not inside a ${scale === 'continent' ? 'continent' : 'country'}, so this shows the nearest one.`;
  }
  if (scale === 'country') return { name: country.n, fit: mainCluster(country.p, ll), outline: country.p.map((r) => r.r), note };
  if (scale === 'continent') {
    const cont = continentOf(country, origin.lon), pieces = [];
    for (const c of x.countries) {
      // Russia counts for Europe west of 60 E and for Asia east of it, and for nothing else
      if (c.n === 'Russia' ? cont !== 'Europe' && cont !== 'Asia' : c.c !== cont) continue;
      for (const r of c.p) {
        if (r.a < 1) continue; // small islands do not stretch the box
        if (c.n === 'Russia') { const side = r.r.filter(([lon]) => (cont === 'Asia' ? lon > 60 || lon < -150 : lon <= 60 && lon > -150)); if (side.length > 3) pieces.push({ a: r.a, r: side }); }
        else pieces.push(r);
      }
    }
    // chain across seas up to 2,000 km: keeps New Zealand with Australia and Iceland with Europe, drops Hawaii
    return { name: cont, fit: mainCluster(pieces, ll, 2000), outline: [], note };
  }
  // state / province
  const inCountry = x.admin1.filter((s) => s.adm === country.n);
  if (!inCountry.length) {
    return { name: country.n, fit: mainCluster(country.p, ll), outline: country.p.map((r) => r.r), fallback: true,
      note: `State and province outlines are only in the map data for ${[...new Set(x.admin1.map((s) => s.adm))].join(', ')}. This shows the country instead.` };
  }
  let st = inCountry.find((s) => containsLL(s.p, ll));
  if (!st) { st = nearest(inCountry, ov); note = `${origin.short || origin.name} is not inside a state or province, so this shows the nearest one.`; }
  return { name: st.n, fit: mainCluster(st.p, ll), outline: st.p.map((r) => r.r), note };
}

// ---------- panels ----------
// Drop the start of a polyline that lies within r px of (cx, cy), and begin it exactly on that circle instead
// (between the last point inside and the first point outside). A line that never leaves the circle comes back empty.
function trimNear(pts, cx, cy, r) {
  const d = (q) => Math.hypot(q[0] - cx, q[1] - cy);
  const i = pts.findIndex((q) => d(q) > r);
  if (i < 0) return [];
  if (i === 0) return pts;
  const [a, b] = [pts[i - 1], pts[i]], da = d(a), db = d(b), t = (r - da) / ((db - da) || 1);
  return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...pts.slice(i)];
}

// One azimuthal equidistant projection (centred on `center`, k px per radian) clipped to a shape.
// Carries what map-common needs: shape, inverse(x, y), labelAt(lon, lat).
function panel(center, cx, cy, k, shape, far = false) {
  const p = { center, cv: toV([center.lon, center.lat]), cx, cy, k, shape, far, proj: azimuthal(center, cx, cy, Math.PI * k) };
  p.maxC = shape.type === 'circle' ? shape.r / k
    : Math.max(...[[shape.x0, shape.y0], [shape.x1, shape.y0], [shape.x0, shape.y1], [shape.x1, shape.y1]].map(([x, y]) => Math.hypot(x - cx, y - cy))) / k;
  p.inverse = (x, y) => p.proj.invert(x, y);
  // lettering size follows the area's drawn size: the map stretches areas by c / sin(c) at angular distance c
  p.labelAt = (lon, lat) => {
    const [x, y, c] = p.proj([lon, lat]);
    if (c > p.maxC || c > 176 * D2R) return null;
    const stretch = c < 1e-6 ? 1 : c / Math.sin(c);
    return { x, y, extent: (a) => Math.sqrt(a * stretch) * (p.k * D2R) };
  };
  return p;
}

export class AzimuthalMap extends BaseMap {
  constructor(base, overlay, data) {
    super(base, overlay, data);
    this.extra = null;
    this.originMark = 'none'; this.originSub = 'CENTER'; // the base map marks the centre itself
  }

  // Work out the view for this origin and scale (loading the region data if it is needed).
  // Returns what the page needs for its heading and notes.
  async prepare(origin, scale = 'earth') {
    let region = null;
    if (scale === 'continent' || scale === 'country' || scale === 'state') {
      // (the region data loads once; this.origin and this.view change only after it is here, so a redraw of the
      // places while it loads still sees the old view whole, and a zoomed view never exists without its region)
      if (!this.extra) {
        const [countries, admin1, admin1Lines] = await Promise.all(['countries', 'admin1', 'admin1-lines'].map((n) => this.data.load(n)));
        this.extra ??= { countries, admin1, admin1Lines };
      }
      region = findRegion(scale, origin, this.extra) || null;
    }
    this.origin = origin;
    this.view = this.buildView(origin, scale, region);
    const v = this.view, rings = v.panels[0].rings; // { main, faint } in miles
    return {
      scale, title: v.title, region: region?.name ?? null, note: region?.note ?? '', fallback: !!region?.fallback, rings,
      ...this.describe(origin, scale, region),
      legend: `Rings every ${fmt(rings.main)} miles; faint rings every ${fmt(rings.faint)}. Headings are degrees clockwise from north.`,
    };
  }
  // the heading text beside the map
  describe(o, scale, region) {
    const name = displayName(o), half = fmt(HALF_MI), quarter = fmt(QUARTER_MI);
    const subtitle = 'DISTANCES FROM ' + name.toUpperCase();
    if (scale === 'earth' || (!region?.name && scale !== 'hemispheres')) return { subtitle, prose: ['Centered on ', { strong: name }, '. Every straight line from the center is a shortest route, and its length is true. ' +
      `The whole edge is the antipode, the spot on the exact opposite side of the Earth: ${antipodeText(o)}, ${half} miles away.`] };
    if (scale === 'hemispheres') return { subtitle, prose: ['The near half is centered on ', { strong: name }, ` and holds everything within ${quarter} miles. ` +
      `The far half is centered on the antipode (${antipodeText(o)}) and holds everything farther away. Rings on both halves measure miles from ${o.short}.`] };
    return { subtitle, prose: ['Centered on ', { strong: name }, `. The box is fitted to ${region.name}. Every straight line from the center is a shortest route, and its length is true.`] };
  }

  buildView(origin, scale, region) {
    const anti = { lat: -origin.lat, lon: ((origin.lon + 360) % 360) - 180, name: 'Antipode', short: 'Antipode' };
    if (scale === 'hemispheres') {
      const H = 1010, R = 405, cy = 548, k = R / (Math.PI / 2);
      const near = panel(origin, 450, cy, k, { type: 'circle', cx: 450, cy, r: R });
      const far = panel(anti, 1350, cy, k, { type: 'circle', cx: 1350, cy, r: R }, true);
      near.rings = { main: 2000, faint: 500, list: [2000, 4000, 6000], R: (mi) => mi / EARTH_MI * k, rimNote: `${ringText(QUARTER_MI)} (HALFWAY)` };
      // (no 12,000 ring on the far half: it would crowd the ANTIPODE lettering)
      far.rings = { main: 2000, faint: 500, list: [8000, 10000], R: (mi) => (HALF_EARTH_MI - mi) / EARTH_MI * k, from: QUARTER_MI };
      return { kind: 'hemispheres', W, H, panels: [near, far], title: 'THE TWO HALVES', lakeRank: 3, labelRank: 6, sizes: [12, 30] };
    }
    if (region) {
      const H = W, unit = azimuthal(origin, 0, 0, Math.PI);
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0; // the origin is always in the box
      for (const { r } of region.fit) for (const q of r) { const [x, y] = unit(q); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const side = Math.max(x1 - x0, y1 - y0, 0.006) * 1.14, size = W - 2 * EDGE, k = size / side;
      const cx = W / 2 - (x0 + x1) / 2 * k, cy = H / 2 - (y0 + y1) / 2 * k;
      const P = panel(origin, cx, cy, k, { type: 'rect', x0: EDGE, y0: EDGE, x1: W - EDGE, y1: H - EDGE });
      const maxMi = P.maxC * EARTH_MI, main = NICE.find((n) => maxMi / n <= 6) ?? 2500, list = [];
      for (let mi = main; mi <= maxMi; mi += main) list.push(mi);
      P.rings = { main, faint: FAINT[main], list, R: (mi) => mi / EARTH_MI * k };
      const detail = scale === 'continent' ? 8 : 10;
      return { kind: 'box', scale, W, H, panels: [P], region, title: region.name.toUpperCase(), lakeRank: 99, labelRank: detail, sizes: [13, 40] };
    }
    const RAD = 780, k = RAD / Math.PI, P = panel(origin, W / 2, W / 2, k, { type: 'circle', cx: W / 2, cy: W / 2, r: RAD });
    P.rings = { main: 2500, faint: 500, list: [2500, 5000, 7500, 10000], R: (mi) => mi / EARTH_MI * k, rimNote: `${ringText(HALF_MI)} (ANTIPODE)` };
    return { kind: 'earth', W, H: W, panels: [P], title: 'THE WORLD', lakeRank: 3, labelRank: 5, sizes: [11, 30] };
  }

  // Is this lon/lat ring anywhere near what the panel shows?
  near(ring, P) { const c = capOf(ring); return ang(P.cv, c.v) - c.r < P.maxC + 0.03; }

  // ---------------- the base map ----------------
  drawBase(origin) {
    const V = this.view, H = V.H, box = V.kind === 'box';
    this.origin = origin;
    this.sizeCanvases();
    const art = createArt(this.base, { width: W, height: H, seed: seedOf(origin.name + origin.lat.toFixed(2) + origin.lon.toFixed(2) + V.kind) });
    const { ctx, crayon, scrawl, batch } = art;
    const { land, lakes, borders, labels } = this.data;
    const show = this.showLabels;
    const step = box ? Infinity : 30;
    let t0 = performance.now(); const lap = (k) => { if (window.FE_DEBUG) console.log(k, Math.round(performance.now() - t0)); t0 = performance.now(); };
    const XY = (pts) => pts.map((p) => [p[0], p[1]]);
    const lakeList = lakes.filter((l) => l.r <= V.lakeRank).map((l) => l.p);

    // project the rings each panel needs; a ring that wraps the panel's antipode is land out to its full rim
    for (const P of V.panels) {
      const anti = P.proj.antipode, keep = (r) => !box || this.near(r, P), rim = { cx: P.cx, cy: P.cy, r: Math.PI * P.k };
      P.landRings = [];
      for (const poly of land) for (const ring of poly) if (keep(ring)) {
        const [pts, jumps] = projectLine(P.proj, ring, step);
        P.landRings.push({ raw: ring, pts: XY(pts), jumps, rim: ringContains(ring, anti) ? rim : null });
      }
      P.lakeRings = lakeList.filter(keep).map((r) => ({ raw: r, pts: XY(projectLine(P.proj, r, step)[0]), rim: ringContains(r, anti) ? rim : null }));
    }
    lap('project');

    // paper only where the map is, then water: hatch each panel and lay the paper back over land (lakes stay
    // water), closing hairline gaps along the data seams (antimeridian cut, south pole) inside land
    const { layPaper } = paperUnderPanels(art, this.base, W, V.panels);
    for (const P of V.panels) {
      const seams = [];
      for (const { raw } of P.landRings) for (let i = 0; i < raw.length - 1; i++) if (isCut(raw[i], raw[i + 1])) seams.push(projectLine(P.proj, [raw[i], raw[i + 1]], box ? 60 : 20)[0]);
      waterAndLand(art, P, layPaper, seams);
    }
    lap('water');

    // land mask, to keep ring labels in open water
    const isLand = landMask(W, H, V.panels);

    // lettering: choose which names fit before drawing rings, so rings can break around them
    const placed = [];
    if (show) for (const P of V.panels) {
      placed.push({ x0: P.cx - 22, y0: P.cy - 22, x1: P.cx + 22, y1: P.cy + 22, text: null, fixed: true });
      placeLabels(art, P, isLand, placed, countryLabels(labels, V.labelRank), V.sizes, 1);
      if (box && V.scale !== 'continent' && this.extra) {
        const states = this.extra.admin1.map((s) => ({ n: s.n, x: s.x, y: s.y, a: s.a, rank: 0 })).sort((a, b) => b.a - a.a);
        placeLabels(art, P, isLand, placed, states, [11, 26], 0.8);
      }
    }
    const texts = placed.filter((b) => b.text);
    lap('labels');

    // distance rings: faint ones first, then dashed crayon rings with a gap for each label
    const hitsLabel = (x, y, pad) => texts.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad);
    ctx.font = RING_SIZE + 'px ' + FONT;
    const ringLabels = [];
    for (const P of V.panels) {
      const { rings } = P, TARGET = (P.far ? 55 : 118) * D2R;
      const around = (k) => TARGET + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * D2R;
      const halfOf = (mi) => (ctx.measureText(ringText(mi)).width / 2 + 16) / rings.R(mi);
      // open water first; views that are nearly all land (a state) then allow land, still clear of lettering
      const clearArc = (r, a, half, onLand) => {
        for (let t = -half; t <= half; t += 3 / r) for (const dr of [-18, -9, 0, 9, 18]) {
          const x = P.cx + Math.cos(a + t) * (r + dr), y = P.cy + Math.sin(a + t) * (r + dr);
          if (!inShape(P.shape, x, y, 12) || (!onLand && isLand(x, y)) || hitsLabel(x, y, 6)) return false;
        }
        return true;
      };
      const vis = rings.list.filter((mi) => { const r = rings.R(mi); return r > 4 && r < P.maxC * P.k; });
      P.ringAngle = {};
      for (const onLand of [false, true]) {
        const todo = vis.filter((mi) => P.ringAngle[mi] == null);
        if (!todo.length) break;
        let shared = null;
        for (let k = 0; k < 160 && shared === null; k++) if (todo.every((mi) => clearArc(rings.R(mi), around(k), halfOf(mi), onLand))) shared = around(k);
        for (const mi of todo) {
          let best = shared;
          for (let k = 0; best === null && k < 360; k++) if (clearArc(rings.R(mi), around(k), halfOf(mi), onLand)) best = around(k);
          P.ringAngle[mi] = best; // null: no clear spot, the ring goes unlabelled
        }
      }
      // faint rings
      ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape);
      for (const b of texts) ctx.rect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
      for (const mi of vis) if (show && P.ringAngle[mi] !== null) {
        const r = rings.R(mi), a = P.ringAngle[mi], hw = ctx.measureText(ringText(mi)).width / 2 + 14;
        ctx.moveTo(P.cx + Math.cos(a) * (r + 8) + hw, P.cy + Math.sin(a) * (r + 8)); ctx.arc(P.cx + Math.cos(a) * (r + 8), P.cy + Math.sin(a) * (r + 8), hw, 0, Math.PI * 2);
      }
      ctx.clip('evenodd');
      ctx.strokeStyle = INK; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.1; ctx.setLineDash([5, 7]); ctx.lineCap = 'round';
      const start = rings.from ? Math.ceil(rings.from / rings.faint) * rings.faint : rings.faint;
      for (let mi = start; mi < (rings.from ? HALF_EARTH_MI : P.maxC * EARTH_MI); mi += rings.faint) {
        if (mi % rings.main === 0) continue;
        const r = rings.R(mi); if (r < 2) continue;
        ctx.beginPath(); ctx.arc(P.cx, P.cy, r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
      // main rings
      ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
      ctx.font = RING_SIZE + 'px ' + FONT;
      batch(() => { for (const mi of vis) {
        const r = rings.R(mi), la = P.ringAngle[mi] ?? 0, gap = show && P.ringAngle[mi] !== null ? (ctx.measureText(ringText(mi)).width / 2 + 12) / r : 0;
        const dash = 16 / r, space = 10 / r;
        for (let t = la + gap; t < la + 2 * Math.PI - gap - dash * 0.5; t += dash + space) {
          const end = Math.min(t + dash, la + 2 * Math.PI - gap), pts = [];
          for (let u = t; u <= end + 1e-9; u += (end - t) / 5) pts.push([P.cx + Math.cos(u) * r, P.cy + Math.sin(u) * r]);
          if (!pts.some(([x, y]) => inShape(P.shape, x, y, -20)) || pts.some(([x, y]) => hitsLabel(x, y, 3))) continue;
          crayon(pts, { color: INK, width: 1.7, alpha: 0.72, passes: 2, wobble: 0.4, crumple: 0.5, breakProb: 0.03, step: 3, jitter: 0.4 });
        }
        if (show && P.ringAngle[mi] !== null) ringLabels.push([P, mi]);
      } });
      ctx.restore();
    }
    lap('rings');

    // lakes, borders, coastlines (never inking the artificial seams or antipode jumps), then the rims:
    // for the world, every point on the rim is the antipode
    for (const P of V.panels) {
      const bounds = boundsOf(P.shape), keep = (r) => !box || this.near(r, P);
      const inkRuns = (raw, opts) => {
        let cur = [];
        const flush = () => {
          if (cur.length > 1) {
            const [pts, jumps] = projectLine(P.proj, cur, step);
            for (const s of splitAt(XY(pts), jumps)) for (const run of box ? clipRuns(s, bounds) : [s]) crayon(run, opts);
          }
          cur = [];
        };
        for (let i = 0; i < raw.length - 1; i++) {
          if (isCut(raw[i], raw[i + 1])) { flush(); continue; }
          if (!cur.length) cur.push(raw[i]); cur.push(raw[i + 1]);
        }
        flush();
      };
      drawLinework(art, P, {
        lakes: P.lakeRings,
        admin: box && this.extra ? this.extra.admin1Lines.filter(keep) : [],
        borders: borders.filter(keep),
        land: P.landRings,
        outlines: box ? V.region.outline.filter(keep) : [], // the country or state in question gets a bolder outline
      }, inkRuns);
      drawRim(art, P.shape);
    }
    lap('lines');

    // lettering
    if (show) {
      letterLabels(art, texts);
      // set tangent to the ring and straddling it; in the top half the lettering is turned over so it never reads upside down
      const labelOnRing = (P, text, r, a, size) => {
        const flip = Math.sin(a) < -0.05, rr = flip ? r - size * 0.36 : r + size * 0.36;
        scrawl(text, P.cx + Math.cos(a) * rr, P.cy + Math.sin(a) * rr, { size, color: INK, align: 'center', rot: a - Math.PI / 2 + (flip ? Math.PI : 0), font: FONT });
      };
      for (const [P, mi] of ringLabels) labelOnRing(P, ringText(mi), P.rings.R(mi), P.ringAngle[mi], RING_SIZE);
      for (const P of V.panels) if (P.rings.rimNote) {
        const a = Object.values(P.ringAngle).find((v) => v !== null) ?? 125 * D2R;
        labelOnRing(P, P.rings.rimNote, P.shape.r + 34, a, 20);
      }
      if (V.kind === 'hemispheres') {
        scrawl('THE NEAR HALF', V.panels[0].cx, 104, { size: 30, color: INK, align: 'center', font: FONT });
        scrawl('THE FAR HALF', V.panels[1].cx, 104, { size: 30, color: INK, align: 'center', font: FONT });
        const f = V.panels[1];
        scrawl('ANTIPODE', f.cx, f.cy + 44, { size: 22, color: INK, align: 'center', font: FONT });
        scrawl(ringText(HALF_MI), f.cx, f.cy + 68, { size: 18, color: INK, align: 'center', font: FONT, alpha: 0.8 });
      }
    }

    // centres: the origin is a hatched ink dot in a hand-drawn ring; the antipode (far half) a hollow ring
    for (const P of V.panels) centerDot(art, P.cx, P.cy, { hollow: P.far });

    art.border({ box: [0, 0, W, H] });
    lap('text+border');
    art.grain({ vignette: 0 });
    lap('grain');
    this.placedLabels = texts;
  }

  // ---------------- places the reader added ----------------
  // Every shortest route from the origin is a straight line through the centre; the far half shows its far end.
  drawPlaces(places, { highlight = null } = {}) {
    if (!this.view) return super.drawPlaces(places);
    const V = this.view, home = V.panels.find((P) => !P.far);
    this.placeHits = drawPlaceLayer(this.overlay, {
      W, H: V.H, edge: EDGE, origin: this.origin, places, highlight, showLabels: this.showLabels,
      soft: this.placedLabels || [], hard: V.panels.map((P) => ({ x0: P.cx - 18, y0: P.cy - 18, x1: P.cx + 18, y1: P.cy + 18 })),
      originMark: this.originMark, originSub: this.originSub,
      // which panel shows the place (the near half before the far half)
      locate: (p) => {
        const pv = toV([p.lon, p.lat]);
        const P = p.isOrigin ? home : V.panels.find((Q) => { const [x, y] = Q.proj([p.lon, p.lat]); return ang(Q.cv, pv) <= Q.maxC && inShape(Q.shape, x, y); });
        if (!P) return null;
        const [x, y] = P.proj([p.lon, p.lat]);
        return { x, y, cx: P.cx, cy: P.cy, P };
      },
      route: (art, p, hot, at) => {
        const P = at?.P, octx = art.ctx, route = greatCircle(this.origin, p, 160);
        for (const Q of V.panels) {
          const runs = []; let cur = [];
          for (const q of route) { if (ang(Q.cv, toV(q)) < Q.maxC + 0.05) cur.push(q); else if (cur.length) { runs.push(cur); cur = []; } }
          if (cur.length) runs.push(cur);
          octx.save(); octx.beginPath(); shapePath(octx, Q.shape); octx.clip();
          const [px, py] = Q.proj([p.lon, p.lat]);
          for (const run of runs) {
            if (run.length < 2) continue;
            // (the route stops just outside the center dot and the place dot. It is cut exactly there, not at the
            // nearest sample point: in the zoomed boxes one sample step of a long route can be 100 px or more.)
            let pts = projectLine(Q.proj, run, V.kind === 'box' ? Infinity : 30)[0].map((q) => [q[0], q[1]]);
            if (Q === home) pts = trimNear(pts, Q.cx, Q.cy, 20);
            if (Q === P) pts = trimNear(pts.reverse(), px, py, 10).reverse();
            for (const seg of clipRuns(pts, boundsOf(Q.shape), 30)) crayonAround(art, seg, LINE.route(hot), this.showLabels ? this.placedLabels || [] : []);
          }
          octx.restore();
        }
      },
    });
  }
}
