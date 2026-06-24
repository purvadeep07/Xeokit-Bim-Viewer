# First-Person Game Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the toolbar's First-Person mode feel like a video game — pointer-lock mouse-look, WASD movement, and a `G` key to toggle between free-fly and floor-gravity walk.

**Architecture:** Pure movement math lives in a small, browser-free, unit-tested module (`src/firstPersonMovementUtils.js`), mirroring the existing `src/toolbar/sectionAxisUtils.js` pattern. A `Controller` subclass (`src/FirstPersonControls.js`) wires DOM events, pointer lock, an on-screen HUD, and a per-frame `scene.tick` loop around those pure functions. It is activated/deactivated by the existing nav-mode mediator in `BIMViewer.js`, and takes over the camera by disabling xeokit's built-in `CameraControl` while active.

**Tech Stack:** Vanilla ES modules, xeokit-sdk 2.6.78 (`Camera`, `Scene`, `math`), Rollup build, Vitest unit tests, Playwright (MCP) for live browser verification.

## Global Constraints

- xeokit-sdk version: **2.6.78** (already installed; do not bump).
- Import xeokit `math` from `@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js` (same path BIMViewer.js uses).
- New controller extends `src/Controller.js` via `super(parent, cfg)`; `this.viewer` and `this.bimViewer` come from the base class.
- Camera access path is `this.viewer.camera` (set in Viewer constructor as `this.camera = this.scene.camera`).
- The demo (`app/index.html`) loads from `dist/xeokit-bim-viewer.es.js`, so any `src/` change requires `npm run build` before live verification.
- Test files live in `test/` and use Vitest (`import {describe, it, expect} from "vitest"`).
- Keep files focused: pure math in the utils module, all DOM/xeokit wiring in the controller. Do not put DOM code in the utils file.
- `/** @private */` JSDoc on new classes/modules, matching the codebase.

---

### Task 1: Pure movement utilities (TDD)

A browser-free module of pure functions: per-axis movement intent, scale-aware config, horizontal direction, and one-frame gravity integration. Fully unit-tested with Vitest.

**Files:**
- Create: `src/firstPersonMovementUtils.js`
- Test: `test/firstPersonMovementUtils.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, no imports).
- Produces:
  - `movementAxes(keys: {forward,back,left,right,up,down}) -> {forward:number, right:number, up:number}` (each −1/0/+1)
  - `deriveFirstPersonConfig(diag: number, overrides?: object) -> {walkSpeed, flySpeed, sprintMultiplier, eyeHeight, gravity, lookSensitivity}`
  - `horizontalForward(eye: number[3], look: number[3]) -> number[3] | null` (unit XZ-plane forward, `null` if vertical)
  - `integrateGravity(y, floorY: number|null, eyeHeight, velocityY, dt, gravity) -> {y:number, velocityY:number, grounded:boolean}`

- [ ] **Step 1: Write the failing test**

Create `test/firstPersonMovementUtils.test.js`:

```js
import {describe, it, expect} from "vitest";
import {
    movementAxes,
    deriveFirstPersonConfig,
    horizontalForward,
    integrateGravity
} from "../src/firstPersonMovementUtils.js";

describe("movementAxes", () => {
    it("maps single keys to unit intent", () => {
        expect(movementAxes({forward: true})).toEqual({forward: 1, right: 0, up: 0});
        expect(movementAxes({back: true})).toEqual({forward: -1, right: 0, up: 0});
        expect(movementAxes({right: true})).toEqual({forward: 0, right: 1, up: 0});
        expect(movementAxes({left: true})).toEqual({forward: 0, right: -1, up: 0});
        expect(movementAxes({up: true})).toEqual({forward: 0, right: 0, up: 1});
        expect(movementAxes({down: true})).toEqual({forward: 0, right: 0, up: -1});
    });

    it("cancels opposing keys to zero", () => {
        expect(movementAxes({forward: true, back: true})).toEqual({forward: 0, right: 0, up: 0});
        expect(movementAxes({left: true, right: true})).toEqual({forward: 0, right: 0, up: 0});
    });

    it("treats missing keys as not pressed", () => {
        expect(movementAxes({})).toEqual({forward: 0, right: 0, up: 0});
    });
});

describe("deriveFirstPersonConfig", () => {
    it("scales speeds with the model diagonal", () => {
        const c = deriveFirstPersonConfig(20);
        expect(c.walkSpeed).toBeCloseTo(2.4);   // 20 * 0.12
        expect(c.flySpeed).toBeCloseTo(6.0);     // 20 * 0.30
    });

    it("uses fixed meter-ish defaults for eye height and gravity", () => {
        const c = deriveFirstPersonConfig(20);
        expect(c.eyeHeight).toBe(1.7);
        expect(c.gravity).toBe(9.81);
        expect(c.sprintMultiplier).toBe(3);
        expect(c.lookSensitivity).toBeCloseTo(0.12);
    });

    it("honors overrides", () => {
        const c = deriveFirstPersonConfig(20, {walkSpeed: 5, eyeHeight: 1.0});
        expect(c.walkSpeed).toBe(5);
        expect(c.eyeHeight).toBe(1.0);
        expect(c.flySpeed).toBeCloseTo(6.0); // non-overridden still derived
    });

    it("guards against a non-positive diagonal", () => {
        const c = deriveFirstPersonConfig(0);
        expect(c.walkSpeed).toBeCloseTo(0.12); // treats diag as 1
    });
});

describe("horizontalForward", () => {
    it("returns a unit XZ vector from eye toward look", () => {
        expect(horizontalForward([0, 0, 0], [0, 0, 5])).toEqual([0, 0, 1]);
        expect(horizontalForward([0, 0, 0], [5, 0, 0])).toEqual([1, 0, 0]);
    });

    it("drops the vertical component before normalizing", () => {
        const f = horizontalForward([0, 0, 0], [1, 9, 1]);
        expect(f[0]).toBeCloseTo(Math.SQRT1_2);
        expect(f[1]).toBe(0);
        expect(f[2]).toBeCloseTo(Math.SQRT1_2);
    });

    it("returns null when looking straight up or down", () => {
        expect(horizontalForward([0, 0, 0], [0, 9, 0])).toBeNull();
    });
});

describe("integrateGravity", () => {
    it("holds the eye planted at floor + eyeHeight", () => {
        const r = integrateGravity(5, 3.3, 1.7, 0, 0.016, 9.81);
        expect(r.y).toBeCloseTo(5.0);
        expect(r.velocityY).toBe(0);
        expect(r.grounded).toBe(true);
    });

    it("falls when above the target height", () => {
        const r = integrateGravity(10, 3.3, 1.7, 0, 0.1, 9.81);
        expect(r.y).toBeLessThan(10);
        expect(r.y).toBeGreaterThan(5);
        expect(r.velocityY).toBeLessThan(0);
        expect(r.grounded).toBe(false);
    });

    it("hovers (never falls) when there is no floor", () => {
        const r = integrateGravity(10, null, 1.7, -5, 0.1, 9.81);
        expect(r).toEqual({y: 10, velocityY: 0, grounded: false});
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- firstPersonMovementUtils`
Expected: FAIL — `Failed to resolve import "../src/firstPersonMovementUtils.js"` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/firstPersonMovementUtils.js`:

```js
/**
 * Pure, framework-free helpers for first-person game movement.
 *
 * Kept separate from FirstPersonControls.js so the math is unit-testable
 * without a browser, an xeokit Scene, or the DOM (mirrors sectionAxisUtils.js).
 *
 * @private
 */

/**
 * Reduce the set of currently-pressed movement keys to per-axis intent.
 * Each axis is -1, 0, or +1.
 *
 * @param {Object} keys Flags: {forward, back, left, right, up, down}
 * @returns {{forward:number, right:number, up:number}}
 */
export function movementAxes(keys) {
    return {
        forward: (keys.forward ? 1 : 0) - (keys.back ? 1 : 0),
        right: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        up: (keys.up ? 1 : 0) - (keys.down ? 1 : 0)
    };
}

/**
 * Derive scale-aware movement config from the model's AABB diagonal.
 *
 * Speeds scale with model size so the feel holds for big and small models.
 * Eye height and gravity use fixed defaults that assume model units are
 * roughly metres (true for the XKT BIM models in this repo); override them
 * for models in other units.
 *
 * @param {Number} diag Model AABB diagonal length, in world units
 * @param {Object} [overrides] Any of the returned fields, to force a value
 * @returns {{walkSpeed:Number, flySpeed:Number, sprintMultiplier:Number,
 *            eyeHeight:Number, gravity:Number, lookSensitivity:Number}}
 */
export function deriveFirstPersonConfig(diag, overrides = {}) {
    const d = (diag > 0) ? diag : 1;
    const o = overrides;
    return {
        walkSpeed: o.walkSpeed !== undefined ? o.walkSpeed : d * 0.12,
        flySpeed: o.flySpeed !== undefined ? o.flySpeed : d * 0.30,
        sprintMultiplier: o.sprintMultiplier !== undefined ? o.sprintMultiplier : 3,
        eyeHeight: o.eyeHeight !== undefined ? o.eyeHeight : 1.7,
        gravity: o.gravity !== undefined ? o.gravity : 9.81,
        lookSensitivity: o.lookSensitivity !== undefined ? o.lookSensitivity : 0.12 // degrees per pixel
    };
}

/**
 * Unit forward vector in the horizontal (XZ) plane, from eye toward look.
 * Used by walk mode so looking up/down does not change ground speed.
 *
 * @param {Number[]} eye  World-space eye position [x,y,z]
 * @param {Number[]} look World-space look position [x,y,z]
 * @returns {Number[]|null} Unit [x,0,z], or null if the direction is vertical
 */
export function horizontalForward(eye, look) {
    const dx = look[0] - eye[0];
    const dz = look[2] - eye[2];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) {
        return null;
    }
    return [dx / len, 0, dz / len];
}

/**
 * Integrate one frame of gravity, clamping the eye to floor + eyeHeight.
 *
 * @param {Number} y         Current eye Y
 * @param {Number|null} floorY World Y of the floor under the eye, or null if none
 * @param {Number} eyeHeight Desired height of the eye above the floor
 * @param {Number} velocityY Current vertical velocity
 * @param {Number} dt        Frame duration in seconds
 * @param {Number} gravity   Downward acceleration (units/s^2)
 * @returns {{y:Number, velocityY:Number, grounded:Boolean}}
 */
export function integrateGravity(y, floorY, eyeHeight, velocityY, dt, gravity) {
    if (floorY === null || floorY === undefined) {
        // No floor beneath us: hover rather than fall forever.
        return {y, velocityY: 0, grounded: false};
    }
    const targetY = floorY + eyeHeight;
    const vY = velocityY - gravity * dt;
    const nextY = y + vY * dt;
    if (nextY <= targetY) {
        return {y: targetY, velocityY: 0, grounded: true};
    }
    return {y: nextY, velocityY: vY, grounded: false};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- firstPersonMovementUtils`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/firstPersonMovementUtils.js test/firstPersonMovementUtils.test.js
git commit -m "feat: add pure first-person movement utils with unit tests"
```

---

### Task 2: FirstPersonControls controller + BIMViewer wiring

The controller that takes over the camera while first-person is active: pointer-lock mouse-look, the WASD/Space/Ctrl/Shift/G key model, the per-frame movement + gravity loop, and the HUD. Wired into the existing nav-mode mediator so no toolbar markup changes.

**Files:**
- Create: `src/FirstPersonControls.js`
- Modify: `src/BIMViewer.js` (import near line 7; instantiate near the other controllers ~line 385; call from mediator at `setFirstPersonModeActive` ~line 367)

**Interfaces:**
- Consumes (from Task 1): `movementAxes`, `deriveFirstPersonConfig`, `horizontalForward`, `integrateGravity`.
- Consumes (from xeokit): `this.viewer.camera` (`yaw`, `pitch`, `pan`, `eye`, `look`), `this.viewer.scene` (`on/off("tick")`, `pick`, `aabb`, `canvas.canvas`), `this.viewer.cameraControl.active`, `math.getAABB3Diag`.
- Produces: `FirstPersonControls` class with `setActive(active: boolean)`.

- [ ] **Step 1: Create the controller**

Create `src/FirstPersonControls.js`:

```js
import {Controller} from "./Controller.js";
import {math} from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";
import {
    movementAxes,
    deriveFirstPersonConfig,
    horizontalForward,
    integrateGravity
} from "./firstPersonMovementUtils.js";

/**
 * Game-style first-person camera controls: pointer-lock mouse-look, WASD
 * movement, and a 'G' toggle between free-fly and floor-gravity walk.
 *
 * Activated/deactivated by BIMViewer's nav-mode mediator alongside
 * CameraControl#navMode = "firstPerson". While active it drives the camera
 * directly and disables the built-in CameraControl so the two don't fight.
 *
 * @private
 */
class FirstPersonControls extends Controller {

    constructor(parent, cfg = {}) {

        super(parent, cfg);

        this._canvas = this.viewer.scene.canvas.canvas;
        this._overrides = cfg.config || {};
        this._fpActive = false;       // our own active flag (base #_active is button state)
        this._gravityOn = false;      // false = fly, true = walk
        this._pointerLocked = false;
        this._velocityY = 0;
        this._tickSubId = undefined;
        this._savedCameraControlActive = undefined;
        this._hud = null;
        this._config = deriveFirstPersonConfig(1, this._overrides);
        this._resetKeys();

        // Stable bound handlers so add/removeEventListener pair up correctly.
        this._onClick = () => {
            if (this._fpActive && !this._pointerLocked && this._canvas.requestPointerLock) {
                this._canvas.requestPointerLock();
            }
        };

        this._onPointerLockChange = () => {
            this._pointerLocked = (document.pointerLockElement === this._canvas);
            this._updateHud();
        };

        this._onMouseMove = (e) => {
            if (!this._fpActive || !this._pointerLocked) {
                return;
            }
            const s = this._config.lookSensitivity;
            const camera = this.viewer.camera;
            if (e.movementX) {
                camera.yaw(-e.movementX * s);
            }
            if (e.movementY) {
                camera.pitch(-e.movementY * s);
            }
        };

        this._onKeyDown = (e) => this._setKey(e, true);
        this._onKeyUp = (e) => this._setKey(e, false);
    }

    _resetKeys() {
        this._keys = {
            forward: false, back: false, left: false, right: false,
            up: false, down: false, sprint: false
        };
    }

    _setKey(e, down) {
        if (!this._fpActive) {
            return;
        }
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
            return;
        }
        switch (e.code) {
            case "KeyW": case "ArrowUp": this._keys.forward = down; break;
            case "KeyS": case "ArrowDown": this._keys.back = down; break;
            case "KeyA": case "ArrowLeft": this._keys.left = down; break;
            case "KeyD": case "ArrowRight": this._keys.right = down; break;
            case "Space": this._keys.up = down; break;
            case "ControlLeft": case "ControlRight": this._keys.down = down; break;
            case "ShiftLeft": case "ShiftRight": this._keys.sprint = down; break;
            case "KeyG":
                if (down) {
                    this._gravityOn = !this._gravityOn;
                    this._velocityY = 0;
                    this._updateHud();
                }
                break;
            default:
                return; // don't preventDefault on unrelated keys
        }
        e.preventDefault();
    }

    /**
     * Enter or leave game-style first-person control.
     * @param {Boolean} active
     */
    setActive(active) {
        active = !!active;
        if (active === this._fpActive) {
            return;
        }
        this._fpActive = active;
        if (active) {
            this._enter();
        } else {
            this._exit();
        }
    }

    _enter() {
        // Take over from the built-in CameraControl.
        this._savedCameraControlActive = this.viewer.cameraControl.active;
        this.viewer.cameraControl.active = false;

        // Recompute scale-aware config from the loaded model each time.
        const diag = math.getAABB3Diag(this.viewer.scene.aabb);
        this._config = deriveFirstPersonConfig(diag, this._overrides);

        this._gravityOn = false;
        this._velocityY = 0;
        this._resetKeys();

        this._canvas.addEventListener("click", this._onClick);
        document.addEventListener("pointerlockchange", this._onPointerLockChange);
        document.addEventListener("mousemove", this._onMouseMove);
        document.addEventListener("keydown", this._onKeyDown);
        document.addEventListener("keyup", this._onKeyUp);

        this._tickSubId = this.viewer.scene.on("tick", (e) => this._update(e));

        this._showHud();
    }

    _exit() {
        this._canvas.removeEventListener("click", this._onClick);
        document.removeEventListener("pointerlockchange", this._onPointerLockChange);
        document.removeEventListener("mousemove", this._onMouseMove);
        document.removeEventListener("keydown", this._onKeyDown);
        document.removeEventListener("keyup", this._onKeyUp);

        if (this._tickSubId !== undefined) {
            this.viewer.scene.off(this._tickSubId);
            this._tickSubId = undefined;
        }
        if (this._pointerLocked && document.exitPointerLock) {
            document.exitPointerLock();
        }
        this._pointerLocked = false;
        this._resetKeys();
        this._hideHud();

        if (this._savedCameraControlActive !== undefined) {
            this.viewer.cameraControl.active = this._savedCameraControlActive;
            this._savedCameraControlActive = undefined;
        }
    }

    _update(e) {
        if (!this._fpActive) {
            return;
        }
        const dt = Math.min(e.deltaTime / 1000, 0.1); // clamp long frame gaps
        const camera = this.viewer.camera;
        const cfg = this._config;
        const ax = movementAxes(this._keys);

        const base = this._gravityOn ? cfg.walkSpeed : cfg.flySpeed;
        const speed = base * (this._keys.sprint ? cfg.sprintMultiplier : 1) * dt;

        if (!this._gravityOn) {
            // FLY: move along camera-local axes (forward follows look incl. pitch).
            if (ax.forward || ax.right) {
                camera.pan([ax.right * speed, 0, -ax.forward * speed]);
            }
            if (ax.up) {
                const dy = ax.up * speed;
                const eye = camera.eye, look = camera.look;
                camera.eye = [eye[0], eye[1] + dy, eye[2]];
                camera.look = [look[0], look[1] + dy, look[2]];
            }
        } else {
            // WALK: move in the horizontal plane only, then apply gravity.
            const fwd = horizontalForward(camera.eye, camera.look);
            if (fwd && (ax.forward || ax.right)) {
                const right = [fwd[2], 0, -fwd[0]]; // screen-right in the XZ plane
                const mx = (fwd[0] * ax.forward + right[0] * ax.right) * speed;
                const mz = (fwd[2] * ax.forward + right[2] * ax.right) * speed;
                const eye = camera.eye, look = camera.look;
                camera.eye = [eye[0] + mx, eye[1], eye[2] + mz];
                camera.look = [look[0] + mx, look[1], look[2] + mz];
            }
            this._applyGravity(dt);
        }
    }

    _applyGravity(dt) {
        const camera = this.viewer.camera;
        const eye = camera.eye;
        const floorY = this._floorYBelow(eye);
        const r = integrateGravity(eye[1], floorY, this._config.eyeHeight, this._velocityY, dt, this._config.gravity);
        this._velocityY = r.velocityY;
        if (r.y !== eye[1]) {
            const dy = r.y - eye[1];
            const look = camera.look;
            camera.eye = [eye[0], r.y, eye[2]];
            camera.look = [look[0], look[1] + dy, look[2]];
        }
    }

    _floorYBelow(eye) {
        // Raycast straight down from just above the eye to find the floor.
        const hit = this.viewer.scene.pick({
            origin: [eye[0], eye[1] + 0.1, eye[2]],
            direction: [0, -1, 0],
            pickSurface: true
        });
        return (hit && hit.worldPos) ? hit.worldPos[1] : null;
    }

    // --- HUD ----------------------------------------------------------------

    _showHud() {
        if (!this._hud) {
            const hud = document.createElement("div");
            hud.style.cssText = [
                "position:absolute", "left:50%", "bottom:16px", "transform:translateX(-50%)",
                "z-index:200000", "pointer-events:none", "font-family:sans-serif",
                "font-size:12px", "line-height:1.5", "color:#fff", "text-align:center",
                "background:rgba(0,0,0,0.55)", "padding:6px 12px", "border-radius:6px",
                "white-space:nowrap"
            ].join(";");
            (this._canvas.parentNode || document.body).appendChild(hud);
            this._hud = hud;
        }
        this._updateHud();
    }

    _updateHud() {
        if (!this._hud) {
            return;
        }
        const mode = this._gravityOn ? "WALK" : "FLY";
        const verticals = this._gravityOn ? "" : " &middot; Space/Ctrl up/down";
        const lock = this._pointerLocked ? "Esc to release mouse" : "Click view to look";
        this._hud.innerHTML =
            `<b>${mode}</b> &nbsp; WASD move &middot; Shift sprint${verticals} &middot; G gravity<br>${lock}`;
    }

    _hideHud() {
        if (this._hud && this._hud.parentNode) {
            this._hud.parentNode.removeChild(this._hud);
        }
        this._hud = null;
    }
}

export {FirstPersonControls};
```

- [ ] **Step 2: Import the controller in BIMViewer.js**

In `src/BIMViewer.js`, add the import next to the other toolbar imports (after the `FirstPersonMode` import on line 7):

```js
import {FirstPersonControls} from "./FirstPersonControls.js";
```

- [ ] **Step 3: Instantiate the controller**

In `src/BIMViewer.js`, immediately after the `this._firstPersonMode = new FirstPersonMode(...)` block (ends ~line 389), add:

```js
        this._firstPersonControls = new FirstPersonControls(this, {
            // config: { walkSpeed, flySpeed, eyeHeight, ... }  // optional overrides
        });
```

- [ ] **Step 4: Drive it from the nav-mode mediator**

In `src/BIMViewer.js`, inside the mediator's `setFirstPersonModeActive` function (currently lines 367-370), add the `setActive` call. Replace:

```js
            this.setFirstPersonModeActive = (active) => {
                bimViewer.viewer.cameraControl.navMode = active ? "firstPerson" : (threeDActive ? "orbit" : "planView");
                firstPersonActive = active;
            };
```

with:

```js
            this.setFirstPersonModeActive = (active) => {
                bimViewer.viewer.cameraControl.navMode = active ? "firstPerson" : (threeDActive ? "orbit" : "planView");
                if (bimViewer._firstPersonControls) {
                    bimViewer._firstPersonControls.setActive(active);
                }
                firstPersonActive = active;
            };
```

Note: the mediator runs before `_firstPersonControls` is constructed during setup, hence the guard. The guard is harmless at runtime (the controller always exists by the time a user clicks the button).

- [ ] **Step 5: Sanity-check that nothing else broke (lint via build dry parse)**

Run: `npm test`
Expected: PASS — the Task 1 suite still green (no test imports the controller; this just confirms the repo still builds the test graph without syntax errors in touched files).

- [ ] **Step 6: Commit**

```bash
git add src/FirstPersonControls.js src/BIMViewer.js
git commit -m "feat: add game-style first-person controls (pointer-lock look, WASD, gravity toggle)"
```

---

### Task 3: Build, live-verify on the Bungalow model, and tune

Rebuild the `dist/` bundles the demo loads, then verify the behaviour in a real browser via Playwright and tune the speed/height constants against the Bungalow model.

**Files:**
- Modify (generated): `dist/xeokit-bim-viewer.es.js`, `dist/xeokit-bim-viewer.min.es.js` (via `npm run build`)
- Possibly modify: `src/firstPersonMovementUtils.js` (only the numeric factors in `deriveFirstPersonConfig`, if tuning is needed)

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces: working built bundles; no new code interfaces.

- [ ] **Step 1: Build the dist bundles**

Run: `npm run build`
Expected: Rollup completes with no errors; `dist/xeokit-bim-viewer.es.js` and `dist/xeokit-bim-viewer.min.es.js` updated.

- [ ] **Step 2: Serve the demo**

Run (background): `npm run serve`  (http-server on port 8080)
Then the app is at `http://localhost:8080/app/`.

- [ ] **Step 3: Load the model and enable first-person (Playwright MCP)**

Using Playwright MCP:
1. `browser_navigate` to `http://localhost:8080/app/`.
2. Load the Bungalow project via the page API:
   `browser_evaluate` → `() => { window.bimViewer.loadProject("Bungalow43"); }`
   (If `window.bimViewer` is not exposed, instead click the model in the Models explorer panel. If neither `Bungalow43` nor a model is present, use whichever project id appears in `app/data/projects/index.json`.)
3. `browser_wait_for` a moment for the model to load (watch for the canvas to show geometry via `browser_take_screenshot`).
4. Click the First-Person toolbar button (selector `.xeokit-firstPerson`) with `browser_click`.

Expected: the FLY HUD appears at the bottom-center ("FLY … WASD move … G gravity / Click view to look").

- [ ] **Step 4: Verify WASD movement moves the camera**

`browser_evaluate`:

```js
() => {
  const cam = window.bimViewer.viewer.camera;
  const before = cam.eye.slice();
  const down = new KeyboardEvent("keydown", {code: "KeyW", bubbles: true});
  const up = new KeyboardEvent("keyup", {code: "KeyW", bubbles: true});
  document.dispatchEvent(down);
  return new Promise(res => setTimeout(() => {
    document.dispatchEvent(up);
    const after = window.bimViewer.viewer.camera.eye.slice();
    const moved = Math.hypot(after[0]-before[0], after[1]-before[1], after[2]-before[2]);
    res({before, after, moved});
  }, 500));
}
```

Expected: `moved` is clearly non-zero (the eye advanced while W was held). If `moved` is 0, the tick loop or key handler is not firing — debug before continuing.

- [ ] **Step 5: Verify the G gravity toggle and floor clamp**

`browser_evaluate`:

```js
() => {
  const v = window.bimViewer.viewer;
  document.dispatchEvent(new KeyboardEvent("keydown", {code: "KeyG", bubbles: true}));
  document.dispatchEvent(new KeyboardEvent("keyup", {code: "KeyG", bubbles: true}));
  const hud = document.querySelector('div[style*="z-index:200000"]')?.innerText || "";
  return new Promise(res => setTimeout(() => {
    res({hudSaysWalk: /WALK/.test(hud), eyeY: v.camera.eye[1]});
  }, 800));
}
```

Expected: `hudSaysWalk` is `true`, and after a moment `eyeY` settles (gravity pulled the eye onto the floor at eye height rather than drifting). Take a `browser_take_screenshot` to confirm the view is at a human standing height inside the model.

- [ ] **Step 6: Verify mouse-look (best-effort) and clean teardown**

- Mouse-look uses pointer lock, which often will not engage under headless automation. Confirm the *look math* path by dispatching a synthetic locked mouse move and checking the camera yaw changed — only meaningful if `document.pointerLockElement` got set; otherwise note "verify mouse-look manually in a real browser" and rely on the unit-tested camera calls.
- Click the First-Person button again (`.xeokit-firstPerson`) to deactivate; `browser_evaluate` that the HUD is gone and `window.bimViewer.viewer.cameraControl.active === true` again:

```js
() => ({
  hudGone: !document.querySelector('div[style*="z-index:200000"]'),
  cameraControlRestored: window.bimViewer.viewer.cameraControl.active === true
})
```

Expected: `{hudGone: true, cameraControlRestored: true}`.

- [ ] **Step 7: Tune if needed**

If movement felt too fast/slow or eye height looked wrong in the Bungalow screenshots, adjust only the numeric factors in `deriveFirstPersonConfig` (`0.12`, `0.30`) and/or the `eyeHeight` default (`1.7`). Re-run `npm test` (the speed-factor assertions in Task 1 must be updated to match if you change factors), then `npm run build`, then re-verify Steps 4-5.

- [ ] **Step 8: Commit**

```bash
git add dist/xeokit-bim-viewer.es.js dist/xeokit-bim-viewer.min.es.js src/firstPersonMovementUtils.js test/firstPersonMovementUtils.test.js
git commit -m "build: wire first-person game controls into dist; tune movement on Bungalow"
```

---

## Self-Review

**Spec coverage:**
- Pointer-lock mouse-look → Task 2 (`_onClick`, `_onPointerLockChange`, `_onMouseMove`). ✓
- WASD + Space/Ctrl + Shift sprint → Task 2 (`_setKey`, `_update` fly branch) + Task 1 `movementAxes`. ✓
- `G` toggles fly ⇄ walk → Task 2 (`_setKey` KeyG, `_update` branch). ✓
- Walk = floor gravity only (raycast down, no wall collision) → Task 2 `_floorYBelow`/`_applyGravity` + Task 1 `integrateGravity`. ✓
- No infinite fall when no floor → Task 1 `integrateGravity` null branch + test. ✓
- Scale-aware speeds/eye-height → Task 1 `deriveFirstPersonConfig` + Task 2 `_enter` recompute. ✓
- Disable built-in CameraControl while active, restore on exit → Task 2 `_enter`/`_exit`. ✓
- Wire through `setFirstPersonModeActive` mediator, no toolbar changes → Task 2 Step 4. ✓
- HUD overlay (injected, no CSS build dep) → Task 2 `_showHud`/`_updateHud`/`_hideHud`. ✓
- Build dist + Playwright verify on Bungalow → Task 3. ✓
- Out-of-scope (wall collision, jumping, touch, rebinding UI) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; the only optional block is the documented `config` override comment in Task 2 Step 3, which is intentionally inert. ✓

**Type consistency:** `movementAxes`, `deriveFirstPersonConfig`, `horizontalForward`, `integrateGravity` signatures match between Task 1 definitions, the Task 1 tests, and the Task 2 call sites. Config field names (`walkSpeed`, `flySpeed`, `sprintMultiplier`, `eyeHeight`, `gravity`, `lookSensitivity`) are used identically in both tasks. `setActive` is the single public method used by the mediator. ✓
