// Flat Earth website: the size maps. Two equal-area world maps from one module, drawn in the book's crayon style:
//   EqualEarthMap  Equal Earth (Savric, Patterson and Jenny 2018), as on book page E1 (equal-earth.js)
//   MollweideMap   Mollweide (1805), the oval map from the size intro page (proj-intro-pages.js, E0)
// Both are centered on the reader's longitude; the reader's place is marked with the book's ink star.
// Overlay: "same-size circles". A circle of everything within 1,000 miles is drawn around the star and around each
// place. On the ground every circle covers the same area, and on an equal-area map it covers the same amount of paper
// too, while its shape squashes and stretches. A small key in the map's corner says so.
//
// What follows the book (E1): faint 30 degree graticule kept off the lettering, a bold equator with EQUATOR and the
// two hemisphere names in open water, letter-spaced ocean names, parallels labeled just outside the side edges and
// meridians under the bottom edge (Mollweide's meridians meet at the poles, so its meridians are labeled in open water
// just over the 60 S parallel instead), and the heavy crayon outline with a faint second pass.
import { createArt, INK, FONT, ORANGE } from './crayon.js';
import {
  BaseMap, MAP_W, EDGE, seedOf, seedOfPlace, wrapLon, shapePath, inShape, projectFill, projectLines, addRing, graticule,
  renderBase, LINE, displayName, D2R, EARTH_MI, ringContains, pxArea,
} from './map-common.js';

// ---------- the projections: (lambda radians, phi radians) -> [x, y] in earth radii, y up ----------
// Equal Earth: Savric, Patterson and Jenny, "The Equal Earth map projection", IJGIS 33 (2019)
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, MM = Math.sqrt(3) / 2;
const eeY = (t) => { const t2 = t * t, t6 = t2 * t2 * t2; return t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)); };
const eeDY = (t) => { const t2 = t * t, t6 = t2 * t2 * t2; return A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2); };
function eeFwd(l, p) {
  const t = Math.asin(MM * Math.sin(p));
  return [2 * Math.sqrt(3) * l * Math.cos(t) / (3 * eeDY(t)), eeY(t)];
}
function eeInv(x, y) {
  let t = y / A1;
  for (let i = 0; i < 25; i++) { const d = (eeY(t) - y) / eeDY(t); t -= d; if (Math.abs(d) < 1e-12) break; }
  t = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, t));
  const s = Math.sin(t) / MM;
  return [x * 3 * eeDY(t) / (2 * Math.sqrt(3) * Math.cos(t)), Math.asin(Math.max(-1, Math.min(1, s)))];
}
// Mollweide (1805): 2 theta + sin 2 theta = pi sin phi, solved by Newton's method
function mollTheta(p) {
  if (Math.abs(p) > Math.PI / 2 - 1e-9) return Math.sign(p) * Math.PI / 2;
  const k = Math.PI * Math.sin(p);
  let t = p;
  for (let i = 0; i < 40; i++) {
    const d = (2 * t + Math.sin(2 * t) - k) / (2 + 2 * Math.cos(2 * t));
    t -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return t;
}
function mollFwd(l, p) { const t = mollTheta(p); return [2 * Math.SQRT2 / Math.PI * l * Math.cos(t), Math.SQRT2 * Math.sin(t)]; }
function mollInv(x, y) {
  const t = Math.asin(Math.max(-1, Math.min(1, y / Math.SQRT2)));
  const c = Math.cos(t);
  return [c < 1e-12 ? 0 : Math.PI * x / (2 * Math.SQRT2 * c), Math.asin(Math.max(-1, Math.min(1, (2 * t + Math.sin(2 * t)) / Math.PI)))];
}
export const PROJECTIONS = {
  'equal-earth': { fwd: eeFwd, inv: eeInv, xMax: eeFwd(Math.PI, 0)[0], yMax: eeFwd(0, Math.PI / 2)[1], poleLine: true },
  mollweide: { fwd: mollFwd, inv: mollInv, xMax: 2 * Math.SQRT2, yMax: Math.SQRT2, poleLine: false },
};

// ---------- layout (logical px; every map is MAP_W = 1800 wide) ----------
const W = MAP_W;
const SIDE = 122;               // room left and right of the map for the parallel labels
const TOP = 26;                 // gap between the neatline and the map's top
const GS = 15;                  // graticule label size
const CIRCLE_MI = 1000;         // radius of the same-size circles
const ARC = CIRCLE_MI / EARTH_MI;

// the book's E1 line settings, at the site's scale
const EQUATOR_LINE = { color: INK, width: 2.2, alpha: 0.8, passes: 3, wobble: 0.6, crumple: 0.8, breakProb: 0.02, step: 3, jitter: 0.5 };
const CIRCLE_LINE = (hot) => ({ colors: ORANGE, width: hot ? 3 : 2.1, alpha: hot ? 0.95 : 0.85, passes: 2, wobble: 0.5, crumple: 0.6, breakProb: 0.02, step: 3 });
const CIRCLE_FILL = [{ angle: 38, spacing: 4.2, colors: ORANGE, alpha: 0.24, width: 1.8, step: 4 }];

// oceans: [text, size, spacing, candidate [lon, lat] spots in order of preference, fallback regions]
// When no candidate is open water (a tiny island such as Tristan da Cunha, or a coast pushed close by the centering),
// a 5 degree grid over the ocean's regions is searched, nearest the first candidate first, then smaller lettering.
// Regions: [lonW, lonE, latS, latN] (lonW > lonE means across the date line)
const OCEANS = [
  ['PACIFIC OCEAN', 24, 8, [[-140, 8], [-130, -15], [-150, 24], [-120, -32], [-165, -8], [160, 18], [170, -12], [-175, 30]],
    [[-175, -95, -40, 35], [150, -175, -40, 30]]],
  ['ATLANTIC OCEAN', 20, 6, [[-38, 22], [-42, 30], [-30, -22], [-45, 38], [-35, 14], [-25, -30], [-20, -2], [-15, -38]],
    [[-60, -12, 8, 45], [-35, 5, -42, -2]]],
  ['INDIAN OCEAN', 22, 7, [[78, -22], [70, -12], [88, -30], [65, -30], [95, -15]],
    [[52, 110, -42, -2]]],
  ['SOUTHERN OCEAN', 18, 6, [[30, -58], [-100, -60], [150, -60], [-30, -58], [90, -58], [-160, -62], [-120, -50], [100, -48], [-20, -50], [170, -52], [60, -45]],
    [[-180, 180, -64, -46]]],
  ['ARCTIC OCEAN', 14, 4, [[-145, 76], [-165, 74], [-155, 78], [0, 84], [150, 80], [170, 78], [-100, 81], [60, 84], [40, 80]],
    [[-180, 180, 72, 86]]],
];
// a second, smaller PACIFIC OCEAN for the other side when the ocean is split or very wide (as on E1)
const PACIFIC2 = ['PACIFIC OCEAN', 18, 5, [[160, 20], [165, -5], [150, 28], [175, -30], [-125, -30], [-150, 20], [-110, -10]],
  [[-175, -95, -40, 35], [150, -175, -40, 30]]];
// every spot an ocean name may try: its candidates, then its regions' grid, nearest the first candidate first
function oceanSpots([, , , spots, regions = []]) {
  const [l0, f0] = spots[0], grid = [];
  for (const [w, e, s, n] of regions) {
    const span = ((e - w) + 360) % 360 || 360;
    for (let dl = 0; dl <= span; dl += 5) for (let lat = s; lat <= n; lat += 5) grid.push([wrapLon(w + dl), lat]);
  }
  const dist = ([l, f]) => Math.hypot(wrapLon(l - l0) * Math.cos(((f + f0) / 2) * D2R), f - f0);
  return [...spots, ...grid.sort((a, b) => dist(a) - dist(b))];
}

// where a country name may sit around its label point: (x in name widths, y in name heights), nearest first
const NUDGES = [];
for (let nx = -0.6; nx <= 0.61; nx += 0.15) for (let ny = -3.3; ny <= 3.31; ny += 0.55) NUDGES.push([Math.round(nx * 100) / 100, Math.round(ny * 100) / 100]);
NUDGES.sort((a, b) => Math.hypot(a[0] * 3, a[1]) - Math.hypot(b[0] * 3, b[1]));
const spacedWidth = (art, text, size, sp) => art.textWidth(text, size) + sp * ([...text].length - 1);
// letter-spaced lettering, as lettered() in equal-earth.js
function spaced(art, text, x, y, size, sp, alpha = 0.9) {
  if (!sp) { art.scrawl(text, x, y, { size, color: INK, font: FONT, align: 'center', alpha }); return; }
  let u = x - spacedWidth(art, text, size, sp) / 2;
  for (const ch of text) { const cw = art.textWidth(ch, size); if (ch !== ' ') art.scrawl(ch, u, y, { size, color: INK, font: FONT, alpha }); u += cw + sp; }
}
const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

// A geodesic circle of `arc` radians around p, as a closed lon/lat ring with continuous longitudes.
// Around a pole the ring runs all the way round, so it is closed along the pole line ({ ring, rim: the drawn part }).
export function geoCircle(p, arc = ARC, n = 120) {
  const f = p.lat * D2R, sf = Math.sin(f), cf = Math.cos(f), sd = Math.sin(arc), cd = Math.cos(arc), pts = [];
  // centered on a pole: a parallel (the bearing formula below has no longitude to work with there)
  const atPole = cf < 1e-9;
  for (let i = 0; i <= n; i++) {
    if (atPole) { pts.push([p.lon - 180 + i / n * 360, Math.sign(p.lat) * (90 - arc / D2R)]); continue; }
    const b = i / n * 2 * Math.PI, f2 = Math.asin(sf * cd + cf * sd * Math.cos(b));
    const dl = Math.atan2(Math.sin(b) * sd * cf, cd - sf * Math.sin(f2));
    pts.push([p.lon + dl / D2R, f2 / D2R]);
  }
  // unwrap (only a circle around a pole jumps)
  for (let i = 1; i < pts.length; i++) { while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360; while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360; }
  const poleN = 90 - p.lat < arc / D2R, poleS = p.lat + 90 < arc / D2R;
  if (!poleN && !poleS) return { ring: pts, rim: pts };
  const pl = poleN ? 90 : -90, a = pts[0][0], z = pts[pts.length - 1][0];
  return { ring: [...pts, [z, pl], [a, pl], pts[0]], rim: pts };
}

class EqualAreaMap extends BaseMap {
  constructor(base, overlay, data, kind) {
    super(base, overlay, data);
    this.kind = kind;
    this.P = PROJECTIONS[kind];
  }

  async prepare(origin, scale = 'world') {
    this.origin = origin;
    // country outlines, so each name is kept inside its own country (loaded once, cached by the page)
    if (!this.countries) {
      const list = await this.data.load('countries');
      this.countries = new Map(list.map((c) => [c.n, c.p.map((q) => q.r)]));
    }
    this.view = this.buildView(origin);
    const name = displayName(origin);
    const ee = this.kind === 'equal-earth';
    return {
      scale: 'world',
      title: ee ? 'THE WORLD, TRUE TO SIZE' : 'MOLLWEIDE’S OVAL',
      subtitle: 'HOW BIG PLACES REALLY ARE',
      prose: ['Every country is drawn at its true size. The star marks ', { strong: name }, ', and the map is centered on its line of longitude. ' +
        (ee ? 'Equal Earth was made in 2018 to keep every size true and still look like the world maps people know.'
          : 'Karl Mollweide’s 1805 map fits the whole world in an oval twice as wide as it is tall, with every area true.')],
      legend: `Each orange circle holds everything within ${CIRCLE_MI.toLocaleString('en-US')} miles of its dot. Every circle covers the same amount of ground, so it covers the same amount of map, even where its shape stretches.`,
    };
  }

  buildView(origin) {
    const P = this.P, S = (W - 2 * SIDE) / (2 * P.xMax), cx = W / 2, cy = EDGE + TOP + P.yMax * S;
    const H = Math.round(cy + P.yMax * S + (P.poleLine ? 54 : 30) + EDGE);
    const lon0 = origin.lon;
    const fwd = (dlon, lat) => { const [x, y] = P.fwd(dlon * D2R, lat * D2R); return [cx + x * S, cy - y * S]; };
    const outline = [];
    for (let lat = -90; lat <= 90; lat += 1) outline.push(fwd(-180, lat));
    for (let lat = 90; lat >= -90; lat -= 1) outline.push(fwd(180, lat));
    const inverse = (x, y) => {
      const u = (x - cx) / S, v = (cy - y) / S;
      if (Math.abs(v) > P.yMax) return null;
      const [l, f] = P.inv(u, v);
      if (!Number.isFinite(l) || Math.abs(l) > Math.PI + 1e-9) return null;
      return [wrapLon(l / D2R + lon0), f / D2R];
    };
    const panel = { shape: { type: 'poly', rings: [outline] }, geo: { type: 'lonlat', lon0, lon: [-180, 180], lat: [-90, 90], fwd }, inverse };
    const V = { W, H, S, cx, cy, lon0, panels: [panel], outline };
    V.gratLabels = this.graticuleLabels(V);
    V.key = this.keyBox(V);
    return V;
  }

  // parallels just outside the side edges, meridians under the bottom edge (Equal Earth) or over the 60 S parallel (Mollweide)
  graticuleLabels(V) {
    const fwd = V.panels[0].geo.fwd, out = [], m = createMeasure();
    const box = (t, x, y, align) => { const w = m(t, GS), x0 = align === 'right' ? x - w : align === 'left' ? x : x - w / 2; return { t, x, y, align, x0, x1: x0 + w, y0: y - GS * 0.78, y1: y + GS * 0.25 }; };
    for (let lat = -60; lat <= 60; lat += 30) {
      const t = lat === 0 ? 'EQUATOR' : Math.abs(lat) + '° ' + (lat > 0 ? 'N' : 'S');
      const [xl, y] = fwd(-180, lat), [xr] = fwd(180, lat);
      out.push(box(t, xl - 10, y + GS * 0.37, 'right'), box(t, xr + 10, y + GS * 0.37, 'left'));
    }
    const mer = [];
    for (let lon = -180; lon < 180; lon += 30) {
      const d = wrapLon(lon - V.lon0);
      if (Math.abs(d) > 176) continue; // on the map's edge
      const t = lon === 0 ? '0°' : lon === -180 ? '180°' : Math.abs(lon) + '° ' + (lon < 0 ? 'W' : 'E');
      if (this.P.poleLine) { const [x, y] = fwd(d, -90); mer.push(box(t, x, y + 26, 'center')); }
      else { const [x, y] = fwd(d, -60); mer.push({ ...box(t, x, y - 7, 'center'), meridian: true }); }
    }
    mer.sort((a, b) => a.x - b.x);
    for (const b of mer) if (!out.some((o) => overlaps(o, b, 6))) out.push(b);
    return out;
  }

  // the corner key ("Every circle covers the same amount of ground"), in the bottom-right pocket outside the map
  keyBox(V) {
    const m = createMeasure(), size = 17, lines = ['Every circle covers the', 'same amount of ground.'];
    const w = 44 + Math.max(...lines.map((t) => m(t, size))), h = 2 * 22 + 6, shape = V.panels[0].shape;
    const x1 = W - EDGE - 16, x0 = x1 - w, bottom = V.H - EDGE - 12;
    const clear = (y0) => {
      const b = { x0, y0, x1, y1: y0 + h };
      for (let x = b.x0; x <= b.x1; x += 6) for (let y = b.y0; y <= b.y1; y += 6) if (inShape(shape, x, y, -12)) return false;
      return !V.gratLabels.some((g) => overlaps(g, b, 6));
    };
    for (let y0 = EDGE + 20; y0 + h <= bottom; y0 += 4) if (clear(y0)) {
      // the highest clear spot in the lower half, else the lowest anywhere
      if (y0 > V.cy) return { x0, y0, x1, y1: y0 + h, lines, size };
    }
    for (let y0 = bottom - h; y0 > EDGE; y0 -= 4) if (clear(y0)) return { x0, y0, x1, y1: y0 + h, lines, size };
    return null;
  }

  drawBase(origin) {
    this.origin = origin;
    const V = this.view, P = V.panels[0], extra = [];
    // country names are placed here (placeCountries), with a stricter test than renderBase's: a name must sit wholly
    // on land, so no coastline runs through it; renderBase gets an empty label list
    const data = this.data;
    this.data = { ...data, labels: [] };
    let env;
    try { env = renderBase(this, {
      seed: seedOf(this.kind + origin.name + origin.lat.toFixed(2) + origin.lon.toFixed(2)),
      labelRank: 5, sizes: [11, 26],
      reserve: this.starBox(P),
      hooks: {
        beforeLines: (e) => {
          if (e.show) {
            this.placeCountries(e, P, data.labels);
            this.placeMeridians(e, P, V, extra);
            this.placeEquator(e, P, extra); this.placeOceans(e, P, extra); this.placeAntarctica(e, P, extra);
          }
          this.drawGraticule(e, P, extra);
        },
        afterLines: (e) => this.drawOuterRim(e, V),
        afterText: (e) => {
          const { art } = e;
          if (e.show) {
            for (const b of extra) spaced(art, b.text, (b.x0 + b.x1) / 2, b.base, b.size, b.sp, b.alpha);
            for (const g of V.gratLabels) {
              if (g.meridian) continue; // placed with the other lettering (placeMeridians)
              art.scrawl(g.t, g.x, g.y, { size: GS, color: INK, font: FONT, align: g.align, alpha: g.meridian ? 0.7 : 0.8 });
            }
          }
          this.drawKey(art, V);
        },
      },
    }); } finally { this.data = data; }
    // place labels keep off the map's lettering where they can, the graticule labels outside the edge included
    this.placedLabels = this.showLabels ? [...env.texts, ...extra, ...V.gratLabels.filter((g) => !g.meridian)] : [];
  }

  // Country names, biggest first (as placeLabels in map-common.js), kept only where the whole name sits on land and in
  // its own country (no coastline, lake shore or neighbor runs through it); a name that does not fit is set smaller
  placeCountries(e, P, labels) {
    const { art } = e, [minS, maxS] = [11, 26];
    const list = labels.filter((L) => L.r <= 5).sort((a, b) => b.a - a.a);
    const solid = this.solidLand(e, P);
    // most of the name's middle row lies in its own country
    const inCountry = (b, rings) => {
      if (!rings) return true;
      let n = 0;
      for (let i = 0; i <= 4; i++) {
        const ll = P.inverse(b.x0 + (b.x1 - b.x0) * i / 4, (b.y0 + b.y1) / 2);
        if (ll && rings.some((r) => ringContains(r, ll))) n++;
      }
      return n >= 4;
    };
    const onLand = (b) => {
      const pad = 1 + 0.04 * (b.x1 - b.x0); // handwriting runs a little wider than measured (solid land keeps off the coasts)
      for (const y of [b.y0 - 1, (b.y0 + b.y1) / 2, b.y1 + 1]) for (let x = b.x0 - pad; x <= b.x1 + pad + 0.1; x += 3) if (!solid(x, y)) return false;
      return [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([qx, qy]) => inShape(P.shape, qx, qy, 6));
    };
    for (const L of list) {
      const at = P.labelAt(L.x, L.y);
      if (!at || !inShape(P.shape, at.x, at.y)) continue;
      const extent = at.extent(L.a), text = L.n.toUpperCase();
      let size = Math.max(minS, Math.min(maxS, extent * 0.2));
      let w = art.textWidth(text, size);
      if (w > extent * 1.5) { size = Math.max(minS, size * extent * 1.5 / w); w = art.textWidth(text, size); }
      if (w > extent * 1.9 || (size < minS + 0.5 && L.r > 3)) continue;
      found: for (const k of [1, 0.85, 0.72, 0.6, 0.5]) {
        const s = Math.max(minS, size * k), ww = art.textWidth(text, s);
        for (const [nx, ny] of NUDGES) {
          const bx = at.x + nx * ww, by = at.y + ny * s;
          const b = { x0: bx - ww / 2, x1: bx + ww / 2, y0: by - s * 0.72, y1: by + s * 0.28, text, size: s, alpha: 0.95 };
          if (!onLand(b) || e.placed.some((o) => b.x0 < o.x1 + 8 && b.x1 > o.x0 - 8 && b.y0 < o.y1 + 5 && b.y1 > o.y0 - 5) || !inCountry(b, this.countries?.get(L.n))) continue;
          e.placed.push(b); e.texts.push(b);
          break found;
        }
        if (s <= minS) break;
      }
    }
  }
  // Land a name can sit on: the land, less its lakes, pulled back from every coast and lake shore by about a crayon
  // line's width. (The shared land mask is at a third of the size and counts its soft edges as land, so it fills in
  // narrow channels such as those between the Arctic islands, and a name there would be crossed by coastlines.)
  solidLand(e, P) {
    const MS = 1 / 2, m = document.createElement('canvas'); m.width = Math.ceil(e.W * MS); m.height = Math.ceil(e.H * MS);
    const c = m.getContext('2d', { willReadFrequently: true }); c.setTransform(MS, 0, 0, MS, 0, 0);
    const shores = (rings) => { c.beginPath(); rings.forEach((r) => addRing(c, r)); };
    // (lakes too small to read as more than a dot are left out)
    const lakes = P.lakeRings.filter((r) => pxArea(r.pts) > 40);
    c.fillStyle = '#000'; shores(P.landRings); c.fill('evenodd');
    c.globalCompositeOperation = 'destination-out'; c.lineWidth = 6; c.lineJoin = 'round';
    shores(lakes); c.fill('evenodd'); c.stroke();
    shores(P.landRings); c.stroke();
    const d = c.getImageData(0, 0, m.width, m.height).data, mw = m.width;
    return (x, y) => { x = Math.round(x * MS); y = Math.round(y * MS); return x >= 0 && y >= 0 && x < mw && y < m.height && d[(y * mw + x) * 4 + 3] > 127; };
  }
  // Mollweide's meridians: labeled just over the 60 S parallel, in open water, where they fit
  placeMeridians(e, P, V, extra) {
    for (const g of V.gratLabels) if (g.meridian && this.inWater(e, P, g, 4, 6) && !this.hitsAny(e, extra, g, 4))
      extra.push({ x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1, base: g.y, text: g.t, size: GS, sp: 0, alpha: 0.7 });
  }
  // keep country names off the star (the origin's mark is drawn on the overlay)
  starBox(P) {
    const q = P.geo.fwd(wrapLon(this.origin.lon - P.geo.lon0), this.origin.lat);
    return [{ x0: q[0] - 20, y0: q[1] - 20, x1: q[0] + 20, y1: q[1] + 20 }];
  }
  // Antarctica is a thin strip on these maps: when the usual lettering does not fit, letter it along the strip
  placeAntarctica(e, P, extra) {
    if (e.texts.some((b) => b.text === 'ANTARCTICA')) return;
    const { art } = e, size = 15, sp = 5, text = 'ANTARCTICA', w = spacedWidth(art, text, size, sp), f = P.geo.fwd;
    const spots = [];
    for (let d = 0; d <= 150; d += 5) for (const s of d ? [d, -d] : [0]) for (const lat of [-79, -77, -81, -75, -83, -73, -71]) spots.push([s, lat]);
    for (const [d, lat] of spots) {
      const [x, y] = f(d, lat), base = y + size * 0.37, b = { x0: x - w / 2, x1: x + w / 2, y0: base - size * 0.78, y1: base + size * 0.22, base, text, size, sp, alpha: 0.85 };
      let ok = true;
      for (const v of [b.y0 - 3, (b.y0 + b.y1) / 2, b.y1 + 3]) for (let u = b.x0 - 6; ok && u <= b.x1 + 6; u += 3) if (!e.isLand(u, v) || !inShape(P.shape, u, v, 3)) ok = false;
      if (ok && !this.hitsAny(e, extra, b, 4)) { extra.push(b); return; }
    }
  }
  hitsAny(e, extra, b, pad = 0) { return e.texts.some((o) => overlaps(o, b, pad)) || extra.some((o) => overlaps(o, b, pad)); }
  // every sample point of the box is open water inside the map
  inWater(e, P, b, step = 6, margin = 8, pad = 4 + 0.04 * (b.x1 - b.x0)) {
    const x0 = b.x0 - pad, x1 = b.x1 + pad, y0 = b.y0 - 3, y1 = b.y1 + 3;
    for (let x = x0; x <= x1 + 0.1; x += Math.min(step, x1 - x0)) for (let y = y0; y <= y1 + 0.1; y += Math.min(step, y1 - y0)) {
      if (e.isLand(x, y) || !inShape(P.shape, x, y, margin)) return false;
    }
    return true;
  }

  // EQUATOR on the bold equator line, NORTHERN / SOUTHERN HEMISPHERE just above and below, in the widest open water
  placeEquator(e, P, extra) {
    const { art } = e, size = 14, f = P.geo.fwd, y = f(0, 0)[1];
    const parts = [['EQUATOR', 3.5, size * 0.37], ['NORTHERN HEMISPHERE', 4.2, -size - 8], ['SOUTHERN HEMISPHERE', 4.2, size + 8 + size * 0.74]];
    const boxesAt = (x) => parts.map(([t, sp, dy]) => { const w = spacedWidth(art, t, size, sp), base = y + dy;
      return { x0: x - w / 2, x1: x + w / 2, y0: base - size * 0.74 - 3, y1: base + 4, base, text: t, size, sp, alpha: 0.85 }; });
    const ok = [];
    for (let d = -170; d <= 170; d += 2) {
      const x = f(d, 0)[0], bs = boxesAt(x);
      ok.push(bs.every((b) => this.inWater(e, P, b) && !this.hitsAny(e, extra, b, 6)) ? x : null);
    }
    // the middle of the longest run of good spots
    let best = null, run = [];
    const close = () => { if (run.length && (!best || run.length > best.length)) best = run; run = []; };
    for (const x of ok) { if (x === null) close(); else run.push(x); }
    close();
    if (best) extra.push(...boxesAt(best[Math.floor(best.length / 2)]));
  }

  // letter-spaced ocean names, each at its first candidate spot that is open water and clear of other lettering
  placeOceans(e, P, extra) {
    const { art } = e, f = P.fwd;
    // full size anywhere first, then smaller lettering (never under the graticule labels' size)
    const tryPlace = (ocean, test = () => true) => {
      const [text, size0, sp0] = ocean, spots = oceanSpots(ocean);
      for (const k of [1, 0.82, 0.7]) {
        const size = Math.max(GS, Math.round(size0 * k)), sp = sp0 * k, w = spacedWidth(art, text, size, sp);
        for (const [lon, lat] of spots) {
          const q = f(lon, lat);
          if (!q) continue;
          const b = { x0: q[0] - w / 2, x1: q[0] + w / 2, y0: q[1] - size * 0.74 - 4, y1: q[1] + 6, base: q[1], text, size, sp, alpha: 0.8 };
          if (test(b) && this.inWater(e, P, b, 7, 14) && !this.hitsAny(e, extra, b, 8)) { extra.push(b); return b; }
        }
      }
      return null;
    };
    const pac = tryPlace(OCEANS[0]);
    for (const o of OCEANS.slice(1)) tryPlace(o);
    tryPlace(PACIFIC2, (b) => !pac || Math.abs((b.x0 + b.x1) / 2 - (pac.x0 + pac.x1) / 2) > 520);
  }

  // faint graticule every 30 degrees and the bold equator, broken around all lettering
  drawGraticule(e, P, extra) {
    const { art, ctx } = e, inLabel = (x, y) => e.hitsLabel(x, y, 3) || extra.some((b) => x > b.x0 - 3 && x < b.x1 + 3 && y > b.y0 - 3 && y < b.y1 + 3);
    const broken = (pts, o) => {
      let run = [];
      const flush = () => { if (run.length > 1) art.crayon(run, o); run = []; };
      for (const p of art.resample(pts, 3)) { if (e.show && inLabel(p[0], p[1])) flush(); else run.push(p); }
      flush();
    };
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
    art.batch(() => {
      for (const l of graticule({ step: 30, res: 2 })) {
        if (l[0][1] === l[1][1] && l[0][1] === 0) continue;                           // the equator is drawn bold below
        if (l[0][0] === l[1][0] && Math.abs(wrapLon(l[0][0] - P.geo.lon0)) > 176) continue; // a meridian on the edge
        for (const run of projectLines(l, P.geo, { cuts: false, maxStep: 12 })) broken(run, LINE.graticule);
      }
    });
    const eq = []; for (let d = -180; d <= 180; d += 2) eq.push(P.geo.fwd(d, 0));
    art.batch(() => broken(eq, EQUATOR_LINE));
    ctx.restore();
  }

  // the faint second pass outside the rim (the book's E1 outline: x 1.006, y 1.012 around the middle)
  drawOuterRim(e, V) {
    const r = V.outline, pts = [...r, r[0]].map(([x, y]) => [V.cx + (x - V.cx) * 1.004, V.cy + (y - V.cy) * 1.01]);
    e.art.crayon(pts, LINE.rimOuter);
  }

  drawKey(art, V) {
    const k = V.key;
    if (!k) return;
    const { ctx, hatchFill, crayon } = art, r = 13, cx = k.x0 + r + 2, cy = (k.y0 + k.y1) / 2;
    hatchFill(() => ctx.arc(cx, cy, r, 0, Math.PI * 2), [cx - r, cy - r, 2 * r, 2 * r], CIRCLE_FILL);
    crayon(art.wobblyEllipse(cx, cy, r, r, 0, 0.3, 0.04), CIRCLE_LINE(false));
    k.lines.forEach((t, i) => art.scrawl(t, k.x0 + 2 * r + 14, k.y0 + 18 + i * 22, { size: k.size, color: INK, font: FONT, alpha: 0.85 }));
  }

  // ---------- places: no route lines here; the same-size circles go under the dots and labels ----------
  // Every point on Earth is on these maps. A place on the map's edge (the origin's antipode, a pole) lands exactly on
  // the outline, where the shared locate's inside-the-shape test can miss it, so place it straight from the projection.
  locate(p) {
    const g = this.view.panels[0].geo, q = g.fwd(wrapLon(p.lon - g.lon0), Math.max(-90, Math.min(90, p.lat)));
    return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? { x: q[0], y: q[1] } : null;
  }
  routeOf() { return null; }
  hardBoxes() { const k = this.view?.key; return k ? [{ x0: k.x0, y0: k.y0, x1: k.x1, y1: k.y1 }] : []; }
  drawPlaces(places, opts = {}) {
    super.drawPlaces(places, opts);
    if (!this.view || !this.origin) return;
    const V = this.view, P = V.panels[0], o = this.overlay;
    const tmp = document.createElement('canvas'); tmp.width = o.width; tmp.height = o.height;
    for (const p of [{ ...this.origin, id: '__origin' }, ...places]) {
      const art = createArt(tmp, { width: V.W, height: V.H, seed: seedOfPlace(p) + 17 });
      this.drawCircle(art, P, p, opts.highlight === p.id);
    }
    // a soft paper halo under the star, so it reads over busy coastlines
    const at = this.locate(this.origin);
    if (at) {
      const t = tmp.getContext('2d'), k = tmp.width / V.W, g = t.createRadialGradient(at.x * k, at.y * k, 10 * k, at.x * k, at.y * k, 21 * k);
      g.addColorStop(0, 'rgba(243,236,219,0.85)'); g.addColorStop(1, 'rgba(243,236,219,0)');
      t.save(); t.setTransform(1, 0, 0, 1, 0, 0); t.fillStyle = g; t.beginPath(); t.arc(at.x * k, at.y * k, 21 * k, 0, Math.PI * 2); t.fill(); t.restore();
    }
    const c = o.getContext('2d');
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'destination-over'; c.drawImage(tmp, 0, 0); c.restore();
  }
  drawCircle(art, P, p, hot) {
    const { ctx } = art, { ring, rim } = geoCircle(p);
    const recs = projectFill(ring, P.geo, { maxStep: 8 });
    if (!recs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of recs) for (const [x, y] of r.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
    art.hatchFill(() => recs.forEach((r) => addRing(ctx, r)), [x0, y0, x1 - x0, y1 - y0], CIRCLE_FILL);
    art.batch(() => { for (const run of projectLines(rim, P.geo, { cuts: false, maxStep: 6 })) art.crayon(run, CIRCLE_LINE(hot)); });
    ctx.restore();
  }
}

// a text measurer that works before any art exists (layout is worked out in prepare)
let measureCtx = null;
function createMeasure() {
  if (!measureCtx) { const c = document.createElement('canvas'); c.width = 8; c.height = 8; measureCtx = c.getContext('2d'); }
  return (t, size) => { measureCtx.font = `${size}px ${FONT}`; return measureCtx.measureText(t).width; };
}

export class EqualEarthMap extends EqualAreaMap { constructor(b, o, d) { super(b, o, d, 'equal-earth'); } }
export class MollweideMap extends EqualAreaMap { constructor(b, o, d) { super(b, o, d, 'mollweide'); } }
