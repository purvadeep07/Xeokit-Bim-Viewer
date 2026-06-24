# First-Person Game Controls — Design

**Date:** 2026-06-24
**Status:** Approved (design)

## Problem

The toolbar's First-Person button currently only changes xeokit's camera pivot
behaviour (`navMode = "firstPerson"`). It does not feel like a video game:

1. **Keyboard movement is gated by hover.** xeokit's built-in WASD movement only
   works while the mouse physically hovers the canvas
   (`keyboardEnabledOnlyIfMouseover` defaults to `true`), so clicking the button
   then pressing W does nothing.
2. **No mouse-look.** xeokit's first-person mode only rotates the view while the
   mouse button is held and dragged. A game uses *pointer lock*: click once, then
   move the mouse to look around.

The user wants to walk through the model like a video game: WASD to move, free
mouse-look, and the ability to both fly and walk on floors.

## Goals

- WASD movement that works without hovering the canvas.
- Pointer-lock mouse-look (click to lock, move mouse to look, `Esc` to release).
- Two sub-modes inside first-person, toggled with the **`G`** key:
  - **Fly** (default): free movement in the look direction; Space/Ctrl for up/down.
  - **Walk**: floor gravity keeps you at eye-height on floors/stairs.
- Works regardless of model units (speeds/eye-height scale with model size).

## Non-Goals (YAGNI)

- Wall / side collision (walk mode is floor-gravity only — you can pass through walls).
- Jumping.
- Touch / mobile controls.
- Configurable key-rebinding UI.

## Architecture

### New module: `src/FirstPersonControls.js`

A `Controller` subclass (matching the existing `src/toolbar/*` pattern) that owns
all game-style camera interaction. It is **inactive by default** and only takes
over the camera while first-person mode is active.

Responsibilities:

- `setActive(active)` — enter/leave game-control mode.
- On activate:
  - Save the current `viewer.cameraControl.active` value, then set it to `false`
    so xeokit's built-in mouse-rotate / keyboard handlers don't fight our own.
  - Attach DOM listeners: canvas `click` → `requestPointerLock`;
    `pointerlockchange`; `mousemove` (look); `keydown`/`keyup` (movement + `G`).
  - Subscribe to `scene.on("tick")` for the per-frame movement loop.
  - Show the HUD overlay.
- On deactivate:
  - Detach all listeners, unsubscribe tick, exit pointer lock, hide HUD,
    restore `viewer.cameraControl.active` to its saved value.

The module injects its own minimal HUD styles inline (via JS), so it needs no
changes to `xeokit-bim-viewer.css` or the build's CSS copy step.

### Integration point: `src/BIMViewer.js`

- Instantiate once near the other controllers:
  `this._firstPersonControls = new FirstPersonControls(this, { ... })`.
- Drive it from the single existing chokepoint that already flips first-person —
  the `cameraControlNavModeMediator.setFirstPersonModeActive(active)` function
  (`BIMViewer.js:367`): add `bimViewer._firstPersonControls.setActive(active)`.

No toolbar markup or `FirstPersonMode.js` button-controller changes are required;
the mediator already activates/deactivates first-person and handles reset.

## Controls

| Input            | Action                                                        |
|------------------|---------------------------------------------------------------|
| Mouse (locked)   | Look around — `camera.yaw(-dx·s)` / `camera.pitch(-dy·s)`      |
| W / A / S / D    | Move forward / left / back / right — via `camera.pan()`        |
| Space / Ctrl     | Move up / down (**fly mode only**)                            |
| Shift            | Sprint (~3× speed)                                            |
| **G**            | Toggle gravity → FLY ⇄ WALK                                   |
| Esc              | Release pointer lock (stays in first-person)                  |

`G` is edge-triggered (acts on keydown, re-armed on keyup) so holding it doesn't
flip repeatedly. Key handlers ignore events whose target is `INPUT`/`TEXTAREA`.
Movement works whenever first-person is active; mouse-look requires pointer lock.

## Movement loop (per `scene.tick`)

Let `dt` = `e.deltaTime / 1000` (seconds). Build a desired velocity from the
currently-pressed keys, then apply it.

- **Fly:** move along the camera's local axes including pitch.
  - Forward/back → `camera.pan([0, 0, -fwd])`; strafe → `camera.pan([strafe, 0, 0])`.
  - Up/down → add `±speed·dt` to `eye.y` and `look.y` (world-up, so it's
    independent of where you're looking).
- **Walk:** move along the **horizontal** projection of the look direction only
  (zero out the vertical component of forward/right), so looking up/down doesn't
  change walking speed. Then apply gravity:
  - Raycast down: `scene.pick({ origin: [eye.x, eye.y + ε, eye.z],
    direction: [0, -1, 0], pickSurface: true })`.
  - If a floor is hit, `targetY = floorWorldPos.y + eyeHeight`.
    Integrate a falling velocity (`vY -= g·dt; y += vY·dt`); clamp at `targetY`
    and zero `vY` when landing — so stepping off a ledge makes you fall.
  - If no floor is hit, hover (skip gravity) to avoid falling forever.

`camera.yaw`/`camera.pitch` rotate `look` about `eye` (confirmed in
`Camera.js:354,369`); `camera.pan` moves `eye` and `look` together along camera
local axes (`Camera.js:389`). xeokit first-person uses gimbal-lock, keeping `up`
world-aligned, which keeps mouse-look stable.

## Scale handling

Model units are not guaranteed to be meters (IFC can be mm). To feel right
regardless:

- Compute the scene AABB diagonal `D = math.getAABB3Diag(scene.aabb)`.
- Default `eyeHeight ≈ 1.7` and `walkSpeed ≈ 4`, `flySprint ≈ 3×`, but scale the
  effective speeds by `D` so movement is proportional to model size.
- Final constants are tuned against the loaded **Bungalow** model during
  verification and exposed as simple config fields for later adjustment.

## Edge cases

- **Pointer lock denied / Esc pressed:** `pointerlockchange` flips the HUD hint
  back to "Click to look"; movement still works, look pauses until re-locked.
- **Leaving first-person (button, 3D toggle, or reset):** the mediator calls
  `setActive(false)`, which fully tears down listeners and restores
  `cameraControl.active`. Existing reset/3D-toggle paths already route through it.
- **Typing in inputs:** key handlers early-return on `INPUT`/`TEXTAREA` targets.
- **No floor under the camera (gaps/holes):** hover instead of infinite fall.

## Build & verification

- The demo (`app/index.html`) loads from `dist/xeokit-bim-viewer.es.js`, so after
  editing `src/` run `npm run build` to regenerate the bundles.
- Verify live with Playwright on the Bungalow model: load → enable first-person →
  confirm WASD walks, mouse-look turns the view, `G` toggles FLY/WALK, walking
  follows the floor (and stairs), and leaving first-person restores normal orbit.
