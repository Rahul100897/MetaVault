# Listing screenshot prompts

Reusable prompts for turning a raw MetaVault screenshot into an App Store
listing image. Paste one screenshot, fill in the `{...}` values, paste the prompt.

**Target:** 16:9. Shopify's minimum is **1600×900**; prefer **2560×1440** if the
capture is Retina (2×), since it is the same ratio with more detail. Never
upscale a small capture to reach the target — pad instead.

---

## ⚠️ Read this first: use a deterministic editor, not a generative one

An image *generator* (Nano Banana, DALL·E, Midjourney, generative fill) will
**re-render the pixels**. UI text comes back subtly wrong: mangled glyphs,
invented numbers, plausible-but-fake labels. For a store listing that is fatal —
it misrepresents the product to a reviewer, and garbled text reads as a broken
app.

So: crop / pad / scale in something deterministic (Preview, Photoshop crop tool,
`sips`, ImageMagick), and use the prompts below only with tools that perform
**exact pixel operations**. Prompt 0 is written to forbid regeneration explicitly,
because some tools will re-render unless told not to.

If you would rather skip prompting entirely, the equivalent one-liner is at the
bottom.

---

## Prompt 0 — Master (use this one; the rest are presets)

```
You are preparing a screenshot for a Shopify App Store listing. Treat the image
as evidence of how the software actually looks. It must stay a faithful,
unaltered representation.

INPUT: one screenshot of an embedded Shopify admin app.
OUTPUT: exactly one PNG, exactly {WIDTH}×{HEIGHT} px, fully opaque.

ONLY these operations are permitted:
1. Crop — remove regions.
2. Uniform scale — identical factor on both axes.
3. Pad — fill remaining area with one solid colour.
4. Solid-colour caption band with text, placed OUTSIDE the screenshot area —
   only if CAPTION below is not "none".

NEVER do any of the following:
- Do not redraw, regenerate, re-render, denoise, sharpen, "enhance", upscale with
  AI, or otherwise recreate any pixel of the interface.
- Do not retype, re-letter, correct, translate, or reflow any text.
- Do not invent, add, remove, reorder or alter any number, label, row, column,
  badge, chart or UI element.
- Do not stretch or squash. Non-uniform scaling is forbidden.
- Do not upscale past 1.0×. If the source is smaller than the target, pad to size
  and tell me the source was too small.
- Do not add shadows, gradients, glows, reflections, rounded corners, browser
  frames, device mockups, hands, people, or decorative backgrounds.
- Do not blur or pixelate anything unless it is listed under REDACT.

CROP: {CROP}
PAD COLOUR: {PAD}
CAPTION: {CAPTION}
REDACT: {REDACT}

Cropping rules:
- Cut on exact pixel boundaries. Never leave a half-height table row, a clipped
  glyph, or a sliver of a neighbouring panel.
- Always keep the app's own dark navy sidebar (the one headed "MetaVault") and
  its plan badge. That sidebar is the product being sold.
- If the cropped region's aspect ratio does not equal {WIDTH}:{HEIGHT}, do NOT
  crop further into content to force the ratio. Scale the crop to fit inside the
  target and centre it on a solid {PAD} background.
- Prefer padding top/bottom over left/right when the source is wider than 16:9.

Before returning, verify and state each of these:
- output dimensions are exactly {WIDTH}×{HEIGHT}
- every character of visible text is identical to the input
- nothing has been added or removed beyond the crop I specified
- the scale factor used, and the padding added on each edge
```

### Values to fill in

| Placeholder | Use this |
| --- | --- |
| `{WIDTH}×{HEIGHT}` | `2560×1440` (or `1600×900`) |
| `{PAD}` | `#F6F6F7` when the admin chrome is cropped away — it matches the app canvas so the pad is invisible. `#F1F1F1` if you kept the chrome. |
| `{CAPTION}` | `none` for a clean shot; otherwise see Prompt 3 |
| `{REDACT}` | `none`, or `the store name and avatar in the top-right` |

---

## Prompt 1 — Crop the Shopify admin chrome (the default)

Removes the grey Shopify admin frame and keeps only the app. This is what you
want for most listing images: it drops the other apps listed in the admin nav
(Flow, Filey, QtyBoost, ServvAI, YouQuote), the `dev` store badge, and the global
search bar — none of which belong in your listing.

Use Prompt 0 with:

```
CROP: Remove all Shopify admin chrome. Specifically: delete everything left of
the app's dark navy "MetaVault" sidebar (the grey admin navigation listing Home,
Orders, Products, and installed apps), delete the top bar containing the Shopify
logo, the global search field and the store-name button, and delete the thin
"MetaVault" breadcrumb strip with the "..." button directly beneath it. Keep the
navy app sidebar as the new left edge, and the app content pane to its right.
Trim any uniform blank margin at the outer right and bottom edges, but leave the
app's own internal padding untouched.
PAD COLOUR: #F6F6F7
CAPTION: none
REDACT: none
```

---

## Prompt 2 — Trim dead space on a sparse page

For pages with a large empty lower area (Import / Export is the worst offender).
Only removes *blank* canvas — it must never crop a card.

Use Prompt 0 with `CROP` set to Prompt 1's text plus:

```
Additionally: remove empty background below the last visible card, leaving 24px
of background beneath it. Do not crop into any card, table, button or text. If
removing that space pushes the result away from {WIDTH}:{HEIGHT}, scale to fit
and pad instead of cropping further.
```

> A page that is half empty makes a weak listing image. Prefer re-capturing it
> with real content on screen (a finished export job, a populated table) over
> cropping the emptiness away.

---

## Prompt 3 — Add a caption band (marketing variant)

Shopify listings allow a short caption baked into the image. The band must sit
*outside* the screenshot so no UI is covered.

Use Prompt 0 with:

```
CAPTION: Add a solid #0A0F1E band across the full width of the top of the canvas,
160px tall at 2560×1440 (scale proportionally at other sizes). Place the screenshot
below it, uncovered. In the band, left-aligned with 64px padding, set this text in
white, semibold, ~56px, single line, no wrapping:
"{HEADLINE}"
Do not place text over the screenshot. Do not add any other graphics, icons,
gradients or shapes. Use #6366F1 only if you add a 4px rule under the band.
```

Headlines that match what each page actually shows — keep them literal, since a
reviewer compares the claim to the image:

| Page | `{HEADLINE}` |
| --- | --- |
| Dashboard | `Every metafield and metaobject in one place` |
| Metafields | `Edit metafields in a spreadsheet view` |
| Import / Export | `Bulk edit with CSV import and export` |
| Backups | `Snapshot your store, restore in one click` |
| Metaobjects | `Create and edit metaobject entries` |
| Cross-store copy | `Copy metaobjects between stores you manage` |

---

## Prompt 4 — Batch, consistent framing

When doing several at once, consistency matters more than any single image:

```
I will send N screenshots of the same app, one per message. Apply an IDENTICAL
crop rule, scale factor, pad colour and output size to every one, so the app
sidebar lands at the same x-offset and the same width in all of them. If one
screenshot cannot take the same crop without cutting content, stop and tell me
which one and why, rather than silently using a different crop for it.
```

---

## Skip the prompt entirely

Deterministic, lossless, no model involved. Crop values come from measuring the
navy sidebar's left edge once:

```bash
# crop: WIDTHxHEIGHT+Xoffset+Yoffset, then fit to 2560x1440 on the app canvas colour
magick input.png -crop 1760x820+250+100 +repage \
  -resize 2560x1440 -background "#F6F6F7" -gravity center -extent 2560x1440 out.png
```

`-resize 2560x1440` fits inside the box preserving ratio; `-extent` pads the rest.
Nothing is regenerated, so text stays exact.

---

## Before you crop anything

No prompt fixes content problems. Re-capture instead when:

- **Metafields shows `judgeme` rows** — another app's data, rendering as raw
  `<div style='display:none' class='jdgm-prev-badge'…>`. Filter to namespace
  `custom` first (see `HANDOVER.md` §6).
- **Test strings are visible** — `MINIMAL TEST — overwrote the previous value`,
  `Test badge`. Replace with realistic copy before shooting.
- **A page is mostly empty** — populate it first.
- **The `dev` badge or other app names appear** — Prompt 1 crops these, but
  double-check the result.
