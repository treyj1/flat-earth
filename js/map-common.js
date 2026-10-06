// Flat Earth website: the drawing every map type shares, in the book's crayon style.
// A map type supplies its projection (forward, inverse, the map's edge, how it handles seams) and its own
// overlays; everything here is projection-agnostic: paper and frame, hatched water and paper land, coasts,
// lakes, borders and state lines, country lettering that never collides, the origin star and places of
// interest with their labels on paper patches, graticules, and line projection that breaks at seams.
//
// Two ways to use it (README.md, "Adding a map type", has the full contract):
//   1. extend BaseMap, build this.view = { W, H, panels: [...] } in prepare(), and call renderBase(this, {...})
//      from drawBase(). Each panel gives a shape (its edge on the canvas) and a geo spec ('cap' or 'lonlat',
//      see projectFill) and the rest is done for you.
//   2. call the step functions yourself (paperUnderPanels, waterAndLand, landMask, placeLabels, drawLinework,
//      drawRim, letterLabels, drawPlaceLayer) with your own projected rings, as azimuthal-map.js does.
//
// Coordinates: every map draws in a logical space W x H (W is 1800 for every type so far); createArt scales it
// to the canvas's real pixels. Geography is [lon, lat] in degrees.
import { createArt, INK, WATER, WATER2, FONT, ORANGE } from './crayon.js';
import { D2R, EARTH_MI, HALF_EARTH_MI, distanceMi, ringContains, greatCircle } from './projection.js';

export { INK, WATER, WATER2, FONT, ORANGE };
export const PAPER = '#f3ecdb';
export const MAP_W = 1800;        // logical width every map type uses
export const EDGE = 34;           // map content stays inside the neatline border (art.border at box [0, 0, W, H])

// ---------- small helpers ----------
export const seedOf = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 100000 + 1; };
export const seedOfPlace = (p) => { let h = 7; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 100000 + 1; };
export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const miText = (mi) => fmt(mi) + ' MI';
// "Nairobi, Nairobi County, Kenya" -> "Nairobi, Kenya" for headings
export const displayName = (p) => { const parts = p.name.split(', '); return parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 1]}` : p.name; };
export const antipodeOf = (o) => ({ lat: -o.lat, lon: ((o.lon + 360) % 360) - 180 });
export const antipodeText = (o) => {
  const { lat, lon } = antipodeOf(o);
  return `${Math.abs(lat).toFixed(1)} degrees ${lat >= 0 ? 'north' : 'south'}, ${Math.abs(lon).toFixed(1)} degrees ${lon >= 0 ? 'east' : 'west'}`;
};
// Natural Earth cuts land at the antimeridian and runs Antarctica along the south pole; those edges are not coast
export const isCut = (a, b) => (Math.abs(a[0]) > 179.99 && Math.abs(b[0]) > 179.99) || (a[1] < -89.9 && b[1] < -89.9) || (a[1] < -84.5 && b[1] < -84.5 && Math.abs(a[0] - b[0]) > 20);
export const wrapLon = (lon) => ((lon + 540) % 360) - 180;

// ---------- sphere helpers ----------
export const toV = ([lon, lat]) => { const f = lat * D2R, l = lon * D2R; return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)]; };
export const fromV = ([x, y, z]) => [Math.atan2(y, x) / D2R, Math.atan2(z, Math.hypot(x, y)) / D2R]; // any length
export const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
export const kmBetween = (a, b) => ang(a, b) * 6371;
// A bounding cap per ring ({ v: centre vector, r: radius in radians }), so far-away rings can be skipped
const capCache = new WeakMap();
export function capOf(ring) {
  let c = capCache.get(ring);
  if (c) return c;
  let x = 0, y = 0, z = 0;
  const vs = ring.map(toV);
  for (const v of vs) { x += v[0]; y += v[1]; z += v[2]; }
  const n = Math.hypot(x, y, z) || 1, v = [x / n, y / n, z / n];
  let r = 0; for (const q of vs) r = Math.max(r, ang(v, q));
  if (n / vs.length < 0.2) r = Math.PI; // ring wraps much of the globe
  c = { v, r }; capCache.set(ring, c);
  return c;
}

// ---------- shapes: a panel's edge on the canvas ----------
// { type: 'circle', cx, cy, r } | { type: 'rect', x0, y0, x1, y1 } | { type: 'poly', rings: [[[x, y], ...], ...] } (even-odd)
export const shapePath = (ctx, s) => {
  if (s.type === 'circle') { ctx.moveTo(s.cx + s.r, s.cy); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); }
  else if (s.type === 'poly') for (const r of s.rings) { r.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
  else ctx.rect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
};
// is (x, y) inside the shape, at least m px from its edge? (a negative m reaches outside)
export const inShape = (s, x, y, m = 0) => {
  if (s.type === 'circle') return Math.hypot(x - s.cx, y - s.cy) < s.r - m;
  if (s.type !== 'poly') return x > s.x0 + m && x < s.x1 - m && y > s.y0 + m && y < s.y1 - m;
  let inside = false;
  for (const r of s.rings) if (ringContains(r, [x, y])) inside = !inside;
  if (!m) return inside;
  let d = Infinity;
  for (const r of s.rings) for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(x, y, r[i], r[(i + 1) % r.length]));
  return m > 0 ? inside && d > m : inside || d < -m;
};
const segDist = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
export const boundsOf = (s) => {
  if (s.type === 'circle') return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
  if (s.type !== 'poly') return [s.x0, s.y0, s.x1, s.y1];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of s.rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};

// ---------- projected-line helpers ----------
// Keep only the parts of a projected line near a box (zoomed views project far-off coasts to huge coordinates)
export function clipRuns(pts, [x0, y0, x1, y1], m = 40) {
  const out = []; let cur = [];
  const near = (a, b) => Math.max(a[0], b[0]) > x0 - m && Math.min(a[0], b[0]) < x1 + m && Math.max(a[1], b[1]) > y0 - m && Math.min(a[1], b[1]) < y1 + m;
  for (let i = 0; i < pts.length - 1; i++) {
    if (near(pts[i], pts[i + 1])) { if (!cur.length) cur.push(pts[i]); cur.push(pts[i + 1]); }
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
// split a projected line at the indices in jumps (projection.js projectLine's second result)
export function splitAt(pts, jumps) {
  if (!jumps.length) return [pts];
  const out = []; let s = 0;
  for (const j of jumps) { out.push(pts.slice(s, j)); s = j; }
  out.push(pts.slice(s));
  return out.filter((p) => p.length > 1);
}
export const pxArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// Project a lon/lat polyline with fwd(lon, lat) -> [x, y] or null (null = not on this map).
// Long steps are subdivided (linear in lon/lat) until shorter than maxStep px. The line breaks where fwd turns
// null (cut at the last point inside, found by bisection), where a step still jumps after `depth` halvings (a seam),
// and, with cuts, at Natural Earth's artificial edges (antimeridian, south pole). With bounds [x0, y0, x1, y1],
// only the parts near that box are kept. Returns an array of runs, each an array of [x, y].
export function projectPolyline(fwd, line, { maxStep = 24, depth = 8, bounds = null, margin = 40, cuts = true } = {}) {
  const runs = []; let cur = [];
  const end = () => { if (cur.length > 1) runs.push(cur); cur = []; };
  const emit = (pa, pb) => { if (!cur.length) cur.push(pa); cur.push(pb); };
  const seg = (a, b, pa, pb, d) => {
    if (pa && pb) {
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      if (len <= maxStep) return emit(pa, pb);
      if (d >= depth) { if (len > maxStep * 3) return end(); return emit(pa, pb); }
    } else if (!pa && !pb) {
      if (d >= 2) return end(); // both ends off the map: peek inside a little in case the step dips in
    } else if (d >= depth) {
      if (pa) { if (!cur.length) cur.push(pa); end(); } else { end(); cur = [pb]; }
      return;
    }
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pm = fwd(m[0], m[1]);
    seg(a, m, pa, pm, d + 1); seg(m, b, pm, pb, d + 1);
  };
  let prev = line.length ? fwd(line[0][0], line[0][1]) : null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], pb = fwd(b[0], b[1]);
    if (cuts && isCut(a, b)) end(); else seg(a, b, prev, pb, 0);
    prev = pb;
  }
  end();
  return bounds ? runs.flatMap((r) => clipRuns(r, bounds, margin)) : runs;
}

// ---------- geo specs: how a panel turns the sphere into canvas points ----------
// A panel's `geo` is one of:
//   { type: 'cap', center: { lon, lat }, maxC, fwd(lon, lat) -> [x, y], rim }
//       Everything within maxC radians of center is on the map (azimuthal-type maps: gnomonic, stereographic,
//       orthographic, polar). fwd must be valid out to maxC. rim = the map's edge, where the cap boundary lands:
//       { cx, cy, r } or a closed [[x, y], ...] outline. Land that wraps the far side is filled out to the rim.
//   { type: 'lonlat', lon0 = 0, lon = [-180, 180], lat = [-90, 90], fwd(dlon, lat) -> [x, y] }
//       Cylindrical, pseudo-cylindrical and lobed maps. dlon is the longitude RELATIVE to lon0 (degrees), and it is
//       never wrapped: the left edge is dlon = lon[0], the right edge dlon = lon[1]. So fwd must not wrap either
//       (Mercator: x = cx + dlon * k). One panel per lobe for interrupted maps (lon/lat give the lobe's box).
// projectFill and projectLines use it; geoForward gives a single-point forward that returns null off the map.
export function geoForward(g) {
  if (g.type === 'cap') {
    const cv = toV([g.center.lon, g.center.lat]);
    return (lon, lat) => (ang(cv, toV([lon, lat])) <= g.maxC ? g.fwd(lon, lat) : null);
  }
  const { lon0 = 0, lon: [a, b] = [-180, 180], lat: [c, d] = [-90, 90] } = g;
  return (lon, lat) => {
    const l = wrapLon(lon - lon0); // in [-180, 180): a point on the seam itself lands on the left edge
    return l >= a && l <= b && lat >= c && lat <= d ? g.fwd(l, lat) : null;
  };
}
// Project closed lon/lat rings for FILLING (land, lakes). Points off the map are pulled onto its edge, so a ring that
// leaves the map runs along the edge and still fills correctly. Returns ring records { raw, pts, rim } for
// waterAndLand and landMask (rim: an extra outline added with even-odd, for land that wraps the far side).
export function projectFill(ring, g, { maxStep = 24 } = {}) {
  if (g.type === 'cap') {
    // Clip in the azimuthal equidistant plane around the cap's center (continuous everywhere but the antipode),
    // against a 180-sided polygon inscribed in the cap's edge; then project what is left.
    const A = aeFrame(g.center), anti = [wrapLon(g.center.lon + 180), -g.center.lat];
    const uv = aeDensify(ring, A);
    let rmax = 0; for (const [u, w] of uv) rmax = Math.max(rmax, Math.hypot(u, w));
    const clipped = rmax <= g.maxC * Math.cos(Math.PI / 180) ? uv : clipConvex(uv, capWindow(g.maxC));
    if (clipped.length < 3) return [];
    const ll = clipped.map((p) => A.inv(p));
    return [{ raw: ring, pts: densify(ll, (q) => g.fwd(q[0], q[1]), sphereMid, maxStep), rim: ringContains(ring, anti) ? g.rim : null }];
  }
  const { lon0 = 0, lon: [a, b] = [-180, 180], lat: [c, d] = [-90, 90] } = g, out = [];
  for (const s of [0, 360, -360]) {
    let mn = Infinity, mx = -Infinity, fn = Infinity, fx = -Infinity;
    const rel = ring.map(([lon, lat]) => { const l = lon - lon0 + s; mn = Math.min(mn, l); mx = Math.max(mx, l); fn = Math.min(fn, lat); fx = Math.max(fx, lat); return [l, lat]; });
    if (mx <= a || mn >= b || fx <= c || fn >= d) continue;
    const clampP = ([l, f]) => g.fwd(Math.max(a, Math.min(b, l)), Math.max(c, Math.min(d, f)));
    out.push({ raw: ring, pts: densify(rel, clampP, linMid, maxStep), rim: null });
  }
  return out;
}
// Project a lon/lat polyline for INKING (coasts, borders, graticules, routes): runs that stop at the map's edge
// and at seams. opts as projectPolyline (bounds, maxStep, cuts).
// The line is first unwrapped (no step longer than 180 degrees of longitude), so routes and other generated lines
// may cross the antimeridian freely.
export function projectLines(line, g, opts = {}) {
  line = unwrapLine(line);
  if (g.type === 'cap') return projectPolyline(geoForward(g), line, opts);
  const { lon0 = 0, lon: [a, b] = [-180, 180], lat: [c, d] = [-90, 90] } = g, out = [];
  let mn = Infinity, mx = -Infinity;
  for (const [lon] of line) { mn = Math.min(mn, lon - lon0); mx = Math.max(mx, lon - lon0); }
  const shifts = [];
  for (let n = Math.ceil((a - mx) / 360); n <= Math.floor((b - mn) / 360); n++) shifts.push(360 * n);
  for (const s of shifts) {
    const f = (lon, lat) => { const l = lon - lon0 + s; return l >= a && l <= b && lat >= c && lat <= d ? g.fwd(l, lat) : null; };
    out.push(...projectPolyline(f, line, opts));
  }
  return out;
}
// Should this lon/lat ring be projected at all on this panel? (skips land far outside a cap)
export function ringNear(g, ring, pad = 0.03) {
  if (g.type !== 'cap') return true;
  const c = capOf(ring);
  return ang(toV([g.center.lon, g.center.lat]), c.v) - c.r < g.maxC + pad;
}
// make longitudes continuous along a line (each step under 180 degrees); Natural Earth lines come back unchanged
export function unwrapLine(line) {
  let off = 0, jumped = false;
  const out = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (i) { const d = p[0] + off - out[i - 1][0]; if (d > 180) { off -= 360; jumped = true; } else if (d < -180) { off += 360; jumped = true; } }
    out.push(off ? [p[0] + off, p[1]] : p);
  }
  return jumped ? out : line;
}
// azimuthal equidistant frame around a center: fwd([lon, lat]) -> [u, w] (radians, w toward north), inv([u, w]) -> [lon, lat]
function aeFrame(center) {
  const cv = toV([center.lon, center.lat]);
  let e = [-cv[1], cv[0], 0], n = Math.hypot(e[0], e[1]);
  e = n < 1e-9 ? [0, 1, 0] : [e[0] / n, e[1] / n, 0];
  const no = [cv[1] * e[2] - cv[2] * e[1], cv[2] * e[0] - cv[0] * e[2], cv[0] * e[1] - cv[1] * e[0]];
  const fwd = (q) => {
    const v = toV(q), x = v[0] * e[0] + v[1] * e[1] + v[2] * e[2], y = v[0] * no[0] + v[1] * no[1] + v[2] * no[2], s = Math.hypot(x, y), c = ang(cv, v);
    return s < 1e-12 ? [0, c > 1 ? Math.PI : 0] : [c * x / s, c * y / s];
  };
  const inv = ([u, w]) => {
    const c = Math.hypot(u, w);
    if (c < 1e-12) return [center.lon, center.lat];
    const a = u / c, b = w / c, sc = Math.sin(c), cc = Math.cos(c);
    return fromV([cv[0] * cc + (e[0] * a + no[0] * b) * sc, cv[1] * cc + (e[1] * a + no[1] * b) * sc, cv[2] * cc + (e[2] * a + no[2] * b) * sc]);
  };
  return { fwd, inv };
}
// a ring in the AE plane, with long steps (near the antipode) split on the sphere so no chord cuts across the map
function aeDensify(ring, A, maxStep = 0.15, depthMax = 10) {
  const out = [A.fwd(ring[0])];
  const rec = (a, b, pa, pb, d) => {
    if (d >= depthMax || Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) <= maxStep) { out.push(pb); return; }
    const m = sphereMid(a, b), pm = A.fwd(m);
    rec(a, m, pa, pm, d + 1); rec(m, b, pm, pb, d + 1);
  };
  for (let i = 1; i < ring.length; i++) rec(ring[i - 1], ring[i], out[out.length - 1], A.fwd(ring[i]), 0);
  return out;
}
const windows = new Map();
const capWindow = (r) => { let w = windows.get(r); if (!w) { w = []; for (let i = 0; i < 180; i++) { const t = i / 180 * Math.PI * 2; w.push([r * Math.cos(t), r * Math.sin(t)]); } windows.set(r, w); } return w; };
// Sutherland-Hodgman: clip a closed polygon to a convex counter-clockwise window (winding inside the window is kept)
function clipConvex(poly, win) {
  let out = poly;
  for (let i = 0; i < win.length && out.length; i++) {
    const [ax, ay] = win[i], [bx, by] = win[(i + 1) % win.length], inp = out; out = [];
    const side = (p) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
  }
  return out;
}
const linMid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const sphereMid = (a, b) => { const p = toV(a), q = toV(b), m = [p[0] + q[0], p[1] + q[1], p[2] + q[2]]; return Math.hypot(...m) < 1e-9 ? a : fromV(m); };
function densify(pts, proj, mid, maxStep, depthMax = 7) {
  const out = [proj(pts[0])];
  const rec = (a, b, pa, pb, d) => {
    if (d >= depthMax || Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) <= maxStep) { out.push(pb); return; }
    const m = mid(a, b), pm = proj(m);
    rec(a, m, pa, pm, d + 1); rec(m, b, pm, pb, d + 1);
  };
  for (let i = 1; i < pts.length; i++) rec(pts[i - 1], pts[i], out[out.length - 1], proj(pts[i]), 0);
  return out;
}

// A label hook from any forward: (lon, lat) -> { x, y, extent(sqDeg) } or null. extent turns an area in square
// degrees (labels.json `a`) into its rough drawn width in px, from the projection's local area scale.
export function labelAtFromForward(fwd, h = 0.25) {
  return (lon, lat) => {
    const p = fwd(lon, lat);
    if (!p) return null;
    const det = (s) => { const a = fwd(lon + s, lat), b = fwd(lon, lat + s); return a && b ? Math.abs((a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0])) / (s * s) : Infinity; };
    let k = Math.min(det(h), det(-h));
    if (!Number.isFinite(k)) k = 0;
    const perSqDeg = k / Math.max(0.05, Math.cos(lat * D2R));
    return { x: p[0], y: p[1], extent: (a) => Math.sqrt(a * perSqDeg) };
  };
}

// ---------- graticule ----------
// Meridians and parallels as lon/lat polylines, every `step` degrees (or lonStep / latStep), points every res degrees.
// Draw them with projectLines(line, geo, { cuts: false }) and LINE.graticule.
export function graticule({ step = 30, lonStep = step, latStep = step, latMax = 90, res = 2 } = {}) {
  const lines = [];
  for (let lon = -180; lon < 180; lon += lonStep) { const l = []; for (let lat = -latMax; lat <= latMax + 1e-9; lat += res) l.push([lon, Math.min(lat, latMax)]); lines.push(l); }
  for (let lat = -90 + latStep; lat < 90; lat += latStep) { if (Math.abs(lat) > latMax) continue; const l = []; for (let lon = -180; lon <= 180 + 1e-9; lon += res) l.push([Math.min(lon, 180), lat]); lines.push(l); }
  return lines;
}

// ---------- the book's line styles (crayon options) ----------
export const WATER_LAYERS = [
  { angle: 4, spacing: 3.2, colors: WATER, alpha: 0.7, width: 2.6, step: 8 },
  { angle: -28, spacing: 6.5, colors: WATER2, alpha: 0.3, width: 2.2, step: 8 },
  { angle: 60, spacing: 11, colors: WATER, alpha: 0.18, width: 2, step: 8, density: 0.8 },
];
export const LINE = {
  lake: { color: INK, width: 1.1, alpha: 0.7, passes: 2, wobble: 0.4, crumple: 0.5, breakProb: 0.04, step: 3 },
  admin: { color: INK, width: 0.9, alpha: 0.35, passes: 1, wobble: 0.5, crumple: 0.6, breakProb: 0.15, step: 3 },
  border: { color: INK, width: 1, alpha: 0.5, passes: 2, wobble: 0.5, crumple: 0.7, breakProb: 0.12, step: 3 },
  coast: (pxArea) => ({ color: INK, width: pxArea < 200 ? 1.2 : 1.6, alpha: 0.85, passes: 2, wobble: 0.6, crumple: 0.9, breakProb: 0.04, step: 3, jitter: 0.5 }),
  outline: { color: INK, width: 2.6, alpha: 0.8, passes: 2, wobble: 0.6, crumple: 0.8, breakProb: 0.02, step: 3 },   // the region in question
  rim: { color: INK, width: 2.6, alpha: 0.9, passes: 3, wobble: 1.4, crumple: 2, breakProb: 0.04, step: 5 },
  rimOuter: { color: INK, width: 1.2, alpha: 0.45, passes: 1, wobble: 2, crumple: 3, breakProb: 0.15, step: 6 },
  graticule: { color: INK, width: 1, alpha: 0.32, passes: 1, wobble: 0.4, crumple: 0.4, breakProb: 0.08, step: 4 },
  route: (hot) => ({ colors: ORANGE, width: hot ? 2.6 : 2, alpha: hot ? 0.95 : 0.8, passes: 2, wobble: 0.5, crumple: 0.6, breakProb: 0.02, step: 3 }),
};

// ---------- canvas sizing and pointer mapping ----------
// Size both canvases to the base canvas's on-screen width (capped at 2400 px), keeping the logical aspect W x H.
export function sizeCanvases(base, overlay, W, H) {
  const px = Math.min(2400, Math.round(base.getBoundingClientRect().width * (window.devicePixelRatio || 1))) || W;
  const ph = Math.round(px * H / W);
  for (const c of [base, overlay]) if (c.width !== px || c.height !== ph) { c.width = px; c.height = ph; }
}
// client (mouse) coordinates -> logical map coordinates
export function toLogical(canvas, W, H, clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return [(clientX - r.left) / r.width * W, (clientY - r.top) / r.height * H];
}

// ---------- drawing steps (in the order a map is drawn) ----------
// 1. Paper only where the map is: disks fade out just past their rims, boxes and outlines are cut clean.
// Returns { layPaper(), paperCopy }: layPaper() lays the untouched paper back down inside the current clip.
export function paperUnderPanels(art, canvas, W, panels) {
  const { ctx } = art;
  art.paperBackground();
  const keepMask = document.createElement('canvas'); keepMask.width = canvas.width; keepMask.height = canvas.height;
  const km = keepMask.getContext('2d'); km.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
  for (const { shape: s } of panels) {
    if (s.type === 'circle') {
      const g = km.createRadialGradient(s.cx, s.cy, s.r + 6, s.cx, s.cy, s.r + 40);
      g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
      km.fillStyle = g; km.beginPath(); km.arc(s.cx, s.cy, s.r + 41, 0, Math.PI * 2); km.fill();
    } else if (s.type === 'poly') { km.fillStyle = '#000'; km.beginPath(); shapePath(km, s); km.fill('evenodd'); }
    else { km.fillStyle = '#000'; km.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0); }
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(keepMask, 0, 0); ctx.restore();
  const paperCopy = document.createElement('canvas');
  paperCopy.width = canvas.width; paperCopy.height = canvas.height;
  paperCopy.getContext('2d').drawImage(canvas, 0, 0);
  const layPaper = () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(paperCopy, 0, 0); ctx.restore(); };
  return { layPaper, paperCopy };
}
// A projected ring record onto the current path: { pts, rim } (rim: { cx, cy, r } circle or closed [[x, y], ...])
export function addRing(c, r) {
  r.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
  const m = r.rim;
  if (m && Array.isArray(m)) { m.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
  else if (m) { c.moveTo(m.cx + m.r, m.cy); c.arc(m.cx, m.cy, m.r, 0, Math.PI * 2); }
}
// 2. Water: hatch the panel blue, then lay the paper back over land (P.landRings minus P.lakeRings, even-odd).
// seams: projected polylines ([[x, y], ...]) along Natural Earth's artificial land edges; paper is laid over a thin
// strip along each so no hairline of water shows inside land.
export function waterAndLand(art, P, layPaper, seams = []) {
  const { ctx, hatchFill } = art;
  const [bx0, by0, bx1, by1] = boundsOf(P.shape);
  hatchFill(() => shapePath(ctx, P.shape), [bx0, by0, bx1 - bx0, by1 - by0], WATER_LAYERS);
  ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
  ctx.beginPath(); P.landRings.forEach((r) => addRing(ctx, r)); P.lakeRings.forEach((r) => addRing(ctx, r)); ctx.clip('evenodd');
  layPaper(); ctx.restore();
  ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip(); ctx.beginPath();
  for (const a of seams) for (let j = 0; j < a.length - 1; j++) {
    const p = a[j], q = a[j + 1], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * 2.5, ny = dx / l * 2.5;
    ctx.moveTo(p[0] + nx, p[1] + ny); ctx.lineTo(q[0] + nx, q[1] + ny); ctx.lineTo(q[0] - nx, q[1] - ny); ctx.lineTo(p[0] - nx, p[1] - ny); ctx.closePath();
  }
  ctx.clip(); layPaper(); ctx.restore();
}
// 3. A land mask at a third of the size: isLand(x, y) in logical px (lettering sits on land, ring labels in water)
export function landMask(W, H, panels) {
  const MS = 1 / 3, mask = document.createElement('canvas'); mask.width = Math.ceil(W * MS); mask.height = Math.ceil(H * MS);
  const m = mask.getContext('2d', { willReadFrequently: true }); m.setTransform(MS, 0, 0, MS, 0, 0);
  for (const P of panels) { m.save(); m.beginPath(); shapePath(m, P.shape); m.clip(); m.beginPath(); P.landRings.forEach((r) => addRing(m, r)); m.fillStyle = '#000'; m.fill('evenodd'); m.restore(); }
  const md = m.getImageData(0, 0, mask.width, mask.height).data, mw = mask.width;
  return (x, y) => { x = Math.round(x * MS); y = Math.round(y * MS); return x < 0 || y < 0 || x >= mw || y >= mask.height ? false : md[(y * mw + x) * 4 + 3] > 0; };
}
// 4. Greedy lettering: bigger names first; a name is kept only if it fits inside its area's drawn size,
// sits on land, stays inside the panel, and overlaps nothing already placed. P.labelAt(lon, lat) -> { x, y, extent }
// or null (see labelAtFromForward). list: [{ n, x, y, a, rank }] (labels.json uses r for rank).
// placed: boxes { x0, y0, x1, y1, text?, size?, alpha? } so far (push { ..., text: null } to reserve space);
// the kept names are added to it.
export function placeLabels(art, P, isLand, placed, list, [minS, maxS], alpha) {
  for (const L of list) {
    const at = P.labelAt(L.x, L.y);
    if (!at) continue;
    const { x, y } = at;
    if (!inShape(P.shape, x, y) || !isLand(x, y)) continue;
    const extent = at.extent(L.a); // rough drawn width of the area
    let size = Math.max(minS, Math.min(maxS, extent * 0.2));
    const text = L.n.toUpperCase();
    let w = art.textWidth(text, size);
    if (w > extent * 1.5) { size = Math.max(minS, size * extent * 1.5 / w); w = art.textWidth(text, size); }
    if (w > extent * 1.9 || (size < minS + 0.5 && L.rank > 3)) continue;
    const nudges = [[0, 0], [0, -1.1], [0, 1.1], [-0.3, 0], [0.3, 0], [0, -2.2], [0, 2.2]];
    for (const [nx, ny] of nudges) {
      const bx = x + nx * w, by = y + ny * size;
      if (!isLand(bx, by - size * 0.3)) continue;
      const b = { x0: bx - w / 2, x1: bx + w / 2, y0: by - size * 0.72, y1: by + size * 0.28, text, size, alpha: 0.95 * alpha };
      if (![[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([qx, qy]) => inShape(P.shape, qx, qy, 6))) continue;
      if (placed.some((o) => b.x0 < o.x1 + 8 && b.x1 > o.x0 - 8 && b.y0 < o.y1 + 5 && b.y1 > o.y0 - 5)) continue;
      placed.push(b);
      break;
    }
  }
}
// labels.json entries up to a rank, in the shape placeLabels wants
export const countryLabels = (labels, maxRank) => labels.filter((L) => L.r <= maxRank).map((L) => ({ ...L, rank: L.r }));
// 5. Lines, clipped to the panel, in one batch: lakes, state lines, borders, coasts, then the bold outline of the
// region in question. inkRuns(rawLonLatLine, crayonOpts) projects and inks one line (see lineInker).
// lakes / land: projected ring records (their pts give the drawn size); admin / borders / outlines: lon/lat lines.
export function drawLinework(art, P, { lakes = [], admin = [], borders = [], land = [], outlines = [] }, inkRuns) {
  const { ctx, batch } = art;
  ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
  batch(() => {
    for (const r of lakes) if (pxArea(r.pts) > 12) inkRuns(r.raw, LINE.lake);
    for (const l of admin) inkRuns(l, LINE.admin);
    for (const b of borders) inkRuns(b, LINE.border);
    for (const r of land) {
      const a = pxArea(r.pts); if (a < 6 && !r.rim) continue;
      inkRuns(r.raw, LINE.coast(a));
    }
    for (const r of outlines) inkRuns([...r, r[0]], LINE.outline);
  });
  ctx.restore();
}
// The inker for a geo spec: (raw, opts) => crayon every run of projectLines(raw, geo, { bounds })
export const lineInker = (art, g, bounds = null) => (raw, opts) => { for (const run of projectLines(raw, g, { bounds })) art.crayon(run, opts); };
// 6. The map's edge in crayon: a double rim for disks and outlines (rect panels are framed by art.border instead,
// unless rect: true).
export function drawRim(art, shape, { rect = false } = {}) {
  const { crayon, batch } = art;
  if (shape.type === 'circle') batch(() => {
    const s = shape, rim = [];
    for (let i = 0; i <= 360; i++) { const a = i / 360 * Math.PI * 2 - 0.02; rim.push([s.cx + Math.cos(a) * s.r, s.cy + Math.sin(a) * s.r]); }
    crayon(rim, LINE.rim);
    crayon(rim.map(([x, y]) => [s.cx + (x - s.cx) * 1.013, s.cy + (y - s.cy) * 1.013]), LINE.rimOuter);
  });
  else if (shape.type === 'poly' || rect) batch(() => {
    const rings = shape.type === 'poly' ? shape.rings : [[[shape.x0, shape.y0], [shape.x1, shape.y0], [shape.x1, shape.y1], [shape.x0, shape.y1]]];
    for (const r of rings) {
      const [x0, y0, x1, y1] = boundsOf({ type: 'poly', rings: [r] }), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, closed = [...r, r[0], r[1]];
      crayon(closed, LINE.rim);
      crayon(closed.map(([x, y]) => [cx + (x - cx) * 1.006, cy + (y - cy) * 1.006]), LINE.rimOuter);
    }
  });
}
// 7. Letter the names placeLabels kept
export function letterLabels(art, texts) {
  for (const b of texts) art.scrawl(b.text, (b.x0 + b.x1) / 2, b.y1 - b.size * 0.12, { size: b.size, color: INK, align: 'center', font: FONT, alpha: b.alpha });
}
// The hatched ink dot in a hand-drawn ring that marks a map's center (hollow: the ring only, as for an antipode)
export function centerDot(art, cx, cy, { hollow = false } = {}) {
  const { crayon, hatchFill, ctx } = art;
  if (!hollow) hatchFill(() => ctx.arc(cx, cy, 6, 0, Math.PI * 2), [cx - 7, cy - 7, 14, 14], [
    { angle: 30, spacing: 1.4, colors: [INK], alpha: 0.95, width: 1.6 }, { angle: -50, spacing: 1.8, colors: [INK], alpha: 0.8, width: 1.6 }]);
  crayon(art.wobblyEllipse(cx, cy, 6, 6, 0, 0.2, 0.04), { color: INK, width: 1.6, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
  crayon(art.wobblyEllipse(cx, cy, 15, 15, 0, 0.3, 0.05), { color: INK, width: 1.8, alpha: 0.85, passes: 2, wobble: 0.6, step: 3 });
}
// The origin star (as the book marks State College on maps not centered on it): ink-hatched, five points.
// Returns its box { x0, y0, x1, y1 }.
export function originStar(art, x, y, r = 14) {
  const { ctx, hatchFill, crayon } = art, pts = [];
  for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
  hatchFill(() => { pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); }, [x - r, y - r, 2 * r, 2 * r], [{ angle: 30, spacing: 1.6, colors: [INK], alpha: 0.9, width: 2 }]);
  crayon(pts, { color: INK, width: 2.2, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
  return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
}

// ---------- places of interest (the transparent overlay canvas) ----------
// Draws the origin and every place: an orange dot (or, for the origin with originMark 'star', the origin star),
// an optional route, and a two-line label (NAME over distance) on a paper patch, set on the first side that is clear.
// opts:
//   W, H, edge             logical size and the margin labels stay inside (EDGE)
//   origin, places         origin { lat, lon, name, short }; places [{ id, lat, lon, name, short }]
//   highlight              id of the place to ring (hover)
//   showLabels             false: dots and routes only
//   locate(p)              -> null (not on this map) or { x, y, cx?, cy? }; labels lean away from (cx, cy)
//                          (default: the middle of the map). Called for the origin too (p.isOrigin is true).
//   route(art, p, hot, at) draws the route from the origin to p (optional; at = locate(p), may be null)
//   soft                   boxes labels prefer not to cover (the map's lettering: map.placedLabels)
//   hard                   boxes labels must not cover
//   originMark             'none' (the base map marks it, e.g. azimuthal's center dot) or 'star'
//   originSub              second line under the origin's name ('CENTER'), or null for one line
//   fits(box)              optional: false when a label box would leave the drawn map (a net's gaps, say)
// Returns the hit list [{ id, x, y }] for placeAt.
// The order drawPlaceLayer tries label spots in (maps that predict its placement call this too): every candidate
// (near ones are listed first) clear of hard and soft boxes, then clear of hard boxes only, then the first one.
export function pickLabelBox(cands, inside, hitsHard, hitsSoft) {
  return cands.find((c) => inside(c) && !hitsHard(c) && !hitsSoft(c)) || cands.find((c) => inside(c) && !hitsHard(c)) || cands[0];
}
export function drawPlaceLayer(canvas, { W, H, edge = EDGE, origin, places, highlight = null, showLabels = true, locate, route = null,
  soft = [], hard = [], originMark = 'star', originSub = null, fits = null }) {
  const o = canvas, ctx0 = o.getContext('2d');
  ctx0.setTransform(1, 0, 0, 1, 0, 0); ctx0.clearRect(0, 0, o.width, o.height);
  const boxes = [...soft.map((b) => ({ ...b, soft: true })), ...hard];
  const results = [];
  const items = [{ ...origin, id: '__origin', isOrigin: true }, ...places];
  // every route first, then the dots and labels on top: a label's paper patch then covers any route it sits on,
  // so no route ever runs through the lettering of an earlier place (the origin's label is set first)
  const where = new Map(items.map((p) => [p, locate(p)]));
  if (route) for (const p of places) route(createArt(o, { width: W, height: H, seed: seedOfPlace(p) }), p, highlight === p.id, where.get(p));
  for (const p of items) {
    const art = createArt(o, { width: W, height: H, seed: seedOfPlace(p) });
    const { crayon, hatchFill, scrawl } = art, octx = art.ctx;
    const hot = highlight === p.id;
    const at = where.get(p);
    if (!at) continue; // off this map
    const { x, y } = at;
    if (!p.isOrigin) {
      hatchFill(() => octx.arc(x, y, 6.5, 0, Math.PI * 2), [x - 8, y - 8, 16, 16], [
        { angle: 30, spacing: 1.4, colors: ORANGE, alpha: 0.95, width: 1.8 }, { angle: -50, spacing: 2, colors: ORANGE, alpha: 0.7, width: 1.6 }]);
      crayon(art.wobblyEllipse(x, y, 7, 7, 0, 0.3, 0.05), { color: INK, width: 1.6, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
      results.push({ id: p.id, x, y });
    } else if (originMark === 'star') boxes.push(originStar(art, x, y));
    if (hot) crayon(art.wobblyEllipse(x, y, 14, 14, 0, 0.4, 0.06), { color: INK, width: 1.6, alpha: 0.8, passes: 2, wobble: 0.6, step: 3 });
    if (!showLabels) continue;

    // lettering: name over distance, placed on the first side that is clear
    const name = (p.short || p.name.split(',')[0]).toUpperCase();
    const dist = p.isOrigin ? originSub : Math.round(distanceMi(origin, p)).toLocaleString('en-US') + ' MI';
    const s1 = 22, s2 = 17, w = Math.max(art.textWidth(name, s1), dist ? art.textWidth(dist, s2) : 0), h = dist ? s1 + s2 + 6 : s1 + 4;
    const cx = at.cx ?? W / 2, cy = at.cy ?? H / 2;
    const dx = x - cx, dy = y - cy, dl = Math.hypot(dx, dy), side = dl > 1 && dx < 0 ? -1 : 1, cands = [];
    for (const g of p.isOrigin ? [22, 50, 90] : [14, 44, 80]) for (const [sx, sy] of [[side, 0], [-side, 0], [0, -1], [0, 1], [side, -1], [side, 1], [-side, -1], [-side, 1]]) {
      const bx = sx > 0 ? x + g : sx < 0 ? x - g - w : x - w / 2, by = sy < 0 ? y - g - h : sy > 0 ? y + g : y - h / 2 - 2;
      cands.push({ x0: bx, y0: by, x1: bx + w, y1: by + h, far: g > 30, align: sx > 0 ? 'left' : sx < 0 ? 'right' : 'center', ax: sx > 0 ? bx : sx < 0 ? bx + w : bx + w / 2 });
    }
    const hitsHard = (c) => boxes.some((b) => !b.soft && c.x0 < b.x1 + 4 && c.x1 > b.x0 - 4 && c.y0 < b.y1 + 2 && c.y1 > b.y0 - 2);
    const hitsSoft = (c) => boxes.some((b) => b.soft && c.x0 < b.x1 && c.x1 > b.x0 && c.y0 < b.y1 && c.y1 > b.y0);
    const inside = (c) => c.x0 > edge + 4 && c.x1 < W - edge - 4 && c.y0 > edge + 4 && c.y1 < H - edge - 4 && (!fits || fits(c));
    // near spots first, then far ones (with a leader line), all clear of lettering; only then may a label sit on
    // the map's own lettering (soft), and last of all anywhere
    const box = pickLabelBox(cands, inside, hitsHard, hitsSoft);
    if (box.far) {
      // leader line in the book's ink, from just outside the dot to the nearest point of the label's patch
      const lx = Math.max(box.x0 - 3, Math.min(box.x1 + 3, x)), ly = Math.max(box.y0 - 1, Math.min(box.y1 + 4, y));
      const d = Math.hypot(lx - x, ly - y), r0 = p.isOrigin ? (originMark === 'star' ? 16 : 11) : 10;
      if (d > r0 + 4) crayon([[x + (lx - x) * r0 / d, y + (ly - y) * r0 / d], [lx, ly]], { color: INK, width: 1.8, alpha: 0.9, passes: 2, wobble: 0.3, step: 3, breakProb: 0 });
    }
    boxes.push(box);
    // paper-coloured patch so lettering reads over hatching and rings
    octx.save(); octx.globalAlpha = 0.72; octx.fillStyle = PAPER;
    roundRect(octx, box.x0 - 5, box.y0 - 2, box.x1 - box.x0 + 10, box.y1 - box.y0 + 6, 6); octx.fill(); octx.restore();
    scrawl(name, box.ax, box.y0 + s1 - 1, { size: s1, color: INK, font: FONT, align: box.align });
    if (dist) scrawl(dist, box.ax, box.y0 + s1 + s2 + 3, { size: s2, color: INK, font: FONT, align: box.align, alpha: 0.8 });
  }
  return results;
}

// Crayon a route, broken where it would run through the base map's lettering (boxes with text), as the Mercator
// map breaks its routes around its own words, so a route never crosses out a country's name.
export function crayonAround(art, pts, opts, boxes, pad = 3) {
  const words = boxes.filter((b) => b.text);
  if (!words.length) { art.crayon(pts, opts); return; }
  let run = [];
  const flush = () => { if (run.length > 1) art.crayon(run, opts); run = []; };
  for (const p of art.resample(pts, 4)) { if (words.some((b) => p[0] > b.x0 - pad && p[0] < b.x1 + pad && p[1] > b.y0 - pad && p[1] < b.y1 + pad)) flush(); else run.push(p); }
  flush();
}

// ---------- BaseMap: the plumbing every map type needs ----------
// Extend it, implement prepare(origin, scale) (set this.view, return the heading info) and drawBase(origin)
// (usually just renderBase(this, {...})). Override locate / routeOf / drawRoute / hardBoxes to change place drawing.
// this.view = { W, H, panels: [{ shape, geo, inverse(x, y) -> [lon, lat] | null, fwd?, labelAt? }], ... }
export class BaseMap {
  constructor(base, overlay, data) {
    this.base = base; this.overlay = overlay; this.data = data;
    this.origin = null; this.view = null; this.showLabels = true;
    this.originMark = 'star'; this.originSub = null;
  }
  get aspect() { return this.view ? this.view.W / this.view.H : 1; }
  sizeCanvases() { sizeCanvases(this.base, this.overlay, this.view.W, this.view.H); }
  toLogical(clientX, clientY) { return toLogical(this.base, this.view.W, this.view.H, clientX, clientY); }
  panelAt(lx, ly) { return this.view?.panels.find((P) => inShape(P.shape, lx, ly)) ?? null; }
  lonLatAt(clientX, clientY) {
    if (!this.view) return null;
    const [lx, ly] = this.toLogical(clientX, clientY), P = this.panelAt(lx, ly);
    return P && P.inverse ? P.inverse(lx, ly) : null;
  }
  placeAt(clientX, clientY) {
    if (!this.view) return null;
    const [lx, ly] = this.toLogical(clientX, clientY);
    return (this.placeHits || []).find((h) => Math.hypot(h.x - lx, h.y - ly) < 14)?.id ?? null;
  }
  // where a place lands: the first panel that shows it
  locate(p) {
    for (const P of this.view.panels) {
      const f = P.fwd || (P.fwd = geoForward(P.geo)), q = f(p.lon, p.lat);
      if (q && inShape(P.shape, q[0], q[1])) return { x: q[0], y: q[1] };
    }
    return null;
  }
  // the route drawn from the origin to a place: the shortest route (great circle) by default; null for none
  routeOf(origin, p) { return greatCircle(origin, p, 160); }
  drawRoute(art, p, hot) {
    const line = this.routeOf(this.origin, p);
    if (!line) return;
    for (const P of this.view.panels) {
      art.ctx.save(); art.ctx.beginPath(); shapePath(art.ctx, P.shape); art.ctx.clip();
      for (const run of projectLines(line, P.geo, { cuts: false, maxStep: 12 })) crayonAround(art, run, LINE.route(hot), this.showLabels ? this.placedLabels || [] : []);
      art.ctx.restore();
    }
  }
  hardBoxes() { return []; }
  drawPlaces(places, { highlight = null } = {}) {
    const o = this.overlay;
    if (!this.view) { const c = o.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, o.width, o.height); return; }
    const V = this.view;
    this.placeHits = drawPlaceLayer(o, {
      W: V.W, H: V.H, edge: V.edge ?? EDGE, origin: this.origin, places, highlight, showLabels: this.showLabels,
      locate: (p) => this.locate(p), route: (art, p, hot) => this.drawRoute(art, p, hot),
      soft: this.placedLabels || [], hard: this.hardBoxes(), originMark: this.originMark, originSub: this.originSub,
      fits: this.labelFits ? (b) => this.labelFits(b) : null,
    });
  }
}

// ---------- renderBase: the whole standard base map for panels with geo specs ----------
// map: a BaseMap (uses map.base, map.data, map.showLabels; sets map.placedLabels and each panel's
// fwd / labelAt / landRings / lakeRings). opts:
//   seed                 crayon seed (seedOf(some string)); W, H default to map.view's
//   labelRank = 5        country labels up to this labels.json rank;  sizes = [11, 30] their px range
//   lakeRank = 3         lakes up to this Natural Earth scalerank
//   maxStep = 24         px between projected points along long steps
//   reserve              boxes kept free of lettering ({ x0, y0, x1, y1 })
//   admin, outlines      extra lon/lat lines: state lines, and bold outlines of a region in question
//   rimRect              also draw a crayon rim around rect panels
//   border = true        the book's neatline border around [0, 0, W, H]
//   hooks                { afterWater(env), beforeLines(env), afterLines(env), afterText(env) }: your overlays.
//                        env = { art, ctx, map, panels, W, H, isLand, placed, texts, hitsLabel(x, y, pad), layPaper, paperCopy, show }
// Returns env.
export function renderBase(map, { seed, W = map.view.W, H = map.view.H, labelRank = 5, lakeRank = 3, sizes = [11, 30], maxStep = 24,
  reserve = [], admin = [], outlines = [], rimRect = false, border = true, hooks = {} } = {}) {
  const panels = map.view.panels, data = map.data, show = map.showLabels;
  map.sizeCanvases();
  const art = createArt(map.base, { width: W, height: H, seed: seed ?? seedOf(JSON.stringify([map.origin?.lat, map.origin?.lon])) });
  const { ctx } = art;
  const lakeList = data.lakes.filter((l) => l.r <= lakeRank).map((l) => l.p);
  for (const P of panels) {
    P.fwd ??= geoForward(P.geo);
    P.labelAt ??= labelAtFromForward(P.fwd);
    P.landRings = []; P.seams = [];
    for (const poly of data.land) for (const ring of poly) if (ringNear(P.geo, ring)) {
      P.landRings.push(...projectFill(ring, P.geo, { maxStep }));
      for (let i = 0; i < ring.length - 1; i++) if (isCut(ring[i], ring[i + 1])) P.seams.push(...projectLines([ring[i], ring[i + 1]], P.geo, { cuts: false, maxStep: 20 }));
    }
    P.lakeRings = lakeList.filter((r) => ringNear(P.geo, r)).flatMap((r) => projectFill(r, P.geo, { maxStep }));
  }
  const { layPaper, paperCopy } = paperUnderPanels(art, map.base, W, panels);
  const env = { art, ctx, map, panels, W, H, layPaper, paperCopy, show };
  for (const P of panels) waterAndLand(art, P, layPaper, P.seams);
  hooks.afterWater?.(env);
  env.isLand = landMask(W, H, panels);
  const placed = [...reserve.map((b) => ({ ...b, text: null }))];
  if (show) for (const P of panels) placeLabels(art, P, env.isLand, placed, countryLabels(data.labels, labelRank), sizes, 1);
  env.placed = placed; env.texts = placed.filter((b) => b.text);
  env.hitsLabel = (x, y, pad = 0) => env.texts.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad);
  hooks.beforeLines?.(env);
  for (const P of panels) {
    const b = boundsOf(P.shape), keep = (l) => ringNear(P.geo, l);
    drawLinework(art, P, { lakes: P.lakeRings, admin: admin.filter(keep), borders: data.borders.filter(keep), land: P.landRings, outlines: outlines.filter(keep) }, lineInker(art, P.geo, b));
    drawRim(art, P.shape, { rect: rimRect });
  }
  hooks.afterLines?.(env);
  if (show) letterLabels(art, env.texts);
  hooks.afterText?.(env);
  if (border) art.border({ box: [0, 0, W, H] });
  art.grain({ vignette: 0 });
  map.placedLabels = env.texts;
  return env;
}

// ---------- the four-truths badges (book-common.js badge(), same fills and icons) ----------
// States: 'true' (green: true everywhere), 'half' (green left, red right: true only in places), 'lost' (red).
// The book's own names ('yes', 'part', 'no') work too.
export const BADGE_KEYS = ['direction', 'distance', 'size', 'shape'];
export const BADGE_LEGEND = 'Green: true everywhere. Half green: true only in places. Red: lost.';
const GREEN = [{ angle: 35, spacing: 3.2, colors: ['#a3d192', '#8fc47e', '#b6dca8'], alpha: 0.8, width: 2.4, step: 5 }, { angle: -30, spacing: 7, colors: ['#7db26c', '#a6d198'], alpha: 0.35, width: 2, step: 5 }];
const RED = [{ angle: 35, spacing: 3.2, colors: ['#f2b6ab', '#eca597', '#f6c6bd'], alpha: 0.75, width: 2.4, step: 5 }, { angle: -30, spacing: 7, colors: ['#e29485', '#efb2a6'], alpha: 0.3, width: 2, step: 5 }];
const STATE = { true: 'yes', yes: 'yes', half: 'part', part: 'part', lost: 'no', no: 'no' };
// Pennsylvania, simplified from Natural Earth (the SHAPE icon is the state outline, as in the book)
const PA = [[-80.52, 42.32], [-80.25, 42.37], [-79.76, 42.54], [-79.76, 42], [-75.35, 42], [-75.27, 41.95], [-75.24, 41.89], [-75.1, 41.83], [-75.09, 41.8], [-75.05, 41.77], [-75.05, 41.61], [-74.98, 41.51], [-74.94, 41.47], [-74.76, 41.42], [-74.7, 41.36], [-74.81, 41.3], [-74.91, 41.16], [-75.12, 41], [-75.08, 40.86], [-75.11, 40.8], [-75.17, 40.78], [-75.19, 40.69], [-75.19, 40.6], [-75.1, 40.54], [-75.03, 40.42], [-74.98, 40.41], [-74.73, 40.15], [-75.02, 40.02], [-75.17, 39.89], [-75.32, 39.86], [-75.42, 39.82], [-75.51, 39.84], [-75.63, 39.84], [-75.71, 39.8], [-75.78, 39.72], [-80.52, 39.72], [-80.52, 42.32]];
function badgeIcons(art) {
  const { ctx, crayon, hatchFill } = art;
  const ic = (k) => ({ color: INK, width: Math.max(1.8, 3 * k * 1.3), alpha: 0.92, passes: 2, wobble: 0.4, crumple: 0.4, step: 3 });
  return {
    direction: (x, y, r) => { const k = r / 130 * 1.05, O = ic(k);
      crayon([[x, y - 70 * k], [x + 18 * k, y], [x, y + 70 * k], [x - 18 * k, y], [x, y - 70 * k]], O);
      hatchFill(() => { ctx.moveTo(x, y - 70 * k); ctx.lineTo(x + 18 * k, y); ctx.lineTo(x - 18 * k, y); ctx.closePath(); }, [x - 20 * k, y - 72 * k, 40 * k, 74 * k], [{ angle: 30, spacing: 1.6, colors: [INK], alpha: 0.9, width: 1.6 }]);
      for (let a = 0; a < 4; a++) { const t = a * Math.PI / 2; crayon([[x + Math.cos(t) * 82 * k, y + Math.sin(t) * 82 * k], [x + Math.cos(t) * 96 * k, y + Math.sin(t) * 96 * k]], O); } },
    distance: (x, y, r) => { const k = r / 130 * 1.25, O = ic(k), a = -0.35, L = 200 * k, T = 44 * k, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux, p = (u, v) => [x + ux * u + vx * v, y + uy * u + vy * v];
      crayon([p(-L / 2, -T / 2), p(L / 2, -T / 2), p(L / 2, T / 2), p(-L / 2, T / 2), p(-L / 2, -T / 2)], O);
      for (let i = 1; i < 10; i++) { const u = -L / 2 + i * L / 10; crayon([p(u, -T / 2), p(u, -T / 2 + (i % 5 ? 12 : 22) * k)], { ...O, width: O.width * 0.7 }); } },
    size: (x, y, r) => { const k = r / 130 * 1.15, O = ic(k), s = 120 * k;
      crayon([[x - s / 2, y - s / 2], [x + s / 2, y - s / 2], [x + s / 2, y + s / 2], [x - s / 2, y + s / 2], [x - s / 2, y - s / 2]], O);
      for (let i = 1; i < 4; i++) { crayon([[x - s / 2 + i * s / 4, y - s / 2], [x - s / 2 + i * s / 4, y + s / 2]], { ...O, width: O.width * 0.55, alpha: 0.6 }); crayon([[x - s / 2, y - s / 2 + i * s / 4], [x + s / 2, y - s / 2 + i * s / 4]], { ...O, width: O.width * 0.55, alpha: 0.6 }); } },
    shape: (x, y, r) => { const k = r / 130 * 1.1, O = ic(k);
      const lx = PA.map(([lon, lat]) => [(lon + 77.6) * Math.cos(40.9 * D2R), lat - 40.9]), s = 170 * k / (Math.max(...lx.map((q) => q[0])) - Math.min(...lx.map((q) => q[0])));
      crayon([...lx, lx[0]].map(([u, v]) => [x + u * s, y - v * s]), { ...O, width: O.width * 1.1 }); },
  };
}
// One badge: hatched fill for its state, a double crayon ring, the icon. Draw on any art (map or UI).
export function drawBadge(art, key, state, cx, cy, r) {
  const { ctx, hatchFill, crayon } = art, full = [cx - r, cy - r, 2 * r, 2 * r], s = STATE[state] || 'no';
  if (s === 'yes') hatchFill(() => ctx.arc(cx, cy, r, 0, Math.PI * 2), full, GREEN);
  else if (s === 'part') {
    hatchFill(() => ctx.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5), [cx - r, cy - r, r, 2 * r], GREEN);
    hatchFill(() => ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2), [cx, cy - r, r, 2 * r], RED);
  } else hatchFill(() => ctx.arc(cx, cy, r, 0, Math.PI * 2), full, RED);
  crayon(art.wobblyEllipse(cx, cy, r, r, 0, 0.8, 0.02), { color: INK, width: 3, alpha: 0.9, passes: 3, wobble: 1, step: 4 });
  crayon(art.wobblyEllipse(cx, cy, r - 7, r - 7, 0, 0.8, 0.02), { color: INK, width: 1.3, alpha: 0.5, passes: 1, wobble: 1, step: 4 });
  badgeIcons(art)[key](cx, cy, r);
}
// Paint one badge onto its own small canvas (the page's badge row). size: CSS px; the badge is drawn at the
// book's plate size (r = 48 in a 120 x 120 box) and scaled, so it looks the same as on the printed plates.
export function paintBadge(canvas, key, state, { size = 64, seed = 1 } = {}) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(size * dpr); canvas.height = Math.round(size * dpr);
  const art = createArt(canvas, { width: 120, height: 120, seed, clear: true });
  drawBadge(art, key, state, 60, 60, 48);
  return canvas;
}

export { D2R, EARTH_MI, HALF_EARTH_MI, distanceMi, ringContains, greatCircle };
