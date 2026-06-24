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
