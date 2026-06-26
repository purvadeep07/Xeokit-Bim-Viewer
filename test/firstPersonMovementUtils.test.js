import {describe, it, expect} from "vitest";
import {
    movementAxes,
    deriveFirstPersonConfig,
    horizontalForward,
    integrateGravity,
    rightVector
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

describe("rightVector", () => {
    it("returns screen-right (-X) for a +Z forward", () => {
        expect(rightVector([0, 0, 1])).toEqual([-1, 0, 0]);
    });

    it("returns +Z for a +X forward", () => {
        const r = rightVector([1, 0, 0]);
        expect(r[2]).toBeCloseTo(1);
        expect(Math.abs(r[0])).toBeCloseTo(0); // -0 and +0 are both valid
        expect(r[1]).toBeCloseTo(0);
    });

    it("is perpendicular to forward and unit length for a 45-degree forward", () => {
        const f = [Math.SQRT1_2, 0, Math.SQRT1_2];
        const r = rightVector(f);
        expect(r[0] * f[0] + r[2] * f[2]).toBeCloseTo(0); // perpendicular
        expect(Math.sqrt(r[0] * r[0] + r[2] * r[2])).toBeCloseTo(1); // unit length
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
