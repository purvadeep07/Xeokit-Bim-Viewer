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

    it("snaps just inside the threshold", () => {
        const dir = [0, Math.sin(11.5 * Math.PI / 180), Math.cos(11.5 * Math.PI / 180)];
        expect(nearestAxisSnap(dir, 12)).toEqual([0, 0, 1]);
    });

    it("does not snap just outside the threshold", () => {
        const dir = [0, Math.sin(12.5 * Math.PI / 180), Math.cos(12.5 * Math.PI / 180)];
        expect(nearestAxisSnap(dir, 12)).toBeNull();
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
