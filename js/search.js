// Flat Earth website: place search.
// Uses Photon (photon.komoot.io), a free OpenStreetMap geocoder built for search-as-you-type.
// Swap this one function to change providers; the rest of the site only needs
// { id, name, short, detail, lat, lon } back.
const PHOTON = 'https://photon.komoot.io/api/';

export async function searchPlaces(query, { signal, limit = 7 } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  let res;
  try { res = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=${limit}&lang=en`, { signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    // (offline, or the search service is down: say so plainly; clicking the map still works)
    throw new Error('Search needs the internet, and it can’t reach it right now. You can still click the map.');
  }
  if (!res.ok) throw new Error('Search is not answering right now. Try again in a little while, or click the map.');
  const json = await res.json();
  const seen = new Set();
  return json.features.map((f) => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    const short = p.name || p.city || p.state || p.country || 'Unnamed place';
    const parts = [p.city !== short ? p.city : null, p.state !== short ? p.state : null, p.country !== short ? p.country : null].filter(Boolean);
    const kind = (p.osm_value || p.type || '').replace(/_/g, ' ');
    return {
      id: `${p.osm_type || 'x'}${p.osm_id || Math.round(lat * 1e4) + '_' + Math.round(lon * 1e4)}`,
      short, name: [short, ...parts].join(', '), detail: [parts.join(', '), kind].filter(Boolean).join(' · '), lat, lon,
    };
  }).filter((r) => (seen.has(r.name) ? false : seen.add(r.name)));
}

// Name for a spot the reader clicked on the map
export async function nameAt(lat, lon, { signal } = {}) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`, { signal });
    const f = (await res.json()).features?.[0];
    if (!f) return null;
    const p = f.properties;
    return p.city || p.name || p.state || p.country || null;
  } catch { return null; }
}

// Wire an <input> to a results list with debounce, keyboard and click selection.
export function attachSearch(input, list, onPick) {
  let timer = 0, ctrl = null, items = [], active = -1;
  const close = () => { list.hidden = true; list.innerHTML = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const render = (msg) => {
    list.innerHTML = '';
    if (msg) { const li = document.createElement('li'); li.className = 'note'; li.setAttribute('role', 'option'); li.setAttribute('aria-disabled', 'true'); li.textContent = msg; list.append(li); }
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.id = `${list.id}-${i}`; li.setAttribute('aria-selected', String(i === active));
      li.className = i === active ? 'active' : '';
      li.innerHTML = `<span class="r-name"></span><span class="r-detail"></span>`;
      li.querySelector('.r-name').textContent = it.short;
      li.querySelector('.r-detail').textContent = it.detail;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      list.append(li);
    });
    list.hidden = !msg && !items.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (active >= 0 && items.length) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const pick = (i) => { const it = items[i]; if (!it) return; input.value = ''; close(); onPick(it); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value;
    if (q.trim().length < 2) { close(); return; }
    timer = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController();
      render('Looking…');
      try { items = await searchPlaces(q, { signal: ctrl.signal }); active = items.length ? 0 : -1; render(items.length ? null : 'No places found.'); }
      catch (e) { if (e.name !== 'AbortError') { items = []; render(e.message || 'Search failed.'); } }
    }, 280);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}
