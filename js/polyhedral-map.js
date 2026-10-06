// Flat Earth website: the butterfly maps, drawn in crayon on a flat net that folds into a solid.
//   cahill    Cahill's butterfly (book page B2): an octahedron, 8 triangles, a lamp at the Earth's center
//   dymaxion  Fuller's Dymaxion (book page B6): his 1954 icosahedron, 20 triangles, his own mapping
// Follows poly-draw.js, butterfly.js and dymaxion.js: baby-blue hatched water, bare-paper land, black coasts,
// thin borders, the 30 degree graticule on the lamp map, a solid line where the net is cut and a dashed line
// where it folds. The nets are fixed, so the reader's place is only marked (the star) wherever it lands.
//
// The geometry lives in poly-net.js. Here each face is one map-common panel: a 'cap' geo around the face's
// center (a little wider than the face, so coasts run on past the edge) clipped to the face's triangle.
import { createArt, INK, FONT } from './crayon.js';
import {
  BaseMap, MAP_W, EDGE, seedOf, isCut, inShape, boundsOf, shapePath, geoForward, projectFill, projectLines, ringNear,
  labelAtFromForward, paperUnderPanels, waterAndLand, addRing, placeLabels, countryLabels, drawLinework, lineInker,
  letterLabels, graticule, LINE, displayName, fromV, D2R, crayonAround,
} from './map-common.js';
import { cahillNet, dymaxionNet, xyz, lonlat } from './poly-net.js';

export const SCALES = [{ id: 'net', label: 'Net' }];
const W = MAP_W, PAD = EDGE + 30;

// one net per kind, built once (the Dymaxion's Fuller tables are filled on first use)
const NETS = {};
const netOf = (kind) => NETS[kind] || (NETS[kind] = kind === 'dymaxion' ? dymaxionNet() : cahillNet());

const KINDS = {
  cahill: {
    title: 'THE BUTTERFLY MAP', grat: true, margin: 9 * D2R,
    prose: (name) => ['The star marks ', { strong: name }, '. Eight triangles spread out like the wings of a butterfly, with the cuts in the oceans. ' +
      'The four top triangles meet at the North Pole. Each one is drawn with a lamp at the Earth’s center, so direction is true only from the middle of each triangle, and the corners stretch.'],
    legend: 'Solid lines are cuts; dashed lines are folds. Faint lines every 30 degrees of latitude and longitude.',
  },
  dymaxion: {
    title: 'THE WORLD IN TWENTY TRIANGLES', grat: false, margin: 8 * D2R,
    prose: (name) => ['The star marks ', { strong: name }, '. Buckminster Fuller cut the globe into twenty triangles that fold up into a ball, and put every cut in the ocean, ' +
      'so the land stays in one piece. Sizes stay within about 10 percent of true, and shapes bend only a little near the corners.'],
    legend: 'Solid lines are cuts; dashed lines are folds. The map has no top or bottom.',
  },
};

// the book's ocean names (butterfly.js / dymaxion.js LABELS): [lines, lon, lat, size]
const OCEANS = [
  [['PACIFIC', 'OCEAN'], -140, 5, 26], [['PACIFIC', 'OCEAN'], 170, 15, 24], [['ATLANTIC', 'OCEAN'], -40, 28, 24],
  [['ATLANTIC', 'OCEAN'], -15, -25, 22], [['INDIAN', 'OCEAN'], 78, -25, 24], [['SOUTHERN', 'OCEAN'], -150, -60, 20],
  [['ARCTIC', 'OCEAN'], 60, 82, 17],
];
const GRAT = { ...LINE.graticule, width: 1, alpha: 0.24 };

// letter-spaced map lettering, centered on x (the book's lettered())
function lettered(art, text, x, y, size, sp, alpha = 0.8) {
  let w = 0; for (const ch of text) w += art.textWidth(ch, size) + sp; w -= sp;
  let u = x - w / 2;
  for (const ch of text) { const cw = art.textWidth(ch, size); if (ch !== ' ') art.scrawl(ch, u, y, { size, color: INK, font: FONT, alpha }); u += cw + sp; }
}
const spacedWidth = (art, text, size, sp) => { let w = 0; for (const ch of text) w += art.textWidth(ch, size) + sp; return w - sp; };
// a dashed crayon line (poly-draw.js dashed())
function dashed(art, pts, o, on, off) {
  const rs = art.resample(pts, 2); let acc = 0, cur = [];
  for (let i = 1; i < rs.length; i++) {
    acc += Math.hypot(rs[i][0] - rs[i - 1][0], rs[i][1] - rs[i - 1][1]);
    if (acc % (on + off) < on) cur.push(rs[i]); else { if (cur.length > 1) art.crayon(cur, o); cur = []; }
  }
  if (cur.length > 1) art.crayon(cur, o);
}
const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;

export class PolyhedralMap extends BaseMap {
  constructor(base, overlay, data, kind = 'cahill') {
    super(base, overlay, data);
    this.kind = KINDS[kind] ? kind : 'cahill';
    this.K = KINDS[this.kind];
    this.originMark = 'star'; this.originSub = null;
    this.marks = [];
  }

  async prepare(origin /* , scale: 'net' is the only one */) {
    this.origin = origin;
    if (!this.view) this.view = this.buildView();
    const name = displayName(origin);
    return { title: this.K.title, prose: this.K.prose(name), legend: this.K.legend };
  }

  // the net fitted to the map's width; one panel per face
  buildView() {
    const N = netOf(this.kind), [bx0, by0, bx1, by1] = N.box;
    const k = (W - 2 * PAD) / (bx1 - bx0), H = Math.round((by1 - by0) * k + 2 * PAD);
    const toC = ([x, y]) => [PAD + (x - bx0) * k, PAD + (y - by0) * k];
    const toN = (x, y) => [bx0 + (x - PAD) / k, by0 + (y - PAD) / k];
    const margin = this.K.margin;
    const panels = N.faces.map((f, fi) => {
      const tri = f.Q.map(toC), shape = { type: 'poly', rings: [tri] };
      const fwd = (lon, lat) => toC(f.net(f.bary(xyz(lon, lat))));
      const maxC = f.radius + margin, cv = f.cen;
      // the cap's edge on the canvas (land that wraps the far side fills out to it)
      const e1 = (() => { const a = Math.abs(cv[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], c = [cv[1] * a[2] - cv[2] * a[1], cv[2] * a[0] - cv[0] * a[2], cv[0] * a[1] - cv[1] * a[0]], n = Math.hypot(...c); return c.map((x) => x / n); })();
      const e2 = [cv[1] * e1[2] - cv[2] * e1[1], cv[2] * e1[0] - cv[0] * e1[2], cv[0] * e1[1] - cv[1] * e1[0]];
      const rim = [];
      for (let i = 0; i < 120; i++) {
        const t = i / 120 * Math.PI * 2, s = Math.sin(maxC * 0.999), c = Math.cos(maxC * 0.999);
        const v = [0, 1, 2].map((j) => cv[j] * c + (e1[j] * Math.cos(t) + e2[j] * Math.sin(t)) * s);
        rim.push(fwd(...fromV(v)));
      }
      const geo = { type: 'cap', center: { lon: f.center[0], lat: f.center[1] }, maxC, fwd, rim };
      const inverse = (x, y) => (inShape(shape, x, y, -0.5) ? lonlat(f.inv(f.netBary(toN(x, y)))) : null);
      return { shape, geo, inverse, face: fi, tri, bounds: boundsOf(shape) };
    });
    const edgePx = N.edgeLen * k;
    return { W, H, panels, net: N, toC, toN, k, edgePx, wk: Math.min(1.2, Math.max(0.55, Math.sqrt(edgePx / 570))) };
  }

  // a place lands in the face its point belongs to (exact, no searching through panels)
  locate(p) {
    const V = this.view, N = V.net, P = xyz(p.lon, p.lat), fi = this.endFace(p), f = N.faces[fi], q = V.toC(f.net(f.bary(P)));
    return { x: q[0], y: q[1] };
  }
  hardBoxes() { return this.marks; }
  // a place label stays on the net: its corners and edge middles (with its paper patch) all on some triangle,
  // never out over the gaps between the wings
  labelFits(b) {
    const x0 = b.x0 - 5, x1 = b.x1 + 5, y0 = b.y0 - 2, y1 = b.y1 + 4, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    return [[x0, y0], [xm, y0], [x1, y0], [x1, ym], [x1, y1], [xm, y1], [x0, y1], [x0, ym]]
      .every(([x, y]) => this.view.panels.some((P) => inShape(P.shape, x, y, -1)));
  }

  // the great circle from the origin to p on the sphere: { A, B, w, at(t) } (null when p is the origin)
  routeFrame(origin, p) {
    const A = xyz(origin.lon, origin.lat), B = xyz(p.lon, p.lat);
    const w = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    if (w < 1e-6) return null;
    // the plane of the route: A and a unit vector U at right angles to it, toward B
    let U = [B[0] - A[0] * Math.cos(w), B[1] - A[1] * Math.cos(w), B[2] - A[2] * Math.cos(w)];
    if (Math.hypot(...U) < 1e-6) { // B is (nearly) the antipode: head due north (due east from a pole)
      const n = Math.abs(A[2]) > 0.999 ? [0, 1, 0] : [-A[0] * A[2], -A[1] * A[2], 1 - A[2] * A[2]];
      U = n;
    }
    const un = Math.hypot(...U); U = U.map((x) => x / un);
    const at = (t) => { const a = t * w, c = Math.cos(a), s = Math.sin(a); return [A[0] * c + U[0] * s, A[1] * c + U[1] * s, A[2] * c + U[2] * s]; };
    return { A, B, w, at };
  }
  // the face p is drawn on. A point on a cut (the South Pole on the butterfly, a place on the cut meridian) shows up at
  // more than one spot of the net; it is drawn where the route from the origin arrives, so the dot and the line meet.
  endFace(p) {
    const N = this.view.net, B = xyz(p.lon, p.lat), fB = N.faceOf(B);
    if (!this.origin || p.isOrigin) return fB;
    const R = this.routeFrame(this.origin, p);
    if (!R) return fB;
    const fa = N.faceOf(R.at(1 - 1e-7 / R.w));
    return fa !== fB && Math.min(...N.faces[fa].bary(B)) > -1e-6 ? fa : fB;
  }

  // The route to a place: the shortest route (great circle), walked on the sphere and placed face by face. Across a
  // fold the line runs on; across a cut it stops at the cut and carries on from the matching spot on the other side.
  // (Walking the sphere also gives a sure route to the origin's antipode, where every great circle is shortest.)
  routeNet(origin, p) {
    const V = this.view, N = V.net, R = this.routeFrame(origin, p);
    if (!R) return [];
    const { A, B, w, at } = R, fEnd = this.endFace(p);
    const px = (fi, P) => V.toC(N.faces[fi].net(N.faces[fi].bary(P)));
    const n = Math.max(8, Math.ceil(w / D2R * 2)), runs = []; // a sample every half degree
    let cur = [], prevT = 0, prevF = N.faceOf(A);
    cur.push(px(prevF, A));
    for (let i = 1; i <= n; i++) {
      const t = i / n, P = i === n ? B : at(t), f = i === n ? fEnd : N.faceOf(P);
      if (f !== prevF && !this.foldBetween(prevF, f)) {
        // find where the route leaves each face it crosses in this step (bisection; near a corner a step can cross
        // two edges): across a cut, end this run there and start the next at the matching spot on the next face
        let g = prevF, t0 = prevT;
        for (let guard = 0; g !== f && guard < 4; guard++) {
          let lo = t0, hi = t;
          for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (N.faceOf(at(m)) === g) lo = m; else hi = m; }
          const E = at((lo + hi) / 2), ge = t - hi < 1e-7 ? f : N.faceOf(at(hi));
          if (ge === g) break;
          cur.push(px(g, E));
          if (!this.foldBetween(g, ge)) { if (cur.length > 1) runs.push(cur); cur = [px(ge, E)]; }
          g = ge; t0 = hi;
        }
      }
      cur.push(px(f, P)); prevT = t; prevF = f;
    }
    if (cur.length > 1) runs.push(cur);
    return runs;
  }
  // do faces a and b meet at a fold of the net (so a line runs straight on across it)?
  foldBetween(a, b) {
    const E = this.view.foldPairs || (this.view.foldPairs = new Set(this.view.net.edges.filter((e) => e.type === 'fold').flatMap((e) => [e.face + ':' + e.other, e.other + ':' + e.face])));
    return E.has(a + ':' + b);
  }
  drawRoute(art, p, hot) {
    if (!this.origin) return;
    for (const run of this.routeNet(this.origin, p)) crayonAround(art, run, LINE.route(hot), this.showLabels ? this.placedLabels || [] : []);
  }

  // ---------------- the base map ----------------
  drawBase(origin) {
    this.origin = origin;
    const V = this.view, { H, panels, net: N } = V, data = this.data, show = this.showLabels, wk = V.wk;
    let t0 = performance.now(); const lap = (s) => { if (globalThis.window?.FE_DEBUG) console.log(s, Math.round(performance.now() - t0)); t0 = performance.now(); };
    this.sizeCanvases();
    const art = createArt(this.base, { width: W, height: H, seed: seedOf('butterfly-' + this.kind) });
    const { ctx, batch } = art;

    // project land and lakes for each face (map-common clips them to the face's cap; the triangle clip does the rest)
    const lakeList = data.lakes.filter((l) => l.r <= 3).map((l) => l.p);
    for (const P of panels) {
      P.fwd = geoForward(P.geo); P.labelAt = labelAtFromForward(P.fwd);
      P.landRings = []; P.seams = [];
      for (const poly of data.land) for (const ring of poly) if (ringNear(P.geo, ring)) {
        P.landRings.push(...projectFill(ring, P.geo));
        for (let i = 0; i < ring.length - 1; i++) if (isCut(ring[i], ring[i + 1])) P.seams.push(...projectLines([ring[i], ring[i + 1]], P.geo, { cuts: false, maxStep: 20, bounds: P.bounds }));
      }
      P.lakeRings = lakeList.filter((r) => ringNear(P.geo, r)).flatMap((r) => projectFill(r, P.geo));
    }
    lap('project');

    const { layPaper } = paperUnderPanels(art, this.base, W, panels);
    for (const P of panels) waterAndLand(art, P, layPaper, P.seams);
    lap('water');

    // the lamp map's graticule, every 30 degrees (B2)
    if (this.K.grat) {
      const lines = graticule({ step: 30, res: 1 });
      for (const P of panels) {
        ctx.save(); ctx.beginPath(); shapePath(ctx, P.shape); ctx.clip();
        batch(() => { for (const l of lines) for (const run of projectLines(l, P.geo, { cuts: false, bounds: P.bounds, maxStep: 12 })) art.crayon(run, GRAT); });
        ctx.restore();
      }
    }

    const isLand = landMaskSeams(W, H, panels);
    // the poles: an ink dot where a pole sits at one spot of the net (a pole split by cuts is left unmarked)
    this.marks = [];
    const poles = [];
    for (const [lat, name] of [[90, 'NORTH POLE'], [-90, 'SOUTH POLE']]) {
      const spots = N.spotsOf(0, lat);
      if (spots.length === 1) { const [x, y] = V.toC(spots[0].net); poles.push({ x, y, name }); this.marks.push({ x0: x - 9, y0: y - 9, x1: x + 9, y1: y + 9 }); }
    }

    // lettering: country names inside one face each (kept 12 px off its edges), then the ocean names and the poles
    const placed = this.marks.map((b) => ({ ...b, text: null, mark: true }));
    // keep the lettering off the reader's star (the place layer letters its name)
    if (origin) { const o = this.locate(origin); placed.push({ x0: o.x - 20, y0: o.y - 20, x1: o.x + 20, y1: o.y + 20, text: null }); }
    const oceanTexts = [], poleTexts = [];
    if (show) {
      // placeLabels keeps every corner 6 px inside the shape; a copy shrunk by 7 px keeps names 13 px off the edges
      for (const P of panels) placeLabels(art, { ...P, shape: { type: 'poly', rings: [shrink(P.tri, 7)] } }, isLand, placed, countryLabels(data.labels, 5), [11, 26], 1);
      const faceBox = (b, m) => panels.find((P) => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1], [(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1]].every(([x, y]) => inShape(P.shape, x, y, m)));
      // the land mask under a box: 0 = all water, 1 = all land, -1 = a coast runs through it
      const boxLand = (b) => { let land = 0, n = 0;
        for (let y = b.y0; y <= b.y1 + 0.1; y += (b.y1 - b.y0) / Math.ceil((b.y1 - b.y0) / 5)) for (let x = b.x0; x <= b.x1 + 0.1; x += (b.x1 - b.x0) / Math.ceil((b.x1 - b.x0) / 5)) { n++; if (isLand(x, y)) land++; }
        return land === 0 ? 0 : land === n ? 1 : -1; };
      const waterBox = (b) => boxLand(b) === 0;
      // Big lands that lie across a fold (Australia and Antarctica on the Dymaxion, as the book letters them) find no
      // single face to fit in. On the Dymaxion, whose cuts all run through the ocean, give the biggest names a second
      // try across neighboring faces: the name's own spot must still be on its face and the name mostly on land, but
      // it may run over a dashed fold. (Cahill's cuts run through land, so its names stay inside one face.)
      const landShare = (b) => { let land = 0, n = 0;
        for (let y = b.y0; y <= b.y1 + 0.1; y += (b.y1 - b.y0) / 4) for (let x = b.x0; x <= b.x1 + 0.1; x += (b.x1 - b.x0) / 12) { n++; if (isLand(x, y)) land++; }
        return land / n; };
      const net = { type: 'poly', rings: panels.map((P) => P.tri) }, shown = new Set(placed.map((b) => b.text).filter(Boolean));
      if (this.kind === 'dymaxion') for (const L of countryLabels(data.labels, 4).filter((q) => q.a > 500 && !shown.has(q.n.toUpperCase()))) {
        for (const P of panels) {
          const trial = [...placed];
          placeLabels(art, { ...P, shape: net, labelAt: (lon, lat) => { const at = P.labelAt(lon, lat); return at && inShape(P.shape, at.x, at.y) ? at : null; } },
            isLand, trial, [L], [11, 26], 1);
          const b = trial.length > placed.length && trial[trial.length - 1];
          if (b && landShare(b) >= 0.6) { placed.push(b); break; }
        }
      }
      for (const p of poles) {
        const size = 14, cands = [];
        for (const lines of [[p.name], p.name.split(' ')]) {
          const w = Math.max(...lines.map((t) => art.textWidth(t, size))), h = size * 1.15 * (lines.length - 1) + size * 0.8;
          for (const g of [10, 16, 24, 34, 46, 60, 76]) for (const [sx, sy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 1], [-1, -1], [-1, 1]]) {
            const x0 = sx > 0 ? p.x + g : sx < 0 ? p.x - g - w : p.x - w / 2, y0 = sy < 0 ? p.y - g - h : sy > 0 ? p.y + g : p.y - h / 2;
            cands.push({ lines, x0, y0, x1: x0 + w, y1: y0 + h, size, cost: g + (lines.length > 1 ? 14 : 0) + (sx && sy ? 6 : 0) });
          }
        }
        cands.sort((a, b) => a.cost - b.cost);
        // clear of every coast if it can be; else on a paper patch (as the book does when a name has no clear spot)
        const free = (b) => faceBox(b, 8) && !placed.some((o) => overlaps(b, o, o.mark ? 2 : 6));
        // (a clear spot far from the dot loses to a patch right beside it)
        const clean = (b) => free(b) && boxLand({ x0: b.x0 - 3, y0: b.y0 - 3, x1: b.x1 + 3, y1: b.y1 + 3 }) >= 0;
        let c = cands.find((b) => b.cost <= 40 && clean(b));
        if (!c) { c = cands.find(free); if (c) c.patch = !clean(c); }
        if (!c) c = cands.find(clean);
        if (c) { placed.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, text: null }); poleTexts.push(c); }
      }
      const used = new Set();
      for (const [lines0, lon, lat, size0] of OCEANS) {
        const at = this.locate({ lon, lat }), key = lines0.join(' ');
        let done = false;
        for (const [lines, f] of [[lines0, 1], [[key], 1], [lines0, 0.85], [[key], 0.85], [lines0, 0.72]]) {
          if (done) break;
          const size = size0 * f * wk / 0.8, sp = size * 0.22, lead = size * 1.25;
          const w = Math.max(...lines.map((t) => spacedWidth(art, t, size, sp))), h = lead * (lines.length - 1) + size * 0.8;
          for (let r = 0; r <= 200 && !done; r += 8) for (let t = 0; t < (r ? Math.max(8, Math.round(r / 6)) : 1) && !done; t++) {
            const a = t / Math.max(8, Math.round(r / 6)) * Math.PI * 2, cx = at.x + Math.cos(a) * r, cy = at.y + Math.sin(a) * r;
            const b = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
            if (placed.some((o) => overlaps(b, o, 10))) continue;
            if (oceanTexts.some((o) => o.key === key && Math.hypot(o.cx - cx, o.cy - cy) < 260)) continue;
            const P = faceBox(b, 14); if (!P || used.has(P.face + key)) continue;
            if (!waterBox({ x0: b.x0 - 6, y0: b.y0 - 6, x1: b.x1 + 6, y1: b.y1 + 6 })) continue;
            used.add(P.face + key); done = true;
            placed.push({ ...b, text: null });
            oceanTexts.push({ key, cx, cy, lines, size, sp, lead, ...b });
          }
        }
      }
    }
    const texts = placed.filter((b) => b.text);
    lap('labels');

    // lakes, borders and coasts, each face clipped to its own triangle
    for (const P of panels) {
      drawLinework(art, P, { lakes: P.lakeRings, borders: data.borders.filter((l) => ringNear(P.geo, l)), land: P.landRings }, lineInker(art, P.geo, P.bounds));
    }
    lap('lines');

    // the net's edges: folds dashed, the outline (cuts) solid and heavy (poly-draw.js, dymaxion.js)
    const FOLD = { color: INK, width: 2.1 * wk, alpha: 0.7, passes: 2, wobble: 0.3, crumple: 0.3, step: 3 };
    const CUT = { color: INK, width: 3.3 * wk, alpha: 0.9, passes: 3, wobble: 0.4, crumple: 0.5, breakProb: 0, step: 3 };
    for (const e of N.edges) {
      const a = V.toC(e.a), b = V.toC(e.b);
      if (e.type === 'fold') dashed(art, [a, b], FOLD, 19 * wk, 12 * wk);
      else art.crayon([a, b], CUT);
    }
    // the pole dots
    for (const p of poles) art.crayon(art.wobblyEllipse(p.x, p.y, 4.5, 4.5, 0, 0.3, 0.05), { color: INK, width: 3.6, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
    lap('edges');

    if (show) {
      letterLabels(art, texts);
      for (const o of oceanTexts) o.lines.forEach((t, n) => lettered(art, t, o.cx, o.cy + (n - (o.lines.length - 1) / 2) * o.lead + o.size * 0.35, o.size, o.sp, 0.8));
      for (const c of poleTexts) if (c.patch) { ctx.save(); ctx.beginPath(); ctx.rect(c.x0 - 4, c.y0 - 3, c.x1 - c.x0 + 8, c.y1 - c.y0 + 7); ctx.clip(); ctx.globalAlpha = 0.85; layPaper(); ctx.restore(); }
      for (const c of poleTexts) c.lines.forEach((t, n) => art.scrawl(t, (c.x0 + c.x1) / 2, c.y0 + c.size * 0.8 + n * c.size * 1.15, { size: c.size, color: INK, font: FONT, align: 'center', alpha: 0.9 }));
    }
    art.border({ box: [0, 0, W, H] });
    art.grain({ vignette: 0 });
    this.placedLabels = [...texts, ...oceanTexts.map((o) => ({ x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 })), ...poleTexts.map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }))];
    lap('finish');
  }
}

// map-common's landMask, plus the data seams (the antimeridian cut through Antarctica, which runs into the South
// Pole) filled in, so lettering near the pole does not see a hairline of water there
function landMaskSeams(W, H, panels) {
  const MS = 1 / 3, mask = document.createElement('canvas'); mask.width = Math.ceil(W * MS); mask.height = Math.ceil(H * MS);
  const m = mask.getContext('2d', { willReadFrequently: true }); m.setTransform(MS, 0, 0, MS, 0, 0);
  for (const P of panels) {
    m.save(); m.beginPath(); shapePath(m, P.shape); m.clip();
    m.beginPath(); P.landRings.forEach((r) => addRing(m, r)); m.fillStyle = '#000'; m.fill('evenodd');
    m.beginPath(); for (const a of P.seams) a.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y)));
    m.lineWidth = 6; m.strokeStyle = '#000'; m.stroke();
    m.restore();
  }
  const md = m.getImageData(0, 0, mask.width, mask.height).data, mw = mask.width;
  return (x, y) => { x = Math.round(x * MS); y = Math.round(y * MS); return x < 0 || y < 0 || x >= mw || y >= mask.height ? false : md[(y * mw + x) * 4 + 3] > 0; };
}

// a triangle moved m px in from each edge (toward its centroid)
function shrink(tri, m) {
  const c = tri.reduce((s, p) => [s[0] + p[0] / tri.length, s[1] + p[1] / tri.length], [0, 0]);
  // inradius of the triangle: distance from the centroid to the first edge (the faces are equilateral)
  const [a, b] = tri, ex = b[0] - a[0], ey = b[1] - a[1], r = Math.abs((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / Math.hypot(ex, ey);
  const f = Math.max(0.05, (r - m) / r);
  return tri.map(([x, y]) => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]);
}

export class CahillMap extends PolyhedralMap { constructor(base, overlay, data) { super(base, overlay, data, 'cahill'); } }
export class DymaxionMap extends PolyhedralMap { constructor(base, overlay, data) { super(base, overlay, data, 'dymaxion'); } }
