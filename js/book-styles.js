// Flat Earth website: paint the page's CSS textures with the book's own crayon engine.
// Each texture is drawn once on an off-screen canvas, turned into an image URL and handed to CSS as
// a custom property, so ordinary HTML (panels, buttons, inputs, tags) wears the book's paper, frames
// and hatching. Seeds are fixed, so every visit looks the same, just like a printed page.
import { createArt, INK, WATER, WATER2, ORANGE } from './crayon.js';

const DPR = Math.min(2, window.devicePixelRatio || 1);

function paint(w, h, seed, draw) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * DPR); c.height = Math.round(h * DPR);
  const art = createArt(c, { width: w, height: h, seed, clear: true });
  draw(art);
  return c;
}
const url = (c) => `url(${c.toDataURL('image/png')})`;

// A crumpled double frame, like the title blocks and badge plate on every map page.
// Used as a 9-slice border-image: the corners stay put, the edges stretch.
function frame(seed, { weight = 1 } = {}) {
  return paint(240, 240, seed, (art) => {
    const k = weight;
    art.crayon([[6, 6], [234, 8], [233, 234], [7, 233], [6, 3]], { color: INK, width: 2.4 * k, alpha: 0.85, passes: 3, wobble: 1.2, crumple: 1.6, breakProb: 0.04, step: 4 });
    art.crayon([[15, 15], [225, 16], [224, 225], [16, 224], [15, 13]], { color: INK, width: 1.2 * k, alpha: 0.5, passes: 2, wobble: 1, crumple: 1.4, breakProb: 0.06, step: 4 });
  });
}
function singleFrame(seed) {
  return paint(160, 80, seed, (art) => {
    art.crayon([[4, 5], [156, 4], [155, 76], [5, 75], [4, 2]], { color: INK, width: 2, alpha: 0.85, passes: 3, wobble: 0.8, crumple: 1.2, breakProb: 0.03, step: 3 });
  });
}
// The baby-blue highlight under each page's projection name (book-common.js projTag)
function hatch(seed, colors, colors2, w = 480, h = 64) {
  return paint(w, h, seed, (art) => {
    const { ctx } = art;
    art.hatchFill(() => { ctx.moveTo(2, 6); ctx.lineTo(w - 2, 2); ctx.lineTo(w - 5, h - 4); ctx.lineTo(4, h - 1); ctx.closePath(); }, [0, 0, w, h],
      [{ angle: 8, spacing: 3, colors, alpha: 0.8, width: 2.6, step: 6 }, { angle: -24, spacing: 6, colors: colors2, alpha: 0.35, width: 2.2, step: 6 }]);
  });
}
function underline(seed) {
  return paint(600, 14, seed, (art) => {
    art.crayon(art.curve([4, 8], [300, 3], [596, 9]), { color: INK, width: 2, alpha: 0.75, passes: 2, wobble: 1.2, crumple: 1.5, breakProb: 0.03, step: 4 });
  });
}
// A small hatched square for checkboxes and list bullets
function dot(seed, colors) {
  return paint(24, 24, seed, (art) => {
    art.hatchFill(() => art.ctx.arc(12, 12, 7, 0, Math.PI * 2), [4, 4, 16, 16], [{ angle: 30, spacing: 1.4, colors, alpha: 0.95, width: 1.8 }, { angle: -50, spacing: 2, colors, alpha: 0.7, width: 1.6 }]);
    art.crayon(art.wobblyEllipse(12, 12, 7.5, 7.5, 0, 0.3, 0.05), { color: INK, width: 1.5, alpha: 0.9, passes: 2, wobble: 0.3, step: 2 });
  });
}
// A small hand-drawn chevron for the dropdown
function chevron(seed) {
  return paint(36, 24, seed, (art) => art.crayon([[5, 6], [18, 18], [31, 6]], { color: INK, width: 2.4, alpha: 0.9, passes: 2, wobble: 0.4, step: 2, breakProb: 0 }));
}
function paperTile() {
  return paint(700, 700, 4079, (art) => art.paperBackground());
}

export function applyBookStyles(root = document.documentElement) {
  const set = (name, c) => root.style.setProperty(name, url(c));
  set('--tex-paper', paperTile());
  set('--tex-frame', frame(11));
  set('--tex-frame-b', frame(23));
  set('--tex-button', singleFrame(5));
  set('--tex-blue', hatch(8, WATER, WATER2));
  set('--tex-blue-soft', hatch(9, WATER, WATER2, 300, 120));
  set('--tex-orange', hatch(12, ORANGE, ['#ffb627']));
  set('--tex-underline', underline(3));
  set('--tex-dot', dot(31, ORANGE));
  set('--tex-dot-ink', dot(32, [INK]));
  set('--tex-chevron', chevron(41));
  root.classList.add('book-styled');
}
