import {describe, it, expect} from "vitest";
import {
    aabbToBox,
    boxToPlanes,
    faceHandlePositions,
    moveFace,
    closestPointOnAxisParam,
    BOX_FACES,
    SECTION_BOX_ID_PREFIX,
    isSectionBoxPlaneId
} from "../src/toolbar/sectionBoxUtils.js";

describe("aabbToBox", () => {
    it("splits a xeokit AABB into min/max corners", () => {
        const box = aabbToBox([-1, -2, -3, 4, 5, 6]);
        expect(box).toEqual({min: [-1, -2, -3], max: [4, 5, 6]});
    });

    it("returns null for a degenerate/empty AABB (min > max)", () => {
        // xeokit uses an inverted AABB to mean "no geometry".
        expect(aabbToBox([100, 100, 100, -100, -100, -100])).toBeNull();
        expect(aabbToBox(null)).toBeNull();
        expect(aabbToBox(undefined)).toBeNull();
    });
});

describe("boxToPlanes", () => {
    const box = {min: [0, 0, 0], max: [10, 10, 10]};

    it("produces one descriptor per face", () => {
        const planes = boxToPlanes(box);
        expect(planes.length).toBe(6);
    });

    it("places each face plane at the box face center with an inward normal", () => {
        const byFace = {};
        for (const p of boxToPlanes(box)) {
            byFace[p.face] = p;
        }
        // +x face sits at max.x, cutting normal points back into the box (-x).
        expect(byFace["+x"].pos).toEqual([10, 5, 5]);
        expect(byFace["+x"].dir).toEqual([-1, 0, 0]);
        // -x face sits at min.x, normal points +x.
        expect(byFace["-x"].pos).toEqual([0, 5, 5]);
        expect(byFace["-x"].dir).toEqual([1, 0, 0]);
        expect(byFace["+y"].pos).toEqual([5, 10, 5]);
        expect(byFace["+y"].dir).toEqual([0, -1, 0]);
        expect(byFace["-y"].pos).toEqual([5, 0, 5]);
        expect(byFace["-y"].dir).toEqual([0, 1, 0]);
        expect(byFace["+z"].pos).toEqual([5, 5, 10]);
        expect(byFace["+z"].dir).toEqual([0, 0, -1]);
        expect(byFace["-z"].pos).toEqual([5, 5, 0]);
        expect(byFace["-z"].dir).toEqual([0, 0, 1]);
    });

    it("covers exactly the six canonical faces", () => {
        const faces = boxToPlanes(box).map((p) => p.face).sort();
        expect(faces).toEqual([...BOX_FACES].sort());
    });
});

describe("faceHandlePositions", () => {
    it("returns a handle position at each face center", () => {
        const box = {min: [0, 0, 0], max: [10, 10, 10]};
        const byFace = {};
        for (const h of faceHandlePositions(box)) {
            byFace[h.face] = h.pos;
        }
        expect(byFace["+x"]).toEqual([10, 5, 5]);
        expect(byFace["-z"]).toEqual([5, 5, 0]);
    });
});

describe("moveFace", () => {
    const box = {min: [0, 0, 0], max: [10, 10, 10]};

    it("moves the +x face inward without touching other bounds", () => {
        const next = moveFace(box, "+x", 7);
        expect(next.max).toEqual([7, 10, 10]);
        expect(next.min).toEqual([0, 0, 0]);
    });

    it("moves the -y face up", () => {
        const next = moveFace(box, "-y", 3);
        expect(next.min).toEqual([0, 3, 0]);
        expect(next.max).toEqual([10, 10, 10]);
    });

    it("does not mutate the input box", () => {
        moveFace(box, "+x", 7);
        expect(box.max).toEqual([10, 10, 10]);
    });

    it("clamps a max-face so it cannot cross the opposite face (keeps minThickness)", () => {
        const next = moveFace(box, "+x", -50, 1);
        expect(next.max[0]).toBeCloseTo(1); // min.x (0) + minThickness (1)
    });

    it("clamps a min-face so it cannot cross the opposite face", () => {
        const next = moveFace(box, "-x", 50, 1);
        expect(next.min[0]).toBeCloseTo(9); // max.x (10) - minThickness (1)
    });
});

describe("isSectionBoxPlaneId", () => {
    it("recognizes section-box plane ids by their prefix", () => {
        expect(isSectionBoxPlaneId(SECTION_BOX_ID_PREFIX + "-plane-+x")).toBe(true);
        expect(isSectionBoxPlaneId(SECTION_BOX_ID_PREFIX + "-plane--z")).toBe(true);
    });

    it("does not match ordinary slice-plane ids", () => {
        expect(isSectionBoxPlaneId("sectionPlane-3")).toBe(false);
        expect(isSectionBoxPlaneId("12345")).toBe(false);
        expect(isSectionBoxPlaneId(undefined)).toBe(false);
        expect(isSectionBoxPlaneId(null)).toBe(false);
    });
});

describe("closestPointOnAxisParam", () => {
    it("finds the param where a perpendicular ray crosses the axis", () => {
        // Ray along +x at height 5; axis is the world Y axis through origin.
        const t = closestPointOnAxisParam([0, 5, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]);
        expect(t).toBeCloseTo(5);
    });

    it("projects onto the axis when ray is parallel to it", () => {
        // Ray parallel to the Y axis, offset in x; closest param is the ray origin's y.
        const t = closestPointOnAxisParam([3, 8, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0]);
        expect(t).toBeCloseTo(8);
    });
});
