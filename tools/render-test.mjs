#!/usr/bin/env node
// Flat Earth website: render any map module to a PNG in Node, without a browser.
// The site's map modules are browser ES modules; this harness gives them what they expect from a page
// (document.createElement('canvas'), devicePixelRatio, fetch of data/*.json, a measured <canvas>) using
// node-canvas, then runs them the same way js/app.js does: prepare -> drawBase -> drawPlaces.
// The PNG is the base map with the places overlay laid on top.
//
// Run from the book project folder (node-canvas lives in its node_modules):
//   node web/tools/render-test.mjs --type azimuthal --scale earth --out out.png
//   node web/tools/render-test.mjs --module js/mercator-map.js --class MercatorMap --scale world \
//        --origin "State College, PA" 40.79 -77.86 --place "Tokyo" 35.68 139.69 --out out.png [--w 1600 --h 1200]
// Options:
//   --type <id>               a type registered in js/map-types.js (uses its create())
//   --module <path>           a map module (relative to web/, or absolute); --class <Name> picks the export
//                             (default: the first exported class with a prepare() method)
//   --scale <id>              scale id (default: the type's first scale, or 'earth' with --module)
//   --origin <name> <lat> <lon>   the map's origin (default: State College, PA)
//   --place <name> <lat> <lon>    a place of interest; repeat for more
//   --highlight <name>        draw that place highlighted (as on hover)
//   --no-labels               the "Show labels" box unticked
//   --w <px>                  canvas width in pixels (default 1800); height follows the map's aspect
//   --h <px>                  optional height limit: the map shrinks to fit inside w x h (like the page does)
//   --dpr <n>                 device pixel ratio (default 1)
//   --probe <x>,<y>           also print lonLatAt / placeAt for that pixel (repeatable)
//   --base-only               write only the base map (no places overlay)
//   --bg <color>              backdrop under the map (default: the page's paper, #f3ecdb); none = transparent
//   --out <file.png>          where to write (default: render-test.png in the current folder)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const ROOT = path.resolve(WEB, '..');

// ---------- arguments ----------
const argv = process.argv.slice(2);
const opt = { places: [], probes: [], labels: true, w: 1800, h: null, dpr: 1, baseOnly: false, bg: '#f3ecdb' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], next = () => { if (i + 1 >= argv.length) die(`${a} needs a value`); return argv[++i]; };
  const placeArgs = () => { const name = next(), lat = +next(), lon = +next(); if (!Number.isFinite(lat) || !Number.isFinite(lon)) die(`${a} wants <name> <lat> <lon>`); return { name, lat, lon }; };
  switch (a) {
    case '--type': opt.type = next(); break;
    case '--module': opt.module = next(); break;
    case '--class': opt.cls = next(); break;
    case '--scale': opt.scale = next(); break;
    case '--origin': opt.origin = placeArgs(); break;
    case '--place': opt.places.push(placeArgs()); break;
    case '--highlight': opt.highlight = next(); break;
    case '--no-labels': opt.labels = false; break;
    case '--w': opt.w = +next(); break;
    case '--h': opt.h = +next(); break;
    case '--dpr': opt.dpr = +next(); break;
    case '--probe': opt.probes.push(next().split(',').map(Number)); break;
    case '--base-only': opt.baseOnly = true; break;
    case '--bg': opt.bg = next(); break;
    case '--out': opt.out = next(); break;
    case '-h': case '--help': console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1).filter((l, i, all) => all.slice(0, i + 1).every((m) => m.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0);
    default: die(`unknown option ${a} (try --help)`);
  }
}
function die(msg) { console.error('render-test: ' + msg); process.exit(1); }
if (!opt.type && !opt.module) opt.type = 'azimuthal';

// ---------- node-canvas, with the book's font ----------
// On Windows, node-canvas finds fonts only through fontconfig, with PANGOCAIRO_BACKEND=fc and FONTCONFIG_FILE
// (render-all.sh sets the same two). Pango reads them when it loads, before any of this code could set them,
// so the harness starts itself again with them set.
if (process.platform === 'win32' && !process.env.PANGOCAIRO_BACKEND) {
  let conf = path.join(ROOT, 'fonts.conf');
  if (!existsSync(conf)) { // outside the book project: a fontconfig file that knows web/fonts
    conf = path.join(os.tmpdir(), 'flat-earth-web-fonts.conf');
    writeFileSync(conf, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${path.join(WEB, 'fonts')}</dir><dir>WINDOWSFONTDIR</dir><cachedir>LOCAL_APPDATA_FONTCONFIG_CACHE</cachedir></fontconfig>`);
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, PANGOCAIRO_BACKEND: 'fc', FONTCONFIG_FILE: process.env.FONTCONFIG_FILE || conf } });
  process.exit(r.status ?? 1);
}
const require = createRequire(import.meta.url);
let canvasLib;
try { canvasLib = require(require.resolve('canvas', { paths: [process.cwd(), ROOT, WEB] })); }
catch { die('node-canvas is not installed here. Run this from the book project folder (npm install canvas).'); }
const { createCanvas, registerFont } = canvasLib;
registerFont(path.join(WEB, 'fonts', 'ArchitectsDaughter.ttf'), { family: 'Architect' });

// ---------- the bits of a browser page the map modules use ----------
globalThis.window = globalThis;
globalThis.devicePixelRatio = opt.dpr;
globalThis.document = {
  createElement(tag) { if (tag !== 'canvas') throw new Error(`render-test: document.createElement('${tag}') is not shimmed`); return createCanvas(300, 150); },
  fonts: { load: async () => [], ready: Promise.resolve() },
  documentElement: { style: { setProperty() {} }, classList: { add() {} } },
};
globalThis.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
const realFetch = globalThis.fetch;
// fetch('data/land.json') and other relative URLs read from web/ on disk
globalThis.fetch = async (url, init) => {
  const s = String(url);
  if (/^[a-z]+:\/\//i.test(s)) return realFetch(url, init);
  const file = path.join(WEB, s.replace(/^\.?\//, '').split('?')[0]);
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + s); }, text: async () => '' };
  const body = readFileSync(file);
  return { ok: true, status: 200, json: async () => JSON.parse(body.toString('utf8')), text: async () => body.toString('utf8'), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};
// Node prints a warning for ES modules in a folder without "type": "module"; it is harmless here
process.removeAllListeners('warning');

// ---------- data, exactly as js/app.js loads it ----------
const cache = {};
const load = (n) => (cache[n] ??= globalThis.fetch(`data/${n}.json`).then((r) => r.json()));
const [land, lakes, borders, labels] = await Promise.all(['land', 'lakes', 'borders', 'labels'].map(load));
const mapData = { land, lakes, borders, labels, load };

// ---------- the map module ----------
const HOME = { id: 'home', short: 'State College', name: 'State College, PA', lat: 40.7934, lon: -77.86 };
const place = (lat, lon, name) => ({ id: `${lat.toFixed(3)},${lon.toFixed(3)}`, short: name.split(',')[0], name, lat, lon });
const origin = opt.origin ? place(opt.origin.lat, opt.origin.lon, opt.origin.name) : HOME;
const places = opt.places.map((p) => place(p.lat, p.lon, p.name));

const base = createCanvas(opt.w, opt.w), overlay = createCanvas(opt.w, opt.w);
let cssW = opt.w / opt.dpr, aspect = 1;
const rect = () => ({ left: 0, top: 0, x: 0, y: 0, width: cssW, height: cssW / aspect, right: cssW, bottom: cssW / aspect });
base.getBoundingClientRect = rect; overlay.getBoundingClientRect = rect;

let map, type = null;
const t0 = performance.now();
if (opt.module) {
  const file = path.isAbsolute(opt.module) ? opt.module : existsSync(path.resolve(WEB, opt.module)) ? path.resolve(WEB, opt.module) : path.resolve(opt.module);
  const mod = await import(pathToFileURL(file).href);
  const Cls = opt.cls ? mod[opt.cls] : Object.values(mod).find((v) => typeof v === 'function' && v.prototype && typeof v.prototype.prepare === 'function');
  if (!Cls) die(opt.cls ? `${opt.module} has no export ${opt.cls}` : `${opt.module} exports no class with a prepare() method; pass --class`);
  map = new Cls(base, overlay, mapData);
  // pick up the registered entry if this module is registered, for its default scale
  try { const { MAP_TYPES } = await import(pathToFileURL(path.join(WEB, 'js', 'map-types.js')).href); type = MAP_TYPES.find((t) => t.module && path.resolve(WEB, 'js', t.module) === file) || null; } catch { /* map-types may not load in an old checkout */ }
} else {
  const { MAP_TYPES } = await import(pathToFileURL(path.join(WEB, 'js', 'map-types.js')).href);
  type = MAP_TYPES.find((t) => t.id === opt.type);
  if (!type) die(`no map type '${opt.type}'. Registered: ${MAP_TYPES.map((t) => t.id).join(', ')}`);
  map = await type.create(base, overlay, mapData);
}
const scale = opt.scale || type?.scales?.[0]?.id || 'earth';
if (type?.scales && !type.scales.some((s) => s.id === scale)) console.warn(`warning: scale '${scale}' is not in ${type.id}'s list (${type.scales.map((s) => s.id).join(', ')})`);

map.showLabels = opt.labels;
const info = await map.prepare(origin, scale);
aspect = map.aspect || 1;
if (opt.h && opt.w / aspect > opt.h) cssW = opt.h * aspect / opt.dpr; // fit inside w x h
const t1 = performance.now();
map.drawBase(origin);
const t2 = performance.now();
const hl = opt.highlight ? places.find((p) => p.name === opt.highlight || p.short === opt.highlight)?.id ?? null : null;
map.drawPlaces(places, { highlight: hl });
const t3 = performance.now();

// ---------- report and write ----------
const out = path.resolve(opt.out || 'render-test.png');
const W = base.width, H = base.height;
const png = createCanvas(W, H), pc = png.getContext('2d');
if (opt.bg && opt.bg !== 'none') { pc.fillStyle = opt.bg; pc.fillRect(0, 0, W, H); }
pc.drawImage(base, 0, 0);
if (!opt.baseOnly) pc.drawImage(overlay, 0, 0);
writeFileSync(out, png.toBuffer('image/png'));
const brief = {}; for (const [k, v] of Object.entries(info || {})) if (typeof v !== 'object' || v === null || Array.isArray(v)) brief[k] = v;
console.log(JSON.stringify({ type: type?.id ?? null, scale, origin: origin.name, places: places.map((p) => p.name), size: [W, H], aspect: +aspect.toFixed(4), info: brief }, null, 1));
console.log(`prepare ${Math.round(t1 - t0)} ms, drawBase ${Math.round(t2 - t1)} ms, drawPlaces ${Math.round(t3 - t2)} ms`);
for (const [x, y] of opt.probes) {
  const ll = map.lonLatAt(x / opt.dpr, y / opt.dpr), hit = map.placeAt(x / opt.dpr, y / opt.dpr);
  console.log(`probe ${x},${y}: lonLat ${ll ? ll.map((v) => v.toFixed(3)).join(', ') : 'null'}; place ${hit ?? 'none'}`);
}
console.log('wrote ' + out);
