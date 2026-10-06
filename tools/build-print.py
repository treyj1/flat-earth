"""Flat Earth website: build the print packs and preview pictures for web/downloads/.

Run from the book project folder (it also works from anywhere, paths are found from this file):

    python web/tools/build-print.py

What it makes (and nothing else; it never touches the other PDFs in web/downloads/):

  web/downloads/star-wheel-print-letter.pdf   the three 12 x 12 in star wheel pages (W3 how-to, W1 star disk,
  web/downloads/star-wheel-print-11x17.pdf    W2 front cover), each shrunk to fit the sheet with 0.25 in margins,
                                              centered, every page at the SAME scale, plus a printed note
  web/downloads/img/*.jpg                     preview pictures for web/downloads/index.html (from outputs/*.png)

It also writes each download's file size into web/downloads/index.html, inside the
<span class="dl-size" data-file="NAME.pdf"> tags, so the sizes stay right when the PDFs are refreshed.

Safe to re-run: every output is rebuilt from outputs/ and replaced in one step (write to a temp file, then rename).
Needs PyMuPDF (fitz) and Pillow.
"""
import os
import re
import sys

import fitz  # PyMuPDF
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
ROOT = os.path.dirname(WEB)
OUTPUTS = os.path.join(ROOT, 'outputs')
DOWNLOADS = os.path.join(WEB, 'downloads')
IMG = os.path.join(DOWNLOADS, 'img')
FONT = os.path.join(WEB, 'fonts', 'ArchitectsDaughter.ttf')
PAGE_HTML = os.path.join(DOWNLOADS, 'index.html')

PT = 72.0                  # points per inch
MARGIN = 0.25 * PT
INK = (0x1d / 255, 0x1b / 255, 0x1e / 255)
INK_SOFT = (0.36, 0.34, 0.37)
NOTE = 'Print at actual size. Both pieces must be printed at the same size.'

# The pack, in the order you need it: read the how-to first, then the two pieces.
PACK_PAGES = [
    ('W3-star-wheel-how-to', 'HOW TO MAKE IT'),
    ('W1-star-wheel-disk', 'PIECE 1: STAR DISK'),
    ('W2-star-wheel-front-cover', 'PIECE 2: FRONT COVER'),
]
PAPERS = [
    ('star-wheel-print-letter.pdf', 'LETTER', 8.5, 11.0),
    ('star-wheel-print-11x17.pdf', 'TABLOID (11 x 17)', 11.0, 17.0),
]

# Preview pictures the downloads page shows: (output name, source PNG in outputs/, width in px)
PREVIEWS = [
    ('butterfly-handout.jpg', 'B2-butterfly-print-letter', 720),
    ('dymaxion-handout.jpg', 'B6-dymaxion-print-letter', 720),
    ('star-wheel-assembled.jpg', 'W0-star-wheel-assembled', 900),
]
PACK_THUMB = ('star-wheel-pack.jpg', 'star-wheel-print-letter.pdf', 1, 360)  # page 2 (the disk), px wide


def replace_atomically(tmp, final):
    os.replace(tmp, final)


def build_pack(out_name, paper_label, w_in, h_in):
    W, H = w_in * PT, h_in * PT
    srcs = []
    for base, label in PACK_PAGES:
        path = os.path.join(OUTPUTS, base + '.pdf')
        if not os.path.exists(path):
            sys.exit(f'missing {path}')
        srcs.append((fitz.open(path), label))
    # One scale for every page, so the disk and the cover match: the largest that fits every source page.
    scale = min(min((W - 2 * MARGIN) / d[0].rect.width, (H - 2 * MARGIN) / d[0].rect.height) for d, _ in srcs)

    font = fitz.Font(fontfile=FONT)
    out = fitz.open()
    n = len(srcs)
    for i, (src, label) in enumerate(srcs):
        r = src[0].rect
        pw, ph = r.width * scale, r.height * scale
        x0, y0 = (W - pw) / 2, (H - ph) / 2
        page = out.new_page(width=W, height=H)
        page.insert_font(fontname='arch', fontfile=FONT)
        page.show_pdf_page(fitz.Rect(x0, y0, x0 + pw, y0 + ph), src, 0)

        def centered(text, y, size, color=INK):
            tw = font.text_length(text, fontsize=size)
            page.insert_text(((W - tw) / 2, y), text, fontname='arch', fontsize=size, color=color)

        # Above the picture: what this sheet is
        top_gap = y0
        head = f'FLAT EARTH  /  STAR WHEEL  /  {label}   (PAGE {i + 1} OF {n})'
        centered(head, max(MARGIN + 10, top_gap / 2 + 4), 10, INK_SOFT)
        # Below the picture: the printing note and a bar to check the printed size
        bottom = y0 + ph
        gap = H - bottom
        ny = bottom + min(gap * 0.38, 30)
        centered(NOTE, ny, 11)
        bar = 2 * PT
        by = ny + 18
        if by + 14 < H - MARGIN + 6:
            bx = (W - bar) / 2
            page.draw_line((bx, by), (bx + bar, by), color=INK, width=1.2)
            for x in (bx, bx + bar):
                page.draw_line((x, by - 4), (x, by + 4), color=INK, width=1.2)
            centered('This bar should measure 2 inches. If it does not, your printer changed the size.', by + 14, 8, INK_SOFT)
        print(f'  {out_name} p{i + 1}: {label}, scale {scale:.4f} ({r.width / PT:.1f} in -> {pw / PT:.2f} in)')

    out.set_metadata({'title': f'Flat Earth star wheel, print pack for {paper_label.lower()} paper',
                      'author': 'Flat Earth: a book of maps just for me',
                      'subject': NOTE, 'creator': 'web/tools/build-print.py', 'producer': 'PyMuPDF'})
    final = os.path.join(DOWNLOADS, out_name)
    tmp = final + '.tmp'
    out.save(tmp, garbage=4, deflate=True)
    out.close()
    for d, _ in srcs:
        d.close()
    replace_atomically(tmp, final)
    return scale


def save_jpg(im, name, width):
    im = im.convert('RGB')
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    final = os.path.join(IMG, name)
    tmp = final + '.tmp'
    im.save(tmp, 'JPEG', quality=84, optimize=True, progressive=True)
    replace_atomically(tmp, final)
    print(f'  img/{name}: {width} x {h}, {os.path.getsize(final) // 1024} KB')


def build_previews():
    os.makedirs(IMG, exist_ok=True)
    for name, base, width in PREVIEWS:
        src = os.path.join(OUTPUTS, base + '.png')
        if not os.path.exists(src):
            print(f'  skipped img/{name}: no {src}')
            continue
        with Image.open(src) as im:
            im.draft('RGB', (width * 2, width * 2))
            save_jpg(im, name, width)
    name, pdf, pno, width = PACK_THUMB
    with fitz.open(os.path.join(DOWNLOADS, pdf)) as d:
        page = d[pno]
        zoom = width * 2 / page.rect.width
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        save_jpg(im, name, width)


def human_size(n):
    if n >= 1024 * 1024:
        return f'{n / (1024 * 1024):.1f} MB'
    return f'{max(1, round(n / 1024))} KB'


def update_sizes():
    if not os.path.exists(PAGE_HTML):
        print('  no downloads/index.html yet; sizes not written')
        return
    with open(PAGE_HTML, encoding='utf-8') as f:
        html = f.read()
    missing = []

    def sub(m):
        path = os.path.join(DOWNLOADS, m.group(2))
        if not os.path.exists(path):
            missing.append(m.group(2))
            return m.group(0)
        return f'{m.group(1)}{human_size(os.path.getsize(path))}{m.group(3)}'

    new = re.sub(r'(<span class="dl-size" data-file="([^"]+)">)[^<]*(</span>)', sub, html)
    if new != html:
        tmp = PAGE_HTML + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
            f.write(new)
        replace_atomically(tmp, PAGE_HTML)
        print('  updated file sizes in downloads/index.html')
    else:
        print('  file sizes in downloads/index.html already current')
    for m in missing:
        print(f'  WARNING: downloads/index.html links {m}, which is not in web/downloads/')


def main():
    print('Star wheel print packs:')
    for out_name, label, w, h in PAPERS:
        build_pack(out_name, label, w, h)
    print('Preview pictures:')
    build_previews()
    print('File sizes:')
    update_sizes()


if __name__ == '__main__':
    main()
