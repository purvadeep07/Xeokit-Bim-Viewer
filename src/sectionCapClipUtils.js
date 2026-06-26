/**
 * Pure geometry helpers for clipping section-cap polygons to the *other* active
 * section planes.
 *
 * Why this exists: xeokit's SectionCaps generates one cap per section plane,
 * covering the solid's full cross-section at that plane. With a Section Box (six
 * planes active at once) the cap for one face is NOT constrained to the box's
 * other planes, so it sticks out past them. Render-time clipping (the Mesh
 * `clippable` flag) does not reliably trim these caps, so we clip the cap
 * geometry to the box at generation time instead.
 *
 * Half-space convention matches xeokit SectionPlanes: a point is KEPT when
 * `dot(plane.dir, point - plane.pos) >= 0` (inward normal keeps the interior).
 *
 * NOTE: This same algorithm is duplicated (inlined) inside the patched
 * @xeokit/xeokit-sdk SectionCaps (see patches/). This module is the unit-tested
 * reference for that math; keep the two in sync.
 *
 * @private
 */

const EPS = 1e-9;

function signedDist(v, pos, dir) {
    return dir[0] * (v[0] - pos[0]) + dir[1] * (v[1] - pos[1]) + dir[2] * (v[2] - pos[2]);
}

function lerp(a, b, t) {
    return [
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        a[2] + t * (b[2] - a[2])
    ];
}

/**
 * Sutherland-Hodgman clip of a convex/simple polygon against one half-space.
 * Keeps the part where `dot(dir, v - pos) >= 0`.
 *
 * @param {number[][]} poly Polygon as an ordered array of [x,y,z] vertices.
 * @param {number[]} pos A point on the clipping plane.
 * @param {number[]} dir The plane normal (interior is the +dir side).
 * @returns {number[][]} The clipped polygon (may be empty).
 */
export function clipPolygonToHalfspace(poly, pos, dir) {
    if (poly.length === 0) {
        return poly;
    }
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const da = signedDist(a, pos, dir);
        const db = signedDist(b, pos, dir);
        const aIn = da >= -EPS;
        const bIn = db >= -EPS;
        if (aIn) {
            out.push(a);
        }
        if (aIn !== bIn) {
            const denom = da - db;
            // Parallel/degenerate edge guard: if both ~0 the edge lies in the plane.
            const t = Math.abs(denom) < EPS ? 0 : da / denom;
            out.push(lerp(a, b, t));
        }
    }
    return out;
}

/**
 * Clip a single triangle against a list of section planes and fan-triangulate
 * the surviving (convex) polygon back into triangles.
 *
 * @param {number[][]} tri Triangle as [p0, p1, p2], each [x,y,z].
 * @param {{pos:number[], dir:number[]}[]} planes Clipping planes.
 * @returns {number[][][]} Array of triangles (each [p0,p1,p2]). Empty if fully clipped.
 */
export function clipTriangleToPlanes(tri, planes) {
    let poly = tri;
    for (let i = 0; i < planes.length; i++) {
        poly = clipPolygonToHalfspace(poly, planes[i].pos, planes[i].dir);
        if (poly.length < 3) {
            return [];
        }
    }
    const out = [];
    for (let i = 1; i < poly.length - 1; i++) {
        out.push([poly[0], poly[i], poly[i + 1]]);
    }
    return out;
}

/**
 * Clip a list of cap triangles against the given planes, returning a flat list
 * of triangles all lying inside every plane's interior half-space.
 *
 * @param {number[][][]} triangles Array of triangles (each [p0,p1,p2]).
 * @param {{pos:number[], dir:number[]}[]} planes Clipping planes.
 * @returns {number[][][]} Flat array of clipped triangles.
 */
export function clipCapTrianglesToPlanes(triangles, planes) {
    if (!planes || planes.length === 0) {
        return triangles;
    }
    const out = [];
    for (let i = 0; i < triangles.length; i++) {
        const clipped = clipTriangleToPlanes(triangles[i], planes);
        for (let j = 0; j < clipped.length; j++) {
            out.push(clipped[j]);
        }
    }
    return out;
}
