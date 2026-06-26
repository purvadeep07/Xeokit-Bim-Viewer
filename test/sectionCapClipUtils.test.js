import {describe, it, expect} from "vitest";
import {
    clipPolygonToHalfspace,
    clipTriangleToPlanes,
    clipCapTrianglesToPlanes
} from "../src/sectionCapClipUtils.js";

// Shoelace area of a polygon given as [[x,y,z],...] projected onto the XY plane.
function areaXY(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
}

function sumArea(tris) {
    return tris.reduce((s, t) => s + areaXY(t), 0);
}

// A 4x4 square in the z=0 plane.
const SQUARE = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]];

describe("clipPolygonToHalfspace", () => {
    it("keeps the half where dot(dir, v - pos) >= 0 (inward normal keeps interior)", () => {
        // Keep x <= 2: dir points -x, pos at x=2.
        const out = clipPolygonToHalfspace(SQUARE, [2, 0, 0], [-1, 0, 0]);
        expect(out.length).toBeGreaterThanOrEqual(3);
        // Resulting strip is x in [0,2], y in [0,4] => area 8.
        expect(areaXY(out)).toBeCloseTo(8, 6);
        // No vertex should lie outside the kept half-space (x <= 2 + eps).
        for (const v of out) {
            expect(v[0]).toBeLessThanOrEqual(2 + 1e-9);
        }
    });

    it("leaves a fully-inside polygon unchanged in area", () => {
        // Keep x >= -1: entire square is inside.
        const out = clipPolygonToHalfspace(SQUARE, [-1, 0, 0], [1, 0, 0]);
        expect(areaXY(out)).toBeCloseTo(16, 6);
    });

    it("returns an empty polygon when fully outside", () => {
        // Keep x >= 10: square is entirely outside.
        const out = clipPolygonToHalfspace(SQUARE, [10, 0, 0], [1, 0, 0]);
        expect(out.length).toBe(0);
    });
});

describe("clipTriangleToPlanes", () => {
    const tri = [[0, 0, 0], [4, 0, 0], [0, 4, 0]]; // area 8

    it("clips a triangle to a box corner (two perpendicular planes)", () => {
        // Keep x <= 2 and y <= 2 (a 2x2 corner region of the triangle).
        const planes = [
            {pos: [2, 0, 0], dir: [-1, 0, 0]},
            {pos: [0, 2, 0], dir: [0, -1, 0]}
        ];
        const out = clipTriangleToPlanes(tri, planes);
        expect(out.length).toBeGreaterThanOrEqual(1);
        // The triangle x+y<=4 intersected with x<=2,y<=2 is the full 2x2 square (area 4),
        // since the line x+y=4 passes through (2,2) and stays outside the square corner.
        expect(sumArea(out)).toBeCloseTo(4, 6);
        // Every output vertex must satisfy both half-spaces.
        for (const t of out) {
            for (const v of t) {
                expect(v[0]).toBeLessThanOrEqual(2 + 1e-9);
                expect(v[1]).toBeLessThanOrEqual(2 + 1e-9);
            }
        }
    });

    it("returns the original triangle (as one tri) when fully inside all planes", () => {
        const planes = [{pos: [-1, 0, 0], dir: [1, 0, 0]}];
        const out = clipTriangleToPlanes(tri, planes);
        expect(sumArea(out)).toBeCloseTo(8, 6);
    });

    it("returns no triangles when fully clipped away", () => {
        const planes = [{pos: [10, 0, 0], dir: [1, 0, 0]}];
        const out = clipTriangleToPlanes(tri, planes);
        expect(out.length).toBe(0);
    });
});

describe("clipCapTrianglesToPlanes", () => {
    it("clips a list of triangles and returns a flat list, all inside the box", () => {
        // Two triangles forming the 4x4 square (area 16 total).
        const tris = [
            [[0, 0, 0], [4, 0, 0], [4, 4, 0]],
            [[0, 0, 0], [4, 4, 0], [0, 4, 0]]
        ];
        // Box: x in [1,3], y in [1,3] => kept area 4.
        const planes = [
            {pos: [3, 0, 0], dir: [-1, 0, 0]},
            {pos: [1, 0, 0], dir: [1, 0, 0]},
            {pos: [0, 3, 0], dir: [0, -1, 0]},
            {pos: [0, 1, 0], dir: [0, 1, 0]}
        ];
        const out = clipCapTrianglesToPlanes(tris, planes);
        expect(sumArea(out)).toBeCloseTo(4, 6);
        for (const t of out) {
            for (const v of t) {
                expect(v[0]).toBeGreaterThanOrEqual(1 - 1e-9);
                expect(v[0]).toBeLessThanOrEqual(3 + 1e-9);
                expect(v[1]).toBeGreaterThanOrEqual(1 - 1e-9);
                expect(v[1]).toBeLessThanOrEqual(3 + 1e-9);
            }
        }
    });

    it("passes triangles through unchanged when there are no clipping planes", () => {
        const tris = [[[0, 0, 0], [4, 0, 0], [0, 4, 0]]];
        const out = clipCapTrianglesToPlanes(tris, []);
        expect(sumArea(out)).toBeCloseTo(8, 6);
    });
});
