// Flat Earth website: Santa's maps, the polar azimuthal equidistant projection, drawn in crayon.
// Follows the book's santa-map.js (pages P2a and P2b): each half of the world is a disk centered on a pole and
// reaching out to the equator. Dashed latitude rings every 30 degrees (labeled 60° N, 30° N), faint rings every 10,
// faint meridian spokes every 30 with their longitudes just outside the rim, Santa's hat on the North Pole, a dot on
// the South Pole, and a dark dashed line from the pole straight out through the reader's place (DUE SOUTH on the
// top half, DUE NORTH on the bottom half).
//
// As in the book, the map is turned so the reader's meridian points straight down on the top half (State College is
// "straight down from the pole") and straight up on the bottom half. So the origin sets the turn, not the center.
//
// Scales:
//   both    the top half and the bottom half side by side (the book's P2a and P2b), each out to the equator
//   north   one big disk: the North Pole in the middle, the equator at the edge
//   south   the same from the South Pole
// The shared steps (paper, water, land, coasts, lettering, places) come from map-common.js; this file has the
// projection, the panels and the polar overlays.
import { INK, FONT } from './crayon.js';
import { BaseMap, MAP_W, PAPER, renderBase, landMask, seedOf, shapePath, roundRect, inShape, geoForward, displayName, fmt, D2R, HALF_EARTH_MI, toV, ang, greatCircle } from './map-common.js';

export const SCALES = [
  { id: 'both', label: 'Both halves' },
  { id: 'north', label: 'Top half (North Pole)' },
  { id: 'south', label: 'Bottom half (South Pole)' },
];
const W = MAP_W;
const MI_PER_DEG = HALF_EARTH_MI / 180;                 // 69.1 miles per degree of latitude
const HALF_MI = Math.round(HALF_EARTH_MI / 10) * 10;    // 12,440: pole to pole
const wrap = (lon) => ((lon + 540) % 360) - 180;
const latText = (lat) => (lat === 0 ? 'EQUATOR' : Math.abs(lat) + '° ' + (lat > 0 ? 'N' : 'S'));
const lonText = (lon) => (lon === 0 ? '0°' : Math.abs(lon) === 180 ? '180°' : Math.abs(lon) + '° ' + (lon < 0 ? 'W' : 'E'));
const poleMi = (lat, pole) => Math.round((90 - pole * lat) * MI_PER_DEG / 10) * 10; // along the meridian from that pole
// a place on the equator is on the edge of both halves (EPS: rounding, in degrees)
const EPS = 1e-6;
const onHalf = (lat, pole) => pole * lat >= -EPS;
const onEquator = (lat) => Math.abs(lat) <= EPS;

// lettering sizes (logical px) for the two-disk view and the single big disk
const SIZES = {
  both: { ring: 21, merid: 17, meridOff: 20, pole: 19, poleSub: 15, due: 20, dueSub: 16, ocean: 18, oceanSp: 5, hat: 0.42, title: 30, note: 17 },
  one: { ring: 24, merid: 20, meridOff: 26, pole: 22, poleSub: 17, due: 24, dueSub: 18, ocean: 26, oceanSp: 7, hat: 0.6, rimNote: 22 },
};
// Ocean names, as in santa-overrides.js, with a few fallback spots each: the map turns with the reader's place, so
// a spot that is open water for one turn may put the (always level) lettering across land for another.
// [text, scale of the ocean size, [[lon, lat], ...]]
const OCEANS = {
  1: [
    ['ARCTIC OCEAN', 0.7, [[150, 79], [-150, 78], [100, 80], [-30, 84], [60, 82], [-100, 80]]],
    ['PACIFIC OCEAN', 1, [[-160, 22], [-150, 12], [-170, 32], [-140, 25], [170, 25], [-130, 12], [160, 15]]],
    ['ATLANTIC OCEAN', 1, [[-40, 25], [-35, 18], [-45, 32], [-30, 10], [-50, 15], [-25, 30]]],
  ],
  [-1]: [
    ['SOUTHERN OCEAN', 0.8, [[150, -62], [30, -58], [-90, -62], [-150, -62], [90, -60], [-30, -58]]],
    ['PACIFIC OCEAN', 1, [[-130, -30], [-120, -20], [-140, -40], [-160, -15], [-110, -40]]],
    ['ATLANTIC OCEAN', 1, [[-15, -30], [-20, -20], [-10, -40], [0, -25], [-25, -35]]],
    ['INDIAN OCEAN', 1, [[80, -30], [75, -20], [90, -35], [70, -40], [95, -20]]],
  ],
};

let mctx = null;
const textW = (t, size) => { mctx ??= document.createElement('canvas').getContext('2d'); mctx.font = `${size}px ${FONT}`; return mctx.measureText(t).width; };
const spacedW = (t, size, sp) => { let w = 0; for (const ch of t) w += textW(ch, size); return w + sp * (t.length - 1); };
const hitBox = (b, x, y, pad = 0) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad;
// boxes covering a line of lettering turned by rot about its baseline anchor (x, y), centered there: one small
// axis-aligned box per stretch of about one letter height, so a slanted name does not claim a big square
const turnedBoxes = (x, y, w, size, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot), n = Math.max(1, Math.ceil(w / size)), out = [];
  for (let i = 0; i < n; i++) {
    const u0 = -w / 2 + (w * i) / n, u1 = u0 + w / n, pts = [[u0, -size * 0.75], [u1, -size * 0.75], [u0, size * 0.25], [u1, size * 0.25]].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
    out.push({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])), rim: true });
  }
  return out;
};
const overlap = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
// where a ring label's lettering goes: straddling the ring, turned along it, and turned over in the top half of the
// disk so it never reads upside down. Returns the baseline anchor and the turn.
const ringText = (P, L, size) => {
  const flip = Math.sin(L.a) < -0.05, rr = flip ? L.r - size * 0.36 : L.r + size * 0.36;
  return { x: P.cx + Math.cos(L.a) * rr, y: P.cy + Math.sin(L.a) * rr, rot: L.a - Math.PI / 2 + (flip ? Math.PI : 0) };
};

// ---------- the projection ----------
// One polar disk. pole = 1 (North Pole in the middle) or -1 (South Pole). lon0 = the meridian that points straight
// down (north) or straight up (south). R = the rim's radius in px, which is the equator: 90 degrees from the pole.
// The book's makeProj with lat0 = +-90: x = c sin(dl), and down the page = c cos(dl) (north) or up it (south),
// where c is the angular distance from the pole. Distances from the pole are true: 1 degree of latitude = R / 90 px.
function polarPanel(pole, lon0, cx, cy, R) {
  const k = R / 90;
  const fwd = (lon, lat) => {
    const rho = (90 - pole * lat) * k, dl = (lon - lon0) * D2R;
    return [cx + rho * Math.sin(dl), cy + pole * rho * Math.cos(dl)];
  };
  const inverse = (x, y) => {
    const dx = x - cx, dy = y - cy, rho = Math.hypot(dx, dy) / k;
    if (rho > 90 + 1e-9) return null;
    const dl = rho < 1e-9 ? 0 : Math.atan2(dx, pole * dy) / D2R;
    return [wrap(lon0 + dl), pole * (90 - rho)];
  };
  // screen angle (radians, clockwise from +x) of a meridian
  const angleOf = (lon) => { const dl = (lon - lon0) * D2R; return Math.atan2(pole * Math.cos(dl), Math.sin(dl)); };
  const shape = { type: 'circle', cx, cy, r: R };
  const geo = { type: 'cap', center: { lon: lon0, lat: 90 * pole }, maxC: Math.PI / 2, fwd, rim: { cx, cy, r: R } };
  return { pole, lon0, cx, cy, R, k, shape, geo, inverse, angleOf, polar: fwd, fwd: geoForward(geo), rOf: (lat) => (90 - pole * lat) * k };
}

// ---------- Santa's hat (santa-map.js santaHat), for the North Pole ----------
// A red crayon cone flopping over to the left, a white fur band and a white pompom, tilted a little. Returns its box.
const HAT = { left: 78, right: 64, top: 74, bottom: 50 };
function santaHat(art, layPaper, cx, cy, s = 1, tilt = 6 * D2R) {
  const { ctx, crayon, hatchFill } = art;
  const rot = ([x, y]) => [cx + s * (x * Math.cos(tilt) - y * Math.sin(tilt)), cy + s * (x * Math.sin(tilt) + y * Math.cos(tilt))];
  const curve = (p0, c, p1, n = 24) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); } return o; };
  const path = (pts) => () => { pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  const boxOf = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); const x0 = Math.min(...xs) - 4, y0 = Math.min(...ys) - 4; return [x0, y0, Math.max(...xs) - x0 + 8, Math.max(...ys) - y0 + 8]; };
  const cone = [...curve([46, 22], [34, -58], [-18, -60]), ...curve([-18, -60], [-46, -62], [-54, -30]).slice(1),
    ...curve([-54, -30], [-36, -46], [-14, -36]).slice(1), ...curve([-14, -36], [-24, -6], [-46, 22]).slice(1)].map(rot);
  const band = [];
  for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + i / 40 * Math.PI; band.push([39 + 15 * Math.cos(a), 31 + 15 * Math.sin(a)]); }
  for (let i = 0; i <= 40; i++) { const a = Math.PI / 2 + i / 40 * Math.PI; band.push([-39 + 15 * Math.cos(a), 31 + 15 * Math.sin(a)]); }
  const bandPts = band.map(rot), [px, py] = rot([-55, -24]), pom = art.wobblyEllipse(px, py, 16 * s, 15 * s, 0, 0.3, 0.12);
  // clear the water under the whole hat so the colors sit on paper
  ctx.save(); ctx.beginPath(); path(cone)(); path(bandPts)(); ctx.moveTo(px + 17 * s, py); ctx.arc(px, py, 17 * s, 0, 2 * Math.PI); ctx.clip(); layPaper(); ctx.restore();
  const RED = ['#c8382c', '#d4463a', '#b9302a'], WHITE = ['#fffdf7', '#fbf6ea'], FUR_SHADE = ['#c9c2b4'];
  hatchFill(path(cone), boxOf(cone), [{ angle: 35, spacing: 2.2, colors: RED, alpha: 0.92, width: 2.2, step: 4 }, { angle: -28, spacing: 4, colors: ['#9e2620'], alpha: 0.35, width: 1.8, step: 4 }]);
  crayon([...cone, cone[0]], { color: INK, width: 1.9, alpha: 0.9, passes: 2, wobble: 0.4, crumple: 0.5, step: 3 });
  for (const pts of [bandPts, pom]) {
    hatchFill(path(pts), boxOf(pts), [{ angle: 20, spacing: 2.2, colors: WHITE, alpha: 0.85, width: 2.2, step: 4 }, { angle: -40, spacing: 6, colors: FUR_SHADE, alpha: 0.35, width: 1.6, step: 5 }]);
    crayon([...pts, pts[0]], { color: INK, width: 1.8, alpha: 0.88, passes: 2, wobble: 0.6, crumple: 0.8, step: 3 });
  }
}
const hatBox = (cx, cy, s) => ({ x0: cx - HAT.left * s, y0: cy - HAT.top * s, x1: cx + HAT.right * s, y1: cy + HAT.bottom * s });
// the South Pole: the book's hatched dot in a hand-drawn ring
function poleDot(art, cx, cy, r = 7) {
  const { ctx, crayon, hatchFill } = art;
  hatchFill(() => ctx.arc(cx, cy, r, 0, Math.PI * 2), [cx - r - 1, cy - r - 1, 2 * r + 2, 2 * r + 2], [
    { angle: 30, spacing: 1.5, colors: [INK], alpha: 0.95, width: 1.8 }, { angle: -50, spacing: 1.9, colors: [INK], alpha: 0.8, width: 1.8 }]);
  crayon(art.wobblyEllipse(cx, cy, r * 2.4, r * 2.4, 0, 0.3, 0.05), { color: INK, width: 1.9, alpha: 0.85, passes: 2, wobble: 0.5, step: 3 });
}

export class PolarMap extends BaseMap {
  constructor(base, overlay, data) {
    super(base, overlay, data);
    this.originMark = 'star'; this.originSub = null; // the reader's place is a star; the poles are the centers
  }

  async prepare(origin, scale = 'both') {
    if (!SCALES.some((s) => s.id === scale)) scale = 'both';
    this.origin = origin;
    this.view = this.buildView(origin, scale);
    return { scale, title: this.view.title, ...this.describe(origin, scale) };
  }

  buildView(origin, scale) {
    const lon0 = origin.lon, home = origin.lat >= 0 ? 1 : -1;
    if (scale === 'both') {
      const R = 365, cy = 530, H = 980;
      const panels = [polarPanel(1, lon0, 450, cy, R), polarPanel(-1, lon0, 1350, cy, R)];
      return { scale, W, H, panels, S: SIZES.both, home, title: 'THE TWO HALVES', labelRank: 5, sizes: [11, 26],
        heads: [['THE TOP HALF', 'THE EDGE IS THE EQUATOR'], ['THE BOTTOM HALF', 'THE EDGE IS THE EQUATOR']] };
    }
    const pole = scale === 'north' ? 1 : -1;
    return { scale, W, H: W, panels: [polarPanel(pole, lon0, W / 2, W / 2, 780)], S: SIZES.one, home,
      title: pole > 0 ? 'THE TOP HALF' : 'THE BOTTOM HALF', labelRank: 6, sizes: [12, 32] };
  }

  // the heading text beside the map, in the book's voice
  describe(o, scale) {
    const name = displayName(o), short = o.short || name.split(',')[0], north = o.lat >= 0, eq = onEquator(o.lat);
    const fromN = fmt(poleMi(o.lat, 1)), fromS = fmt(poleMi(o.lat, -1));
    // where the place is, from one pole (the place's own half), in the book's voice
    const where = (pole) => {
      if (eq) return ` is on the equator, right on the edge of both halves: ${pole > 0 ? fromN : fromS} miles from each pole.`;
      if (poleMi(o.lat, pole) === 0) return pole > 0 ? ' is right at the North Pole, where Santa’s workshop is.' : ' is right at the South Pole.';
      return pole > 0 ? ` is ${fromN} miles due south of Santa’s workshop.` : ` is ${fromS} miles due north of the South Pole.`;
    };
    const legend = 'Rings every 30 degrees of latitude; faint rings every 10. Spokes every 30 degrees of longitude.';
    if (scale === 'both') return {
      subtitle: 'DISTANCES FROM THE POLES', legend,
      prose: ['This is how Santa sees the world. The top half is centered on the North Pole and the bottom half on the South Pole. ' +
        'The edge of each half is the equator. ', { strong: name }, north || eq ? where(1)
        : poleMi(o.lat, -1) === 0 ? ' is right at the South Pole, in the middle of the bottom half.' : ` is in the bottom half, ${fromS} miles due north of the South Pole.`],
    };
    if (scale === 'north') return {
      subtitle: 'DISTANCES FROM THE NORTH POLE', legend,
      prose: ['The northern half of the world, the way Santa sees it. From his workshop at the North Pole, every direction is south. ' +
        'About two thirds of the world’s land is in this half. The edge is the equator.', ...(onHalf(o.lat, 1) ? [' ', { strong: name }, where(1)] : [])],
      note: onHalf(o.lat, 1) ? '' : `${short} is south of the equator, so it is not on the top half. The dashed line points due south toward it. Pick the bottom half to see it.`,
    };
    return {
      subtitle: 'DISTANCES FROM THE SOUTH POLE', legend,
      prose: ['The southern half of the world, seen from below the South Pole. From the South Pole, every direction is north. ' +
        'Only about a third of the world’s land is down here. The edge is the equator.', ...(onHalf(o.lat, -1) ? [' ', { strong: name }, where(-1)] : [])],
      note: onHalf(o.lat, -1) ? '' : `${short} is north of the equator, so it is not on the bottom half. The dashed line points due north toward it. Pick the top half to see it.`,
    };
  }

  // A line for the page's note about added places that are not on the half shown (single-disk views only), e.g.
  // 'Lima is on the bottom half.' The page calls this after every change to the places (optional hook).
  placesNote(places) {
    const scale = this.view?.scale;
    if (scale !== 'north' && scale !== 'south') return '';
    const pole = scale === 'north' ? 1 : -1, other = pole > 0 ? 'bottom' : 'top';
    const off = places.filter((p) => !onHalf(p.lat, pole)).map((p) => p.short || p.name.split(',')[0]);
    if (!off.length) return '';
    const list = off.length === 1 ? off[0] : off.length === 2 ? `${off[0]} and ${off[1]}` : `${off.slice(0, -1).join(', ')} and ${off[off.length - 1]}`;
    return `${list} ${off.length === 1 ? 'is' : 'are'} on the ${other} half.`;
  }

  // ---------------- layout that must be known before the country lettering ----------------
  // Per panel: the pole marker and its label, and (on the half that holds the place, or on a single disk) the
  // dashed line from the pole along the place's meridian with its DUE SOUTH / DUE NORTH label.
  layout(origin) {
    const V = this.view, S = V.S, show = this.showLabels, single = V.panels.length === 1;
    for (const P of V.panels) {
      const { cx, cy, R, pole } = P;
      P.marks = []; P.letters = [];
      // when the reader's place is the pole itself and has the pole's name, its own label names it: no second one
      const markR = pole > 0 ? HAT.bottom * S.hat + 4 : 22, poleName = pole > 0 ? 'NORTH POLE' : 'SOUTH POLE';
      const named = onHalf(origin.lat, pole) && P.rOf(origin.lat) < markR + 12 && (origin.short || origin.name.split(',')[0]).trim().toUpperCase() === poleName;
      // pole marker: the hat (north) or a dot (south), and its name
      if (pole > 0) {
        const b = hatBox(cx, cy, S.hat); P.marks.push(b); P.markR = markR;
        if (show && !named) {
          const t = 'NORTH POLE', w = textW(t, S.pole), x = b.x1 + 8, y = cy + S.hat * 18;
          P.letters.push({ x0: x, y0: y - S.pole * 0.75, x1: x + w, y1: y + S.pole * 0.25, text: t, size: S.pole, align: 'left', ax: x, by: y });
        }
      } else {
        P.marks.push({ x0: cx - 19, y0: cy - 19, x1: cx + 19, y1: cy + 19 }); P.markR = markR;
        if (show) {
          const t = 'SOUTH POLE', w = textW(t, S.pole), y = cy + 46;
          if (!named) P.letters.push({ x0: cx - w / 2, y0: y - S.pole * 0.75, x1: cx + w / 2, y1: y + S.pole * 0.25, text: t, size: S.pole, align: 'center', ax: cx, by: y });
          const t2 = fmt(HALF_MI) + ' MI FROM SANTA’S WORKSHOP', w2 = textW(t2, S.poleSub), y2 = y + S.poleSub + 8;
          P.letters.push({ x0: cx - w2 / 2, y0: y2 - S.poleSub * 0.75, x1: cx + w2 / 2, y1: y2 + S.poleSub * 0.25, text: t2, size: S.poleSub, align: 'center', ax: cx, by: y2, alpha: 0.75 });
        }
      }
      // the line from the pole out through the place
      // (none when the place is at the pole itself, under the hat or the dot: the line would point nowhere)
      P.due = null;
      const onDisk = onHalf(origin.lat, pole), d = onDisk ? P.rOf(origin.lat) : R; // the place's distance from the pole, px
      if ((single || pole === V.home) && !(onDisk && d < P.markR + 12)) {
        const dir = pole; // +1: straight down the page (north half), -1: straight up (south half)
        P.due = { dir, onDisk, d, corridor: { x0: cx - 11, x1: cx + 11, y0: dir > 0 ? cy + P.markR : cy - R, y1: dir > 0 ? cy + R : cy - P.markR } };
        if (show) {
          const t1 = pole > 0 ? 'DUE SOUTH' : 'DUE NORTH', short = (origin.short || origin.name.split(',')[0]).toUpperCase();
          const t2 = onDisk ? fmt(poleMi(origin.lat, pole)) + ' MI' : 'TOWARD ' + short;
          const w = Math.max(textW(t1, S.due), textW(t2, S.dueSub)), h = S.due + S.dueSub + 6;
          // along the stretch from the pole to the place first (as the book's 3,400 MI), then past it
          const tries = [];
          const span = (a, b) => { for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) tries.push(a + (b - a) * f); };
          if (onDisk) { span(P.markR + 10, d - 26); span(d + 30, R - 20); } else span(P.markR + 10, R - 20);
          const avoid = [...P.marks, ...P.letters];
          let best = null;
          place: for (const t of tries) for (const side of [-1, 1]) {
            const yc = cy + dir * t, x0 = side < 0 ? cx - 22 - w : cx + 22;
            const b = { x0, x1: x0 + w, y0: yc - h / 2, y1: yc + h / 2 };
            if (![[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => inShape(P.shape, x, y, 10))) continue;
            if (avoid.some((o) => overlap(b, o, 6))) continue;
            if (onDisk && overlap(b, { x0: cx - 26, x1: cx + 26, y0: cy + dir * d - 26, y1: cy + dir * d + 26 })) continue; // the star
            best = { b, side }; break place;
          }
          if (best) {
            const { b, side } = best, ax = side < 0 ? b.x1 : b.x0, align = side < 0 ? 'right' : 'left';
            P.letters.push({ ...b, y1: b.y0 + S.due + 2, text: t1, size: S.due, align, ax, by: b.y0 + S.due - 1, due: true });
            P.letters.push({ ...b, y0: b.y0 + S.due + 2, text: t2, size: S.dueSub, align, ax, by: b.y1 - 2, alpha: 0.8, due: true });
          }
        }
      }
    }
  }

  // ---------------- the base map ----------------
  drawBase(origin) {
    this.origin = origin;
    const V = this.view;
    this.layout(origin);
    const reserve = V.panels.flatMap((P) => [...P.marks, ...P.letters, ...(P.due ? [P.due.corridor] : [])]);
    const extra = []; // lettering boxes this file adds (oceans, rings), for the places overlay to stay off
    const env = renderBase(this, {
      seed: seedOf('santa' + V.scale + origin.name + origin.lat.toFixed(2) + origin.lon.toFixed(2)),
      labelRank: V.labelRank, lakeRank: 3, sizes: V.sizes, reserve,
      hooks: {
        // (renderBase copies `reserve` after afterWater, so the ocean names and ring labels placed here win their
        // spots before the country names are chosen: the rings are the point of this map)
        afterWater: (env) => this.placeOverlays(env, reserve, extra),
        beforeLines: (env) => this.gridAndRings(env, extra),
        afterLines: (env) => this.poleMarks(env),
        afterText: (env) => this.lettering(env, extra),
      },
    });
    this.placedLabels = [...env.texts, ...extra, ...V.panels.flatMap((P) => P.letters)];
  }

  // ocean names, then the ring labels, kept off the pole marks, the DUE line and its label
  placeOverlays(env, reserve, extra) {
    const V = this.view, S = V.S;
    for (const P of V.panels) { P.oceans = []; P.ringLabels = []; P.ringHard = []; }
    if (!env.show) return;
    const isLand = landMask(env.W, env.H, V.panels); // (renderBase makes its own right after this hook)
    for (const P of V.panels) {
      const keepOut = [...reserve];
      const clear = (x, y, pad) => !keepOut.some((b) => hitBox(b, x, y, pad));
      // ocean names: level, letter-spaced, wholly on open water
      for (const [text, f, spots] of OCEANS[P.pole]) {
        const size = Math.round(S.ocean * f), sp = S.oceanSp * f, w = spacedW(text, size, sp), h = size * 0.78;
        for (const [lon, lat] of spots) {
          const [x, y] = P.polar(lon, lat), b = { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y };
          let ok = true;
          for (let u = b.x0 - 6; u <= b.x1 + 6 && ok; u += 7) for (let v = b.y0 - 6; v <= b.y1 + 6 && ok; v += 6) {
            if (!inShape(P.shape, u, v, 10) || isLand(u, v) || !clear(u, v, 4)) ok = false;
          }
          if (!ok) continue;
          const L = { ...b, text, size, sp }; P.oceans.push(L); extra.push(L); keepOut.push(L); reserve.push(L);
          break;
        }
      }
      // ring labels: tangent to the ring and straddling it, upright, in open water near a target angle if possible
      const lats = P.pole > 0 ? [60, 30] : [-60, -30], RS = S.ring;
      const TARGET = (P.pole > 0 ? 120 : 60) * D2R; // lower left on the top half, lower right on the bottom half
      const around = (k) => TARGET + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * D2R;
      const halfOf = (lat) => (textW(latText(lat), RS) / 2 + 14) / P.rOf(lat);
      const clearArc = (r, a, half, onLand) => {
        for (let t = -half; t <= half; t += 3 / r) for (const dr of [-RS * 0.75, -RS * 0.38, 0, RS * 0.38, RS * 0.75]) {
          const x = P.cx + Math.cos(a + t) * (r + dr), y = P.cy + Math.sin(a + t) * (r + dr);
          if (!inShape(P.shape, x, y, 12) || (onLand === 'water' && isLand(x, y)) || (onLand === 'land' && !isLand(x, y)) || !clear(x, y, 6)) return false;
        }
        return true;
      };
      const angle = {};
      // open water first, then wholly on land (never across a coast, where the lettering gets lost), then anywhere
      for (const onLand of ['water', 'land', 'any']) {
        const todo = lats.filter((lat) => angle[lat] == null);
        if (!todo.length) break;
        let shared = null;
        for (let k = 0; k < 150 && shared === null; k++) if (todo.every((lat) => clearArc(P.rOf(lat), around(k), halfOf(lat), onLand))) shared = around(k);
        for (const lat of todo) {
          let best = shared;
          for (let k = 0; best === null && k < 360; k++) if (clearArc(P.rOf(lat), around(k), halfOf(lat), onLand)) best = around(k);
          angle[lat] = best; // null: no clear spot, the ring goes unlabeled
        }
      }
      for (const lat of lats) {
        const a = angle[lat];
        if (a == null) continue;
        const r = P.rOf(lat), w = textW(latText(lat), RS) + 16, x = P.cx + Math.cos(a) * r, y = P.cy + Math.sin(a) * r;
        const L = { lat, a, r, x, y, hw: w / 2, rs: RS };
        P.ringLabels.push(L);
        // tight boxes along the turned lettering, which place labels must not cover (the rings are the point of
        // this map: a place near a pole, such as Vostok, would otherwise hide 60° S under its name)
        const T = ringText(P, L, RS);
        P.ringHard.push(...turnedBoxes(T.x, T.y, textW(latText(lat), RS) + 4, RS, T.rot));
        // its bounding box (the text runs along the ring's tangent), for everything placed after it
        const ux = Math.abs(Math.sin(a)), uy = Math.abs(Math.cos(a)), hx = (w / 2) * ux + RS * 0.6 * uy, hy = (w / 2) * uy + RS * 0.6 * ux;
        const B = { x0: x - hx, x1: x + hx, y0: y - hy, y1: y + hy, ring: true };
        extra.push(B); keepOut.push(B); reserve.push(B);
      }
    }
  }

  // the faint rings and spokes and the dashed rings, all kept off the lettering
  gridAndRings(env, extra) {
    const { art, ctx } = env, V = this.view;
    const lettersNow = [...env.texts, ...extra, ...V.panels.flatMap((P) => P.letters), ...V.panels.flatMap((P) => P.marks)];
    for (const P of V.panels) {
      // a point is off limits inside any lettering box (ring labels: their own turned box)
      const inRingLabel = (x, y, pad) => P.ringLabels.some((L) => {
        const dx = x - L.x, dy = y - L.y, v = dx * Math.cos(L.a) + dy * Math.sin(L.a), u = -dx * Math.sin(L.a) + dy * Math.cos(L.a);
        return Math.abs(u) < L.hw + pad && Math.abs(v) < L.rs * 0.62 + pad;
      });
      const blocked = (x, y, pad = 3) => lettersNow.some((b) => !b.ring && hitBox(b, x, y, pad)) || inRingLabel(x, y, pad);
      // faint rings every 10 degrees (dashed) and faint spokes every 30 degrees of longitude, broken round the lettering
      ctx.save(); ctx.strokeStyle = INK; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.3; ctx.lineWidth = 1.1; ctx.beginPath();
      for (let lat = 10; lat < 90; lat += 10) {
        if (lat % 30 === 0) continue;
        const r = P.rOf(P.pole * lat), da = 5 / r, step = 12 / r;
        for (let t = 0; t < Math.PI * 2 - step * 0.5; t += step) {
          const ends = [[t, 0], [t + da, 0], [t + da / 2, 0]].map(([u]) => [P.cx + Math.cos(u) * r, P.cy + Math.sin(u) * r]);
          if (ends.some(([x, y]) => blocked(x, y))) continue;
          ctx.moveTo(ends[0][0], ends[0][1]); ctx.arc(P.cx, P.cy, r, t, t + da);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 0.22; ctx.beginPath();
      for (let lon = -180; lon < 180; lon += 30) {
        const a = P.angleOf(lon), ux = Math.cos(a), uy = Math.sin(a);
        let on = false;
        for (let t = 0; t <= P.R - 2; t += 4) {
          const x = P.cx + ux * t, y = P.cy + uy * t, ok = !blocked(x, y, 2);
          if (ok && !on) ctx.moveTo(x, y); else if (ok) ctx.lineTo(x, y);
          on = ok;
        }
      }
      ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();

      // dashed rings at 30 and 60 degrees, with a gap for each label and none through other lettering
      ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
      art.batch(() => { for (const lat of P.pole > 0 ? [60, 30] : [-60, -30]) {
        const r = P.rOf(lat), L = P.ringLabels.find((q) => q.lat === lat), la = L ? L.a : 0, gap = L ? (L.hw - 2) / r : 0;
        const dash = 16 / r, space = 10 / r;
        for (let t = la + gap; t < la + 2 * Math.PI - gap - dash * 0.5; t += dash + space) {
          const end = Math.min(t + dash, la + 2 * Math.PI - gap), pts = [];
          for (let u = t; u <= end + 1e-9; u += (end - t) / 5) pts.push([P.cx + Math.cos(u) * r, P.cy + Math.sin(u) * r]);
          if (pts.some(([x, y]) => lettersNow.some((b) => !b.ring && hitBox(b, x, y, 3)))) continue;
          art.crayon(pts, { color: INK, width: 1.7, alpha: 0.72, passes: 2, wobble: 0.4, crumple: 0.5, breakProb: 0.03, step: 3, jitter: 0.4 });
        }
      } });
      ctx.restore();
    }
  }

  // the hat or the dot on each pole, and the dark dashed line from the pole out through the place
  poleMarks(env) {
    const { art, layPaper } = env, V = this.view;
    for (const P of V.panels) {
      if (P.due) {
        const { dir, onDisk, d } = P.due, letters = P.letters.filter((b) => b.due), dashes = [];
        for (let t = P.markR + 4; t < P.R - 6; t += 23) {
          const e = Math.min(t + 14, P.R - 4);
          if (onDisk && e > d - 20 && t < d + 20) continue; // a gap for the star
          const pts = [[P.cx, P.cy + dir * t], [P.cx, P.cy + dir * e]];
          if (!pts.some(([x, y]) => letters.some((b) => hitBox(b, x, y, 3)))) dashes.push(pts);
        }
        // a paper halo under each dash, so the line reads across busy coasts (the Arctic islands). The halos go in
        // a batch of their own, finished before the ink: in one batch a later halo could be stroked over the ink.
        art.batch(() => { for (const pts of dashes) art.crayon(pts, { color: PAPER, width: 7, alpha: 0.8, passes: 1, wobble: 0.2, step: 3 }); });
        art.batch(() => { for (const pts of dashes) art.crayon(pts, { color: INK, width: 3, alpha: 0.95, passes: 3, wobble: 0.35, crumple: 0.4, step: 3, jitter: 0.4 }); });
      }
      if (P.pole > 0) santaHat(art, layPaper, P.cx, P.cy, V.S.hat);
      else poleDot(art, P.cx, P.cy);
    }
  }

  // ocean names, ring labels, meridian labels round the rim, pole names, the DUE line label, and the half titles
  lettering(env, extra) {
    if (!env.show) return;
    const { scrawl, ctx } = env.art, V = this.view, S = V.S;
    for (const P of V.panels) {
      for (const L of P.oceans) { // letter-spaced, as the book's big ocean names
        let u = L.x0;
        for (const ch of L.text) { const cw = textW(ch, L.size); if (ch !== ' ') scrawl(ch, u, L.y1, { size: L.size, color: INK, font: FONT, alpha: 0.8 }); u += cw + L.sp; }
      }
      for (const L of P.ringLabels) { // straddling the ring; turned over in the top half of the disk so it never reads upside down
        const T = ringText(P, L, S.ring);
        scrawl(latText(L.lat), T.x, T.y, { size: S.ring, color: INK, align: 'center', rot: T.rot, font: FONT, alpha: 0.9 });
      }
      // pole names and the DUE label sit on a paper patch (as the place labels do), so they read over busy coasts
      // (one patch for each name; the DUE label's two lines and the South Pole's two lines share one)
      const groups = new Map();
      for (const b of P.letters) { const k = b.due ? 'due' : b.align === 'center' ? 'pole' : b.text, g = groups.get(k);
        groups.set(k, g ? { x0: Math.min(g.x0, b.x0), y0: Math.min(g.y0, b.y0), x1: Math.max(g.x1, b.x1), y1: Math.max(g.y1, b.y1) } : { ...b }); }
      ctx.save(); ctx.globalAlpha = 0.72; ctx.fillStyle = PAPER;
      for (const g of groups.values()) { roundRect(ctx, g.x0 - 5, g.y0 - 3, g.x1 - g.x0 + 10, g.y1 - g.y0 + 6, 6); ctx.fill(); }
      ctx.restore();
      for (const b of P.letters) scrawl(b.text, b.ax, b.by, { size: b.size, color: INK, align: b.align, font: FONT, alpha: b.alpha ?? 0.95 });
      // longitudes just outside the rim, kept upright (santa-map.js `outside`)
      // (each also leaves a few small boxes in `extra`, so place labels keep off it)
      const outside = (text, a, off, size, alpha = 0.85) => {
        let rot = a - Math.PI / 2, rr = P.R + off;
        if (Math.cos(rot) < 0) { rot += Math.PI; rr += size * 0.8; }
        const x = P.cx + Math.cos(a) * rr, y = P.cy + Math.sin(a) * rr;
        scrawl(text, x, y, { size, color: INK, font: FONT, rot, align: 'center', alpha });
        extra.push(...turnedBoxes(x, y, textW(text, size), size, rot));
      };
      // the reader's star, when it sits on this rim (a place on the equator), takes the place of the longitude there
      const star = this.locate(this.origin), starHere = star && star.cx === P.cx && star.cy === P.cy;
      const angles = [];
      for (let lon = -180; lon < 180; lon += 30) {
        const a = P.angleOf(lon); angles.push(a);
        if (starHere && Math.hypot(star.x - (P.cx + Math.cos(a) * P.R), star.y - (P.cy + Math.sin(a) * P.R)) < 34) continue;
        outside(lonText(lon), a, S.meridOff, S.merid);
      }
      // the single disk names its edge in the free gap between two longitudes nearest the lower right (the book's spot)
      if (S.rimNote) {
        const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), sorted = angles.map(norm).sort((p, q) => p - q);
        let best = null, bd = Infinity;
        for (let i = 0; i < sorted.length; i++) {
          const a0 = sorted[i], a1 = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 2 * Math.PI, mid = (a0 + a1) / 2;
          const dd = Math.abs(Math.atan2(Math.sin(mid - 30 * D2R), Math.cos(mid - 30 * D2R)));
          if (dd < bd) { bd = dd; best = mid; }
        }
        outside('THE EDGE IS THE EQUATOR', best, S.meridOff, S.rimNote, 0.9);
      }
    }
    if (V.heads) V.panels.forEach((P, i) => {
      const [t, sub] = V.heads[i];
      scrawl(t, P.cx, 74, { size: S.title, color: INK, align: 'center', font: FONT });
      scrawl(sub, P.cx, 74 + S.note + 12, { size: S.note, color: INK, align: 'center', font: FONT, alpha: 0.8 });
    });
  }

  // ---------------- places ----------------
  // a place sits on the half that holds it (a place on the equator: the first half shown); its label leans away
  // from that half's pole. (The plain polar formula, so a place exactly on the equator still lands on the rim.)
  locate(p) {
    for (const P of this.view.panels) {
      if (!onHalf(p.lat, P.pole)) continue;
      const [x, y] = P.polar(p.lon, p.lat);
      return { x, y, cx: P.cx, cy: P.cy };
    }
    return null;
  }
  // the shortest route. To the far side of the world (the antipode) every route through the middle of the Earth
  // is equally short and the usual math has no single answer, so take the one over the nearer pole: on this map
  // that is the straight line up the reader's meridian and on down the other side.
  routeOf(origin, p) {
    if (ang(toV([origin.lon, origin.lat]), toV([p.lon, p.lat])) < Math.PI - 1e-6) return greatCircle(origin, p, 160);
    const top = origin.lat >= 0 ? 90 : -90, pts = [];
    for (let i = 0; i <= 90; i++) pts.push([origin.lon, origin.lat + (top - origin.lat) * i / 90]);
    for (let i = 0; i <= 90; i++) pts.push([origin.lon + 180, top + (p.lat - top) * i / 90]);
    return pts;
  }
  // place labels keep off the pole markers and their names, the DUE SOUTH / DUE NORTH lettering, the ring labels,
  // and the dashed line itself (a narrow strip, so a label can still sit right beside the star)
  hardBoxes() {
    if (!this.view) return [];
    return this.view.panels.flatMap((P) => [...(P.marks || []), ...(P.letters || []), ...(P.ringHard || []),
      ...(P.due ? [{ ...P.due.corridor, x0: P.cx - 7, x1: P.cx + 7 }] : [])]);
  }
}
