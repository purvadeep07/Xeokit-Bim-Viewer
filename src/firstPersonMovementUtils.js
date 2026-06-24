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
