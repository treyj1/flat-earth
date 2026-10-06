// Flat Earth website: shrink the book's Natural Earth files into small web-ready JSON.
// Run from the project root:  node web/tools/build-data.js
// Writes web/data/{land,lakes,borders,labels}.json. Coordinates are rounded to 0.01 degrees
// (about half a mile), plenty for a map drawn in crayon.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });

const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f + '.json'), 'utf8')).features;
const q = (v) => Math.round(v * 100) / 100;
// round, then drop repeated points
const ring = (r) => {
  const out = [];
  for (const [x, y] of r) { const p = [q(x), q(y)], l = out[out.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p); }
  return out;
};
const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const lines = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
// spherical-ish area of a lon/lat ring in square degrees at the equator
const sqDeg = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += (x2 - x1) * (Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180)); } return Math.abs(a / 2) * 180 / Math.PI; };

// land: polygons as [outer, ...holes]
const land = [];
for (const f of load('ne_50m_land')) for (const p of polys(f.geometry)) {
  const rr = p.map(ring).filter((r) => r.length > 3);
  if (rr.length && sqDeg(rr[0]) > 0.01) land.push(rr);
}
// lakes: the larger ones only (the book keeps scalerank <= 3 on the world page)
// lakes keep their rank: the world map shows rank <= 3 (like the book), closer views show them all
const lakes = [];
for (const f of load('ne_50m_lakes')) for (const p of polys(f.geometry)) lakes.push({ r: f.properties.scalerank ?? 0, p: ring(p[0]) });
const borders = [];
for (const f of load('ne_50m_admin_0_boundary_lines_land')) for (const l of lines(f.geometry)) borders.push(ring(l));

// the book's shorter lettering for a few long names
const SHORT = { 'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'C. African Rep.', 'Bosnia and Herz.': 'Bosnia', 'Dominican Rep.': 'Dominican Rep.' };
// country labels: name, label point, rank, and area (for lettering size)
const labels = load('ne_50m_admin_0_countries').map((f) => {
  const p = f.properties;
  const area = polys(f.geometry).reduce((a, poly) => a + sqDeg(poly[0]), 0);
  return { n: SHORT[p.NAME] || p.NAME, x: q(p.LABEL_X), y: q(p.LABEL_Y), r: p.LABELRANK, a: Math.round(area * 10) / 10 };
}).sort((a, b) => a.r - b.r || b.a - a.a);

const write = (name, data) => {
  const file = path.join(OUT, name + '.json');
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(name.padEnd(8), (fs.statSync(file).size / 1024).toFixed(0).padStart(5), 'KB');
};
write('land', land); write('lakes', lakes); write('borders', borders); write('labels', labels);

// ---- for the continent / country / state views (loaded only when needed) ----
// countries: outer rings with each ring's area, so the site can drop far-flung islands when fitting a box
const outer = (g) => polys(g).map((p) => ring(p[0])).filter((r) => r.length > 3).map((r) => ({ a: Math.round(sqDeg(r) * 100) / 100, r }));
write('countries', load('ne_50m_admin_0_countries').map((f) => ({ n: SHORT[f.properties.NAME] || f.properties.NAME, c: f.properties.CONTINENT, p: outer(f.geometry) })));
// states and provinces (Natural Earth 50m has them for nine large countries only)
write('admin1', load('ne_50m_admin_1_states_provinces').map((f) => {
  const p = f.properties, rings = outer(f.geometry);
  return { n: p.name, adm: SHORT[p.admin] || p.admin, x: q(p.longitude ?? 0), y: q(p.latitude ?? 0), a: Math.round(rings.reduce((t, r) => t + r.a, 0) * 100) / 100, p: rings };
}));
const a1lines = [];
for (const f of load('ne_50m_admin_1_states_provinces_lines')) for (const l of lines(f.geometry)) a1lines.push(ring(l));
write('admin1-lines', a1lines);
