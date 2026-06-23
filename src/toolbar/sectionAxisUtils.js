/**
 * Pure axis-vector helpers for axis-aligned section cuts and rotate-snap.
 * No xeokit / DOM dependencies so this stays unit-testable.
 * @private
 */

// Frozen so the exported reference can't be mutated by consumers. The public
// functions still return fresh arrays via .slice(), so callers get writable copies.
const AXES = Object.freeze([
    Object.freeze({key: "+x", dir: Object.freeze([1, 0, 0])}),
    Object.freeze({key: "-x", dir: Object.freeze([-1, 0, 0])}),
    Object.freeze({key: "+y", dir: Object.freeze([0, 1, 0])}),
    Object.freeze({key: "-y", dir: Object.freeze([0, -1, 0])}),
    Object.freeze({key: "+z", dir: Object.freeze([0, 0, 1])}),
    Object.freeze({key: "-z", dir: Object.freeze([0, 0, -1])})
]);

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
