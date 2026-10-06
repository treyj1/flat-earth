// Flat Earth website: azimuthal equidistant projection from any origin, plus the
// sphere math the map needs (distance, heading, inverse projection).
// Same formulas as the book's proj.js, with the origin as a parameter instead of State College.
export const D2R = Math.PI / 180;
export const EARTH_MI = 3958.8;
export const EARTH_KM = 6371.0;
export const HALF_EARTH_MI = Math.PI * EARTH_MI; // distance to the antipode, about 12,437 miles

// Returns p([lon, lat]) -> [x, y, c], where c is the angular distance from the origin in radians.
// The whole Earth fits in a disk of radius rad; the rim is the antipode.
export function azimuthal(origin, cx, cy, rad) {
  const p0 = origin.lat * D2R, l0 = origin.lon * D2R, sp0 = Math.sin(p0), cp0 = Math.cos(p0);
  const fwd = ([lon, lat]) => {
    const f = lat * D2R, dl = lon * D2R - l0, sf = Math.sin(f), cf = Math.cos(f), cdl = Math.cos(dl);
    const cc = Math.max(-1, Math.min(1, sp0 * sf + cp0 * cf * cdl));
    const c = Math.acos(cc), k = c < 1e-9 ? 1 : c / Math.sin(c);
    // the exact antipode is the whole rim; put it where greatCircle()'s route to it ends (straight up, through the
    // North Pole, or straight down from the southern half)
    if (Math.PI - c < 1e-7) return [cx, cy + (origin.lat < 0 ? 1 : -1) * rad * (1 - 1e-6), c]; // (just inside the rim)
    const x = k * cf * Math.sin(dl), y = k * (cp0 * sf - sp0 * cf * cdl);
    return [cx + x * rad / Math.PI, cy - y * rad / Math.PI, c];
  };
  // canvas point -> [lon, lat], or null outside the disk
  fwd.invert = (px, py) => {
    const x = (px - cx) / rad * Math.PI, y = -(py - cy) / rad * Math.PI, c = Math.hypot(x, y);
    if (c > Math.PI) return null;
    if (c < 1e-9) return [origin.lon, origin.lat];
    const sc = Math.sin(c), cc = Math.cos(c);
    const lat = Math.asin(cc * sp0 + y * sc * cp0 / c);
    const lon = l0 + Math.atan2(x * sc, c * cp0 * cc - y * sp0 * sc);
    return [((lon / D2R + 540) % 360) - 180, lat / D2R];
  };
  fwd.antipode = [((origin.lon + 360) % 360) - 180, -origin.lat];
  return fwd;
}

export function distanceMi(a, b) {
  const f1 = a.lat * D2R, f2 = b.lat * D2R, df = f2 - f1, dl = (b.lon - a.lon) * D2R;
  const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Initial heading, degrees clockwise from north (the book's M1 convention).
export function headingDeg(a, b) {
  const f1 = a.lat * D2R, f2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
const POINTS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compassWord = (deg) => POINTS[Math.round(deg / 45) % 8];

// Planar point-in-polygon on lon/lat (Natural Earth splits rings at the antimeridian, so this is safe).
export function ringContains(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Project a lon/lat line. Near the antipode a short step on the globe can jump across the disk,
// so long projected steps are subdivided on the sphere. Returns [points, jumps] where jumps
// marks steps that stayed long anyway (they straddle the antipode and should not be inked).
export function projectLine(proj, line, maxStep = 30) {
  const out = [proj(line[0])], jumps = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const add = (p, q, pp, qq, depth) => {
      if (Math.hypot(qq[0] - pp[0], qq[1] - pp[1]) <= maxStep || depth > 7) {
        if (Math.hypot(qq[0] - pp[0], qq[1] - pp[1]) > maxStep * 3) jumps.push(out.length);
        out.push(qq); return;
      }
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], mm = proj(m);
      add(p, m, pp, mm, depth + 1); add(m, q, mm, qq, depth + 1);
    };
    add(a, b, out[out.length - 1], proj(b), 0);
  }
  return [out, jumps];
}

// Great-circle path from a to b as lon/lat points (a straight line through the centre on this map).
export function greatCircle(a, b, n = 64) {
  const toV = (p) => [Math.cos(p.lat * D2R) * Math.cos(p.lon * D2R), Math.cos(p.lat * D2R) * Math.sin(p.lon * D2R), Math.sin(p.lat * D2R)];
  const A = toV(a), B = toV(b), w = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (w < 1e-9) return [[a.lon, a.lat], [b.lon, b.lat]];
  const pts = [];
  if (Math.PI - w < 1e-6) return antipodeRoute(a, b, A, n);
  for (let i = 0; i <= n; i++) {
    const t = i / n, s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
    const v = [A[0] * s1 + B[0] * s2, A[1] * s1 + B[1] * s2, A[2] * s1 + B[2] * s2];
    pts.push([Math.atan2(v[1], v[0]) / D2R, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R]);
  }
  return pts;
}
// b is a's antipode: every great circle through a is a shortest route there, and sin(w) is about zero, so the
// usual formula scribbles. Take one route, the same every time: the meridian from a through the pole nearer a
// (the North Pole from the equator), then down the far side to b. Points are v = A cos(t pi) + U sin(t pi), with
// U the unit direction the route leaves a in.
function antipodeRoute(a, b, A, n) {
  const pz = a.lat < 0 ? -1 : 1;
  let U = [-pz * A[2] * A[0], -pz * A[2] * A[1], pz - pz * A[2] * A[2]]; // the pole, minus its part along A
  const m = Math.hypot(...U);
  if (m < 1e-9) U = [Math.cos(a.lon * D2R), Math.sin(a.lon * D2R), 0]; // a is a pole: leave along its own meridian
  else U = U.map((x) => x / m);
  const pts = [[a.lon, a.lat]];
  let lastLon = a.lon;
  for (let i = 1; i < n; i++) {
    const c = Math.cos(i / n * Math.PI), s = Math.sin(i / n * Math.PI);
    const v = [A[0] * c + U[0] * s, A[1] * c + U[1] * s, A[2] * c + U[2] * s];
    // (at the pole itself the longitude is undefined: keep the last one so the line has no spike)
    const lon = Math.hypot(v[0], v[1]) < 1e-9 ? lastLon : Math.atan2(v[1], v[0]) / D2R;
    lastLon = lon;
    pts.push([lon, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R]);
  }
  pts.push([b.lon, b.lat]);
  return pts;
}
