// Flat Earth website: page wiring.
// State lives in the URL hash (#m=type&s=scale&l=0&o=lat,lon,name&p=lat,lon,name&p=...) so any map can be bookmarked or shared.
// Older links without m or s still load (they get the default type and that type's first scale).
// Map types come from map-types.js; each one's module loads the first time it is picked.
import { applyBookStyles } from './book-styles.js';
import { DEFAULT_TYPE, typeById, groupedTypes, HOME } from './map-types.js';
import { attachSearch, nameAt } from './search.js';
import { distanceMi, headingDeg, compassWord } from './projection.js';
import { paintBadge, BADGE_KEYS, BADGE_LEGEND, displayName as display, fmt } from './map-common.js';

const $ = (s) => document.querySelector(s);
const place = (lat, lon, name) => ({ id: `${lat.toFixed(3)},${lon.toFixed(3)}`, short: name.split(',')[0], name, lat, lon });
// two places are the same spot when their ids match or they sit within about 100 m (State College from the
// Back button has id 'home'; the same town read back from a shared link has a lat,lon id)
const samePlace = (a, b) => a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lon - b.lon) < 1e-3);
const scalesOf = (typeId) => typeById(typeId).scales;
const scaleOk = (typeId, s) => scalesOf(typeId).some((q) => q.id === s);

const state = { type: DEFAULT_TYPE, scale: scalesOf(DEFAULT_TYPE)[0].id, origin: HOME, places: [], labels: true };

// ---------- URL hash ----------
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const parse = (v) => { const [a, b, ...n] = (v || '').split(','); const lat = +a, lon = +b; return Number.isFinite(lat) && Number.isFinite(lon) && v ? place(lat, lon, n.join(',') || 'Unnamed place') : null; };
  state.type = typeById(h.get('m')).id;
  state.scale = scaleOk(state.type, h.get('s')) ? h.get('s') : scalesOf(state.type)[0].id;
  state.labels = h.get('l') !== '0';
  state.origin = parse(h.get('o')) || HOME;
  state.places = h.getAll('p').map(parse).filter(Boolean);
}
function writeHash() {
  const h = new URLSearchParams();
  const enc = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)},${p.name}`;
  h.set('m', state.type);
  h.set('s', state.scale);
  if (!state.labels) h.set('l', '0');
  if (state.origin !== HOME) h.set('o', enc(state.origin));
  state.places.forEach((p) => h.append('p', enc(p)));
  const s = h.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname);
}

// ---------- map ----------
let map, mapData, drawing = null;
// build the map for state.type (only when the type actually changes), and fill the scale dropdown, the heading
// furniture (running head, projection tag) and the badge row for it
async function useType() {
  const t = typeById(state.type);
  state.type = t.id;
  if (!scaleOk(t.id, state.scale)) state.scale = t.scales[0].id;
  if (map && map.typeId === t.id) return;
  $('#map-type').value = t.id;
  $('.proj-tag').textContent = t.proj;
  $('.running-head').innerHTML = t.head.replace(/ {2}/g, ' &nbsp;');
  const sel = $('#map-scale');
  sel.innerHTML = '';
  for (const s of t.scales) sel.append(new Option(s.label, s.id));
  sel.closest('.field').hidden = t.scales.length < 2;
  renderTruths(t);
  renderOriginWords(t);
  $('#map-base').setAttribute('aria-label', `${t.label} map`);
  // (redraws are queued one at a time, so two types never load at once)
  map = await t.create($('#map-base'), $('#map-places'), mapData);
  map.typeId = t.id;
}
// The four truths for this map type, painted with the crayon engine like the book's plates
const badgeCache = new Map();
function renderTruths(t) {
  const ul = $('#badges'); ul.textContent = '';
  const names = { true: 'true everywhere', half: 'true only in places', lost: 'lost' };
  BADGE_KEYS.forEach((key, i) => {
    const st = t.badges?.[key] || 'lost', note = t.badgeNotes?.[key] || '';
    const li = document.createElement('li'); li.className = 'badge';
    const ck = key + '|' + st;
    let img = badgeCache.get(ck);
    if (!img) { img = paintBadge(document.createElement('canvas'), key, st, { size: 64, seed: 31 + i }).toDataURL('image/png'); badgeCache.set(ck, img); }
    const said = `${key[0].toUpperCase() + key.slice(1)}: ${names[st] || st}.`;
    li.title = note ? `${said} ${note}` : said;
    // (screen readers read the picture's alt text; the caption under it repeats the name, so it is hidden from them)
    const pic = document.createElement('img'); pic.src = img; pic.alt = li.title; pic.width = 64; pic.height = 64;
    const cap = document.createElement('span'); cap.className = 'badge-name'; cap.textContent = key.toUpperCase();
    cap.setAttribute('aria-hidden', 'true');
    li.append(pic, cap);
    ul.append(li);
  });
  $('#badge-legend').textContent = BADGE_LEGEND;
  $('#blurb').textContent = t.blurb || '';
}
// Maps centered on the reader's place say "center"; the others only mark it with a star
function renderOriginWords(t) {
  const centered = t.originMatters !== false;
  $('#origin-label').textContent = centered ? 'CENTER OF THE MAP' : 'MY PLACE (THE STAR)';
  $('#pop-center').textContent = centered ? 'Center here' : 'Make this my place';
}
async function redrawWorld() {
  await useType();
  $('#map-scale').value = state.scale;
  const status = $('#map-status');
  $('#popover').hidden = true;
  status.textContent = 'Drawing the map…';
  status.hidden = false;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // let "Drawing…" paint first
  // the reader may have picked another type meanwhile; the redraw queued for that will draw it
  if (map.typeId !== state.type || !scaleOk(map.typeId, state.scale)) return;
  const origin = state.origin, info = await map.prepare(origin, state.scale);
  $('#map-scale').value = state.scale;
  $('.map-frame').style.setProperty('--aspect', map.aspect);
  renderHeading(info);
  await new Promise((r) => requestAnimationFrame(r)); // the frame may have changed shape
  const t0 = performance.now();
  map.showLabels = state.labels;
  map.drawBase(origin);
  map.drawPlaces(state.places);
  console.log(`map drawn in ${Math.round(performance.now() - t0)} ms`);
  status.hidden = true;
}
function queueWorld() { drawing = (drawing || Promise.resolve()).then(redrawWorld).catch(showError); return drawing; }
function showError(e) { console.error(e); const s = $('#map-status'); s.hidden = false; s.textContent = 'Something went wrong drawing the map: ' + e.message; }

// ---------- text ----------
// parts: strings, or { strong: text } for the emphasised place name
function setProse(parts) {
  const p = $('#prose'); p.textContent = '';
  for (const part of parts) {
    if (typeof part === 'string') p.append(part);
    else { const s = document.createElement('strong'); s.textContent = part.strong; p.append(s); }
  }
}
// info comes from the map's prepare(): { title, subtitle?, prose?, note?, legend? }
function renderHeading(info) {
  const name = display(state.origin), centered = typeById(state.type).originMatters !== false;
  $('#title').textContent = info.title || '';
  $('#subtitle').textContent = info.subtitle ?? (centered ? 'CENTERED ON ' : 'THE STAR: ') + name.toUpperCase();
  setProse(info.prose ?? (centered ? ['Centered on ', { strong: name }, '.'] : ['The star marks ', { strong: name }, '.']));
  viewNote = info.note || '';
  renderNote();
  $('#legend').textContent = info.legend || 'Headings are degrees clockwise from north.';
  // what a screen reader says for the map picture: the map type, its title and what it is centered on
  const words = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  $('#map-base').setAttribute('aria-label', `${typeById(state.type).label} map: ${words(info.title || '')}. ${centered ? 'Centered on' : 'The star marks'} ${name}.`);
}
// the note under the heading: the map's own note for this view, plus (when the map type offers placesNote) a line
// about added places this view cannot show
let viewNote = '';
function renderNote() {
  const text = [viewNote, (map?.view && map.placesNote?.(state.places)) || ''].filter(Boolean).join(' ');
  const note = $('#scale-note');
  note.textContent = text; note.hidden = !text;
}
function renderList() {
  const o = state.origin;
  const ul = $('#place-list');
  ul.innerHTML = '';
  $('#places-empty').hidden = state.places.length > 0;
  for (const p of state.places) {
    const li = document.createElement('li');
    const d = distanceMi(o, p), hd = headingDeg(o, p);
    li.innerHTML = `<span class="p-dot" aria-hidden="true"></span>
      <span class="p-body"><span class="p-name"></span><span class="p-meta"></span></span>
      <button class="p-center" type="button"></button>
      <button class="p-remove" type="button" aria-label="Remove">&times;</button>`;
    li.querySelector('.p-name').textContent = p.name;
    li.querySelector('.p-remove').setAttribute('aria-label', `Remove ${p.name}`);
    const centered = typeById(state.type).originMatters !== false, pc = li.querySelector('.p-center');
    pc.textContent = centered ? 'center' : 'my place'; pc.title = centered ? 'Center the map here' : 'Make this my place (the star)';
    li.querySelector('.p-meta').textContent = `${fmt(d)} miles, heading ${Math.round(hd)} degrees (${compassWord(hd)})`;
    li.querySelector('.p-remove').addEventListener('click', () => { state.places = state.places.filter((q) => q !== p); changed(false); });
    li.querySelector('.p-center').addEventListener('click', () => setOrigin(p));
    li.addEventListener('mouseenter', () => map?.view && map.drawPlaces(state.places, { highlight: p.id }));
    li.addEventListener('mouseleave', () => map?.view && map.drawPlaces(state.places));
    ul.append(li);
  }
}
function changed(world) {
  writeHash(); renderList();
  if (world || !map?.view) queueWorld(); else { map.drawPlaces(state.places); renderNote(); }
}
function setOrigin(p) {
  // the old centre becomes a place on the map, so the reader keeps their bearings
  const old = state.origin;
  if (samePlace(p, old)) return; // already the center (this used to add the center as a place too)
  state.places = state.places.filter((q) => !samePlace(q, p));
  if (!state.places.some((q) => samePlace(q, old))) state.places.unshift(old);
  state.origin = p;
  changed(true);
}
function addPlace(p) {
  if (samePlace(p, state.origin) || state.places.some((q) => samePlace(q, p))) return;
  state.places.push(p);
  changed(false);
}

// ---------- clicking the map ----------
function setupPopover() {
  const pop = $('#popover'), wrap = $('.map-frame');
  let current = null, ctrl = null;
  const hide = () => { pop.hidden = true; current = null; };
  wrap.addEventListener('click', async (e) => {
    if (pop.contains(e.target) || !map?.view) return;
    const hitId = map.placeAt(e.clientX, e.clientY);
    const hit = hitId && state.places.find((p) => p.id === hitId);
    const ll = hit ? [hit.lon, hit.lat] : map.lonLatAt(e.clientX, e.clientY);
    if (!ll) { hide(); return; }
    const [lon, lat] = ll;

    const d = distanceMi(state.origin, { lat, lon }), hd = headingDeg(state.origin, { lat, lon });
    current = hit || place(lat, lon, `${Math.abs(lat).toFixed(2)} ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)} ${lon >= 0 ? 'E' : 'W'}`);
    $('#pop-name').textContent = hit ? hit.name : 'Finding the name…';
    $('#pop-meta').textContent = d < 1 ? 'The center of the map.' : `${fmt(d)} miles from ${state.origin.short}, heading ${Math.round(hd)} degrees (${compassWord(hd)}).`;
    $('#pop-add').hidden = !!hit;
    pop.hidden = false;
    // keep the popover inside the map frame
    const rect = wrap.getBoundingClientRect();
    pop.style.left = Math.max(0, Math.min(rect.width - pop.offsetWidth, e.clientX - rect.left + 12)) + 'px';
    pop.style.top = Math.max(0, Math.min(rect.height - pop.offsetHeight, e.clientY - rect.top + 12)) + 'px';
    if (!hit) {
      ctrl?.abort(); ctrl = new AbortController();
      const mine = current, name = await nameAt(lat, lon, { signal: ctrl.signal });
      if (current !== mine) return;
      if (name) { current = place(lat, lon, name); $('#pop-name').textContent = name; }
      else $('#pop-name').textContent = mine.name;
    }
  });
  $('#pop-add').addEventListener('click', () => { if (current) addPlace(current); hide(); });
  $('#pop-center').addEventListener('click', () => { if (current) setOrigin(current); hide(); });
  $('#pop-close').addEventListener('click', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// ---------- start ----------
async function start() {
  applyBookStyles();
  await document.fonts.load('24px Architect');
  const cache = {};
  const load = (n) => (cache[n] ??= fetch(`data/${n}.json`).then((r) => r.json())); // region data loads only when a view needs it
  const [land, lakes, borders, labels] = await Promise.all(['land', 'lakes', 'borders', 'labels'].map(load));
  mapData = { land, lakes, borders, labels, load };
  // MAP TYPE dropdown, grouped by the book's sets. Switching type keeps the origin, the places and (when the new
  // type has it) the scale.
  const sel = $('#map-type');
  for (const [group, types] of groupedTypes()) {
    const og = document.createElement('optgroup'); og.label = group;
    for (const t of types) og.append(new Option(t.label, t.id));
    sel.append(og);
  }
  sel.addEventListener('change', () => { state.type = sel.value; if (!scaleOk(state.type, state.scale)) state.scale = scalesOf(state.type)[0].id; changed(true); });
  const scaleSel = $('#map-scale');
  scaleSel.addEventListener('change', () => { state.scale = scaleSel.value; changed(true); });
  const lab = $('#labels-toggle');
  lab.addEventListener('change', () => { state.labels = lab.checked; changed(true); });
  readHash();
  lab.checked = state.labels;
  renderList();
  attachSearch($('#origin-search'), $('#origin-results'), setOrigin);
  attachSearch($('#place-search'), $('#place-results'), addPlace);
  $('#home-btn').addEventListener('click', () => setOrigin(HOME));
  $('#clear-btn').addEventListener('click', () => { state.places = []; changed(false); });
  setupPopover();
  window.addEventListener('hashchange', () => { readHash(); writeHash(); lab.checked = state.labels; renderList(); queueWorld(); });
  writeHash(); // the address always says which map type and scale are showing
  await queueWorld();
  // redraw only when the map's real pixel size changes a lot (not for every small resize)
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => {
    if (!map?.view) return;
    const px = $('#map-base').getBoundingClientRect().width * (window.devicePixelRatio || 1);
    if (Math.abs(px - $('#map-base').width) > 120) queueWorld();
  }, 300); });
}
start().catch(showError);
