# Section Tool — ±X/±Y/±Z Axis Cuts + Axis-Snap on Rotate

**Date:** 2026-06-23
**Status:** Approved design

## Problem

The section-cut feature lets users slice the model by clicking a surface, then
adjust the plane with the 3D gizmo. The main (downstream) project adds X/Y/Z
buttons that create axis-aligned cuts, but:

1. Only the three positive axes are available. Users need all six directions
   (+X, −X, +Y, −Y, +Z, −Z) so they can cut from either side of each axis with a
   single click.
2. Rotating the gizmo is fully free-form. Users want it to **snap the cut-plane
   normal to the nearest principal axis** so clean orthogonal cuts are easy to
   reach, while still allowing oblique cuts when intended.

## Scope & Boundary

All logic lives in this repository's source:

- `src/toolbar/SectionTool.js`
- `src/contextMenus/SectionToolContextMenu.js`

No xeokit SDK changes. The gizmo (`TransformControl`) is a `@private` SDK class
with no snap hook, but `SectionPlanesPlugin` already binds the gizmo to each
plane's `"dir"` event — so externally setting `sectionPlane.dir` makes the gizmo
re-sync automatically. This is the mechanism both features rely on.

The X/Y/Z buttons themselves live in the separate main project, which is not in
this repo and cannot be edited from here. This repo exposes the callable methods
**and** self-contained UI (context-menu items) so the behavior is testable in
`app/`. The main project will be updated by porting these source changes and
rebuilding `dist/` — the same workflow already used for the section-caps fix
(see `SECTION_CAPS_FIX.md`).

## Decisions (locked)

| Question | Decision |
|---|---|
| Axis directions | All 6: +X, −X, +Y, −Y, +Z, −Z |
| Axis-button mode | **Replace** — each click clears existing planes, makes one clean axis cut |
| Snap rule | **Threshold** snap on release: snap normal to nearest axis only if within ~12°, otherwise keep oblique |
| Snap toggle | Context-menu **"Snap to axis"** toggle, **default ON** |
| SDK fork | None |

## Design

### 1. `SectionTool.createAxisSectionPlane(axis)`

`axis` is one of `"+x" | "-x" | "+y" | "-y" | "+z" | "-z"`.

Steps:
1. If no model geometry is loaded (empty/degenerate scene AABB), no-op and return.
2. Clear existing section planes (`this._sectionPlanesPlugin.clear()`) — replace mode.
3. Compute the model AABB center (`math.getAABB3Center(scene.aabb, ...)`) as the plane `pos`.
4. Map `axis` → unit direction vector (`+x → [1,0,0]`, `-x → [-1,0,0]`, etc.).
5. `createSectionPlane({ pos, dir })`.
6. `showControl(sectionPlane.id)` so the user can still nudge it.

The existing **"Flip"** menu action (`sectionPlane.flipDir()`) inverts the
visible half if the chosen direction shows the wrong side.

### 2. Axis-snap on rotate

State on `SectionTool`:
- `getSnapToAxisEnabled()` / `setSnapToAxisEnabled(bool)`, backing field defaults `true`.
- Constant `SNAP_THRESHOLD_DEG = 12`.

Trigger: on the section container's `mouseup` and `touchend`:
1. If snapping disabled → return.
2. Get the currently shown control id (`this._sectionPlanesPlugin.getShownControl()`); if none → return.
3. Read that plane's normalized `dir`.
4. Find the axis (of the 6 unit axes) with the maximum dot product against `dir`.
5. If the angle to that axis ≤ `SNAP_THRESHOLD_DEG`, set `sectionPlane.dir = axis`.
   The plugin's `"dir"` listener re-syncs the gizmo automatically.
6. Otherwise leave the oblique cut unchanged.

This re-uses the existing `mouseup` listener path in `_initSectionMode()`. The
gizmo's own `mouseup` deliberately does **not** stop propagation, so the
SectionTool handler still fires after a rotation drag. A snap on a click that did
not rotate is a harmless no-op (already axis-aligned planes don't move).

### 3. UI (this repo, for self-containment + testing)

Added to the data-driven `SectionToolContextMenu` (no HTML/CSS changes):

- New group **"Cut along axis"** with 6 items: `+X, −X, +Y, −Y, +Z, −Z`, each
  calling `context.sectionTool.createAxisSectionPlane(<axis>)`.
- A **"Snap to axis"** toggle item whose title reflects
  `sectionTool.getSnapToAxisEnabled()` and whose action flips it.

Titles use the existing `context.viewer.localeService.translate(key) || "Fallback"`
pattern, so locale files are optional. The menu already receives `sectionTool`
in its `context` (set in `SectionTool`'s menu-show handler).

### 4. Build & port

- Run `npm run build` to regenerate `dist/`.
- Port the two changed source files (or the rebuilt `dist/`) into the main
  project, then wire the main project's existing X/Y/Z buttons (plus 3 new
  negative-axis buttons) to `createAxisSectionPlane`.

## Testing (manual, in `app/`)

1. Load a model.
2. Click each of the 6 axis cut items → a single clean axis-aligned cut appears
   at the model center; previous cut is replaced.
3. Rotate the gizmo to within ~12° of an axis and release → normal snaps to that axis.
4. Rotate to a clearly oblique angle and release → cut stays oblique (no snap).
5. Toggle "Snap to axis" off → rotation is free-form, no snapping on release.
6. "Flip" still inverts the visible half of an axis cut.

## Out of Scope

- Angle-increment snapping during the drag itself (would require forking the SDK
  gizmo). Only nearest-axis snap on release is in scope.
- Editing the main project's UI directly (not in this repo).
- Locale message files (fallback strings are used).
