# Flat Earth: the website

Interactive maps in the book's hand-drawn crayon style. Pick a map type (grouped by the book's sets), put any
place on it, add places of interest, and see the book's four-truths badges for that map beside it. A Downloads
page has the book's printables: the fold-up globes and the star wheel.

Live at **https://treyj1.github.io/flat-earth/**. The book's QR codes point at that address, at
`downloads/#fold` and at `downloads/#star-wheel`, so those three must keep working.

The site is plain static files. Everything it loads is relative to this folder (`data/`, `fonts/`, `js/`, `css/`,
`downloads/`), so it works from any sub-path. Only place search goes off-site (photon.komoot.io).

## Map types

In the MAP TYPE dropdown, grouped by the book's sets in book order (the first scale is the default):

| Set | Map type (`#m=`) | Scales (`#s=`) | Module |
|---|---|---|---|
| Distance maps | Azimuthal equidistant (`azimuthal`, the default, centered on State College) | Earth, Hemispheres, Continent, Country, State / province | `azimuthal-map.js` |
| Distance maps | Santa's maps, polar (`santa`) | Both halves, Top half, Bottom half | `polar-map.js` |
| Direction maps | Mercator (`mercator`) | World, Region (6,000 miles), Close up (1,000 miles) | `mercator-map.js` |
| Size maps | Equal Earth (`equal-earth`), Mollweide (`mollweide`) | World | `equal-area-map.js` |
| Airplane maps | Gnomonic (`gnomonic`) | Wide, Medium, Close | `gnomonic-map.js` |
| Butterfly maps | Cahill butterfly (`cahill`), Dymaxion (`dymaxion`) | Net | `polyhedral-map.js` (+ `poly-net.js`) |
| Shape maps | Stereographic (`stereographic`) | Tiny planet, Hemisphere, Region | `stereographic-map.js` |

Each entry in `js/map-types.js` carries its badges (as on the book's plate for that set), the badge notes and the
blurb. Santa's single-half views say in the note when an added place is on the other half (`placesNote(places)`,
an optional hook the page calls after every change to the places).

## Publishing

The GitHub repository `treyj1/flat-earth` holds **only the contents of this `web/` folder**, at its root.
GitHub Pages serves its `main` branch (root folder) at https://treyj1.github.io/flat-earth/. `.nojekyll` tells
Pages to serve the files as they are, and `404.html` is the page for a missing address.

To update the site after the book changes:

1. Re-export the book (`export.py`), then copy the refreshed printables from the book's `outputs/` into
   `downloads/`: `B2-butterfly-print-letter.pdf`, `B2-butterfly-print-11x17.pdf`, `B6-dymaxion-print-letter.pdf`,
   `B6-dymaxion-print-11x17.pdf`, `B6-dymaxion-cut-and-fold.pdf`, `W0-star-wheel-assembled.pdf`,
   `W1-star-wheel-disk.pdf`, `W2-star-wheel-front-cover.pdf`, `W3-star-wheel-how-to.pdf`.
2. Run `python web/tools/build-print.py` from the book folder. It rebuilds the star wheel print packs and the
   preview pictures, and writes the file sizes into `downloads/index.html`.
3. If the map data changed, run `node web/tools/build-data.js`.
4. Look at it locally (below), then copy `web/` into the repository, commit and push. Pages updates in a minute
   or two.

Keep every link and fetch relative (no leading `/`, no `localhost`), and nothing outside this folder, or the
site breaks under `/flat-earth/`. The one exception is `404.html`, which works out the site's folder from the
address, because Pages shows it for missing addresses at any depth.

## Run it locally

Double-click **`Open Flat Earth website.vbs`** in the project folder. It starts a small web server in the
background (no window) and opens http://localhost:8791 in your browser. Double-click it again any time; it
reuses the server if it's already running. **`Stop Flat Earth website.vbs`** shuts the server down.
Both need Python installed.

By hand, the same thing is:

```
python web/tools/serve.py
```

Then open http://localhost:8791. Opening `index.html` directly (file://) will not work, because the page
loads its map data with fetch. The server sends no-cache headers, so edits show on reload.

## How the style matches the book

The book's pages are drawn by `crayon-kit/scripts/crayon-kit.js` on node-canvas. node-canvas speaks the
same Canvas 2D API as a browser, so `js/crayon.js` is a direct port of that engine: same seeded crayon
strokes, hatching, handwriting, paper and grain. One change: dashes are batched by colour, pressure and
width before stroking. That makes a whole map draw in about 1.5 s instead of 12 s, and it looks the same.

The page chrome uses the same engine. `js/book-styles.js` paints small textures on load (the paper,
the crumpled double frame, the baby-blue projection highlight, the pencil underline, the orange place dot).
It hands each one to CSS as a custom property (`--tex-paper`, `--tex-frame`, ...), so plain HTML
panels, buttons and inputs wear the book's materials. Colours and the Architects Daughter lettering
match the interior pages (`#f3ecdb` paper, `#1d1b1e` ink, the WATER blues).

## Files

| File | What it does |
|---|---|
| `index.html`, `css/site.css` | The maps page and the shared page style |
| `downloads/index.html`, `css/downloads.css` | The Downloads page (`#fold`, `#star-wheel`), its PDFs and `img/` previews |
| `404.html` | Page for a missing address, with links to Maps and Downloads |
| `activities.html` | Old address: sends the reader on to `downloads/` |
| `.nojekyll` | Tells GitHub Pages not to run Jekyll |
| `favicon.svg` | The tab icon (a little globe with the orange place dot), linked from every page so browsers don't ask for `/favicon.ico` outside the site's folder |
| `js/crayon.js` | Browser port of the crayon engine |
| `js/book-styles.js` | Paints the CSS textures with the crayon engine |
| `js/projection.js` | Azimuthal equidistant from any origin, inverse, distance, heading, great circles (to the exact antipode too: through the pole nearer the origin) |
| `js/map-common.js` | Everything map types share: paper, water and land, coasts, lakes, borders, lettering, places, badges, seam-safe projection helpers, `BaseMap`, `renderBase` |
| `js/azimuthal-map.js` | Distance maps: five scales (Earth, Hemispheres, Continent, Country, State/province), following `world-azimuthal.js` and `hemi-map.js` for any origin |
| `js/polar-map.js` | Santa's maps: the two polar halves, following `santa-map.js` |
| `js/mercator-map.js` | Direction maps: Mercator with compass lines, straight headings and shortest routes, following `merc-core.js` |
| `js/equal-area-map.js` | Size maps: Equal Earth and Mollweide, with equal-ground circles, following `equal-earth.js` |
| `js/gnomonic-map.js` | Airplane maps: gnomonic, where every straight line is a shortest route, following `gno-map.js` |
| `js/polyhedral-map.js`, `js/poly-net.js` | Butterfly maps: Cahill's 8 triangles and Fuller's Dymaxion 20, following `poly-engine.js`, `butterfly.js`, `dymaxion.js` |
| `js/stereographic-map.js` | Shape maps: stereographic tiny planet, hemisphere and region, following `st-map.js` |
| `js/search.js` | Place search (Photon, a free OpenStreetMap geocoder); swap providers here |
| `js/map-types.js` | The list behind the MAP TYPE dropdown: labels, sets, badges, blurbs, scales, and how to load each module |
| `js/app.js` | Wiring; state lives in the URL hash (`#m=<type>&s=<scale>&o=...&p=...`) so any map can be shared. Older links without `m` or `s` still load |
| `data/*.json` | Natural Earth land, lakes, borders, country labels, trimmed for the web. `countries`, `admin1` and `admin1-lines` load only for the Continent, Country and State views |
| `tools/build-data.js` | Rebuilds `data/` from the book's Natural Earth files: `node web/tools/build-data.js` |
| `tools/render-test.mjs` | Renders any map type to a PNG in Node, no browser needed (see below) |
| `tools/build-print.py` | Makes the star wheel print packs, the Downloads previews and file sizes from the book's `outputs/` |
| `tools/serve.py` | Local server for testing (no caching) |

## Scales

- **Earth**: the whole world in one disk; the rim is the antipode.
- **Hemispheres**: the book's near half and far half side by side. The far half is centered on the antipode, and its rings still measure miles from the chosen center.
- **Continent, Country, State / province**: still centered on the chosen place, in a box fitted to the region that place is in. Far-flung islands don't stretch the box (Hawaii for the US, Svalbard for Norway). Russia counts as Europe west of 60 degrees E and as Asia east of it. Ring spacing adapts to the box.

Known gap: Natural Earth's 50m state/province file covers only nine countries (Australia, Brazil, Canada, China, India, Indonesia, Russia, South Africa, United States). Anywhere else, State / province falls back to the country and says so. Swapping in the 10m file (`ne_10m_admin_1_states_provinces`) in `tools/build-data.js` would cover the whole world.

## Adding a map type

1. Write `js/<name>-map.js` exporting a class (the module contract below). Use `crayon.js` for every stroke
   and `map-common.js` for everything that is not your projection.
2. Add an entry to `MAP_TYPES` in `js/map-types.js` (its shape is documented at the top of that file):
   `id, label, group, head, proj, scales, badges, badgeNotes, blurb, originMatters, module, create`.
   `group` is one of `GROUPS` (the book's sets, in book order; the dropdown's groups follow that order, whatever
   order the entries are in). `badges` uses `'true'` (green), `'half'` (true only in places) and `'lost'` (red).
   `create` loads the module only when it is picked:
   `(base, overlay, data) => import('./x-map.js').then((m) => new m.XMap(base, overlay, data))`.
3. Look at it with the harness (below), then in the page.

### The module contract

The page makes one map object per type and calls, in this order:

| Member | What it must do |
|---|---|
| `constructor(base, overlay, data)` | `base` and `overlay` are `<canvas>` elements (the base map, and a transparent one on top for places). `data` = `{ land, lakes, borders, labels, load(name) }`; `load('countries')`, `load('admin1')`, `load('admin1-lines')` fetch more of `data/` once and cache it. |
| `async prepare(origin, scale)` | Work out the view (set `this.origin`, `this.view`) and return the heading: `{ title, subtitle?, prose?, note?, legend? }`. `prose` is an array of strings and `{ strong: text }` parts. Anything missing gets a plain default. |
| `aspect` (getter) | width / height of the map, read after `prepare` to shape the frame |
| `showLabels` | set by the page before `drawBase` (the "Show labels" box) |
| `drawBase(origin)` | draw the whole base map on `base` (size the canvases first: `this.sizeCanvases()`) |
| `drawPlaces(places, { highlight })` | redraw the overlay: the origin and each place `{ id, name, short, lat, lon }`; `highlight` is a place id (hover) |
| `lonLatAt(clientX, clientY)` | `[lon, lat]` under the mouse, or `null` off the map |
| `placeAt(clientX, clientY)` | id of the place dot under the mouse, or `null` |

`BaseMap` (in `map-common.js`) does all of that except `prepare` and `drawBase`. Extend it, and in `prepare` set
`this.view = { W, H, panels }` with `W = MAP_W` (1800, the logical width every map draws in). A **panel** is one
projected piece of the map:

```js
{ shape,           // its edge on the canvas: { type: 'circle', cx, cy, r } | { type: 'rect', x0, y0, x1, y1 }
                   //   | { type: 'poly', rings: [[[x, y], ...], ...] }
  geo,             // how the sphere lands on it (below)
  inverse(x, y),   // logical px -> [lon, lat], or null (for clicks)
  fwd?, labelAt? } // optional; made from geo when missing
```

`geo` is one of two kinds, and the helpers clip, fill and break lines at seams from it:

- **`{ type: 'lonlat', lon0, lon: [-180, 180], lat: [-90, 90], fwd(dlon, lat) }`** for cylindrical,
  pseudo-cylindrical and lobed maps. `dlon` is the longitude **relative to `lon0`** and is never wrapped (the left
  edge is `lon[0]`), so `fwd` must not wrap it either. Give one panel per lobe for an interrupted map.
- **`{ type: 'cap', center: { lon, lat }, maxC, fwd(lon, lat), rim }`** for maps that show everything within
  `maxC` radians of a center (gnomonic, stereographic, orthographic, polar). `fwd` must work out to `maxC`;
  `rim` is the map's edge on the canvas (`{ cx, cy, r }` or a closed `[[x, y], ...]`). Land that wraps the far
  side is filled out to the rim. Keep `maxC` under 180 degrees (in radians).

Then `drawBase(origin) { this.origin = origin; renderBase(this, { seed: seedOf(...), hooks }); }` draws the book's
whole map: paper, hatched water, paper land with the data seams closed, country lettering, lakes, borders, coasts,
the rim, the neatline border and the grain. Your overlays go in `hooks`: `afterWater`, `beforeLines` (graticules,
rings), `afterLines`, `afterText`. Each gets `env = { art, ctx, map, panels, W, H, isLand, placed, texts, hitsLabel,
layPaper, paperCopy, show }`. Other `renderBase` options: `labelRank`, `lakeRank`, `sizes`, `maxStep`, `reserve`
(boxes kept free of lettering), `admin`, `outlines`, `rimRect`, `border`.

Places are drawn by `BaseMap.drawPlaces`: an orange dot and a NAME over miles label on a paper patch for each place.
Labels try spots beside the dot, then farther out with an ink leader line, all clear of the map's lettering, before
they may sit on lettering (`pickLabelBox` in `map-common.js`; maps that predict label spots use the same order).
Every route is drawn before any dot or label, so a label's paper patch always covers a route rather than a route
crossing out a name, and routes break around the base map's own names (`crayonAround`). A map whose drawn area is not
its whole box (the butterfly nets) can give `labelFits(box)`, and labels then stay off the gaps.
The origin gets the book's ink star (`this.originMark = 'star'`, the default) or is left to the base map
(`'none'`, as the azimuthal map does with its center dot). The route from the origin is the shortest route (a great
circle) by default: override `routeOf(origin, p)` (return a lon/lat line, or `null` for none) or `drawRoute`.

### What map-common.js provides

- Helpers: `seedOf`, `seedOfPlace`, `fmt`, `miText`, `displayName`, `antipodeOf`, `antipodeText`, `isCut`, `wrapLon`,
  `toV`, `fromV`, `ang`, `capOf`, `kmBetween`, `shapePath`, `inShape`, `boundsOf`, `clipRuns`, `splitAt`, `pxArea`,
  `roundRect`.
- Projection: `geoForward(geo)`, `projectFill(ring, geo)`, `projectLines(line, geo, opts)`,
  `projectPolyline(fwd, line, opts)` (for any `fwd` that returns `null` off the map), `unwrapLine`, `ringNear`,
  `labelAtFromForward(fwd)`, `graticule({ step })`.
- Drawing steps, for maps that do their own geometry (as `azimuthal-map.js` does): `paperUnderPanels`, `addRing`,
  `waterAndLand`, `landMask`, `placeLabels`, `countryLabels`, `drawLinework`, `lineInker`, `drawRim`,
  `letterLabels`, `centerDot`, `originStar`, `drawPlaceLayer`, `crayonAround` (a route broken around lettering).
- Styles: `LINE` (the book's crayon settings for lake, admin, border, coast, outline, rim, graticule, route) and
  `WATER_LAYERS`.
- Badges: `drawBadge(art, key, state, cx, cy, r)`, `paintBadge(canvas, key, state)`, `BADGE_KEYS`, `BADGE_LEGEND`.
- `BaseMap`, `renderBase`, `sizeCanvases`, `toLogical`, `MAP_W`, `EDGE`, `PAPER`.

### Looking at a map without a browser

`tools/render-test.mjs` runs a map module in Node with node-canvas (from the book project's `node_modules`) and
writes a PNG of the base map with the places on top. Run it from the book project folder:

```
node web/tools/render-test.mjs --type azimuthal --scale hemispheres --out hemi.png
node web/tools/render-test.mjs --module js/mercator-map.js --class MercatorMap --scale world --origin "State College, PA" 40.79 -77.86 --place "Tokyo" 35.68 139.69 --out merc.png --w 1600 --h 1200
```

More options: `--place` (repeat it), `--highlight <name>`, `--no-labels`, `--dpr 2`, `--probe x,y` (prints
`lonLatAt` and `placeAt` at that pixel), `--base-only`, `--bg <color>` (default: the page's paper; `none` keeps it
transparent). `--help` lists them all. It prints the heading info from `prepare` and how long each step took.
On Windows it sets `PANGOCAIRO_BACKEND=fc` and `FONTCONFIG_FILE` (the book's `fonts.conf`) for itself, as
`render-all.sh` does. The same seed always gives the same pixels, so two runs can be compared byte for byte.

Debug timing for each drawing stage in the browser: run `window.FE_DEBUG = 1` in the console, then redraw.
