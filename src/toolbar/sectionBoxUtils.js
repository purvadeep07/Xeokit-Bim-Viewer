/**
 * Pure helpers for the axis-aligned Section Box.
 *
 * A section box is just six axis-aligned cutting planes, one per face, each with
 * an *inward*-pointing normal so the kept region is the box interior. Keeping the
 * geometry here (no xeokit / DOM) lets us unit-test the math, mirroring
 * sectionAxisUtils.js and firstPersonMovementUtils.js.
 *
 * A box is `{min:[x,y,z], max:[x,y,z]}`. Faces are keyed like sectionAxisUtils:
 * "+x" is the face at max.x, "-x" the face at min.x, etc.
 *
 * @private
 */

/** Canonical face keys, in a stable order. */
export const BOX_FACES = Object.freeze(["+x", "-x", "+y", "-y", "+z", "-z"]);

/**
 * Id prefix for all Section Box scene objects (planes, handles, wireframe).
 * Lets the Slice tool tell box planes apart from ordinary slice planes so its
 * clear/flip/enable/disable operations never touch the box.
 */
export const SECTION_BOX_ID_PREFIX = "xeokit-sectionBox";

/**
 * True if a section-plane id belongs to the Section Box (not a Slice-tool plane).
 * @param {String} id
 * @returns {Boolean}
 */
export function isSectionBoxPlaneId(id) {
    return typeof id === "string" && id.indexOf(SECTION_BOX_ID_PREFIX) === 0;
}

// face -> {axis index (0=x,1=y,2=z), bound ("max"|"min"), inward unit normal}
const FACE_INFO = Object.freeze({
    "+x": {axis: 0, bound: "max", dir: Object.freeze([-1, 0, 0])},
    "-x": {axis: 0, bound: "min", dir: Object.freeze([1, 0, 0])},
    "+y": {axis: 1, bound: "max", dir: Object.freeze([0, -1, 0])},
    "-y": {axis: 1, bound: "min", dir: Object.freeze([0, 1, 0])},
    "+z": {axis: 2, bound: "max", dir: Object.freeze([0, 0, -1])},
    "-z": {axis: 2, bound: "min", dir: Object.freeze([0, 0, 1])}
});

/**
 * Convert a xeokit AABB `[minx,miny,minz,maxx,maxy,maxz]` to a box.
 * Returns null for a missing or inverted (empty) AABB — xeokit uses an inverted
 * AABB to mean "no geometry loaded".
 *
 * @param {Number[]} aabb
 * @returns {{min:Number[], max:Number[]}|null}
 */
export function aabbToBox(aabb) {
    if (!aabb || aabb.length < 6) {
        return null;
    }
    if (aabb[0] > aabb[3] || aabb[1] > aabb[4] || aabb[2] > aabb[5]) {
        return null;
    }
    return {
        min: [aabb[0], aabb[1], aabb[2]],
        max: [aabb[3], aabb[4], aabb[5]]
    };
}

function faceCenter(box, face) {
    const info = FACE_INFO[face];
    const c = [
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2
    ];
    c[info.axis] = box[info.bound][info.axis];
    return c;
}

/**
 * Six `{face, pos, dir}` plane descriptors for a box — `pos` at each face center,
 * `dir` the inward cutting normal.
 *
 * @param {{min:Number[], max:Number[]}} box
 * @returns {Array<{face:String, pos:Number[], dir:Number[]}>}
 */
export function boxToPlanes(box) {
    return BOX_FACES.map((face) => ({
        face,
        pos: faceCenter(box, face),
        dir: FACE_INFO[face].dir.slice()
    }));
}

/**
 * Six `{face, pos}` handle positions, one at each face center.
 *
 * @param {{min:Number[], max:Number[]}} box
 * @returns {Array<{face:String, pos:Number[]}>}
 */
export function faceHandlePositions(box) {
    return BOX_FACES.map((face) => ({face, pos: faceCenter(box, face)}));
}

/**
 * Return a new box with one face moved to coordinate `worldT` along its axis,
 * clamped so it cannot reach or cross the opposite face (a `minThickness` gap is
 * preserved). Does not mutate the input.
 *
 * @param {{min:Number[], max:Number[]}} box
 * @param {String} face One of BOX_FACES
 * @param {Number} worldT New coordinate of the face along its axis
 * @param {Number} [minThickness=0.01] Minimum remaining box thickness on that axis
 * @returns {{min:Number[], max:Number[]}}
 */
export function moveFace(box, face, worldT, minThickness = 0.01) {
    const info = FACE_INFO[face];
    const next = {min: box.min.slice(), max: box.max.slice()};
    const i = info.axis;
    if (info.bound === "max") {
        next.max[i] = Math.max(worldT, box.min[i] + minThickness);
    } else {
        next.min[i] = Math.min(worldT, box.max[i] - minThickness);
    }
    return next;
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Parameter `t` such that `axisPoint + t*axisDir` is the point on the axis line
 * closest to the ray `rayOrigin + s*rayDir`. Used to turn a pointer ray into a
 * face translation along its axis (the same closest-point-between-lines math the
 * SDK's TransformControl uses). Falls back to projecting the ray origin onto the
 * axis when the two lines are parallel.
 *
 * @param {Number[]} rayOrigin
 * @param {Number[]} rayDir   Need not be normalized
 * @param {Number[]} axisPoint
 * @param {Number[]} axisDir  Need not be normalized
 * @returns {Number}
 */
export function closestPointOnAxisParam(rayOrigin, rayDir, axisPoint, axisDir) {
    const r = [
        rayOrigin[0] - axisPoint[0],
        rayOrigin[1] - axisPoint[1],
        rayOrigin[2] - axisPoint[2]
    ];
    const a = dot(rayDir, rayDir);
    const b = dot(rayDir, axisDir);
    const c = dot(axisDir, axisDir);
    const d = dot(rayDir, r);
    const e = dot(axisDir, r);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-9) {
        // Lines are parallel: project the ray origin onto the axis.
        return c < 1e-9 ? 0 : e / c;
    }
    return (a * e - b * d) / denom;
}
