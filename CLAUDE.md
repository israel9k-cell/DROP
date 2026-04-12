# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working in this repository.

## Project overview

**TimeLens — Cámara del Pasado** is a vintage-camera **Progressive Web App** (PWA). It uses the device camera (or an uploaded image), applies an era-specific vintage filter in the browser via the Canvas 2D API, and lets the user save, share, and edit photos with a built-in "Nano Banana" editor.

The app is in Spanish (UI strings) and has **no build step, no package.json, no backend, and no external runtime dependencies** — everything is plain static HTML/CSS/JS served directly from the repo root.

## Repository layout

```
/
├── index.html      # Single HTML file — all views (camera, result, gallery, editor, modal)
├── app.js          # All JS logic, ~1225 lines, wrapped in an IIFE ('use strict')
├── styles.css      # All CSS, ~990 lines
├── sw.js           # Service worker (cache-first fallback for offline)
├── manifest.json   # PWA manifest (standalone, portrait, theme #1a0a00)
├── icon-192.png    # PWA icons
└── icon-512.png
```

There are no config files, no lockfiles, no tests, no linters, no CI, no framework, and no third-party libraries. Do **not** introduce any of the above unless explicitly requested.

## Architecture

### Single-page, view-switching UI
`index.html` contains every screen (splash, camera view, result view, gallery view, editor view, send modal). Navigation is handled by toggling the `.hidden` class via helper functions in `app.js`:

- `showCamera()` / `showResult()` / `showGallery()` / `showEditor()`
- Elements are fetched once at the top of `app.js` via the `$ = id => document.getElementById(id)` helper.

### State model (all in-memory in `app.js`)
Top-level module state (module IIFE, not attached to `window`):
- `currentEra` — one of `'1850' | '1900' | '1920' | '1950' | '1970' | '1990'`
- `currentStream`, `facingMode` — camera stream state
- `flashEnabled`, `autodreamEnabled` — toggles
- `gallery` — array of `{ thumb, full, era, date, ts }`, persisted to `localStorage` under key `timelens_gallery` (max 50 items, newest first)
- Editor state: `editorBaseImage` (`ImageData`), `drawHistory`, `drawColor`, `drawSize`, `isDrawing`, `textColor`, `activeTool`

### Era config
`eras` object (`app.js:45`) maps era id → `{ label, name, yearRange }`. When adding a new era you must update **all of**:
1. `eras` object in `app.js`
2. `.era-option` entries in `index.html` (era picker dropdown)
3. The `switch` in `applyVintageFilter` (`app.js:206`)
4. A new filter function `applyXxx(data, w, h)` mirroring the others
5. Any post-processing overlays conditional on era at `app.js:220-225`

### Canvas pipeline
All image processing is pure Canvas 2D (no WebGL, no WASM).

Capture → filter flow (`app.js:133` onward):
1. `captureFromVideo()` draws `video` into `previewCanvas`, mirroring horizontally for the front ("user") camera.
2. `applyVintageFilter(sourceCanvas)` copies it to `resultCanvas`, reads `ImageData`, dispatches to an era-specific per-pixel function, then layers overlays: `applyVignette`, `applyScratches`/`applyDust` (old eras), `applyLightLeak` (1970), `applyFlashGlare` (1990), then `applyDreamEffect` if Autodream is on.
3. A random in-range date is drawn onto 1970/1990 photos; older eras get a `circa YYYY` caption below the canvas via `#date-stamp`.
4. Thumbnail (300px) + full JPEG (`image/jpeg`, quality 0.85) are pushed to `gallery` and persisted.

Helpers: `clamp(v)`, `randomInt(min,max)`, `createThumbnail(canvas, size)`, `showToast(msg)`, `blurEdges(data, w, h, strength)`.

### Nano Banana editor (`app.js:789-1219`)
A second canvas layer (`drawCanvas`) sits over `editorCanvas`. Floating DOM elements (`.sticker-floating`, `.text-floating`) are positioned absolutely inside `.editor-canvas-wrap` and made draggable by `makeDraggable(el, container)`. `flattenEditorToResult()` rasterizes everything (base + draw layer + floating elements, scaled from screen-space to canvas-space) back into `resultCanvas` and updates gallery entry `[0]` in place.

Tools: `adjust` (brightness/contrast/saturation sliders, re-applied from `editorBaseImage` in `applyAdjustments`), `draw`, `text`, `sticker`, and rotate/flip (`rotateEditor(deg)`, `flipEditor(axis)`).

### Send modal (`app.js:648-724`)
`handleSendAction(action)` branches on `whatsapp | instagram | email | copy | more`. It always tries `navigator.share({ files: [file] })` first and falls back to `downloadBlob` (or `navigator.clipboard.write` for `copy`). There is **no** deep-linking or external API — "WhatsApp" and "Instagram" buttons just funnel into the Web Share API with different fallback toasts.

### Service worker (`sw.js`)
Cache name `timelens-v1`, network-first with cache fallback. When you add, rename, or remove a root asset that must work offline, update the `ASSETS` array **and bump the cache name** (`timelens-v2`, etc.) so existing clients invalidate.

## Development workflow

### Running locally
There is no dev server in the repo. The app needs `getUserMedia`, which requires a **secure context** — serve over HTTPS or `http://localhost`, not `file://`. Any static server works:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`. On mobile Safari/Chrome, test over HTTPS (e.g. via a tunneling tool) because the camera will not initialize otherwise.

### Testing
There is no automated test suite. Verify changes manually in a browser:
- Camera preview starts and the front/back toggle works
- Each era filter renders without errors (check console)
- Capture → result → save → gallery roundtrip persists across reload
- Editor tools: adjust sliders live-update, draw/undo, text placement, sticker drag, rotate/flip, done flattens correctly
- Autodream toggle affects the next capture
- Send modal buttons fall back gracefully when `navigator.share` is unavailable

Type checking and lint are not configured — do not claim a change "passes tests" when none were run.

### Git workflow
- Default branch for Claude-authored work in this session: **`claude/add-claude-documentation-jdcbE`**
- Commit style is short, imperative, feature-focused (see `git log`): e.g. `Add Autodream mode: ethereal/surreal dream filter toggle`
- Push with `git push -u origin <branch>`; retry on transient network failures only
- Do **not** open a pull request unless the user explicitly asks
- GitHub interactions must use the `mcp__github__*` tools (no `gh` CLI available), and are scoped to `israel9k-cell/drop` only

## Conventions

### Code style
- Vanilla ES (no TypeScript, no transpilation) — target modern evergreen browsers
- Entire `app.js` is wrapped in `(function() { 'use strict'; ... })();` — keep it that way; do not pollute `window`
- 4-space indentation, single quotes for strings, semicolons required
- Section headers use the banner comment style: `// ==================== SECTION NAME ====================`
- Prefer the existing `$('id')` shortcut for DOM lookups
- Spanish for user-facing strings (toasts, button labels, confirm dialogs); English is fine for code identifiers and comments
- Era filter functions follow a consistent shape: iterate `data` in steps of 4 (RGBA), do per-channel math with `clamp()`, optionally add uniform noise

### CSS
- Everything lives in `styles.css`, organized roughly top-down by view. No preprocessor, no CSS-in-JS, no CSS variables framework — keep additions in the same file and keep the existing naming (kebab-case, BEM-ish)
- Theme base color is `#1a0a00` (warm near-black); accent gold is `#c8a050`. Match these when adding UI
- The layout assumes mobile portrait; test at a phone viewport

### Assets
- Root-level only (no `/assets` or `/public` folder). Icons are PNG. SVG icons are inlined directly in `index.html` — follow that pattern instead of adding an icon font or sprite

### Things to avoid
- Do **not** add `package.json`, bundlers, frameworks (React/Vue/etc.), TypeScript, CSS preprocessors, or any runtime dependency without being asked
- Do **not** move files into subdirectories — the service worker's `ASSETS` list and relative paths in `index.html` assume everything is at the repo root
- Do **not** rely on non-ASCII characters in source code; existing Spanish strings avoid accents (e.g. `Camara`, `Galeria`) because some toolchains mangle them. Keep new strings ASCII-safe unless you verify the full pipeline (including the service worker cache) handles UTF-8
- Do **not** introduce blocking async imports, module scripts, or build output — `app.js` is loaded as a classic script
- Do **not** bump the cache name in `sw.js` unless the asset list actually changed

## Quick reference — where things live in `app.js`

| Feature | Approx. line |
|---|---|
| State & DOM refs | 5–42 |
| Era config | 44–52 |
| Init / splash | 54–68 |
| Camera start/switch/flash | 70–97 |
| Autodream toggle | 99–107 |
| Era picker | 109–128 |
| Capture from video | 130–157 |
| Upload / file input | 159–175 |
| `applyVintageFilter` dispatcher | 194–258 |
| Per-era filter functions | 262–354 |
| `applyDreamEffect` | 358–467 |
| Overlay effects (vignette/scratches/dust/etc.) | 470–534 |
| Navigation (`showResult`/`showCamera`/`showGallery`) | 559–594 |
| Save / share / send modal | 596–724 |
| Gallery rendering & clear | 733–787 |
| Nano Banana editor (init/tools/adjust/draw/text/sticker) | 789–1067 |
| Rotate / flip | 1068–1161 |
| `flattenEditorToResult` | 1163–1219 |
| Service worker registration | 1221–1224 |
