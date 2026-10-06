// Flat Earth website: polyhedral nets for the butterfly maps (browser port of the book's poly-engine.js).
// A solid's faces are unfolded into a flat net. Each face is a triangle with three corners on the sphere (V)
// and three corners in the net (Q, net units, y down). A point on the sphere lands in a face as barycentric
// weights b (b0 + b1 + b2 = 1), and in the net at b0 Q0 + b1 Q1 + b2 Q2.
//   gnomonic  the lamp maps (Cahill's octahedron, B2): a lamp at the Earth's center throws each point onto the
//             face plane; b are the plane point's weights. Every straight line inside a face is a great circle.
//   fuller    Buckminster Fuller's own mapping (Dymaxion, B6), as dymaxion.js: each edge is split evenly and
//             matching points are joined by great circles; the inverse is the mean of the three pairwise crossings.
// Both work past their face's edges too (map-common's cap panels need that: land is filled per face, then clipped
// to the triangle). Gnomonic simply carries on. Fuller's mapping is only defined inside its triangle, so past the
// edges it carries on as the lamp map, shifted to meet Fuller's mapping at the nearest point of the edge
// (continuous across every edge, and only ever seen through the face's own clip).
// No Node APIs: plain ES module.
export const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };
export const xyz = (lon, lat) => { const l = lon * D2R, f = lat * D2R; return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)]; };
export const lonlat = (p) => [Math.atan2(p[1], p[0]) / D2R, Math.asin(Math.max(-1, Math.min(1, p[2]))) / D2R];
function slerp(p, q, t) {
  const w = Math.acos(Math.max(-1, Math.min(1, dot(p, q))));
  if (w < 1e-12) return p.slice();
  const s = Math.sin(w), a = Math.sin((1 - t) * w) / s, b = Math.sin(t * w) / s;
  return [a * p[0] + b * q[0], a * p[1] + b * q[1], a * p[2] + b * q[2]];
}

// ================= Fuller's triangle mapping (as poly-engine.js and dymaxion.js) =================
const circleN = (A, B, C, t) => unit(cross(slerp(A, B, t), slerp(A, C, t)));
// planar barycentrics (in the face's vertex order) -> unit vector
export function fullerInv(T, FC, b) {
  for (let i = 0; i < 3; i++) if (b[i] > 1 - 1e-9) return T[i];
  const ns = [circleN(T[0], T[1], T[2], 1 - b[0]), circleN(T[1], T[2], T[0], 1 - b[1]), circleN(T[2], T[0], T[1], 1 - b[2])];
  let s = [0, 0, 0];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) { let p = unit(cross(ns[i], ns[j])); if (dot(p, FC) < 0) p = mul(p, -1); s = add(s, p); }
  return unit(s);
}
// unit vector (inside the face) -> planar barycentrics; exact but slow (108 bisection steps). The maps use the
// table in Face below; this one is for checking it.
export function fullerFwd(T, P) {
  const ts = [];
  for (const [X, Y, Z] of [[T[0], T[1], T[2]], [T[1], T[2], T[0]], [T[2], T[0], T[1]]]) {
    const s1 = Math.sign(dot(cross(Y, Z), X)); let lo = 1e-9, hi = 1;
    for (let i = 0; i < 36; i++) { const m = (lo + hi) / 2; if (Math.sign(dot(circleN(X, Y, Z, m), P)) === s1) hi = m; else lo = m; }
    ts.push((lo + hi) / 2);
  }
  const b = ts.map((t) => 1 - t), e = (1 - b[0] - b[1] - b[2]) / 3;
  return [b[0] + e, b[1] + e, b[2] + e];
}

// ================= one face =================
const TABLE_N = 48; // Fuller table: (N + 1)(N + 2) / 2 nodes per face, piecewise linear between them
export class Face {
  // V: three unit vectors; Q: three net points [x, y]; vid: the solid's vertex ids (to find shared edges)
  constructor(V, Q, vid, method = 'gnomonic') {
    this.V = V; this.Q = Q; this.vid = vid; this.method = method;
    const cen = unit(add(add(V[0], V[1]), V[2]));
    let n = unit(cross(sub(V[1], V[0]), sub(V[2], V[0]))); if (dot(n, cen) < 0) n = mul(n, -1);
    this.cen = cen; this.n = n; this.d = dot(n, V[0]);
    this.center = lonlat(cen);
    this.radius = Math.max(...V.map((v) => Math.acos(Math.max(-1, Math.min(1, dot(v, cen)))))); // circumradius, radians
    // planar barycentrics are affine in the plane point X: b_i = g_i . X + h_i
    const [A, B, C] = V, area2 = dot(cross(sub(B, A), sub(C, A)), n);
    this.g = [mul(cross(n, sub(C, B)), 1 / area2), mul(cross(n, sub(A, C)), 1 / area2), mul(cross(n, sub(B, A)), 1 / area2)];
    this.h = [dot(cross(B, C), n) / area2, dot(cross(C, A), n) / area2, dot(cross(A, B), n) / area2];
    this.table = null;
  }
  // lamp (gnomonic) barycentrics of a unit vector; valid while P faces the plane (P . n > 0)
  gBary(P) {
    const t = this.d / Math.max(dot(P, this.n), 1e-6), g = this.g, h = this.h;
    return [t * dot(g[0], P) + h[0], t * dot(g[1], P) + h[1], t * dot(g[2], P) + h[2]];
  }
  // the map's barycentrics of a unit vector (carries on past the edges)
  bary(P) {
    const g = this.gBary(P);
    if (this.method !== 'fuller') return g;
    const q = this.clampBary(g), f = this.tableFwd(q);
    return [g[0] + f[0] - q[0], g[1] + f[1] - q[1], g[2] + f[2] - q[2]];
  }
  // barycentrics -> unit vector (b inside the triangle; clamped otherwise)
  inv(b) {
    const [A, B, C] = this.V;
    if (this.method === 'fuller') { const c = this.clampBary(b); return fullerInv(this.V, this.cen, c); }
    return unit([b[0] * A[0] + b[1] * B[0] + b[2] * C[0], b[0] * A[1] + b[1] * B[1] + b[2] * C[1], b[0] * A[2] + b[1] * B[2] + b[2] * C[2]]);
  }
  net(b) { const Q = this.Q; return [b[0] * Q[0][0] + b[1] * Q[1][0] + b[2] * Q[2][0], b[0] * Q[0][1] + b[1] * Q[1][1] + b[2] * Q[2][1]]; }
  netBary([x, y]) { return baryIn(this.Q, x, y); }
  // nearest point of the triangle (in the net, where every face is equilateral), as barycentrics
  clampBary(b) {
    if (b[0] >= 0 && b[1] >= 0 && b[2] >= 0) return b;
    const p = this.net(b), Q = this.Q;
    let best = null, bd = Infinity;
    for (let i = 0; i < 3; i++) {
      const a = Q[i], c = Q[(i + 1) % 3], ex = c[0] - a[0], ey = c[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
      const dd = Math.hypot(a[0] + ex * t - p[0], a[1] + ey * t - p[1]);
      if (dd < bd) { bd = dd; best = [0, 0, 0]; best[i] = 1 - t; best[(i + 1) % 3] = t; }
    }
    return best;
  }
  // Fuller forward from the lamp barycentrics g (inside the triangle), through a table of the exact inverse:
  // node (i, j) holds Fuller weights f = (i / N, j / N, rest) and the lamp weights of fullerInv(f). A query walks to
  // the table cell whose lamp-space triangle holds g and interpolates f linearly there.
  tableFwd(gq) {
    const T = this.table || this.buildTable(), N = TABLE_N;
    const idx = (i, j) => (i * (2 * N + 3 - i)) / 2 + j; // row i holds j = 0 .. N - i
    let f0 = gq[0], f1 = gq[1], out = null;
    for (let it = 0; it < 8; it++) {
      let u = Math.max(0, Math.min(N, f0 * N)), v = Math.max(0, Math.min(N - u, f1 * N));
      let i = Math.min(N - 1, Math.floor(u)), j = Math.floor(v);
      if (i + j > N - 1) j = N - 1 - i;
      const upper = (u - i) + (v - j) > 1 && i + j < N - 1;
      const nodes = upper ? [[i + 1, j], [i, j + 1], [i + 1, j + 1]] : [[i, j], [i + 1, j], [i, j + 1]];
      const G = nodes.map(([a, b]) => T[idx(a, b)]);
      // weights of gq in the lamp-space triangle (first two barycentric components as plane coordinates)
      const l = baryIn(G, gq[0], gq[1]);
      const fa = nodes.map(([a, b]) => [a / N, b / N]);
      f0 = l[0] * fa[0][0] + l[1] * fa[1][0] + l[2] * fa[2][0];
      f1 = l[0] * fa[0][1] + l[1] * fa[1][1] + l[2] * fa[2][1];
      out = [f0, f1, 1 - f0 - f1];
      if (l[0] > -1e-7 && l[1] > -1e-7 && l[2] > -1e-7) break;
    }
    return out;
  }
  buildTable() {
    const N = TABLE_N, T = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
      const f = [i / N, j / N, Math.max(0, 1 - i / N - j / N)], g = this.gBary(fullerInv(this.V, this.cen, f));
      T.push([g[0], g[1]]);
    }
    return (this.table = T);
  }
}
// barycentric weights of (x, y) in the 2D triangle P
function baryIn(P, x, y) {
  const [A, B, C] = P, det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
  const a = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / det, b = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / det;
  return [a, b, 1 - a - b];
}

// ================= a net: faces, which face a point is in, fold and cut edges =================
export class Net {
  constructor(name, faces) {
    this.name = name; this.faces = faces;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of faces) for (const [x, y] of f.Q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    this.box = [x0, y0, x1, y1];
    this.edgeLen = Math.hypot(faces[0].Q[1][0] - faces[0].Q[0][0], faces[0].Q[1][1] - faces[0].Q[0][1]);
    // edges: 'fold' where another face shares the edge in the net, 'cut' where the net's outline runs
    const tol = this.edgeLen * 1e-4, same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol;
    this.edges = [];
    faces.forEach((f, fi) => {
      for (let k = 0; k < 3; k++) {
        const a = f.vid[k], b = f.vid[(k + 1) % 3], pa = f.Q[k], pb = f.Q[(k + 1) % 3];
        let type = 'cut', other = -1;
        faces.forEach((g, gi) => {
          if (gi === fi) return; const ia = g.vid.indexOf(a), ib = g.vid.indexOf(b);
          if (ia < 0 || ib < 0) return; other = gi;
          if (same(g.Q[ia], pa) && same(g.Q[ib], pb)) type = 'fold';
        });
        if (type === 'fold' && other < fi) continue; // each fold once
        this.edges.push({ face: fi, other, type, a: pa, b: pb });
      }
    });
  }
  // the face a unit vector belongs to (every solid here is regular: the nearest face center)
  faceOf(P) { let best = 0, bd = -2; this.faces.forEach((f, i) => { const d = dot(P, f.cen); if (d > bd) { bd = d; best = i; } }); return best; }
  // lon/lat -> { face, b, net: [x, y] }
  locate(lon, lat) { const P = xyz(lon, lat), fi = this.faceOf(P), f = this.faces[fi], b = f.bary(P); return { face: fi, b, net: f.net(b) }; }
  // every distinct net spot of a point (a point on a cut edge or corner shows up more than once)
  spotsOf(lon, lat, eps = 1e-6) {
    const P = xyz(lon, lat), out = [];
    this.faces.forEach((f, fi) => {
      if (dot(P, f.n) <= 0) return;
      const b = f.bary(P);
      if (Math.min(...b) < -eps) return;
      const p = f.net(b);
      if (!out.some((o) => Math.hypot(o.net[0] - p[0], o.net[1] - p[1]) < this.edgeLen * 1e-3)) out.push({ face: fi, net: p });
    });
    return out;
  }
  // net point -> lon/lat, or null off the net
  inverse(x, y) {
    for (const f of this.faces) {
      const b = f.netBary([x, y]);
      if (b[0] >= -1e-9 && b[1] >= -1e-9 && b[2] >= -1e-9) return lonlat(f.inv(b));
    }
    return null;
  }
}

// ================= Cahill's butterfly (B2): the octahedron, as butterfly.js SOLID.octa(2) =================
// Poles plus four corners on the equator at lon0 + 90k; face Nk / Sk spans lon0 + 90k to lon0 + 90(k + 1).
// The four top faces are joined in a fan around the North Pole, opened on meridian lon0 + 90j; each bottom
// face hangs below its partner; the net is turned so the middle fold (meridian lon0 + 90((j + 2) mod 4)) points down.
function orderFace(V, idx) { // counterclockwise as seen from outside
  const c = unit(idx.reduce((s, i) => add(s, V[i]), [0, 0, 0])), e1 = unit(sub(V[idx[0]], mul(c, dot(V[idx[0]], c)))), e2 = cross(c, e1);
  return idx.slice().sort((a, b) => Math.atan2(dot(V[a], e2), dot(V[a], e1)) - Math.atan2(dot(V[b], e2), dot(V[b], e1)));
}
export function cahillNet(lon0 = -20, j = 2) {
  const V = [[0, 0, 1], [0, 0, -1], ...[0, 1, 2, 3].map((k) => xyz(lon0 + 90 * k, 0))], solid = [];
  for (let k = 0; k < 4; k++) {
    solid.push({ name: 'N' + k, v: orderFace(V, [0, 2 + k, 2 + ((k + 1) % 4)]) });
    solid.push({ name: 'S' + k, v: orderFace(V, [1, 2 + k, 2 + ((k + 1) % 4)]) });
  }
  // local coordinates in each face plane (poly-engine.js build): origin at the centroid, e1 toward the first corner
  const loc = solid.map((f) => {
    const P3 = f.v.map((i) => V[i]), cen = mul(add(add(P3[0], P3[1]), P3[2]), 1 / 3);
    let n = unit(cross(sub(P3[1], P3[0]), sub(P3[2], P3[0]))); if (dot(n, cen) < 0) n = mul(n, -1);
    const e1 = unit(sub(P3[0], cen)), e2 = cross(n, e1);
    return P3.map((X) => { const r = sub(X, cen); return [dot(r, e1), dot(r, e2)]; });
  });
  const byName = Object.fromEntries(solid.map((f, i) => [f.name, i]));
  const tree = [];
  for (let m = 0; m < 3; m++) tree.push(['N' + ((j + m) % 4), 'N' + ((j + m + 1) % 4)]);
  for (let k = 0; k < 4; k++) tree.push(['N' + k, 'S' + k]);
  // unfold (poly-engine.js M.unfold): each child is turned and moved onto its parent's shared edge
  const T = solid.map(() => null), ap = (t, [x, y]) => [t.c * x - t.s * y + t.tx, t.s * x + t.c * y + t.ty];
  T[byName[tree[0][0]]] = { c: 1, s: 0, tx: 0, ty: 0 };
  let left = tree.slice(), guard = 0;
  while (left.length && guard++ < 50) left = left.filter(([pa, ch]) => {
    const a = byName[pa], b = byName[ch]; if (!T[a]) return true;
    const shared = solid[b].v.filter((v) => solid[a].v.includes(v)), [ka, kb] = shared;
    const pa0 = ap(T[a], loc[a][solid[a].v.indexOf(ka)]), pa1 = ap(T[a], loc[a][solid[a].v.indexOf(kb)]);
    const cb0 = loc[b][solid[b].v.indexOf(ka)], cb1 = loc[b][solid[b].v.indexOf(kb)];
    const th = Math.atan2(pa1[1] - pa0[1], pa1[0] - pa0[0]) - Math.atan2(cb1[1] - cb0[1], cb1[0] - cb0[0]), c = Math.cos(th), s = Math.sin(th);
    T[b] = { c, s, tx: pa0[0] - (c * cb0[0] - s * cb0[1]), ty: pa0[1] - (s * cb0[0] + c * cb0[1]) };
    return false;
  });
  const netUp = solid.map((f, i) => loc[i].map((q) => ap(T[i], q))); // net coordinates, y up
  // turn the net so the middle fold points straight down the page (butterfly.js wingsDown), then flip to y down
  const faces0 = solid.map((f, i) => new Face(f.v.map((k) => V[k]), netUp[i], f.v, 'gnomonic'));
  const tmp = new Net('tmp', faces0), mid = lon0 + 90 * ((j + 2) % 4), a = tmp.locate(mid, 60).net, b = tmp.locate(mid, 30).net;
  const ang = -Math.PI / 2 - Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
  const R = ([x, y]) => [c * x - s * y, -(s * x + c * y)];
  return new Net('cahill', solid.map((f, i) => new Face(f.v.map((k) => V[k]), netUp[i].map(R), f.v, 'gnomonic')));
}

// ================= Fuller's Dymaxion (B6): his 1954 icosahedron and the book's net (design/dymaxion/net-book.json) =================
// V: Fuller's vertex positions; F: the faces (vertex ids); Q: each face's corners on the book page (px, y down), in F order.
const DYM_V = [[0.420152426709, 0.078145249403, 0.904082550615], [0.995009439436, -0.091347795276, 0.040147175877], [0.518836730327, 0.835420380378, 0.181331837557], [-0.41468222532, 0.655962405435, 0.630675807891], [-0.515455959944, -0.381716898287, 0.767200992518], [0.355781402533, -0.843580002466, 0.402234226603], [0.41468222532, -0.655962405435, -0.630675807891], [0.515455959944, 0.381716898287, -0.767200992518], [-0.355781402533, 0.843580002466, -0.402234226603], [-0.995009439436, 0.091347795276, -0.040147175877], [-0.518836730327, -0.835420380378, -0.181331837557], [-0.420152426709, -0.078145249403, -0.904082550615]];
const DYM_F = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 1, 5], [1, 2, 7], [2, 7, 8], [2, 3, 8], [3, 8, 9], [3, 4, 9], [4, 9, 10], [4, 5, 10], [5, 10, 6], [1, 5, 6], [1, 6, 7], [6, 7, 11], [7, 8, 11], [8, 9, 11], [9, 10, 11], [6, 10, 11]];
const DYM_Q = [[[1657.449, 1616.906], [1942.551, 2110.719], [2227.654, 1616.906]], [[1657.449, 1616.906], [2227.654, 1616.906], [1942.551, 1123.094]], [[1657.449, 1616.906], [1942.551, 1123.094], [1372.346, 1123.094]], [[1657.449, 1616.906], [1372.346, 1123.094], [1087.243, 1616.906]], [[1657.449, 1616.906], [1942.551, 2110.719], [1372.346, 2110.719]], [[1942.551, 2110.719], [2227.654, 1616.906], [2512.757, 2110.719]], [[2797.86, 1616.906], [3082.962, 1123.094], [2512.757, 1123.094]], [[2227.654, 1616.906], [1942.551, 1123.094], [2512.757, 1123.094]], [[1942.551, 1123.094], [2512.757, 1123.094], [2227.654, 629.281]], [[1942.551, 1123.094], [1372.346, 1123.094], [1657.449, 629.281]], [[1087.243, 629.281], [517.038, 629.281], [802.14, 1123.094]], [[1372.346, 1123.094], [1087.243, 1616.906], [802.14, 1123.094]], [[1087.243, 1616.906], [802.14, 1123.094], [517.038, 1616.906]], [[802.14, 2110.719], [1087.243, 1616.906], [517.038, 1616.906]], [[802.14, 2110.719], [517.038, 1616.906], [231.935, 2110.719]], [[3368.065, 629.281], [3082.962, 1123.094], [2797.86, 629.281]], [[3082.962, 1123.094], [2512.757, 1123.094], [2797.86, 629.281]], [[2512.757, 1123.094], [2227.654, 629.281], [2797.86, 629.281]], [[517.038, 629.281], [802.14, 1123.094], [231.935, 1123.094]], [[517.038, 1616.906], [802.14, 1123.094], [231.935, 1123.094]]];
export function dymaxionNet() {
  const V = DYM_V.map(unit);
  return new Net('dymaxion', DYM_F.map((f, i) => new Face(f.map((k) => V[k]), DYM_Q[i], f, 'fuller')));
}
