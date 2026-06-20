# Known Issues & Future Work

## Intermittent map blank-out on rapid pan/zoom (hosted build)

**Symptom.** On some machines, while scroll-zooming or dragging the map quickly
on the deployed build, the map area would occasionally go black while the rest
of the UI (sidebars, inspector) stayed alive. The browser console showed a
client-side exception: `TypeError: Cannot read properties of null (reading 'tx')`.

### What's actually happening

This is a **client-side rendering exception, not a graphics failure**. The
`tx` property lives only on the map's pan/zoom state. During very
high-frequency wheel/pointer events, a state update could be processed against
a transient/empty view object and throw. Because the throw happens inside
React's render cycle, React unmounts the map subtree — which is what blanks the
canvas. The surrounding app keeps running because only that subtree died.

Two things made it hard to pin down:

1. **Environment-specific.** It only reproduced on certain GPU/driver setups and
   only in the production build. Local dev and headless test browsers render
   the canvas in software, where it does not occur — so it never reproduced in
   our normal test loop. (Tellingly, opening DevTools, which switches the page
   to a software render path, also made it disappear.)
2. **Slow feedback loop.** Each candidate fix had to go through a full
   `commit → push → Vercel build → hard refresh` cycle to validate against the
   one environment that reproduced it, instead of a fast local reproduction.

### Mitigations shipped

- **Null-guarded the pan/zoom state** everywhere it is read (render, drag,
  wheel, zoom buttons, clamp) so a transient empty value can no longer throw.
- **Forced the canvas onto the CPU render path** (`willReadFrequently`) and
  removed the GPU layer promotion (`will-change`) plus reduced the internal
  canvas resolution, to avoid the unstable large-composited-layer path.
- **Wrapped the map in an error boundary** (`MapErrorBoundary.jsx`). If any
  rendering exception still occurs, the map now degrades to a small
  "Reset map view" card instead of a black screen, and recovers on one click —
  data, filters and selection stay intact.

### What would fully resolve it

1. **Confirm deploy parity.** Verify (via `git show HEAD:web/src/MapCanvas.jsx`)
   that the guarded source is exactly what the hosted bundle was built from — a
   build-cache / commit-sync gap is the most likely reason a fix appeared not to
   take effect on the live URL.
2. **Move pan/zoom into the canvas context.** Apply the transform with
   `ctx.translate/scale` inside the canvas instead of CSS-transforming the
   canvas element. This removes the GPU-composited transformed layer entirely —
   the most robust structural fix.
3. **Add interaction tests in CI.** A Playwright test that fires rapid
   wheel + drag events would catch any regression automatically.

The error boundary already guarantees graceful, recoverable behaviour in the
meantime, so the failure mode is contained rather than user-facing-fatal.

## Other future work

- Named POIs are currently inferred from activity clusters + minimap landmarks;
  swap in canonical in-game place names when available.
- Per-POI metrics table and CSV export for design reviews.
- Match-phase (early / mid / late) and patch-over-patch comparison views.
