import {describe, it, expect} from "vitest";
import {
    encodeShareState,
    decodeShareState,
    buildShareUrl,
    parseShareUrl
} from "../src/toolbar/shareLinkUtils.js";

const sampleState = {
    m: ["architectural", "electrical"],
    box: {min: [0, 0, 0], max: [10, 5, 8]},
    cam: {eye: [1, 2, 3], look: [0, 0, 0], up: [0, 1, 0], projection: "perspective"},
    lock: true // view-only flag lives INSIDE the encoded payload, not a visible URL param
};

describe("encodeShareState / decodeShareState", () => {
    it("round-trips a state object", () => {
        const encoded = encodeShareState(sampleState);
        expect(typeof encoded).toBe("string");
        expect(decodeShareState(encoded)).toEqual(sampleState);
    });

    it("produces URL-safe output (no +, /, or = padding)", () => {
        const encoded = encodeShareState(sampleState);
        expect(encoded).not.toMatch(/[+/=]/);
    });

    it("returns null for malformed input instead of throwing", () => {
        expect(decodeShareState("")).toBeNull();
        expect(decodeShareState("@@@not-base64@@@")).toBeNull();
        expect(decodeShareState(null)).toBeNull();
    });
});

describe("buildShareUrl / parseShareUrl", () => {
    it("builds a URL carrying projectId in the query and state in the hash", () => {
        const encoded = encodeShareState(sampleState);
        const url = buildShareUrl("https://host/app/index.html", "Clinic", encoded);
        expect(url).toContain("projectId=Clinic");
        expect(url).toContain("#sectionBox=" + encoded);
    });

    it("keeps the lock flag out of the visible URL (it rides inside the payload)", () => {
        const encoded = encodeShareState(sampleState); // sampleState.lock === true
        const url = buildShareUrl("https://host/app/index.html", "Clinic", encoded);
        expect(url).not.toContain("lock=");
        // ...but the decoded payload still carries it:
        expect(parseShareUrl(url).payload.lock).toBe(true);
    });

    it("strips any pre-existing query/hash from the base URL", () => {
        const encoded = encodeShareState(sampleState);
        const url = buildShareUrl("https://host/app/index.html?projectId=Old#x=1", "Clinic", encoded);
        expect(url).toBe("https://host/app/index.html?projectId=Clinic#sectionBox=" + encoded);
    });

    it("round-trips through parseShareUrl", () => {
        const encoded = encodeShareState(sampleState);
        const url = buildShareUrl("https://host/app/index.html", "Clinic", encoded);
        const parsed = parseShareUrl(url);
        expect(parsed.projectId).toBe("Clinic");
        expect(parsed.payload).toEqual(sampleState);
    });

    it("returns null when there is no sectionBox in the URL", () => {
        expect(parseShareUrl("https://host/app/index.html?projectId=Clinic")).toBeNull();
    });

    it("returns null when the sectionBox payload is corrupt", () => {
        expect(parseShareUrl("https://host/app/index.html?projectId=Clinic#sectionBox=@@bad@@")).toBeNull();
    });
});
