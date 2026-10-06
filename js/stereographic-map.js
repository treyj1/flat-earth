// Flat Earth website: the stereographic map (the book's SHAPE MAPS set), drawn in crayon from any center.
// Follows st-map.js (book pages S1 TINY PLANET and S2 NORTH AMERICA) and the "circles stay circles" figure on
// the set's introduction page (proj-intro-pages.js, S0): a lamp on the far side of a glass globe throws every place's
// shadow onto a flat sheet touching the center. Every small shape is drawn true and every circle on the Earth stays
// a circle; sizes swell away from the center, and the point opposite the center never fits.
//
// Three scales, all centered on the reader's place, north up:
//   planet      the "tiny planet" (S1): a square frame about 105 degrees from the center at its edges; land is
//               kept out to 150 degrees (it reaches the corners). Rings every 1,000 miles, faint every 500.
//   hemisphere  one disk out to 90 degrees (the near half of the world). Rings every 1,000 miles, faint every 500.
//   region      a square frame 35 degrees from the center at its edges (like S2). Rings every 500, faint every 100,
//               with state and province lines.
// On top of the base map: dashed distance rings (they spread apart outward), a faint graticule, and "cookie-cutter"
// circles: small circles of the same size on the ground, set on rings and spokes around the center, that stay
// perfectly round but grow away from it. Places off the frame get an arrow on the edge along their true bearing
// (the center's antipode, reached by every bearing, gets no route and an arrow wherever there is room).
import { createArt, INK, FONT } from './crayon.js';
import { headingDeg } from './projection.js';
import {
  BaseMap, renderBase, MAP_W, EDGE, PAPER, D2R, EARTH_MI, LINE, seedOf, seedOfPlace, fmt, displayName,
  shapePath, inShape, boundsOf, projectLines, graticule, placeLabels, distanceMi, roundRect, ORANGE,
} from './map-common.js';

export const SCALES = [
  { id: 'planet', label: 'Tiny planet' },
  { id: 'hemisphere', label: 'Hemisphere' },
  { id: 'region', label: 'Region' },
];
const W = MAP_W;
const RING_SIZE = 24;
const ringText = (mi) => fmt(mi) + ' MI';
// the book's warm accent for the cookie-cutter circles (proj-intro.js WARM, WARM_LINE)
const WARM = ['#d9663a', '#e07a4a', '#cc5a30'], WARM_LINE = '#b44a24';
// how many times bigger things are drawn (in length), mi from the center
export const swell = (mi) => 2 / (1 + Math.cos(mi / EARTH_MI));
const rhoOf = (c) => 2 * Math.tan(c / 2); // map distance from the center, in earth radii, at angle c (radians)
const ANTI = 179.5 * D2R; // a place this far from the center (radians) counts as the antipode: every bearing leads there

// The scales. half: the frame's half-width in earth radii (rect), or disk: the disk's edge angle in degrees.
// maxC: how far from the center land is projected (degrees). circles: radius (degrees) and the distances (degrees)
// of the rings of cookie-cutter circles (6 spokes, the first due north; distance 0 is one circle on the center).
const VIEWS = {
  planet: { half: 2.6, maxC: 150, main: 1000, faint: 500, labelRank: 5, lakeRank: 3, sizes: [11, 30], grat: 30,
    circles: { r: 9, at: [0, 30, 60, 90] } },
  hemisphere: { disk: 90, maxC: 90, main: 1000, faint: 500, labelRank: 6, lakeRank: 3, sizes: [12, 30], grat: 30,
    circles: { r: 7, at: [0, 27, 54, 78] } },
  region: { half: rhoOf(35 * D2R), maxC: 50, main: 500, faint: 100, labelRank: 8, lakeRank: 99, sizes: [13, 40], grat: 10,
    circles: { r: 3, at: [0, 11, 22, 33] } },
};

// ---------- sphere helpers ----------
// the point d radians from c along bearing az (radians clockwise from north). Worked with vectors so it holds at
// the poles too, where "north" is taken along the center's own meridian (as the projection's north-up does).
function dest(c, d, az) {
  const f = c.lat * D2R, l = c.lon * D2R, sf = Math.sin(f), cf = Math.cos(f), sl = Math.sin(l), cl = Math.cos(l);
  const v = [cf * cl, cf * sl, sf], e = [-sl, cl, 0], n = [-sf * cl, -sf * sl, cf];
  const cd = Math.cos(d), sd = Math.sin(d), ca = Math.cos(az), sa = Math.sin(az);
  const q = [0, 1, 2].map((i) => v[i] * cd + (n[i] * ca + e[i] * sa) * sd);
  return { lat: Math.asin(Math.max(-1, Math.min(1, q[2]))) / D2R, lon: Math.atan2(q[1], q[0]) / D2R };
}
// a small circle on the sphere: every point d radians from c, as a closed lon/lat line
const smallCircle = (c, d, n = 72) => Array.from({ length: n + 1 }, (_, i) => { const q = dest(c, d, (i / n) * 2 * Math.PI); return [q.lon, q.lat]; });

// ---------- the projection ----------
// Stereographic, tangent at the center, north up; k px per earth radius (scale 1 at the center), y down.
// Returns fwd(lon, lat) -> [x, y] (valid anywhere but the antipode) and inv(x, y) -> [lon, lat] | null (beyond maxC).
export function stereographic(center, cx, cy, k, maxC = Math.PI * 0.95) {
  const p0 = center.lat * D2R, l0 = center.lon * D2R, sp0 = Math.sin(p0), cp0 = Math.cos(p0);
  const fwd = (lon, lat) => {
    const f = lat * D2R, dl = lon * D2R - l0, sf = Math.sin(f), cf = Math.cos(f), cdl = Math.cos(dl);
    const cc = Math.max(-0.999999, sp0 * sf + cp0 * cf * cdl), s = 2 / (1 + cc);
    return [cx + k * s * cf * Math.sin(dl), cy - k * s * (cp0 * sf - sp0 * cf * cdl)];
  };
  const inv = (px, py) => {
    const x = (px - cx) / k, y = -(py - cy) / k, rho = Math.hypot(x, y), c = 2 * Math.atan(rho / 2);
    if (c > maxC) return null;
    if (rho < 1e-12) return [center.lon, center.lat];
    const sc = Math.sin(c), cc = Math.cos(c);
    const lat = Math.asin(Math.max(-1, Math.min(1, cc * sp0 + (y * sc * cp0) / rho)));
    const lon = l0 + Math.atan2(x * sc, rho * cp0 * cc - y * sp0 * sc);
    return [((lon / D2R + 540) % 360) - 180, lat / D2R];
  };
  return { fwd, inv };
}

export class StereographicMap extends BaseMap {
  constructor(base, overlay, data) {
    super(base, overlay, data);
    this.extra = null;
    this.originMark = 'star'; this.originSub = 'CENTER';
  }

  async prepare(origin, scale = 'planet') {
    if (!VIEWS[scale]) scale = 'planet';
    this.origin = origin;
    if (scale === 'region' && !this.extra) {
      const [admin1, admin1Lines] = await Promise.all(['admin1', 'admin1-lines'].map((n) => this.data.load(n)));
      this.extra = { admin1, admin1Lines };
    }
    this.view = this.buildView(origin, scale);
    return { scale, ...this.describe(origin, scale) };
  }

  buildView(origin, scale) {
    const S = VIEWS[scale], cx = W / 2, cy = W / 2, maxC = S.maxC * D2R;
    let k, shape;
    if (S.disk) { const R = 780; k = R / rhoOf(S.disk * D2R); shape = { type: 'circle', cx, cy, r: R }; }
    else { k = (W / 2 - EDGE) / S.half; shape = { type: 'rect', x0: EDGE, y0: EDGE, x1: W - EDGE, y1: W - EDGE }; }
    const { fwd, inv } = stereographic(origin, cx, cy, k, maxC);
    const P = {
      shape, cx, cy, k, maxC,
      geo: { type: 'cap', center: { lon: origin.lon, lat: origin.lat }, maxC, fwd, rim: { cx, cy, r: rhoOf(maxC) * k } },
      inverse: (x, y) => (inShape(shape, x, y) ? inv(x, y) : null),
      R: (mi) => rhoOf(mi / EARTH_MI) * k, // a distance ring's radius in px
    };
    // how far the frame reaches from the center (px), for which rings to draw
    P.reach = shape.type === 'circle' ? shape.r : Math.hypot(W / 2 - EDGE, W / 2 - EDGE);
    return { scale, W, H: W, panels: [P], S };
  }

  // the heading beside the map
  describe(o, scale) {
    const name = displayName(o), short = o.short || name.split(',')[0], S = VIEWS[scale];
    const x = (mi) => swell(mi).toFixed(1), pct = (mi) => Math.round((swell(mi) - 1) * 100);
    const across = Math.round(2 * S.circles.r * D2R * EARTH_MI / 10) * 10;
    const legend = `Rings every ${fmt(S.main)} miles; faint rings every ${fmt(S.faint)}. ` +
      `The shaded circles are all the same size on the ground, about ${fmt(across)} miles across. They stay round but swell far from the center.`;
    if (scale === 'hemisphere') {
      const edge = Math.round(EARTH_MI * Math.PI / 2 / 10) * 10;
      return { title: 'THE NEAR HALF', subtitle: 'HALF THE WORLD AROUND ' + short.toUpperCase(), legend,
        prose: ['Centered on ', { strong: name }, `. The edge is everything ${fmt(edge)} miles away, halfway to the far side of the Earth. ` +
          'Every shape is true up close, and every circle on the Earth stays a circle. Out at the edge, places are drawn twice as big as at the center.'] };
    }
    if (scale === 'region') {
      return { title: 'CLOSE UP', subtitle: 'TRUE SHAPES AROUND ' + short.toUpperCase(), legend,
        prose: ['Centered on ', { strong: name }, `. Up close, every shape is true, so each country and state looks like itself. ` +
          `Sizes swell only a little: ${pct(1000)} percent at 1,000 miles, ${pct(2000)} percent at 2,000.`] };
    }
    return { title: 'TINY PLANET', subtitle: 'THE WORLD CURLED AROUND ' + short.toUpperCase(), legend,
      prose: ['Centered on ', { strong: name }, `. Up close, every shape on this map is true. Farther out, places keep their shapes but swell: ` +
        `3,000 miles away they are drawn ${x(3000)} times bigger, 6,000 miles away ${x(6000)} times, 8,000 miles away ${x(8000)} times. ` +
        'The spot on the far side of the Earth would be infinitely big, so the world curls outward and never ends.'] };
  }

  // ---------------- the base map ----------------
  drawBase(origin) {
    this.origin = origin;
    const V = this.view, S = V.S, P = V.panels[0], region = V.scale === 'region';
    const o = this.origin, show = this.showLabels;
    // the cookie-cutter circles (lon/lat rings) and their projected outlines, kept if wholly inside the frame
    const circles = [];
    for (const d of S.circles.at) for (let i = 0; i < (d ? 6 : 1); i++) {
      const c = d ? dest(o, d * D2R, (i * Math.PI) / 3) : { lat: o.lat, lon: o.lon };
      const pts = smallCircle(c, S.circles.r * D2R).map(([lon, lat]) => P.geo.fwd(lon, lat));
      if (!pts.every(([x, y]) => inShape(P.shape, x, y, 10))) continue;
      const [x0, y0, x1, y1] = boundsOf({ type: 'poly', rings: [pts] });
      circles.push({ pts, x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: (x1 - x0) / 2 });
    }
    this.circles = circles;
    const ringBoxes = [];
    let letterRings = () => {};

    const env = renderBase(this, {
      seed: seedOf('stereo' + o.name + o.lat.toFixed(2) + o.lon.toFixed(2) + V.scale),
      labelRank: S.labelRank, lakeRank: S.lakeRank, sizes: S.sizes,
      reserve: [{ x0: P.cx - 22, y0: P.cy - 22, x1: P.cx + 22, y1: P.cy + 22 }, this.originLabelBox(P)],
      admin: region && this.extra ? this.extra.admin1Lines : [],
      hooks: {
        beforeLines: (e) => {
          const { art, ctx } = e;
          // state and province names in the close-up (after the country names, so they never cover them)
          if (region && show && this.extra) {
            const states = this.extra.admin1.map((s) => ({ n: s.n, x: s.x, y: s.y, a: s.a, rank: 0 })).sort((a, b) => b.a - a.a);
            placeLabels(art, P, e.isLand, e.placed, states, [11, 24], 0.8);
            e.texts = e.placed.filter((b) => b.text);
          }
          const texts = e.texts;
          // clip that keeps faint linework off the lettering
          const clipOffText = () => {
            ctx.beginPath(); shapePath(ctx, P.shape);
            for (const b of texts) ctx.rect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
            ctx.clip('evenodd');
          };
          // graticule: faint meridians and parallels; they cross at right angles everywhere (shapes are true)
          ctx.save(); clipOffText();
          art.batch(() => {
            for (const l of graticule({ step: S.grat, latMax: 90, res: S.grat > 10 ? 2 : 1 })) {
              for (const run of projectLines(l, P.geo, { cuts: false, bounds: boundsOf(P.shape), maxStep: 16 })) art.crayon(run, LINE.graticule);
            }
          });
          ctx.restore();
          // cookie-cutter circles: warm hatching and a warm crayon outline, as on the set's introduction page
          for (const c of circles) {
            art.hatchFill(() => { c.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); },
              [c.x - c.r - 2, c.y - c.r - 2, 2 * c.r + 4, 2 * c.r + 4], [{ angle: 38, spacing: 4.2, colors: WARM, alpha: 0.3, width: 1.7, step: 5 }]);
          }
          art.batch(() => { for (const c of circles) art.crayon(c.pts, { color: WARM_LINE, width: 1.8, alpha: 0.75, passes: 2, wobble: 0.4, crumple: 0.4, step: 3 }); });
          letterRings = this.drawRings(e, P, S, ringBoxes);
        },
        afterLines: () => letterRings(),
      },
    });
    // place labels must not cover the ring labels (hardBoxes), and prefer not to cover the lettering (placedLabels)
    this.ringBoxes = ringBoxes;
    this.placedLabels = env.texts;
  }

  // where the origin's NAME / CENTER label sits (drawPlaceLayer sets it to the right of the star first),
  // kept free of lettering and ring labels
  originLabelBox(P) {
    const name = (this.origin.short || this.origin.name.split(',')[0]).toUpperCase();
    const c = document.createElement('canvas').getContext('2d');
    c.font = '22px ' + FONT; const w = Math.max(c.measureText(name).width, 60);
    return { x0: P.cx + 16, y0: P.cy - 26, x1: P.cx + 28 + w, y1: P.cy + 26 };
  }

  // Distance rings from the center: circles on the map too, spreading apart outward. Faint rings first, then dashed
  // crayon rings with a gap for each label; labels go in open water (clear of lettering and the shaded circles),
  // all on one spoke when they can. Returns the function that letters the labels (called after the linework).
  drawRings(e, P, S, ringBoxes) {
    const { art, ctx, isLand, texts, hitsLabel, show } = e;
    const list = [];
    for (let mi = S.main; mi / EARTH_MI < P.maxC - 0.01; mi += S.main) { const r = P.R(mi); if (r > 6 && r < P.reach - 8) list.push(mi); }
    const inCircle = (x, y, pad) => this.circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + pad);
    // lettering and the reserved boxes (the center and the origin's label)
    const hitsAny = (x, y, pad) => e.placed.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad);
    const TARGET = 40 * D2R; // the book's spoke for ring labels (lower right of the center)
    const around = (k) => TARGET + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * D2R;
    ctx.font = RING_SIZE + 'px ' + FONT;
    const halfOf = (mi) => (ctx.measureText(ringText(mi)).width / 2 + 16) / P.R(mi);
    // passes: open water clear of the circles, then all on land, then the same over a circle; never across a coast,
    // and always clear of all lettering
    // (last resort: across a coast, set on a paper patch so the lines under it fade away)
    const clearArc = (r, a, half, [onLand, overCircle]) => {
      for (let t = -half; t <= half; t += 3 / r) for (const dr of [-18, -9, 0, 9, 18]) {
        const x = P.cx + Math.cos(a + t) * (r + dr), y = P.cy + Math.sin(a + t) * (r + dr);
        if (!inShape(P.shape, x, y, 14) || (onLand !== null && isLand(x, y) !== onLand) || hitsAny(x, y, 6) || (!overCircle && inCircle(x, y, 4))) return false;
      }
      return true;
    };
    const angle = {}, patch = {};
    if (show) for (const onLand of [[false, false], [true, false], [false, true], [true, true], [null, true]]) {
      const todo = list.filter((mi) => angle[mi] == null);
      if (!todo.length) break;
      let shared = null;
      for (let k = 0; k < 160 && shared === null; k++) if (todo.every((mi) => clearArc(P.R(mi), around(k), halfOf(mi), onLand))) shared = around(k);
      for (const mi of todo) {
        let best = shared;
        for (let k = 0; best === null && k < 360; k++) if (clearArc(P.R(mi), around(k), halfOf(mi), onLand)) best = around(k);
        angle[mi] = best;
        if (best !== null && onLand[0] !== false) patch[mi] = true; // on land or across a coast: borders may run under it
      }
    }
    const labelled = (mi) => show && angle[mi] != null;
    // faint rings
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape);
    for (const b of texts) ctx.rect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8);
    for (const mi of list) if (labelled(mi)) {
      const r = P.R(mi), a = angle[mi], hw = ctx.measureText(ringText(mi)).width / 2 + 14;
      ctx.moveTo(P.cx + Math.cos(a) * (r + 8) + hw, P.cy + Math.sin(a) * (r + 8)); ctx.arc(P.cx + Math.cos(a) * (r + 8), P.cy + Math.sin(a) * (r + 8), hw, 0, Math.PI * 2);
    }
    ctx.clip('evenodd');
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.1; ctx.setLineDash([5, 7]); ctx.lineCap = 'round';
    for (let mi = S.faint; mi / EARTH_MI < P.maxC; mi += S.faint) {
      if (mi % S.main === 0) continue;
      const r = P.R(mi); if (r < 3) continue; if (r > P.reach) break;
      ctx.beginPath(); ctx.arc(P.cx, P.cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
    // main rings: dashed crayon, broken around lettering and the ring's own label
    ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
    art.batch(() => { for (const mi of list) {
      const r = P.R(mi), la = angle[mi] ?? 0, gap = labelled(mi) ? (ctx.measureText(ringText(mi)).width / 2 + 12) / r : 0;
      const dash = 16 / r, space = 10 / r;
      for (let t = la + gap; t < la + 2 * Math.PI - gap - dash * 0.5; t += dash + space) {
        const end = Math.min(t + dash, la + 2 * Math.PI - gap), pts = [];
        for (let u = t; u <= end + 1e-9; u += (end - t) / 5) pts.push([P.cx + Math.cos(u) * r, P.cy + Math.sin(u) * r]);
        if (!pts.some(([x, y]) => inShape(P.shape, x, y, -20)) || pts.some(([x, y]) => hitsLabel(x, y, 3))) continue;
        art.crayon(pts, { color: INK, width: 1.7, alpha: 0.72, passes: 2, wobble: 0.4, crumple: 0.5, breakProb: 0.03, step: 3, jitter: 0.4 });
      }
    } });
    ctx.restore();
    if (!show) return () => {};
    // labels (lettered after the coasts and borders, so no line crosses them): tangent to the ring and straddling it, turned over in the top half so they never read upside down
    const labelOnRing = (text, r, a, size, onPatch = false) => {
      const flip = Math.sin(a) < -0.05, rr = flip ? r - size * 0.36 : r + size * 0.36;
      const x = P.cx + Math.cos(a) * rr, y = P.cy + Math.sin(a) * rr, hw = art.textWidth(text, size) / 2 + 4, rot = a - Math.PI / 2 + (flip ? Math.PI : 0);
      if (onPatch) { // a paper patch, as under place labels, so no line runs through the lettering
        ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = 0.78; ctx.fillStyle = PAPER;
        roundRect(ctx, -hw - 3, -size * 0.82, 2 * hw + 6, size * 1.08, 6); ctx.fill(); ctx.restore();
      }
      art.scrawl(text, x, y, { size, color: INK, align: 'center', rot, font: FONT });
      // the turned label's bounding box (its baseline runs along rot; letters rise about 0.75 size above it)
      const ux = Math.cos(rot), uy = Math.sin(rot), vx = Math.sin(rot), vy = -Math.cos(rot), xs = [], ys = [];
      for (const [u, v] of [[-hw, -0.25 * size], [hw, -0.25 * size], [-hw, 0.8 * size], [hw, 0.8 * size]]) { xs.push(x + ux * u + vx * v); ys.push(y + uy * u + vy * v); }
      ringBoxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), text: null });
    };
    return () => {
      for (const mi of list) if (labelled(mi)) labelOnRing(ringText(mi), P.R(mi), angle[mi], RING_SIZE, !!patch[mi]);
      // the disk's edge is the 90-degree ring: halfway to the far side of the Earth
      if (P.shape.type === 'circle') {
        const a = Object.values(angle).find((v) => v != null) ?? 125 * D2R;
        labelOnRing(`${fmt(Math.round(EARTH_MI * P.maxC / 10) * 10)} MI (HALFWAY)`, P.shape.r + 34, a, 20);
      }
    };
  }

  // ---------------- places the reader added ----------------
  // The base class draws the star, every place on the map, and the shortest routes (straight lines through the
  // center, since every great circle through the center is a straight line here). A place beyond the frame gets an
  // orange arrow on the frame's edge, along its true bearing (directions from the center are true), with its miles.
  // The off-map arrows and labels are planned first, so the on-map place labels keep clear of them.
  hardBoxes() { return [...(this.ringBoxes || []), ...(this.offBoxes || [])]; }

  // the shortest route: straight out from the center along the place's bearing, only as far as the map reaches.
  // The point opposite the center (the antipode) is reached by every bearing, so it gets no route.
  routeOf(origin, p) {
    const d = distanceMi(origin, p) / EARTH_MI;
    if (d < 1e-9 || d > ANTI) return null;
    const az = headingDeg(origin, p) * D2R, end = Math.min(d, this.view.panels[0].maxC + 0.02), n = Math.max(2, Math.ceil(end / D2R));
    return Array.from({ length: n + 1 }, (_, i) => { const q = dest(origin, (end * i) / n, az); return [q.lon, q.lat]; });
  }

  // where each off-map place's arrow and label go: { p, x, y, dx, dy, label: box | null, anti }
  planOffMap(places) {
    const V = this.view, P = V.panels[0], o = this.origin, show = this.showLabels;
    const box = (x, y, h) => ({ x0: x - h, y0: y - h, x1: x + h, y1: y + h });
    const over = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    // hard: never covered (ring labels, the origin and its label, every place dot, other off-map arrows and labels);
    // soft: the map's lettering, covered only when nothing else fits (then the least of it)
    const hard = [...(this.ringBoxes || []), this.originLabelBox(P), box(P.cx, P.cy, 22)];
    for (const p of places) { const q = this.locate(p); if (q) hard.push(box(q.x, q.y, 14)); }
    const soft = this.placedLabels || [];
    const hitsHard = (b) => hard.some((q) => over(b, q) > 0), softArea = (b) => soft.reduce((s, q) => s + over(b, q), 0);
    const art = createArt(document.createElement('canvas'), { width: 8, height: 8, seed: 1 });
    const plan = [];
    // keep room for each on-map place's own label beside its dot, found the way drawPlaceLayer will look for it,
    // so an off-map arrow or label never pushes it away from its dot (as near the frame's edge)
    if (show) {
      const taken = [...(this.ringBoxes || []), this.originLabelBox(P), box(P.cx, P.cy, 14)];
      const clash = (c) => taken.some((b) => c.x0 < b.x1 + 4 && c.x1 > b.x0 - 4 && c.y0 < b.y1 + 2 && c.y1 > b.y0 - 2);
      const lettered = (c) => soft.some((b) => c.x0 < b.x1 && c.x1 > b.x0 && c.y0 < b.y1 && c.y1 > b.y0);
      const inside = (c) => c.x0 > EDGE + 4 && c.x1 < V.W - EDGE - 4 && c.y0 > EDGE + 4 && c.y1 < V.H - EDGE - 4;
      for (const p of places) {
        const q = this.locate(p);
        if (!q) continue;
        const name = (p.short || p.name.split(',')[0]).toUpperCase(), dist = fmt(distanceMi(o, p)) + ' MI';
        const w = Math.max(art.textWidth(name, 22), art.textWidth(dist, 17)), h = 22 + 17 + 6;
        const dx = q.x - V.W / 2, side = Math.hypot(dx, q.y - V.H / 2) > 1 && dx < 0 ? -1 : 1, cands = [];
        for (const g of [14, 44, 80]) for (const [sx, sy] of [[side, 0], [-side, 0], [0, -1], [0, 1], [side, -1], [side, 1], [-side, -1], [-side, 1]]) {
          const bx = sx > 0 ? q.x + g : sx < 0 ? q.x - g - w : q.x - w / 2, by = sy < 0 ? q.y - g - h : sy > 0 ? q.y + g : q.y - h / 2 - 2;
          cands.push({ x0: bx, y0: by, x1: bx + w, y1: by + h, far: g > 30 });
        }
        const c = cands.find((k) => inside(k) && !clash(k) && !lettered(k)) || cands.find((k) => inside(k) && !clash(k)); // (pickLabelBox's order)
        if (!c) continue;
        taken.push(c);
        hard.push({ x0: c.x0 - 5, y0: c.y0 - 2, x1: c.x1 + 5, y1: c.y1 + 4 });
      }
    }
    // where the arrow can go along bearing az: on the frame's edge (on a disk, just outside the rim), else stepped
    // in along the ray; the first spot clear of everything, else clear of the hard boxes (ok 2, 1, 0).
    const spotOn = (az) => {
      const dx = Math.sin(az), dy = -Math.cos(az), m = 30;
      let ts;
      if (P.shape.type === 'circle') ts = [P.shape.r + 18, ...Array.from({ length: 8 }, (_, i) => P.shape.r - 24 - 34 * i)];
      else {
        const s = P.shape, e = [];
        if (dx > 1e-9) e.push((s.x1 - m - P.cx) / dx); if (dx < -1e-9) e.push((s.x0 + m - P.cx) / dx);
        if (dy > 1e-9) e.push((s.y1 - m - P.cy) / dy); if (dy < -1e-9) e.push((s.y0 + m - P.cy) / dy);
        const t0 = Math.min(...e);
        ts = Array.from({ length: 21 }, (_, i) => t0 - 10 * i);
      }
      const at = (t) => box(P.cx + dx * t, P.cy + dy * t, 16);
      let t = ts.find((tt) => !hitsHard(at(tt)) && !softArea(at(tt))), ok = 2;
      if (t == null) { t = ts.find((tt) => !hitsHard(at(tt))); ok = 1; }
      if (t == null) { t = ts[0]; ok = 0; }
      return { t, ok, dx, dy, b: at(t) };
    };
    // the antipode last: every bearing leads there, so its arrow takes the clearest of a few bearings
    const off = places.filter((p) => !this.locate(p)).map((p) => ({ p, anti: distanceMi(o, p) / EARTH_MI > ANTI }));
    off.sort((a, b) => a.anti - b.anti);
    for (const { p, anti } of off) {
      let sp;
      if (!anti) sp = spotOn(headingDeg(o, p) * D2R);
      else for (const deg of [135, 225, 45, 315, 165, 195, 105, 255, 75, 285, 15, 345]) {
        const q = spotOn(deg * D2R);
        if (!sp || q.ok > sp.ok) sp = q;
        if (sp.ok === 2) break;
      }
      const { t, dx, dy } = sp;
      hard.push(sp.b);
      const x = P.cx + dx * t, y = P.cy + dy * t, item = { p, x, y, dx, dy, anti, label: null };
      plan.push(item);
      if (!show) continue;
      const name = (p.short || p.name.split(',')[0]).toUpperCase();
      const dist = anti ? fmt(distanceMi(o, p)) + ' MI, ANY DIRECTION' : fmt(distanceMi(o, p)) + ' MI, OFF THE MAP';
      const s1 = 22, s2 = 17, w = Math.max(art.textWidth(name, s1), art.textWidth(dist, s2)), h = s1 + s2 + 6;
      // inward from the arrow, then farther in or sideways: the first spot clear of everything, else the one that
      // covers the least lettering
      const nx = -dy, ny = dx, back = 22 + 0.5 * (Math.abs(dx) * w + Math.abs(dy) * h), cands = [];
      for (const extra of [0, 40, 80, 130, 190]) for (const side of [0, 1, -1, 2, -2, 3, -3]) {
        const bx = Math.max(EDGE + 8, Math.min(V.W - EDGE - 8 - w, x - dx * (back + extra) + nx * side * 40 - w / 2));
        const by = Math.max(EDGE + 8, Math.min(V.H - EDGE - 8 - h, y - dy * (back + extra) + ny * side * 40 - h / 2));
        cands.push({ x0: bx - 5, y0: by - 2, x1: bx + w + 5, y1: by + h + 4, bx, by });
      }
      const ok = cands.filter((c) => !hitsHard(c));
      let pick = ok.find((c) => !softArea(c));
      if (!pick && ok.length) pick = ok.reduce((a, b) => (softArea(b) < softArea(a) ? b : a));
      pick = pick || cands[0];
      hard.push(pick);
      item.label = { ...pick, name, dist, s1, s2, w, h };
    }
    return plan;
  }

  drawPlaces(places, opts = {}) {
    if (!this.view) return super.drawPlaces(places, opts);
    const V = this.view, hl = opts.highlight ?? null;
    const plan = this.planOffMap(places);
    this.offBoxes = plan.flatMap((q) => [{ x0: q.x - 16, y0: q.y - 16, x1: q.x + 16, y1: q.y + 16 }, ...(q.label ? [q.label] : [])]);
    super.drawPlaces(places, opts);
    this.offBoxes = [];
    for (const { p, x, y, dx, dy, label } of plan) {
      const hot = hl === p.id;
      const art = createArt(this.overlay, { width: V.W, height: V.H, seed: seedOfPlace(p) }), { ctx, crayon, hatchFill, scrawl } = art;
      // arrowhead pointing out of the map
      const nx = -dy, ny = dx, tip = [x + dx * 12, y + dy * 12], b1 = [x - dx * 8 + nx * 10, y - dy * 8 + ny * 10], b2 = [x - dx * 8 - nx * 10, y - dy * 8 - ny * 10];
      hatchFill(() => { ctx.moveTo(...tip); ctx.lineTo(...b1); ctx.lineTo(...b2); ctx.closePath(); }, [x - 14, y - 14, 28, 28],
        [{ angle: 30, spacing: 1.4, colors: ORANGE, alpha: 0.95, width: 1.8 }, { angle: -50, spacing: 2, colors: ORANGE, alpha: 0.7, width: 1.6 }]);
      crayon([tip, b1, b2, tip], { color: INK, width: 1.6, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
      if (hot) crayon(art.wobblyEllipse(x, y, 18, 18, 0, 0.4, 0.06), { color: INK, width: 1.6, alpha: 0.8, passes: 2, wobble: 0.6, step: 3 });
      this.placeHits.push({ id: p.id, x, y });
      if (!label) continue;
      const { bx, by, w, h, s1, s2, name, dist } = label;
      ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = PAPER; roundRect(ctx, bx - 5, by - 2, w + 10, h + 6, 6); ctx.fill(); ctx.restore();
      scrawl(name, bx + w / 2, by + s1 - 1, { size: s1, color: INK, font: FONT, align: 'center' });
      scrawl(dist, bx + w / 2, by + s1 + s2 + 3, { size: s2, color: INK, font: FONT, align: 'center', alpha: 0.8 });
    }
  }
}
