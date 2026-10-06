// Flat Earth website: the list of map types behind the MAP TYPE dropdown.
// Each entry describes one projection; its module is loaded only when the reader picks it, so a type that
// fails to load cannot break the others. The dropdown (grouped by the book's sets), running head, projection tag,
// badge row, blurb, SCALE dropdown and URL (#m=<id>&s=<scale>) all come from this list.
//
// Entry shape (README.md, "Adding a map type", has the module contract):
//   id            short URL-safe id, used in #m=<id>
//   label         text in the MAP TYPE dropdown
//   group         the book set it belongs to: one of GROUPS below (the dropdown's <optgroup>)
//   head          running head, as on the book pages: 'FLAT EARTH  /  DISTANCE MAPS'
//   proj          projection tag under the title: 'AZIMUTHAL EQUIDISTANT PROJECTION'
//   scales        [{ id, label }] for the SCALE dropdown; the first is the default
//   badges        the four truths, each 'true' (green: true everywhere), 'half' (true only in places) or 'lost' (red),
//                 as on the book's plate for that set: { direction, distance, size, shape }
//   badgeNotes    one short line per badge, shown as its caption on hover / for screen readers
//   blurb         one or two sentences in the book's voice: what this map keeps true and what it gives up
//   originMatters true: the map is centered on the reader's place; false: the place is only marked (a star)
//   module        the module file, relative to js/ (the render-test harness uses it to find the entry)
//   create(base, overlay, data) -> a map object (or a Promise of one)
// (Nothing is imported here: each map module loads on demand through its create().)

// The book's sets, in book order. The dropdown groups follow this order whatever order entries are listed in.
// (Santa's maps are in the distance set, as in the book.)
export const GROUPS = ['Distance maps', 'Direction maps', 'Size maps', 'Airplane maps', 'Butterfly maps', 'Shape maps'];

// The reader's starting place (and the book's home)
export const HOME = { id: 'home', short: 'State College', name: 'State College, PA', lat: 40.7934, lon: -77.86 };

export const MAP_TYPES = [
  {
    id: 'azimuthal',
    label: 'Azimuthal equidistant',
    group: 'Distance maps',
    head: 'FLAT EARTH  /  DISTANCE MAPS',
    proj: 'AZIMUTHAL EQUIDISTANT PROJECTION',
    // (the same list as SCALES in azimuthal-map.js)
    scales: [
      { id: 'earth', label: 'Earth' },
      { id: 'hemispheres', label: 'Hemispheres' },
      { id: 'continent', label: 'Continent' },
      { id: 'country', label: 'Country' },
      { id: 'state', label: 'State / province' },
    ],
    badges: { direction: 'half', distance: 'half', size: 'lost', shape: 'lost' },
    badgeNotes: {
      direction: 'True only along lines from the center.',
      distance: 'True only along lines from the center.',
      size: 'Lands far from the center get stretched bigger.',
      shape: 'Shapes stretch more and more toward the edge.',
    },
    blurb: 'Every straight line from the center is a shortest route, and its length in miles is true. Far from the center, sizes and shapes stretch.',
    originMatters: true,
    module: 'azimuthal-map.js',
    create: (base, overlay, data) => import('./azimuthal-map.js').then((m) => new m.AzimuthalMap(base, overlay, data)),
  },
  {
    id: 'santa',
    label: 'Santa’s maps (polar)',
    group: 'Distance maps',
    head: 'FLAT EARTH  /  SANTA’S MAPS',
    proj: 'POLAR AZIMUTHAL EQUIDISTANT PROJECTION',
    // (the same list as SCALES in polar-map.js)
    scales: [
      { id: 'both', label: 'Both halves' },
      { id: 'north', label: 'Top half (North Pole)' },
      { id: 'south', label: 'Bottom half (South Pole)' },
    ],
    badges: { direction: 'half', distance: 'half', size: 'lost', shape: 'lost' },
    badgeNotes: {
      direction: 'True only along lines from the pole.',
      distance: 'True only along lines from the pole.',
      size: 'Lands near the equator get stretched bigger.',
      shape: 'Shapes stretch sideways toward the edge.',
    },
    blurb: 'Santa’s view: the top half of the world seen from the North Pole, and the bottom half from the South Pole. Every straight line from a pole is a shortest route, and its length in miles is true.',
    originMatters: false,
    module: 'polar-map.js',
    create: (base, overlay, data) => import('./polar-map.js').then((m) => new m.PolarMap(base, overlay, data)),
  },
  {
    id: 'mercator',
    label: 'Mercator',
    group: 'Direction maps',
    head: 'FLAT EARTH  /  DIRECTION MAPS',
    proj: 'MERCATOR PROJECTION',
    // (the same list as SCALES in mercator-map.js)
    scales: [
      { id: 'world', label: 'World' },
      { id: 'region', label: 'Region (6,000 miles)' },
      { id: 'close', label: 'Close up (1,000 miles)' },
    ],
    badges: { direction: 'true', distance: 'lost', size: 'lost', shape: 'half' },
    badgeNotes: {
      direction: 'Every straight line keeps one compass heading.',
      distance: 'Miles stretch more and more toward the poles.',
      size: 'Lands near the poles look far too big.',
      shape: 'Shapes are true only in small areas.',
    },
    blurb: 'Every straight line keeps one compass heading, so sailors could steer by it. Shapes are true only in small areas, and lands near the poles look far too big.',
    originMatters: true,
    module: 'mercator-map.js',
    create: (base, overlay, data) => import('./mercator-map.js').then((m) => new m.MercatorMap(base, overlay, data)),
  },
  {
    id: 'equal-earth',
    label: 'Equal Earth',
    group: 'Size maps',
    head: 'FLAT EARTH  /  SIZE MAPS',
    proj: 'EQUAL EARTH PROJECTION',
    scales: [{ id: 'world', label: 'World' }],
    badges: { direction: 'lost', distance: 'lost', size: 'true', shape: 'lost' },
    badgeNotes: {
      direction: 'North is straight up only along the middle line.',
      distance: 'Distances stretch toward the edges.',
      size: 'Every area is true, everywhere.',
      shape: 'Shapes squash and stretch toward the edges.',
    },
    blurb: 'Every country is drawn at its true size, so shapes squash and stretch toward the edges. Equal Earth was made in 2018 to keep sizes true and still look like the world maps people know.',
    originMatters: false,
    module: 'equal-area-map.js',
    create: (base, overlay, data) => import('./equal-area-map.js').then((m) => new m.EqualEarthMap(base, overlay, data)),
  },
  {
    id: 'mollweide',
    label: 'Mollweide',
    group: 'Size maps',
    head: 'FLAT EARTH  /  SIZE MAPS',
    proj: 'MOLLWEIDE PROJECTION',
    scales: [{ id: 'world', label: 'World' }],
    badges: { direction: 'lost', distance: 'lost', size: 'true', shape: 'lost' },
    badgeNotes: {
      direction: 'North is straight up only along the middle line.',
      distance: 'Distances stretch toward the edges.',
      size: 'Every area is true, everywhere.',
      shape: 'Shapes squash toward the sides of the oval.',
    },
    blurb: 'An older equal-area map, from 1805, with an oval edge. Every country is drawn at its true size, and shapes squash toward the sides.',
    originMatters: false,
    module: 'equal-area-map.js',
    create: (base, overlay, data) => import('./equal-area-map.js').then((m) => new m.MollweideMap(base, overlay, data)),
  },
  {
    id: 'gnomonic',
    label: 'Gnomonic',
    group: 'Airplane maps',
    head: 'FLAT EARTH  /  AIRPLANE MAPS',
    proj: 'GNOMONIC PROJECTION',
    // (the same list as SCALES in gnomonic-map.js)
    scales: [
      { id: 'wide', label: 'Wide' },
      { id: 'medium', label: 'Medium' },
      { id: 'close', label: 'Close' },
    ],
    badges: { direction: 'half', distance: 'lost', size: 'lost', shape: 'lost' },
    badgeNotes: {
      direction: 'True only from the center.',
      distance: 'Miles stretch more and more away from the center.',
      size: 'Lands far from the center get stretched bigger.',
      shape: 'Shapes stretch more and more toward the edge.',
    },
    blurb: 'Every straight line is a shortest route (a great circle), between any two places. The map stretches fast away from the center, so it can never show half the world.',
    originMatters: true,
    module: 'gnomonic-map.js',
    create: (base, overlay, data) => import('./gnomonic-map.js').then((m) => new m.GnomonicMap(base, overlay, data)),
  },
  {
    id: 'cahill',
    label: 'Cahill butterfly',
    group: 'Butterfly maps',
    head: 'FLAT EARTH  /  BUTTERFLY MAPS',
    proj: 'CAHILL BUTTERFLY PROJECTION',
    scales: [{ id: 'net', label: 'Net' }],
    badges: { direction: 'half', distance: 'lost', size: 'lost', shape: 'lost' },
    badgeNotes: {
      direction: 'True only from the middle of each triangle.',
      distance: 'Lost: the triangles stretch toward their corners.',
      size: 'Lands near the corners come out up to 5 times too big.',
      shape: 'Shapes stretch toward the corners and break at the cuts.',
    },
    blurb: 'Eight triangles spread out like the wings of a butterfly, with the cuts in the oceans. Direction is true only from the middle of each triangle; sizes and shapes stretch toward the corners.',
    originMatters: false,
    module: 'polyhedral-map.js',
    create: (base, overlay, data) => import('./polyhedral-map.js').then((m) => new m.CahillMap(base, overlay, data)),
  },
  {
    id: 'dymaxion',
    label: 'Dymaxion',
    group: 'Butterfly maps',
    head: 'FLAT EARTH  /  BUTTERFLY MAPS',
    proj: 'DYMAXION PROJECTION',
    scales: [{ id: 'net', label: 'Net' }],
    badges: { direction: 'lost', distance: 'lost', size: 'half', shape: 'half' },
    badgeNotes: {
      direction: 'Lost: there is no up or down, and lines bend at every fold.',
      distance: 'Lost: the oceans are cut into pieces.',
      size: 'Sizes stay within about 10 percent of true.',
      shape: 'Shapes bend only a little near the corners.',
    },
    blurb: 'Twenty triangles that fold up into a ball, with every cut in the ocean so the land stays in one piece. Sizes stay within about 10 percent of true and shapes bend only a little, but the oceans are split apart.',
    originMatters: false,
    module: 'polyhedral-map.js',
    create: (base, overlay, data) => import('./polyhedral-map.js').then((m) => new m.DymaxionMap(base, overlay, data)),
  },
  {
    id: 'stereographic',
    label: 'Stereographic',
    group: 'Shape maps',
    head: 'FLAT EARTH  /  SHAPE MAPS',
    proj: 'STEREOGRAPHIC PROJECTION',
    // (the same list as SCALES in stereographic-map.js)
    scales: [
      { id: 'planet', label: 'Tiny planet' },
      { id: 'hemisphere', label: 'Hemisphere' },
      { id: 'region', label: 'Region' },
    ],
    badges: { direction: 'half', distance: 'lost', size: 'lost', shape: 'half' },
    badgeNotes: {
      direction: 'True only from the center.',
      distance: 'The rings spread farther apart away from the center.',
      size: 'Places swell bigger the farther they are from the center.',
      shape: 'Shapes are true up close, and every circle stays a circle.',
    },
    blurb: 'Every small shape is drawn true, and every circle on the Earth stays a circle. Far from the center, places keep their shapes but swell bigger, and the far side of the world never fits.',
    originMatters: true,
    module: 'stereographic-map.js',
    create: (base, overlay, data) => import('./stereographic-map.js').then((m) => new m.StereographicMap(base, overlay, data)),
  },
];

export const DEFAULT_TYPE = MAP_TYPES[0].id;
export const typeById = (id) => MAP_TYPES.find((t) => t.id === id) || MAP_TYPES[0];
// [[group, [entries]], ...] in book order, for the dropdown
export const groupedTypes = () => {
  const rank = (g) => { const i = GROUPS.indexOf(g); return i < 0 ? GROUPS.length : i; };
  const groups = [...new Set(MAP_TYPES.map((t) => t.group || 'Other maps'))].sort((a, b) => rank(a) - rank(b));
  return groups.map((g) => [g, MAP_TYPES.filter((t) => (t.group || 'Other maps') === g)]);
};
