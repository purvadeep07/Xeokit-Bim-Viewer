/**
 * Pure helpers for encoding/decoding a shareable Section Box link.
 *
 * The share link carries only a tiny state payload — which models, the box
 * (min/max corners) and the camera — never any geometry. That's deliberate: the
 * geometry always loads fresh from the server when the link is opened, so the
 * shared view reflects the latest model while the box stays put.
 *
 * No xeokit / DOM dependencies, so the round-trip is unit-testable. `btoa`/`atob`
 * are available both in browsers and in the Node/Vitest environment.
 *
 * @private
 */

function toUrlSafe(b64) {
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafe(s) {
    return s.replace(/-/g, "+").replace(/_/g, "/");
}

/**
 * Encode a share-state object to a compact URL-safe string.
 * `encodeURIComponent` first keeps `btoa` happy for any non-Latin1 characters.
 *
 * @param {Object} state e.g. {m:[ids], box:{min,max}, cam:{eye,look,up,projection}}
 * @returns {String}
 */
export function encodeShareState(state) {
    const json = JSON.stringify(state);
    return toUrlSafe(btoa(encodeURIComponent(json)));
}

/**
 * Decode a string produced by {@link encodeShareState}. Returns null for any
 * malformed/garbage input rather than throwing.
 *
 * @param {String} str
 * @returns {Object|null}
 */
export function decodeShareState(str) {
    if (!str || typeof str !== "string") {
        return null;
    }
    try {
        return JSON.parse(decodeURIComponent(atob(fromUrlSafe(str))));
    } catch (e) {
        return null;
    }
}

/**
 * Build a shareable viewer URL: `<base>?projectId=<id>#sectionBox=<encoded>`.
 * Any pre-existing query/hash on `baseUrl` is dropped.
 *
 * The view-only flag is NOT a visible query param (that could just be deleted) —
 * it lives inside the encoded payload (`state.lock`), so it can't be toggled off
 * by editing the obvious parts of the URL.
 *
 * @param {String} baseUrl e.g. window.location.href or ".../app/index.html"
 * @param {String} projectId
 * @param {String} encoded Output of encodeShareState
 * @returns {String}
 */
export function buildShareUrl(baseUrl, projectId, encoded) {
    const base = baseUrl.split("#")[0].split("?")[0];
    return base + "?projectId=" + encodeURIComponent(projectId) + "#sectionBox=" + encoded;
}

/**
 * Extract `{projectId, payload}` from a share URL, or null if it carries no valid
 * section-box payload.
 *
 * @param {String} href
 * @returns {{projectId:String|null, payload:Object}|null}
 */
export function parseShareUrl(href) {
    if (!href || typeof href !== "string") {
        return null;
    }
    const boxMatch = href.match(/[#&]sectionBox=([^&]*)/);
    if (!boxMatch) {
        return null;
    }
    const payload = decodeShareState(boxMatch[1]);
    if (!payload) {
        return null;
    }
    const pidMatch = href.match(/[?&]projectId=([^&#]*)/);
    const projectId = pidMatch ? decodeURIComponent(pidMatch[1]) : null;
    return {projectId, payload};
}
