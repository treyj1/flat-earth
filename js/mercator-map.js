// Flat Earth website: the Mercator map (the book's DIRECTION MAPS), drawn in crayon from any origin, at three scales.
// Follows merc-core.js (book sheets M1, M2, M3, M5): paper, blue-hatched water, paper land, a faint graticule with
// ticks and degree labels around the border, the bold equator, and compass bearings from the origin every 15 degrees.
// On Mercator a line that keeps one compass heading (a rhumb line) is straight, so every bearing is a straight ray:
// north, east, south and west in darker crayon dashes with big N E S W letters, the rest in lighter clean dashes with
// their heading in degrees. Like the book, each ray runs at most 180 degrees of longitude, and copies one world-width
// to each side are traced too, so a ray that leaves one side of the page comes back in on the other.
//
// Places of interest get two routes from the origin: a solid straight line (the rhumb line: one compass heading all
// the way, lettered with that heading) and a thin dashed curve (the great circle: the shortest route). A child sees
// straight-but-longer next to curved-but-shorter.
//
// Scales (one rect panel each, always centered on the origin's longitude):
//   world   the whole world, 80 S to 84 N, wrapping in longitude
//   region  about 6,000 miles across (measured along the origin's latitude), centered on the origin
//   close   about 1,000 miles across, centered on the origin, with state and province lines
import { createArt, INK, FONT, ORANGE } from './crayon.js';
import {
  BaseMap, MAP_W, EDGE, PAPER, seedOf, seedOfPlace, fmt, displayName, wrapLon, renderBase, placeLabels,
  drawPlaceLayer, projectLines, roundRect, centerDot, addRing, LINE, WATER_LAYERS, D2R, EARTH_MI, distanceMi, ringContains, greatCircle,
} from './map-common.js';

export const SCALES = [
  { id: 'world', label: 'World' },
  { id: 'region', label: 'Region (6,000 miles)' },
  { id: 'close', label: 'Close up (1,000 miles)' },
];
const W = MAP_W;
const SPAN_MI = { region: 6000, close: 1000 };
const LAT_N = 84, LAT_S = -80;          // the world sheet's top and bottom (the book's M1 runs 84.7 N to about 80 S)
const H_BOX = 1350;                     // region and close-up height (4 : 3)

// ---------- Mercator ----------
const POLE = 89.5;                      // an origin this close to a pole is treated as the pole itself
const clampLat = (lat) => Math.max(-89.5, Math.min(89.5, lat));
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + clampLat(lat) * D2R / 2));
const unmerc = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Rhumb line from a to b, taking the shorter way around in longitude: heading (degrees clockwise from north) and miles
export function rhumb(a, b) {
  // from a pole every way is south (or north): the route runs down a meridian, one heading all the way
  if (Math.abs(a.lat) >= POLE) return { deg: a.lat > 0 ? 180 : 0, mi: Math.abs(b.lat - a.lat) * D2R * EARTH_MI };
  // to a pole: straight up or down a meridian (any other heading only spirals in), so due north or due south
  if (Math.abs(b.lat) >= POLE) return { deg: b.lat > 0 ? 0 : 180, mi: Math.abs(b.lat - a.lat) * D2R * EARTH_MI };
  const dl = wrapLon(b.lon - a.lon) * D2R, df = (b.lat - a.lat) * D2R, dpsi = merc(b.lat) - merc(a.lat);
  const deg = (Math.atan2(dl, dpsi) / D2R + 360) % 360;
  const q = Math.abs(dpsi) > 1e-12 ? df / dpsi : Math.cos(a.lat * D2R);
  return { deg, mi: Math.hypot(df, q * dl) * EARTH_MI };
}
// The shortest route from a to b as lon/lat points. greatCircle() divides by sin(angle), which is zero at the
// antipode (every great circle through it is equally short), so there it takes the one that leaves on heading deg.
export function shortestRoute(a, b, n, deg) {
  const v = (p) => [Math.cos(p.lat * D2R) * Math.cos(p.lon * D2R), Math.cos(p.lat * D2R) * Math.sin(p.lon * D2R), Math.sin(p.lat * D2R)];
  const A = v(a), B = v(b), dot = A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
  if (dot > -1 + 1e-12) return greatCircle(a, b, n);
  const f = a.lat * D2R, l = a.lon * D2R, h = deg * D2R;
  const north = [-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f)], east = [-Math.sin(l), Math.cos(l), 0];
  const D = [0, 1, 2].map((i) => Math.cos(h) * north[i] + Math.sin(h) * east[i]), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.PI * i / n, q = [0, 1, 2].map((k) => A[k] * Math.cos(t) + D[k] * Math.sin(t));
    pts.push([Math.atan2(q[1], q[0]) / D2R, Math.asin(Math.max(-1, Math.min(1, q[2]))) / D2R]);
  }
  return pts;
}
export const headingText =(deg) => { const d = Math.round(deg) % 360; return `${COMPASS[Math.round(d / 45) % 8]} ${d} DEGREES`; };

// ---------- lettering helpers ----------
let mctx = null;
// width of text in the map's lettering (spacing: extra px between letters, as the book letter-spaces big names)
const measure = (text, size, spacing = 0) => {
  mctx ??= document.createElement('canvas').getContext('2d');
  mctx.font = `${size}px ${FONT}`;
  if (!spacing) return mctx.measureText(text).width;
  let w = 0; for (const ch of text) w += mctx.measureText(ch).width;
  return w + spacing * (text.length - 1);
};
// a label record: its box (x0..y1, padded) plus how to letter it (baseline at y; align as scrawl)
const labelBox = (text, x, y, size, { align = 'center', spacing = 0, pad = 4, alpha = 0.9 } = {}) => {
  const w = measure(text, size, spacing), l = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  return { x0: l - pad, x1: l + w + pad, y0: y - size * 0.74 - pad, y1: y + size * 0.1 + pad, text, x, y, size, align, spacing, alpha };
};
const hits = (b, boxes, pad = 0) => boxes.some((o) => b.x0 < o.x1 + pad && b.x1 > o.x0 - pad && b.y0 < o.y1 + pad && b.y1 > o.y0 - pad);
const inRect = (b, R, m = 0) => b.x0 > R.x0 + m && b.x1 < R.x1 - m && b.y0 > R.y0 + m && b.y1 < R.y1 - m;
function lettered(art, L) {
  if (!L.spacing) { art.scrawl(L.text, L.x, L.y, { size: L.size, color: INK, font: FONT, align: L.align, alpha: L.alpha }); return; }
  const w = measure(L.text, L.size, L.spacing);
  let u = L.align === 'left' ? 0 : L.align === 'right' ? -w : -w / 2;
  for (const ch of L.text) {
    if (ch !== ' ') art.scrawl(ch, L.x + u, L.y, { size: L.size, color: INK, font: FONT, alpha: L.alpha });
    u += measure(ch, L.size) + L.spacing;
  }
}
// Liang-Barsky: the part of p + d * t (t in [lo, hi]) inside rect R, or null
function clipRay(p, d, R, lo = -Infinity, hi = Infinity) {
  let t0 = lo, t1 = hi;
  for (const [q, dd, a, b] of [[p[0], d[0], R.x0, R.x1], [p[1], d[1], R.y0, R.y1]]) {
    if (Math.abs(dd) < 1e-12) { if (q < a || q > b) return null; continue; }
    let u = (a - q) / dd, v = (b - q) / dd; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
  }
  return t0 < t1 ? [t0, t1] : null;
}
// break a polyline wherever it enters a lettering box
function brokenAround(art, pts, opts, boxes, pad = 2) {
  let run = [];
  const flush = () => { if (run.length > 1) art.crayon(run, opts); run = []; };
  for (const p of art.resample(pts, 4)) { if (boxes.some((b) => p[0] > b.x0 - pad && p[0] < b.x1 + pad && p[1] > b.y0 - pad && p[1] < b.y1 + pad)) flush(); else run.push(p); }
  flush();
}
// clip the context to the panel minus the lettering boxes, so straight strokes break around words
function clipOffLettering(ctx, R, boxes) {
  ctx.beginPath(); ctx.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0);
  for (const b of boxes) ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  ctx.clip('evenodd');
}
// separating-axis test for two convex quads [[x, y] x 4]
function overlaps(A, B) {
  for (const poly of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4], nx = y2 - y1, ny = x1 - x2;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of A) { const d = x * nx + y * ny; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, y] of B) { const d = x * nx + y * ny; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
const quadOf = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
// the oceans, each with a few spots to try (lon, lat), lettered in open water where one fits
const OCEANS = [
  ['PACIFIC OCEAN', [[-140, 10], [-150, -20], [170, 22], [-125, 25], [-130, 40], [-120, -12], [160, -30], [-160, 35], [-90, -20]]],
  ['ATLANTIC OCEAN', [[-38, 25], [-20, -15], [-50, 35], [-60, 30], [-45, 40], [-30, 5], [-15, -30], [-65, 25]]],
  ['INDIAN OCEAN', [[75, -15], [80, -25], [65, -5], [90, -10], [60, -30]]],
  ['ARCTIC OCEAN', [[-20, 80.6], [0, 82], [-160, 78], [150, 79], [-140, 75]]],
  ['SOUTHERN OCEAN', [[30, -58], [-30, -60], [120, -58], [-120, -62], [80, -60]]],
];

export class MercatorMap extends BaseMap {
  constructor(base, overlay, data) {
    super(base, overlay, data);
    this.extra = null;
    this.originMark = 'none'; // the base map marks the origin with the book's ringed dot (as M1 marks State College)
    this.originSub = null;
  }

  async prepare(origin, scale = 'world') {
    if (!SCALES.some((s) => s.id === scale)) scale = 'world';
    this.origin = origin;
    if (scale !== 'world' && !this.extra) {
      const [countries, admin1, admin1Lines] = await Promise.all(['countries', 'admin1', 'admin1-lines'].map((n) => this.data.load(n)));
      this.extra = { countries, admin1, admin1Lines };
    }
    this.view = this.buildView(origin, scale);
    const V = this.view, name = displayName(origin), short = origin.short || name.split(',')[0];
    const title = this.titleFor(origin, scale);
    let note = '';
    const up = origin.lat > 0, pole = up ? 'North Pole' : 'South Pole';
    if (V.atPole) note = `The ${pole} cannot fit on a Mercator map: it would sit endlessly far off the ${up ? 'top' : 'bottom'} edge. From the ${pole}, every direction is ${up ? 'south' : 'north'}, so each place is straight ${up ? 'down' : 'up'} its own line of longitude.`;
    else if (!V.originOn) note = `${short} is too close to the ${pole} for a Mercator map, so it sits off the ${up ? 'top' : 'bottom'} edge. Its compass lines still come in from there.`;
    const prose = scale === 'world'
      ? ['Centered on ', { strong: name }, '. Every straight line on this map keeps one compass heading, so a ship could steer by it. ' +
        'But a straight line here is not the shortest route, and lands near the poles look far too big.']
      : ['Centered on ', { strong: name }, (V.wraps
        ? `. At ${Math.abs(origin.lat) > 85 ? `latitude 85 degrees ${up ? 'north' : 'south'}` : `${short}’s latitude`}, the whole way around the world is only about ${fmt(2 * Math.PI * EARTH_MI * Math.cos(Math.min(85, Math.abs(origin.lat)) * D2R))} miles, so this map shows all of it. `
        : `. About ${fmt(SPAN_MI[scale])} miles across, measured along ${Math.abs(origin.lat) > 85 ? `latitude 85 degrees ${up ? 'north' : 'south'}` : `${short}’s latitude`}. `) +
        (scale === 'close' && !V.wraps ? 'This close, shapes look true, and every straight line still keeps one compass heading.'
          : 'Every straight line keeps one compass heading. Lands toward the poles still swell.')];
    return {
      scale, title, subtitle: 'BEARINGS FROM ' + name.toUpperCase(), prose, note,
      legend: `${V.atPole ? '' : `Dashed lines: compass headings from ${short}, every 15 degrees. `}Faint lines every ${V.grat.step === V.grat.latStep ? V.grat.step + ' degrees' : `${V.grat.step} degrees of longitude and ${V.grat.latStep} of latitude`}. ` +
        'Solid orange line: one heading all the way to a place. Dashed orange curve: the shortest route.',
    };
  }

  titleFor(origin, scale) {
    if (scale === 'world') return 'THE WORLD';
    const ll = [origin.lon, origin.lat], around = 'AROUND ' + (origin.short || origin.name.split(',')[0]).toUpperCase();
    const inside = (item) => item.p.some((r) => ringContains(r.r, ll));
    const country = this.extra.countries.find(inside);
    if (scale === 'region') {
      if (!country || country.c === 'Seven seas (open ocean)') return around;
      return (country.n === 'Russia' ? (origin.lon > 60 || origin.lon < -150 ? 'Asia' : 'Europe') : country.c).toUpperCase();
    }
    const st = country && this.extra.admin1.find((s) => s.adm === country.n && inside(s));
    return (st?.n || country?.n || around).toUpperCase();
  }

  // ---------------- the view: one rect panel, its Mercator mapping, graticule and bearing rays ----------------
  buildView(origin, scale) {
    const R = { x0: EDGE, y0: EDGE, x1: W - EDGE };
    let a, b, S, H, YT;
    if (scale === 'world') {
      a = -180; b = 180; S = (R.x1 - R.x0) / (2 * Math.PI); YT = merc(LAT_N);
      H = Math.round(2 * EDGE + (merc(LAT_N) - merc(LAT_S)) * S);
    } else {
      const span = Math.min(2 * Math.PI, SPAN_MI[scale] / (EARTH_MI * Math.cos(Math.max(-85, Math.min(85, origin.lat)) * D2R)));
      a = -span / 2 / D2R; b = span / 2 / D2R; S = (R.x1 - R.x0) / span; H = H_BOX;
      const ys = (H - 2 * EDGE) / S;
      YT = merc(Math.max(LAT_S, Math.min(LAT_N, origin.lat))) + ys / 2;
      YT = Math.max(merc(LAT_S) + ys, Math.min(merc(LAT_N), YT));
    }
    R.y1 = H - EDGE;
    const latTop = unmerc(YT), latBot = unmerc(YT - (R.y1 - R.y0) / S);
    const X = (dl) => R.x0 + (dl - a) * D2R * S, Y = (lat) => R.y0 + (YT - merc(lat)) * S;
    const lon0 = origin.lon;
    const geo = { type: 'lonlat', lon0, lon: [a, b], lat: [latBot, latTop], fwd: (dl, lat) => [X(dl), Y(lat)] };
    const shape = { type: 'rect', ...R };
    const inverse = (x, y) => (x < R.x0 || x > R.x1 || y < R.y0 || y > R.y1 ? null
      : [wrapLon(lon0 + a + (x - R.x0) / S / D2R), unmerc(YT - (y - R.y0) / S)]);
    const O = [X(0), Y(origin.lat)];
    const originOn = O[1] > R.y0 + 2 && O[1] < R.y1 - 2;
    const V = {
      scale, W, H, R, S, a, b, YT, X, Y, lon0, latTop, latBot, O, originOn, atPole: Math.abs(origin.lat) >= POLE,
      panels: [{ shape, geo, inverse }],
      wraps: b - a >= 359.999,
      labelRank: scale === 'world' ? 5 : scale === 'region' ? 7 : 10,
      lakeRank: scale === 'world' ? 3 : scale === 'region' ? 5 : 99,
      sizes: scale === 'world' ? [11, 30] : scale === 'region' ? [12, 34] : [13, 38],
      stateSizes: scale === 'region' ? [10, 18] : [12, 26],
    };
    V.originBox = originOn ? { x0: O[0] - 18, y0: O[1] - 18, x1: O[0] + 18, y1: O[1] + 18 } : null;
    V.grat = this.graticuleFor(V);
    V.segs = V.atPole ? [] : this.bearingRays(V); // from a pole there are no compass bearings to draw
    return V;
  }

  // graticule lines and ticks every step / tick degrees, and degree labels on the border (book: merc-core.js step 3)
  graticuleFor(V) {
    const { R, X, Y, lon0, a, b, latTop, latBot } = V;
    const steps = [1, 2, 5, 10, 15, 30], TICK = { 30: 10, 15: 5, 10: 5, 5: 1, 2: 1, 1: 1 };
    const step = steps.find((s) => (b - a) / s <= 12) ?? 30, tick = TICK[step];
    const latStep = steps.find((s) => (latTop - latBot) / s <= 10) ?? 30, latTick = TICK[latStep];
    const GS = 15, lines = [], labels = [];
    const latTxt = (lat) => (lat === 0 ? '0°' : Math.abs(lat) + '° ' + (lat > 0 ? 'N' : 'S'));
    const lonTxt = (lon) => { const n = Math.round(wrapLon(lon)); return n === 0 ? '0°' : Math.abs(n) === 180 ? '180°' : Math.abs(n) + '° ' + (n < 0 ? 'W' : 'E'); };
    const addL = (L) => { if (inRect(L, R, 1) && !hits(L, labels, 6)) labels.push(L); };
    for (let lat = Math.ceil(latBot / latTick) * latTick; lat <= latTop; lat += latTick) {
      const y = Y(lat); if (y <= R.y0 + 3 || y >= R.y1 - 3) continue;
      const major = lat % latStep === 0; lines.push({ kind: 'lat', v: y, major });
      if (major && y > R.y0 + 34 && y < R.y1 - 34) { addL(labelBox(latTxt(lat), R.x0 + 16, y + GS * 0.37, GS, { align: 'left', alpha: 0.8 })); addL(labelBox(latTxt(lat), R.x1 - 16, y + GS * 0.37, GS, { align: 'right', alpha: 0.8 })); }
    }
    for (let lon = Math.ceil((lon0 + a) / tick) * tick; lon <= lon0 + b; lon += tick) {
      const x = X(lon - lon0); if (x <= R.x0 + 3 || x >= R.x1 - 3) continue;
      const major = ((lon % step) + step) % step === 0; lines.push({ kind: 'lon', v: x, major });
      if (major && x > R.x0 + 44 && x < R.x1 - 44) { addL(labelBox(lonTxt(lon), x, R.y0 + 17 + GS * 0.74, GS, { alpha: 0.8 })); addL(labelBox(lonTxt(lon), x, R.y1 - 15, GS, { alpha: 0.8 })); }
    }
    return { step, latStep, lines, labels };
  }

  // compass bearings from the origin every 15 degrees: straight rays, each at most 180 degrees of longitude, traced
  // from the origin and (on the world map) from its copies one world-width to each side, clipped to the map
  bearingRays(V) {
    const { R, S, O } = V, segs = [];
    const oy = Math.max(-1e5, Math.min(1e5, O[1]));
    const copies = V.wraps ? [-2 * Math.PI * S, 0, 2 * Math.PI * S] : [0];
    for (let deg = 0; deg < 360; deg += 15) {
      const major = deg % 90 === 0, d = [Math.sin(deg * D2R), -Math.cos(deg * D2R)];
      const tmax = Math.abs(d[0]) > 1e-9 ? Math.PI * S / Math.abs(d[0]) : Infinity;
      for (const o of copies) {
        const p = [O[0] + o, oy], c = clipRay(p, d, R); if (!c) continue;
        const t0 = Math.max(c[0], 0), t1 = Math.min(c[1], tmax); if (t1 - t0 < 20) continue;
        segs.push({ deg, major, d, p, t0, t1, fromO: o === 0 && t0 === 0, endEdge: c[1] <= tmax, startEdge: c[0] > 0 });
      }
    }
    return segs;
  }

  // ---------------- the base map ----------------
  drawBase(origin) {
    this.origin = origin;
    const V = this.view;
    const reserve = [...(this.showLabels ? V.grat.labels : []), ...(V.originBox ? [V.originBox] : [])];
    const admin = V.scale !== 'world' && this.extra ? this.extra.admin1Lines : [];
    const env = renderBase(this, {
      seed: seedOf('merc' + origin.name + origin.lat.toFixed(2) + origin.lon.toFixed(2) + V.scale),
      labelRank: V.labelRank, lakeRank: V.lakeRank, sizes: V.sizes, reserve, admin,
      hooks: { beforeLines: (e) => this.overlays(e), afterLines: (e) => this.clearUnderLabels(e), afterText: (e) => this.lettering(e) },
    });
    this.placedLabels = [...env.texts, ...this.ownLabels];
  }

  // beforeLines: state names (zoomed views), then this map's own lettering (graticule degrees, oceans, the equator,
  // bearing labels) placed clear of everything already placed; then the graticule, the bearing rays and the equator,
  // all broken around the lettering. Coasts and borders are inked over them by renderBase.
  overlays(env) {
    const V = this.view, { art, ctx, isLand } = env, R = V.R, P = env.panels[0], show = env.show;
    if (show && V.scale !== 'world' && this.extra) {
      // close up: every state and province; region: the origin's own country's, and only the biggest elsewhere
      const home = this.extra.countries.find((c) => c.p.some((r) => ringContains(r.r, [this.origin.lon, this.origin.lat])))?.n;
      const states = this.extra.admin1.filter((s) => V.scale === 'close' || s.adm === home || s.a >= 40)
        .map((s) => ({ n: s.n, x: s.x, y: s.y, a: s.a, rank: 0 })).sort((p, q) => q.a - p.a);
      placeLabels(art, P, isLand, env.placed, states, V.stateSizes, 0.8);
      env.texts = env.placed.filter((b) => b.text);
    }
    const boxes = env.texts.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }));
    const own = [];
    const add = (L) => { boxes.push(L); own.push(L); };
    if (V.originBox) boxes.push(V.originBox);
    const water = (b) => { for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) if (isLand(b.x0 + (b.x1 - b.x0) * i / 4, b.y0 + (b.y1 - b.y0) * j / 2)) return false; return true; };
    if (show) {
      for (const L of V.grat.labels) add(L);
      // oceans: the first spot (in the order listed) that is on the map, in open water and clear
      const os = V.scale === 'world' ? 22 : 24;
      for (const [name, spots] of OCEANS) for (const [lon, lat] of spots) {
        const dl = wrapLon(lon - V.lon0); if (dl < V.a || dl > V.b || lat < V.latBot || lat > V.latTop) continue;
        const L = labelBox(name, V.X(dl), V.Y(lat) + os * 0.37, os, { spacing: os * 0.3, pad: 6, alpha: 0.8 });
        if (inRect(L, R, 10) && water(L) && !hits(L, boxes, 12)) { add(L); break; }
      }
    }
    // the equator: a bold line, EQUATOR lettered on it in open water with the hemisphere names above and below
    const eqY = V.Y(0), eqOn = eqY > R.y0 + 20 && eqY < R.y1 - 20;
    if (show && eqOn) {
      const es = 17, hs = 14, xs = [];
      for (let x = R.x0 + 120; x <= R.x1 - 120; x += 12) xs.push(x);
      const want = W * 0.3; xs.sort((p, q) => Math.abs(Math.abs(p - V.O[0]) - want) - Math.abs(Math.abs(q - V.O[0]) - want));
      const block = (x, hemi) => {
        const L = [labelBox('EQUATOR', x, eqY + es * 0.37, es, { spacing: es * 0.25, pad: 4, alpha: 0.85 })];
        if (hemi) L.push(labelBox('NORTHERN HEMISPHERE', x, eqY - es * 0.37 - 9, hs, { spacing: hs * 0.3, pad: 3, alpha: 0.8 }),
          labelBox('SOUTHERN HEMISPHERE', x, eqY + es * 0.37 + 9 + hs * 0.74, hs, { spacing: hs * 0.3, pad: 3, alpha: 0.8 }));
        return L.every((b) => inRect(b, R, 8) && (!wet || water(b)) && !hits(b, boxes, 10)) ? L : null;
      };
      let got = null, wet = true;
      for (const [hemi, w] of [[true, true], [false, true], [false, false]]) { wet = w; for (const x of xs) if ((got = block(x, hemi))) break; if (got) break; }
      if (got) got.forEach(add);
    }
    // bearing labels: N E S W big, the rest in degrees, near the far end of each ray (book: merc-core.js step 4)
    if (show) for (const pass of ['water', 'any']) for (const s of V.segs) {
      if (s.label !== undefined) continue;
      const text = s.major ? 'NESW'[s.deg / 90] : s.deg + '°', size = s.major ? 30 : 17;
      const tryAt = (t) => {
        const x = s.p[0] + s.d[0] * t, y = s.p[1] + s.d[1] * t;
        const L = labelBox(text, x, y + size * 0.37, size, { pad: s.major ? 6 : 4, alpha: 0.9 });
        if (!inRect(L, R, 4) || hits(L, boxes, s.major ? 22 : 16)) return null;
        return pass === 'water' && !water(L) ? null : L;
      };
      const near = s.fromO ? 80 : 22; let L = null;
      if (s.endEdge || !s.startEdge) { for (let t = s.t1 - 22; t > s.t0 + near && !L; t -= 4) L = tryAt(t); }
      else { for (let t = s.t0 + 22; t < s.t1 - 22 && !L; t += 4) L = tryAt(t); }
      if (L) { s.label = L; add(L); } else if (pass === 'any') s.label = null;
    }
    for (const s of V.segs) delete s.label;
    this.ownLabels = own;

    // graticule: faint straight lines broken around the lettering
    ctx.save(); clipOffLettering(ctx, R, boxes);
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.2; ctx.lineWidth = 0.9; ctx.beginPath();
    for (const g of V.grat.lines) if (g.major) { if (g.kind === 'lat') { ctx.moveTo(R.x0, g.v); ctx.lineTo(R.x1, g.v); } else { ctx.moveTo(g.v, R.y0); ctx.lineTo(g.v, R.y1); } }
    ctx.stroke(); ctx.restore();
    // mid-direction rays: lighter, clean dashes, starting a little way out from the origin
    ctx.save(); clipOffLettering(ctx, R, boxes);
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.42; ctx.lineWidth = 1.2; ctx.setLineDash([8, 7]); ctx.lineCap = 'round'; ctx.beginPath();
    for (const s of V.segs) if (!s.major) {
      const t0 = s.fromO ? Math.max(s.t0, 35) : s.t0; if (s.t1 - t0 < 4) continue;
      ctx.moveTo(s.p[0] + s.d[0] * t0, s.p[1] + s.d[1] * t0); ctx.lineTo(s.p[0] + s.d[0] * s.t1, s.p[1] + s.d[1] * s.t1);
    }
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    // north, east, south, west: darker crayon dashes
    const inBox = (x, y) => boxes.some((b) => x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2);
    const inMap = (x, y) => x >= R.x0 - 1 && x <= R.x1 + 1 && y >= R.y0 - 1 && y <= R.y1 + 1;
    art.batch(() => {
      for (const s of V.segs) if (s.major) for (let t = s.fromO ? 20 : s.t0; t < s.t1; t += 21) {
        const e = Math.min(t + 13, s.t1), pts = [[s.p[0] + s.d[0] * t, s.p[1] + s.d[1] * t], [s.p[0] + s.d[0] * e, s.p[1] + s.d[1] * e]];
        if (e - t < 3 || pts.some(([x, y]) => inBox(x, y) || !inMap(x, y))) continue;
        art.crayon(pts, { color: INK, width: 1.7, alpha: 0.7, passes: 2, wobble: 0.3, crumple: 0.4, breakProb: 0.02, step: 2, jitter: 0.4 });
      }
      // the equator: a bold crayon line
      if (eqOn) brokenAround(art, [[R.x0 + 2, eqY], [R.x1 - 2, eqY]], { color: INK, width: 2.4, alpha: 0.8, passes: 3, wobble: 0.5, crumple: 0.6, breakProb: 0.02, step: 3, jitter: 0.4 }, boxes);
      // ticks on the border
      const tk = { color: INK, width: 1.2, alpha: 0.85, passes: 2, wobble: 0.15, step: 2 };
      for (const g of V.grat.lines) {
        const L = g.major ? 12 : 6;
        if (g.kind === 'lat') { art.crayon([[R.x0, g.v], [R.x0 + L, g.v]], tk); art.crayon([[R.x1 - L, g.v], [R.x1, g.v]], tk); }
        else { art.crayon([[g.v, R.y0], [g.v, R.y0 + L]], tk); art.crayon([[g.v, R.y1 - L], [g.v, R.y1]], tk); }
      }
    });
  }

  // afterLines: coasts, borders and state lines are inked by renderBase without breaks, so where one of this map's
  // labels touches land, the paper and the water hatching are laid down again inside the label's box first
  // (the book breaks every line around its lettering the same way)
  clearUnderLabels(env) {
    if (!env.show) return;
    const { art, ctx, isLand, layPaper } = env, P = env.panels[0];
    const touches = (b) => { for (let i = 0; i <= 6; i++) for (let j = 0; j <= 3; j++) if (isLand(b.x0 - 4 + (b.x1 - b.x0 + 8) * i / 6, b.y0 - 4 + (b.y1 - b.y0 + 8) * j / 3)) return true; return false; };
    const list = this.ownLabels.filter(touches).map((b) => ({ x0: b.x0 + 1, y0: b.y0 + 1, x1: b.x1 - 1, y1: b.y1 - 1 }));
    if (!list.length) return;
    const boxPath = () => { ctx.beginPath(); for (const b of list) ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); };
    ctx.save(); boxPath(); ctx.clip(); layPaper();
    for (const b of list) art.hatchFill(() => ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0), [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0], WATER_LAYERS);
    ctx.beginPath(); P.landRings.forEach((r) => addRing(ctx, r)); P.lakeRings.forEach((r) => addRing(ctx, r)); ctx.clip('evenodd'); layPaper();
    ctx.restore();
  }

  // afterText: this map's lettering, and the origin's ringed dot on top of everything
  lettering(env) {
    const { art } = env;
    if (env.show) for (const L of this.ownLabels) lettered(art, L);
    if (this.view.originOn) centerDot(art, this.view.O[0], this.view.O[1]);
  }

  // ---------------- places the reader added ----------------
  locate(p) {
    let at = super.locate(p);
    // a place exactly half a world from the center line (the origin's antipode, say) sits on the left edge
    const V = this.view;
    if (!at && V.wraps && p.lat > V.latBot && p.lat < V.latTop && Math.abs(wrapLon(p.lon - V.lon0)) > 180 - 1e-9) at = { x: V.R.x0 + 0.5, y: V.Y(p.lat) };
    return at && { ...at, cx: this.view.O[0], cy: this.view.O[1] }; // labels lean away from the origin, off the routes
  }
  hardBoxes() { return this.view?.originBox ? [this.view.originBox] : []; }

  // the two routes to a place, in map px: the rhumb line (straight) and the great circle (projected, in runs)
  routesTo(p) {
    const V = this.view, o = this.origin, R = V.R;
    if (distanceMi(o, p) < 1) return null;
    const { deg, mi } = rhumb(o, p), dl = wrapLon(p.lon - o.lon);
    // (to a pole the line runs straight up or down the origin's own meridian)
    const A = [V.X(V.atPole ? dl : 0), V.Y(o.lat)], B = [Math.abs(p.lat) >= POLE ? A[0] : V.X(dl), V.Y(p.lat)], at = this.locate(p);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, d = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
    // the solid line runs from just outside the origin's ring to just short of the place's dot, clipped to the map
    const c = clipRay(A, d, { x0: R.x0 - 4, y0: R.y0 - 4, x1: R.x1 + 4, y1: R.y1 + 4 }, V.originOn ? 17 : 0, at ? len - 9 : len);
    const line = c ? [[A[0] + d[0] * c[0], A[1] + d[1] * c[0]], [A[0] + d[0] * c[1], A[1] + d[1] * c[1]]] : null;
    const gc = projectLines(shortestRoute(o, p, 200, deg), V.panels[0].geo, { cuts: false, maxStep: 6 })
      .map((run) => run.filter(([x, y]) => (!V.originOn || Math.hypot(x - A[0], y - A[1]) > 17) && (!at || Math.hypot(x - B[0], y - B[1]) > 9)))
      .filter((run) => run.length > 1);
    return { p, deg, mi, gcMi: distanceMi(o, p), A, B, d, line, gc, at };
  }

  // a heading label for each rhumb line: set parallel to it, just to one side, clear of dots, other routes, other
  // heading labels and (if it can) the map's lettering. Off-map places say so on the label's second line.
  headingLabels(routes) {
    const V = this.view, R = V.R, out = [];
    const s1 = 16, s2 = 14, gap = 7, pad = 4;
    const dots = [...(V.originOn ? [[V.O[0], V.O[1], 20]] : []), ...routes.filter((r) => r.at).map((r) => [r.at.x, r.at.y, 13])];
    const pts = [];
    for (const r of routes) {
      if (r.line) { const [[ax, ay], [bx, by]] = r.line, n = Math.ceil(Math.hypot(bx - ax, by - ay) / 6); for (let i = 0; i <= n; i++) pts.push([ax + (bx - ax) * i / n, ay + (by - ay) * i / n, r, 'line']); }
      for (const run of r.gc) for (let i = 1; i < run.length; i++) { const [ax, ay] = run[i - 1], [bx, by] = run[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6)); for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n, r, 'gc']); }
    }
    const softBoxes = this.placedLabels || [], soft = softBoxes.map(quadOf), own = (this.ownLabels || []).map(quadOf);
    // how much of the map's lettering a label would cover: its points (on a grid) that land in a lettering box
    const covered = (c, u, v, hw, hh) => {
      let n = 0;
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 2; j++) {
        const p = -hw + 2 * hw * i / 8, q = -hh + 2 * hh * j / 2, x = c[0] + u[0] * p + v[0] * q, y = c[1] + u[1] * p + v[1] * q;
        if (softBoxes.some((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1)) n++;
      }
      return n;
    };
    for (const r of routes) {
      if (!r.line) continue;
      const [[ax, ay], [bx, by]] = r.line, L = Math.hypot(bx - ax, by - ay); if (L < 30 && r.at) continue;
      // reads left to right; lines within about 10 degrees of upright read bottom to top
      let a = Math.atan2(by - ay, bx - ax); while (a > Math.PI / 2 - 0.18) a -= Math.PI; while (a <= -Math.PI / 2 - 0.18) a += Math.PI;
      const u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
      const name = (r.p.short || r.p.name.split(',')[0]).toUpperCase();
      // two lines: the heading (and, for a place off the map, where it goes), then what it means and how far
      const head = r.at ? headingText(r.deg) : `${headingText(r.deg)} TO ${name}, OFF THE MAP`;
      const long = `ONE HEADING ALL THE WAY, ${fmt(r.mi)} MI`, brief = `${fmt(r.mi)} MI ON THIS LINE`;
      const ts = [];
      if (r.at) for (let k = 0; k <= 10; k++) for (const sg of k ? [-1, 1] : [1]) ts.push(0.5 + sg * k * 0.04);
      else for (let t = 0.86; t >= 0.2; t -= 0.04) ts.push(t);
      let best = null;
      // tiers: clear of all the map's lettering and the routes; then clear of the lettering but crossing this place's
      // own dashed curve (on a short route it hugs the straight line); then clear of this map's own lettering (bearings, degrees, oceans);
      // then anywhere (the last tiers may cross another route, so a place off the map is never left without its label)
      // (from the fifth tier on, the spot covering the least lettering wins, earlier tiers first on a tie; the last two
      // tiers, which cross other routes, are tried only when nothing else fits)
      const tiers = [[head, long, soft], [head, brief, soft], [head, long, soft, 'own curve'], [head, brief, soft, 'own curve'],
        [head, long, own], [head, brief, own], [head, long, []], [head, brief, []], [head, null, []], [head, brief, own, true], [head, null, [], true]];
      for (const [ti, [t1, t2, avoid, loose]] of tiers.entries()) {
        const w = Math.max(measure(t1, s1), t2 ? measure(t2, s2) : 0), h = t2 ? s1 + s2 + 6 : s1 + 4, hw = w / 2 + pad, hh = h / 2 + pad;
        scan: for (const t of ts) for (const side of [1, -1]) {
          const m = [ax + (bx - ax) * t, ay + (by - ay) * t], k = side * (h / 2 + gap), c = [m[0] + v[0] * k, m[1] + v[1] * k];
          const quad = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([p, q]) => [c[0] + u[0] * p + v[0] * q, c[1] + u[1] * p + v[1] * q]);
          if (!quad.every(([x, y]) => x > R.x0 + 6 && x < R.x1 - 6 && y > R.y0 + 6 && y < R.y1 - 6)) continue;
          const local = (x, y) => [(x - c[0]) * u[0] + (y - c[1]) * u[1], (x - c[0]) * v[0] + (y - c[1]) * v[1]];
          if (dots.some(([x, y, rr]) => { const [p, q] = local(x, y); return Math.abs(p) < hw + rr && Math.abs(q) < hh + rr; })) continue;
          if (loose !== true && pts.some(([x, y, rr, kind]) => { if (loose && rr === r && kind === 'gc') return false; const [p, q] = local(x, y); return Math.abs(p) < hw && Math.abs(q) < hh; })) continue;
          if (out.some((o) => overlaps(o.quad, quad))) continue;
          if (avoid.some((s) => overlaps(s, quad))) continue;
          // past the tiers that keep clear of all lettering, take the spot that covers the least of it
          const cover = avoid === soft ? 0 : covered(c, u, v, hw, hh);
          if (!best || cover < best.cover) best = { c, a, u, v, w, h, t1, t2, quad, hot: r.p.id, cover };
          if (!cover) break scan;
        }
        if (best && (best.cover === 0 || ti >= 8)) break;
      }
      // nothing fits along the line (a short line, say the South Pole seen from McMurdo): set the label level, beside
      // some point of the line, preferring spots off the routes and the lettering, so no place is left without its heading
      if (!best) {
        const u = [1, 0], v = [0, 1], hitsRoutes = (c, hw, hh) => pts.some(([x, y]) => Math.abs(x - c[0]) < hw && Math.abs(y - c[1]) < hh);
        for (const [t1, t2, strict] of [[head, long, true], [head, brief, true], [head, null, true], [head, null, false]]) {
          const w = Math.max(measure(t1, s1), t2 ? measure(t2, s2) : 0), h = t2 ? s1 + s2 + 6 : s1 + 4, hw = w / 2 + pad, hh = h / 2 + pad;
          for (const g of [gap, 30, 60, 100]) for (const t of [0.5, 0.75, 0.25, 1, 0]) for (const [sx, sy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
            const m = [ax + (bx - ax) * t, ay + (by - ay) * t], c = [m[0] + sx * (hw + g), m[1] + sy * (hh + g)];
            const quad = [[c[0] - hw, c[1] - hh], [c[0] + hw, c[1] - hh], [c[0] + hw, c[1] + hh], [c[0] - hw, c[1] + hh]];
            if (!quad.every(([x, y]) => x > R.x0 + 6 && x < R.x1 - 6 && y > R.y0 + 6 && y < R.y1 - 6)) continue;
            if (dots.some(([x, y, rr]) => Math.abs(x - c[0]) < hw + rr && Math.abs(y - c[1]) < hh + rr)) continue;
            if (out.some((o) => overlaps(o.quad, quad)) || (strict && own.some((s) => overlaps(s, quad)))) continue;
            const cover = (hitsRoutes(c, hw, hh) ? 100 : 0) + covered(c, u, v, hw, hh);
            if (!best || cover < best.cover) best = { c, a: 0, u, v, w, h, t1, t2, quad, hot: r.p.id, cover };
          }
          if (best) break;
        }
      }
      if (best) out.push(best);
    }
    return out;
  }

  drawPlaces(places, { highlight = null } = {}) {
    const o = this.overlay, c0 = o.getContext('2d');
    if (!this.view) { c0.setTransform(1, 0, 0, 1, 0, 0); c0.clearRect(0, 0, o.width, o.height); return; }
    const V = this.view, R = V.R;
    const routes = places.map((p) => this.routesTo(p)).filter(Boolean);
    const labels = this.showLabels ? this.headingLabels(routes) : [];
    // the heading labels are hard boxes for the place labels: small boxes along each one, so a slanted label
    // does not block a big square around it
    // and so are the place dots, so no label (the origin's included) is set over another place's dot
    const hard = [...this.hardBoxes(), ...routes.filter((r) => r.at).map(({ at: { x, y } }) => ({ x0: x - 9, y0: y - 9, x1: x + 9, y1: y + 9 }))];
    for (const L of labels) for (let s = -L.w / 2; s < L.w / 2 + 1; s += L.h) {
      const e = Math.min(s + L.h, L.w / 2), q = [[s, -L.h / 2], [e, -L.h / 2], [e, L.h / 2], [s, L.h / 2]].map(([p, r]) => [L.c[0] + L.u[0] * p + L.v[0] * r, L.c[1] + L.u[1] * p + L.v[1] * r]);
      hard.push({ x0: Math.min(...q.map((z) => z[0])), y0: Math.min(...q.map((z) => z[1])), x1: Math.max(...q.map((z) => z[0])), y1: Math.max(...q.map((z) => z[1])) });
    }
    // dots and place labels go on a canvas of their own, laid over the routes at the end
    const top = document.createElement('canvas'); top.width = o.width; top.height = o.height;
    this.placeHits = drawPlaceLayer(top, {
      W, H: V.H, edge: EDGE, origin: this.origin, places, highlight, showLabels: this.showLabels,
      locate: (p) => this.locate(p), route: null, soft: this.placedLabels || [], hard, originMark: this.originMark, originSub: this.originSub,
    });
    c0.setTransform(1, 0, 0, 1, 0, 0); c0.clearRect(0, 0, o.width, o.height);
    // both routes break around this map's own lettering (N E S W, degrees, EQUATOR, oceans), as the rays and the
    // equator do: a route due south runs right along the S ray, and one along the equator right through EQUATOR
    // (and around the country names too, so a route never crosses out a name)
    const ownBoxes = this.showLabels ? [...(this.ownLabels || []), ...(this.placedLabels || []).filter((q) => q.text)] : [];
    const inOwn = ([x, y]) => ownBoxes.some((b) => x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2);
    for (const r of routes) {
      const art = createArt(o, { width: W, height: V.H, seed: seedOfPlace(r.p) }), ctx = art.ctx, hot = highlight === r.p.id;
      ctx.save(); ctx.beginPath(); ctx.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); ctx.clip();
      art.batch(() => {
        // the shortest route: a thin dashed curve
        const dash = { colors: ORANGE, width: hot ? 1.9 : 1.4, alpha: hot ? 0.95 : 0.85, passes: 2, wobble: 0.3, crumple: 0.3, breakProb: 0, step: 2, jitter: 0.3 };
        for (const run of r.gc) {
          let cur = [], acc = 0;
          const flush = () => { if (cur.length > 1) art.crayon(cur, dash); cur = []; };
          const rs = art.resample(run, 2);
          for (let i = 0; i < rs.length; i++) {
            if (i) acc += Math.hypot(rs[i][0] - rs[i - 1][0], rs[i][1] - rs[i - 1][1]);
            if (acc % 17 < 9 && !inOwn(rs[i])) cur.push(rs[i]); else flush();
          }
          flush();
        }
        // one compass heading all the way: the solid straight line
        if (r.line) { if (ownBoxes.length) brokenAround(art, r.line, LINE.route(hot), ownBoxes); else art.crayon(r.line, LINE.route(hot)); }
      });
      ctx.restore();
    }
    for (const L of labels) {
      const art = createArt(o, { width: W, height: V.H, seed: seedOf(L.t1 + L.hot) }), ctx = art.ctx;
      ctx.save(); ctx.translate(L.c[0], L.c[1]); ctx.rotate(L.a);
      ctx.globalAlpha = 0.78; ctx.fillStyle = PAPER; roundRect(ctx, -L.w / 2 - 6, -L.h / 2 - 3, L.w + 12, L.h + 6, 6); ctx.fill();
      ctx.restore();
      const at = (k) => [L.c[0] + L.v[0] * k, L.c[1] + L.v[1] * k];
      const [x1, y1] = at(-L.h / 2 + 15), [x2, y2] = at(-L.h / 2 + 16 + 14 + 4);
      art.scrawl(L.t1, x1, y1, { size: 16, color: INK, font: FONT, align: 'center', rot: L.a, alpha: 0.95 });
      if (L.t2) art.scrawl(L.t2, x2, y2, { size: 14, color: INK, font: FONT, align: 'center', rot: L.a, alpha: 0.8 });
    }
    c0.save(); c0.setTransform(1, 0, 0, 1, 0, 0); c0.drawImage(top, 0, 0); c0.restore();
  }
}
