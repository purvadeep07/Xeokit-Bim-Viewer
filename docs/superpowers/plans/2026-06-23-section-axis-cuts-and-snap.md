# Section Axis Cuts + Rotate Snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six one-click axis section cuts (+X, −X, +Y, −Y, +Z, −Z) and a default-on "snap normal to nearest axis on release" behavior to the section gizmo.

**Architecture:** Pure direction/snap math lives in a new standalone module (`src/toolbar/sectionAxisUtils.js`) unit-tested with Vitest. `SectionTool` gains a `createAxisSectionPlane(axis)` method (replace mode) and a `mouseup`/`touchend` snap hook that rewrites the active plane's `dir`; the xeokit plugin's existing `"dir"` binding re-syncs the gizmo automatically (no SDK fork). The context menu exposes 6 axis-cut items and a "Snap to axis" toggle.

**Tech Stack:** Vanilla ES modules, `@xeokit/xeokit-sdk`'s `SectionPlanesPlugin` + `math`, Rollup build, Vitest (new devDependency) for unit tests.

## Global Constraints

- No xeokit SDK source changes (no edits under `node_modules/@xeokit`). The snap relies on `SectionPlanesPlugin` re-syncing the gizmo from the section plane's `"dir"` event.
- Snap threshold: **12 degrees**. Snap toggle default: **ON**.
- Axis buttons use **replace mode**: clear existing planes before creating the new one.
- Axis→direction mapping is exactly: `+x→[1,0,0]`, `-x→[-1,0,0]`, `+y→[0,1,0]`, `-y→[0,-1,0]`, `+z→[0,0,1]`, `-z→[0,0,-1]`.
- Menu titles use the existing `context.viewer.localeService.translate(key) || "Fallback"` pattern; no locale files required.
- All viewer source stays ESM (`"type": "module"`).

---

## File Structure

- `src/toolbar/sectionAxisUtils.js` (new) — pure, dependency-light helpers: `AXES`, `axisToDir(axis)`, `nearestAxisSnap(dir, thresholdDeg)`. One responsibility: axis vector math. No xeokit, no DOM.
- `test/sectionAxisUtils.test.js` (new) — Vitest unit tests for the above.
- `package.json` (modify) — add `vitest` devDependency + `test` script.
- `src/toolbar/SectionTool.js` (modify) — add `createAxisSectionPlane(axis)`, snap state (`getSnapToAxisEnabled`/`setSnapToAxisEnabled`), and `_initAxisSnap()` listener.
- `src/contextMenus/SectionToolContextMenu.js` (modify) — add "Cut along axis" group (6 items) + "Snap to axis" toggle.

---

### Task 1: Pure axis utilities (TDD with Vitest)

**Files:**
- Create: `src/toolbar/sectionAxisUtils.js`
- Modify: `package.json` (scripts + devDependencies)
- Test: `test/sectionAxisUtils.test.js`

**Interfaces:**
- Produces:
  - `AXES: Array<{key: string, dir: [number,number,number]}>` — the 6 unit axes, `key` one of `"+x","-x","+y","-y","+z","-z"`.
  - `axisToDir(axis: string): [number,number,number]` — returns a fresh 3-element array for a valid key, throws `Error` for an invalid key.
  - `nearestAxisSnap(dir: number[], thresholdDeg: number): [number,number,number] | null` — normalizes `dir`, finds the nearest of the 6 axes; returns that axis vector if the angle ≤ `thresholdDeg`, else `null`. Returns `null` for a zero-length `dir`.

- [ ] **Step 1: Add Vitest to package.json**

Modify `package.json` — replace the `test` script and add the devDependency:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "rollup --config rollup.config.js && rollup --config rollup.dev.config.js && copyfiles -f locales/messages.js ./dist && copyfiles -f xeokit-bim-viewer.css ./dist",
    "docs": "./node_modules/.bin/esdoc && node docs/.scripts/fix-doc-links.js",
    "serve": "http-server . -p 8080 ",
    "changelog": "auto-changelog --commit-limit false --package --template changelog-template.hbs"
  },
```

Add `"vitest": "^2.1.0"` to `devDependencies` (keep the others; alphabetical placement after `rollup-plugin-import-css`):

```json
    "rollup-plugin-import-css": "^3.5.8",
    "vitest": "^2.1.0"
```

- [ ] **Step 2: Install Vitest**

Run: `npm install`
Expected: completes without error; `node_modules/.bin/vitest` exists.

- [ ] **Step 3: Write the failing tests**

Create `test/sectionAxisUtils.test.js`:

```js
import {describe, it, expect} from "vitest";
import {AXES, axisToDir, nearestAxisSnap} from "../src/toolbar/sectionAxisUtils.js";

describe("axisToDir", () => {
    it("maps each axis key to its unit vector", () => {
        expect(axisToDir("+x")).toEqual([1, 0, 0]);
        expect(axisToDir("-x")).toEqual([-1, 0, 0]);
        expect(axisToDir("+y")).toEqual([0, 1, 0]);
        expect(axisToDir("-y")).toEqual([0, -1, 0]);
        expect(axisToDir("+z")).toEqual([0, 0, 1]);
        expect(axisToDir("-z")).toEqual([0, 0, -1]);
    });

    it("returns a fresh array each call (no shared mutation)", () => {
        const a = axisToDir("+x");
        a[0] = 99;
        expect(axisToDir("+x")).toEqual([1, 0, 0]);
    });

    it("throws on an invalid axis key", () => {
        expect(() => axisToDir("w")).toThrow();
    });
});

describe("AXES", () => {
    it("contains all six unit axes", () => {
        expect(AXES.map(a => a.key).sort()).toEqual(["+x", "+y", "+z", "-x", "-y", "-z"]);
    });
});

describe("nearestAxisSnap", () => {
    it("snaps a near-axis direction within threshold", () => {
        // ~5 degrees off +z
        const dir = [0, Math.sin(5 * Math.PI / 180), Math.cos(5 * Math.PI / 180)];
        expect(nearestAxisSnap(dir, 12)).toEqual([0, 0, 1]);
    });

    it("snaps to the negative axis when closest", () => {
        const dir = [0, Math.sin(5 * Math.PI / 180), -Math.cos(5 * Math.PI / 180)];
        expect(nearestAxisSnap(dir, 12)).toEqual([0, 0, -1]);
    });

    it("returns null for an oblique direction outside threshold", () => {
        // 45 degrees between +x and +z
        const dir = [Math.SQRT1_2, 0, Math.SQRT1_2];
        expect(nearestAxisSnap(dir, 12)).toBeNull();
    });

    it("snaps an exactly-aligned direction", () => {
        expect(nearestAxisSnap([1, 0, 0], 12)).toEqual([1, 0, 0]);
    });

    it("returns null for a zero-length direction", () => {
        expect(nearestAxisSnap([0, 0, 0], 12)).toBeNull();
    });

    it("handles a non-normalized input direction", () => {
        // same direction as ~5 deg off +z but scaled by 10
        const s = 10;
        const dir = [0, s * Math.sin(5 * Math.PI / 180), s * Math.cos(5 * Math.PI / 180)];
        expect(nearestAxisSnap(dir, 12)).toEqual([0, 0, 1]);
    });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/toolbar/sectionAxisUtils.js` (module does not exist yet).

- [ ] **Step 5: Implement the module**

Create `src/toolbar/sectionAxisUtils.js`:

```js
/**
 * Pure axis-vector helpers for axis-aligned section cuts and rotate-snap.
 * No xeokit / DOM dependencies so this stays unit-testable.
 * @private
 */

const AXES = [
    {key: "+x", dir: [1, 0, 0]},
    {key: "-x", dir: [-1, 0, 0]},
    {key: "+y", dir: [0, 1, 0]},
    {key: "-y", dir: [0, -1, 0]},
    {key: "+z", dir: [0, 0, 1]},
    {key: "-z", dir: [0, 0, -1]}
];

const _axisByKey = {};
for (const a of AXES) {
    _axisByKey[a.key] = a.dir;
}

/**
 * Returns a fresh unit direction vector for an axis key.
 * @param {String} axis One of "+x","-x","+y","-y","+z","-z".
 * @returns {Number[]} New 3-element array.
 */
function axisToDir(axis) {
    const dir = _axisByKey[axis];
    if (!dir) {
        throw new Error("Invalid section axis: " + axis);
    }
    return dir.slice();
}

/**
 * Finds the nearest principal axis to a direction and returns its unit vector
 * if within thresholdDeg, otherwise null.
 * @param {Number[]} dir Direction vector (need not be normalized).
 * @param {Number} thresholdDeg Max angle (degrees) to snap.
 * @returns {Number[]|null} Snapped axis unit vector, or null.
 */
function nearestAxisSnap(dir, thresholdDeg) {
    const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len === 0) {
        return null;
    }
    const nx = dir[0] / len, ny = dir[1] / len, nz = dir[2] / len;
    // Largest absolute component => nearest axis; its sign picks +/- axis.
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let best;
    let bestDot;
    if (ax >= ay && ax >= az) {
        best = nx >= 0 ? "+x" : "-x";
        bestDot = ax;
    } else if (ay >= ax && ay >= az) {
        best = ny >= 0 ? "+y" : "-y";
        bestDot = ay;
    } else {
        best = nz >= 0 ? "+z" : "-z";
        bestDot = az;
    }
    const cosThreshold = Math.cos(thresholdDeg * Math.PI / 180);
    if (bestDot >= cosThreshold) {
        return _axisByKey[best].slice();
    }
    return null;
}

export {AXES, axisToDir, nearestAxisSnap};
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `test/sectionAxisUtils.test.js` green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/toolbar/sectionAxisUtils.js test/sectionAxisUtils.test.js
git commit -m "feat: add pure axis-vector helpers for section cuts and snap"
```

---

### Task 2: `SectionTool.createAxisSectionPlane(axis)` (replace mode)

**Files:**
- Modify: `src/toolbar/SectionTool.js`

**Interfaces:**
- Consumes: `axisToDir(axis)` from Task 1; `this._sectionPlanesPlugin` (`SectionPlanesPlugin`), `this.viewer.scene`, and `math` (already imported in this file).
- Produces: `SectionTool.createAxisSectionPlane(axis: string): void` — clears existing planes, creates one section plane at the model AABB center with `dir = axisToDir(axis)`, and shows its gizmo. No-op if the scene has no geometry.

- [ ] **Step 1: Add the import**

In `src/toolbar/SectionTool.js`, below the existing imports (after line 3), add:

```js
import {axisToDir} from "./sectionAxisUtils.js";
```

- [ ] **Step 2: Add the method**

In `src/toolbar/SectionTool.js`, insert this method inside the `SectionTool` class, immediately after the existing `flipSections()` method (after its closing brace near line 178):

```js
    /**
     * Creates a single axis-aligned section plane at the model center, replacing
     * any existing section planes, and shows its editing gizmo.
     *
     * @param {String} axis One of "+x","-x","+y","-y","+z","-z".
     */
    createAxisSectionPlane(axis) {
        const scene = this.viewer.scene;
        const aabb = scene.aabb;
        // Guard: empty/degenerate AABB means no model geometry is loaded.
        if (!aabb || aabb[0] > aabb[3] || aabb[1] > aabb[4] || aabb[2] > aabb[5]) {
            return;
        }
        this._sectionPlanesPlugin.clear();
        const center = math.getAABB3Center(aabb, math.vec3());
        const sectionPlane = this._sectionPlanesPlugin.createSectionPlane({
            pos: center,
            dir: axisToDir(axis)
        });
        this._sectionPlanesPlugin.showControl(sectionPlane.id);
        this._updateSectionPlanesCount();
    }
```

- [ ] **Step 3: Manual verification (build + app)**

This method touches the live viewer/WebGL and is verified in the app, not by unit test.

Run: `npm run build`
Then run: `npm run serve`
Open: `http://localhost:8080/app/index.html`, load a model, then in the browser devtools console run:

```js
// Reach the SectionTool via the running BIMViewer instance used by app/index.html.
// (Use the app's existing global/handle for the viewer; e.g. bimViewer._sectionTool
//  if exposed, or temporarily call from within the app.)
```

Expected observable behavior (perform via the menu in Task 4 if no console handle is exposed): calling `createAxisSectionPlane("+x")` produces exactly one section plane cutting through the model center perpendicular to X, with the gizmo shown. Calling it again with `"+y"` replaces it with a single Y cut (count stays at 1).

Note: if no console handle to `SectionTool` is available, defer this verification to Task 4 (the menu items call this method) and confirm there.

- [ ] **Step 4: Commit**

```bash
git add src/toolbar/SectionTool.js
git commit -m "feat: add createAxisSectionPlane replace-mode axis cuts to SectionTool"
```

---

### Task 3: Rotate-snap state + listener in `SectionTool`

**Files:**
- Modify: `src/toolbar/SectionTool.js`

**Interfaces:**
- Consumes: `nearestAxisSnap(dir, thresholdDeg)` from Task 1; `this._sectionPlanesPlugin.getShownControl()`, `this.viewer.scene.sectionPlanes`, `this._containerElement`.
- Produces:
  - `SectionTool.getSnapToAxisEnabled(): boolean`
  - `SectionTool.setSnapToAxisEnabled(enabled: boolean): void`
  - Internal `_snapToAxisEnabled` field (default `true`) and `_initAxisSnap()` method wiring `mouseup`/`touchend`.

- [ ] **Step 1: Add the import**

In `src/toolbar/SectionTool.js`, extend the Task 2 import to also bring in the snap helper:

```js
import {axisToDir, nearestAxisSnap} from "./sectionAxisUtils.js";
```

- [ ] **Step 2: Initialize snap state and listener in the constructor**

In `src/toolbar/SectionTool.js`, in the constructor, find the line `this._initSectionMode();` (near line 127) and add immediately before it:

```js
        this._snapToAxisEnabled = true;
        this._snapThresholdDeg = 12;
        this._initAxisSnap();
```

- [ ] **Step 3: Add the snap methods**

In `src/toolbar/SectionTool.js`, add these methods to the `SectionTool` class immediately after `_updateSectionPlanesCount()` (after its closing brace near line 165):

```js
    _initAxisSnap() {
        const trySnap = () => {
            if (!this._snapToAxisEnabled) {
                return;
            }
            const shownId = this._sectionPlanesPlugin.getShownControl();
            if (!shownId) {
                return;
            }
            const sectionPlane = this.viewer.scene.sectionPlanes[shownId];
            if (!sectionPlane) {
                return;
            }
            const snapped = nearestAxisSnap(sectionPlane.dir, this._snapThresholdDeg);
            if (snapped) {
                sectionPlane.dir = snapped; // Plugin re-syncs the gizmo via its "dir" binding.
            }
        };
        this._containerElement.addEventListener("mouseup", trySnap);
        this._containerElement.addEventListener("touchend", trySnap);
    }

    /**
     * Sets whether the gizmo snaps the cut normal to the nearest principal axis on release.
     * @param {Boolean} enabled
     */
    setSnapToAxisEnabled(enabled) {
        this._snapToAxisEnabled = !!enabled;
    }

    /**
     * Gets whether axis snapping is enabled.
     * @returns {Boolean}
     */
    getSnapToAxisEnabled() {
        return this._snapToAxisEnabled;
    }
```

- [ ] **Step 4: Manual verification (build + app)**

Run: `npm run build`
Then run: `npm run serve` and open `http://localhost:8080/app/index.html`.

Verify (using an axis cut from Task 4, or a click-created section plane):
1. With a gizmo shown, rotate a rotation ring so the normal is within ~12° of an axis and release → the plane snaps to that axis (gizmo jumps to align).
2. Rotate to a clearly oblique angle (e.g. ~45°) and release → the plane stays oblique (no snap).
3. Call `setSnapToAxisEnabled(false)` (via the Task 4 toggle) → rotation no longer snaps on release.

- [ ] **Step 5: Commit**

```bash
git add src/toolbar/SectionTool.js
git commit -m "feat: snap section gizmo normal to nearest axis on release"
```

---

### Task 4: Context-menu axis-cut items + snap toggle

**Files:**
- Modify: `src/contextMenus/SectionToolContextMenu.js`

**Interfaces:**
- Consumes: `context.sectionTool.createAxisSectionPlane(axis)` (Task 2), `context.sectionTool.getSnapToAxisEnabled()` / `setSnapToAxisEnabled()` (Task 3). `context.sectionTool` is already provided (set in `SectionTool`'s menu-show handler).
- Produces: two new top-level menu groups in `this.items`.

- [ ] **Step 1: Add the axis-cut group and snap toggle**

In `src/contextMenus/SectionToolContextMenu.js`, inside `_buildMenu()`, the `this.items = [ ... ]` array currently starts with the "Clear Slices / Flip Slices" group, then "Disable/Enable all Slices", then `sectionPlanesMenuItems`. Insert two new groups **after** the disable/enable group and **before** `sectionPlanesMenuItems`.

Replace the closing of the disable/enable group and the `sectionPlanesMenuItems` line, i.e. change:

```js
            ],
            sectionPlanesMenuItems
        ];
```

to:

```js
            ],

            [
                {
                    getTitle: (context) => {
                        return context.viewer.localeService.translate("sectionToolContextMenu.cutPlusX") || "Cut +X";
                    },
                    doAction: (context) => { context.sectionTool.createAxisSectionPlane("+x"); }
                },
                {
                    getTitle: (context) => {
                        return context.viewer.localeService.translate("sectionToolContextMenu.cutMinusX") || "Cut -X";
                    },
                    doAction: (context) => { context.sectionTool.createAxisSectionPlane("-x"); }
                },
                {
                    getTitle: (context) => {
                        return context.viewer.localeService.translate("sectionToolContextMenu.cutPlusY") || "Cut +Y";
                    },
                    doAction: (context) => { context.sectionTool.createAxisSectionPlane("+y"); }
                },
                {
                    getTitle: (context) => {
                        return context.viewer.localeService.translate("sectionToolContextMenu.cutMinusY") || "Cut -Y";
                    },
                    doAction: (context) => { context.sectionTool.createAxisSectionPlane("-y"); }
                },
                {
                    getTitle: (context) => {
                        return context.viewer.localeService.translate("sectionToolContextMenu.cutPlusZ") || "Cut +Z";
                    },
                    doAction: (context) => { context.sectionTool.createAxisSectionPlane("+z"); }
                },
                {
                    getTitle: (context) => {
                        return context.viewer.localeService.translate("sectionToolContextMenu.cutMinusZ") || "Cut -Z";
                    },
                    doAction: (context) => { context.sectionTool.createAxisSectionPlane("-z"); }
                }
            ],

            [
                {
                    getTitle: (context) => {
                        return context.sectionTool.getSnapToAxisEnabled()
                            ? (context.viewer.localeService.translate("sectionToolContextMenu.snapOn") || "Snap to axis: On")
                            : (context.viewer.localeService.translate("sectionToolContextMenu.snapOff") || "Snap to axis: Off");
                    },
                    doAction: (context) => {
                        context.sectionTool.setSnapToAxisEnabled(!context.sectionTool.getSnapToAxisEnabled());
                    }
                }
            ],

            sectionPlanesMenuItems
        ];
```

- [ ] **Step 2: Manual verification (build + app)**

Run: `npm run build`
Then run: `npm run serve` and open `http://localhost:8080/app/index.html`.

1. Load a model. Activate the Section tool and open its dropdown menu (the arrow button).
2. Confirm a group with **Cut +X / Cut -X / Cut +Y / Cut -Y / Cut +Z / Cut -Z** appears, plus a **Snap to axis: On** item.
3. Click **Cut +X** → one X-aligned cut at center with gizmo shown. Click **Cut +Z** → replaced by a single Z cut.
4. Click **Cut +X** then **Flip** (existing item) → the visible half inverts.
5. Rotate the gizmo within ~12° of an axis and release → snaps. Click **Snap to axis: On** → it reads **Snap to axis: Off**; rotate again → no snap on release.

- [ ] **Step 3: Commit**

```bash
git add src/contextMenus/SectionToolContextMenu.js
git commit -m "feat: add axis-cut items and snap toggle to section context menu"
```

---

### Task 5: Final build + verification sweep

**Files:**
- Modify: `dist/` (regenerated build output)

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: PASS — all `sectionAxisUtils` tests green.

- [ ] **Step 2: Rebuild dist**

Run: `npm run build`
Expected: completes without error; `dist/xeokit-bim-viewer.es.js` and `dist/xeokit-bim-viewer.min.es.js` updated.

- [ ] **Step 3: Full manual sweep in app**

Run: `npm run serve`, open `http://localhost:8080/app/index.html`, load a model, and confirm the full spec acceptance list:
1. Each of the 6 axis cut items produces a single clean axis-aligned cut at center; previous cut is replaced (section count stays 1).
2. Rotating within ~12° of an axis snaps on release; oblique stays oblique.
3. Toggling "Snap to axis" off gives free-form rotation.
4. "Flip" still inverts the visible half of an axis cut.
5. Caps still render on cut faces (no regression to the existing section-caps behavior).

- [ ] **Step 4: Commit the rebuilt dist**

```bash
git add dist/
git commit -m "build: regenerate dist with section axis cuts and snap"
```

---

## Porting to the main project

After this branch is merged/built, port to the downstream main project exactly as done for the section-caps fix (`SECTION_CAPS_FIX.md`): copy the changed source (`src/toolbar/sectionAxisUtils.js`, `src/toolbar/SectionTool.js`, `src/contextMenus/SectionToolContextMenu.js`) or the rebuilt `dist/`, then wire the main project's six axis buttons (the existing three plus three new negative-axis buttons) to `sectionTool.createAxisSectionPlane("+x" | "-x" | ...)`.

---

## Self-Review

**Spec coverage:**
- ±X/±Y/±Z axis cuts → Task 2 (`createAxisSectionPlane`) + Task 4 (6 menu items). ✓
- Replace mode → Task 2 (`clear()` before create). ✓
- Snap normal to nearest axis, threshold ~12°, on release → Task 1 (`nearestAxisSnap`) + Task 3 (mouseup/touchend hook). ✓
- Snap toggle, default on → Task 3 (state, default `true`) + Task 4 (toggle item). ✓
- Self-contained UI, no HTML/CSS, locale-fallback pattern → Task 4. ✓
- No SDK fork; gizmo re-sync via `"dir"` binding → Task 3 note. ✓
- Build + port → Task 5 + porting section. ✓
- No-model guard → Task 2 Step 2 AABB check. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; all code blocks are concrete. The only deferred item is Task 2 Step 3's optional console handle, which explicitly defers to Task 4's menu-driven verification — not a placeholder.

**Type consistency:** `axisToDir`, `nearestAxisSnap`, `AXES`, `createAxisSectionPlane`, `getSnapToAxisEnabled`, `setSnapToAxisEnabled` are named identically across Tasks 1–4. Axis keys are consistently `"+x"`-style strings throughout.
