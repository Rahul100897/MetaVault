#!/usr/bin/env python3
"""
Turn raw MetaVault window captures into App Store listing screenshots.

Deterministic: crop, uniform scale, pad with the app's own canvas colour. No
image model is involved, so every glyph in the output is the app's own pixels.
This matters — a generative "resize" rewrites UI text into plausible nonsense,
which on a store listing means describing the product incorrectly.

Usage:
    python3 scripts/listing-screenshots.py <folder-of-raw-captures>

Input:  raw, UNCROPPED window captures (Cmd+Shift+4 then Space, then click the
        window). Include the Shopify admin chrome — it gets cropped off.
        Files may be named anything; pass them in the page order of PAGES below,
        or name them NN-slug-raw.png to be picked up automatically.
Output: <folder>/listing/2560x1440/ and <folder>/listing/1600x900/

What it does, and why:
  * Finds the app frame by locating the navy sidebar (#0A0F1E) via per-column
    darkness density. A naive "longest navy run" scan fails, because the active
    nav item has a lighter indigo background that splits the run — that bug
    silently sliced 138px off the sidebar the first time round.
  * On Polaris-centred pages there is a ~590px strip of dead canvas between the
    sidebar and the content column. That strip is spliced out and the content
    butted against the sidebar using the same 42px gap the full-width pages use,
    so all pages end up visually consistent.
  * Crop height is snapped to a gap BETWEEN nav items, so the last sidebar entry
    is never bisected. The glyph test uses a strict brightness threshold —
    a loose one counts antialiased text tails as empty navy.
  * The right margin is then tuned per page so the frame lands on exactly 16:9,
    which removes letterboxing entirely on the centred pages.

Known limitation: genuinely full-width pages (Metafields, Metaobjects, Liquid
snippets) are ~2.17:1 after cropping. Reaching 16:9 would mean cutting the
right-hand columns, so those keep a symmetric canvas-coloured letterbox instead.
Capturing in a window ~1590 CSS px wide avoids this.
"""

import os
import sys
import glob
from PIL import Image

CANVAS = (246, 246, 247)          # app canvas #F6F6F7 — pad colour, so pad is invisible
NAVY_MAX_MEAN = 30                # mean RGB below this = flat navy, no glyph
GAP = 42                          # sidebar → content gap used by full-width pages
RIGHT_MARGIN = 40                 # fallback breathing room right of content
TARGETS = [(2560, 1440), (1600, 900)]

# Page order, and which render full-width (no centred column to de-gutter).
PAGES = ["dashboard", "metafields", "metaobjects", "import-export", "jobs",
         "backups", "cross-store-copy", "liquid-snippets", "activity-log",
         "help-feedback"]
FULL_WIDTH = {"metafields", "metaobjects", "liquid-snippets"}


def is_bg(p, tol=4):
    return all(abs(a - b) <= tol for a, b in zip(p[:3], CANVAS))


def find_frame(im):
    """(sidebar_x0, sidebar_x1, app_y) — the app's own frame inside the capture."""
    W, H = im.size
    px = im.load()
    ys = range(int(H * 0.15), H - 20, 6)
    n = len(list(ys))

    dens = []
    for x in range(0, min(1600, W)):
        c = sum(1 for y in ys if sum(px[x, y][:3]) / 3 < 90)
        dens.append((x, c / n))

    runs, start = [], None
    for x, d in dens:
        if d > 0.80:
            start = x if start is None else start
        elif start is not None:
            runs.append((start, x)); start = None
    if start is not None:
        runs.append((start, len(dens)))
    if not runs:
        raise SystemExit("could not locate the app sidebar — is this a MetaVault capture?")

    x0, x1 = max(runs, key=lambda r: r[1] - r[0])

    # App frame top = first row where the sidebar column is continuously the
    # EXACT navy. A loose "is it dark" test finds y=0, because the Shopify admin
    # chrome above the sidebar is also dark — that produced crop heights taller
    # than the source image.
    def navy(p, tol=12):
        return all(abs(a - b) <= tol for a, b in zip(p[:3], (10, 15, 30)))

    mid = (x0 + x1) // 2
    app_y = 0
    for y in range(H - 30):
        if all(navy(px[mid, y + k]) for k in range(30)):
            app_y = y
            break
    return x0, x1, app_y


def content_bounds(im, x_scan, app_y, y_safe):
    """Left/right edge of the content column, ignoring the sidebar border pixel."""
    W, _ = im.size
    px = im.load()
    ys = list(range(app_y, y_safe, 6))
    L = R = None
    for x in range(x_scan, W - 44, 2):
        if sum(1 for y in ys if not is_bg(px[x, y])) / len(ys) > 0.02:
            L = x; break
    for x in range(W - 45, x_scan, -2):
        if sum(1 for y in ys if not is_bg(px[x, y])) / len(ys) > 0.02:
            R = x; break
    return L, R


def nav_gaps(im, x0, x1, app_y, frame_h):
    """Frame-relative rows where the sidebar is flat navy — safe places to cut."""
    px = im.load()
    return {
        fy for fy in range(frame_h)
        if max(sum(px[x, app_y + fy][:3]) / 3 for x in range(x0 + 16, x1 - 16, 4))
        < NAVY_MAX_MEAN
    }


def build(path, page, outdir):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    SB_X0, SB_X1, APP_Y = find_frame(im)
    frame_h = H - APP_Y
    y_safe = H - 62                      # skip window edge / scrollbar artefacts
    L, R = content_bounds(im, SB_X1 + 36, APP_Y, y_safe)
    sb_w = SB_X1 - SB_X0

    if page in FULL_WIDTH:
        piece = im.crop((SB_X0, APP_Y, min(R + RIGHT_MARGIN, W - 44), APP_Y + frame_h))
    else:
        base_w = sb_w + GAP + (R - L)
        h_ideal = round(base_w * 9 / 16)
        gaps = nav_gaps(im, SB_X0, SB_X1, APP_Y, frame_h)
        h = h_ideal
        for fy in range(h_ideal, min(h_ideal + 200, frame_h - 8)):
            if all((fy + k) in gaps for k in range(8)):
                h = fy + 4; break
        width = round(h * 16 / 9)
        x1 = L + (width - sb_w - GAP)
        if width < base_w or x1 > W - 44 or h > frame_h:   # can't tune → plain fit
            width = base_w + RIGHT_MARGIN
            h = min(round(width * 9 / 16), frame_h)
            x1 = min(R + RIGHT_MARGIN, W - 44)
        sidebar = im.crop((SB_X0, APP_Y, SB_X1, APP_Y + h))
        content = im.crop((L, APP_Y, min(x1, W - 44), APP_Y + h))
        piece = Image.new("RGB", (sb_w + GAP + content.width, h), CANVAS)
        piece.paste(sidebar, (0, 0))
        piece.paste(content, (sb_w + GAP, 0))

    cw, ch = piece.size
    for TW, TH in TARGETS:
        s = min(TW / cw, TH / ch)        # uniform only — never stretched
        nw, nh = round(cw * s), round(ch * s)
        out = Image.new("RGB", (TW, TH), CANVAS)
        out.paste(piece.resize((nw, nh), Image.LANCZOS), ((TW - nw) // 2, (TH - nh) // 2))
        d = os.path.join(outdir, f"{TW}x{TH}")
        os.makedirs(d, exist_ok=True)
        out.save(os.path.join(d, os.path.basename(path).replace("-raw", "")))
    pad = "none" if (nw == TW and nh == TH) else f"{(TW-nw)//2}/{(TH-nh)//2}"
    return cw, ch, s, pad


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    folder = os.path.abspath(sys.argv[1])
    outdir = os.path.join(folder, "listing")

    files = sorted(glob.glob(os.path.join(folder, "*-raw.png")))
    if not files:
        raise SystemExit(f"no *-raw.png files in {folder}")

    print(f"{'page':20s} {'crop':>13s} {'scale':>7s} {'pad':>10s}")
    for f in files:
        slug = os.path.basename(f).replace("-raw.png", "")
        page = slug.split("-", 1)[1] if "-" in slug else slug
        cw, ch, s, pad = build(f, page, outdir)
        print(f"{page:20s} {cw:5d}x{ch:<6d} {s:7.3f} {pad:>10s}")
    print(f"\nwrote {outdir}/2560x1440 and {outdir}/1600x900")


if __name__ == "__main__":
    main()
