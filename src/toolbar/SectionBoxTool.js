import {ContextMenu, utils} from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";
import {Controller} from "../Controller.js";
import {aabbToBox} from "./sectionBoxUtils.js";
import {SectionBox} from "./SectionBox.js";
import {encodeShareState, buildShareUrl} from "./shareLinkUtils.js";

/**
 * Toolbar tool for the Section Box: crops the model to an axis-aligned box that
 * the user resizes by dragging its faces, and offers a "Copy share link" action.
 *
 * Mirrors {@link SectionTool}'s button/menu wiring and Controller lifecycle.
 *
 * @private
 */
class SectionBoxTool extends Controller {

    constructor(parent, cfg) {

        super(parent, cfg);

        if (!cfg.buttonElement) {
            throw "Missing config: buttonElement";
        }
        if (!cfg.menuButtonElement) {
            throw "Missing config: menuButtonElement";
        }

        this._buttonElement = cfg.buttonElement;
        this._menuButtonElement = cfg.menuButtonElement;
        this._menuButtonArrowElement = cfg.menuButtonArrowElement;
        this._containerElement = cfg.containerElement;

        this._sectionBox = new SectionBox(this.viewer);
        this._lastBox = null; // remembered crop, so toggling off/on keeps it
        this._locked = false; // view-only: no dragging, button/menu disabled

        this._menu = new ContextMenu({
            hideOnAction: true,
            context: {sectionBoxTool: this},
            items: [
                [
                    {
                        getTitle: (context) => this.bimViewer.viewer.localeService.translate("sectionBox.copyLink") || "Copy share link",
                        doAction: () => this._copyShareLink(false)
                    },
                    {
                        getTitle: (context) => this.bimViewer.viewer.localeService.translate("sectionBox.copyViewOnlyLink") || "Copy view-only link",
                        doAction: () => this._copyShareLink(true)
                    },
                    {
                        getTitle: (context) => this.bimViewer.viewer.localeService.translate("sectionBox.resetBox") || "Reset box to model bounds",
                        doAction: () => this._resetToModelBounds()
                    }
                ]
            ]
        });

        this.on("enabled", (enabled) => {
            const method = enabled ? "remove" : "add";
            this._buttonElement.classList[method]("disabled");
            this._menuButtonElement.classList[method]("disabled");
            this._menuButtonArrowElement.classList[method]("disabled");
        });

        this.on("active", (active) => {
            const method = active ? "add" : "remove";
            this._buttonElement.classList[method]("active");
            this._menuButtonElement.classList[method]("active");
            this._menuButtonArrowElement.classList[method]("active");
        });

        this.on("active", (active) => {
            if (active) {
                const box = this._lastBox || aabbToBox(this.viewer.scene.aabb);
                if (!box) {
                    // No model geometry to crop - bail back out of active state.
                    this.setActive(false);
                    return;
                }
                this._sectionBox.activate(box);
                this._sectionBox.setLocked(this._locked);
            } else {
                this._lastBox = this._sectionBox.getBox() || this._lastBox;
                this._sectionBox.deactivate();
            }
        });

        this._buttonElement.addEventListener("click", (e) => {
            if (!this.getEnabled() || this._locked) {
                // View-only crop: ignore toggle/menu so the box cannot be changed.
                return;
            }
            if (e.target === this._menuButtonElement || e.target.parentNode === this._menuButtonElement) {
                if (this._menu.shown) {
                    this._menu.hide();
                } else {
                    const rect = this._menuButtonElement.getBoundingClientRect();
                    this._menu.show(rect.left + window.scrollX, rect.bottom + window.scrollY + 5);
                }
                return;
            }
            this.setActive(!this.getActive());
            e.preventDefault();
        });

        this._menu.on("shown", () => {
            this._menuButtonArrowElement.classList.remove("xeokit-arrow-down");
            this._menuButtonArrowElement.classList.add("xeokit-arrow-up");
        });

        this._menu.on("hidden", () => {
            this._menuButtonArrowElement.classList.remove("xeokit-arrow-up");
            this._menuButtonArrowElement.classList.add("xeokit-arrow-down");
        });

        this.bimViewer.on("reset", () => {
            if (this._locked) {
                // A view-only crop must survive the Reset View button too.
                return;
            }
            this.clear();
            this.setActive(false);
        });
    }

    /**
     * Activates or deactivates the Section Box tool.
     *
     * Overrides {@link Controller#setActive} to pin a view-only (locked) crop:
     * while locked, deactivation is ignored so the crop survives the mutex that
     * deactivates every other tool when any toolbar tool (Slice, Hide, Select,
     * Measure…) is activated. Without this, turning on another tool would call
     * setActive(false) here, tear down the six section planes, and silently lift
     * the view-only restriction. The button-click and "reset" guards only cover
     * user-driven paths; this covers the programmatic (mutex) path too.
     *
     * @param {Boolean} active
     */
    setActive(active) {
        if (!active && this._locked) {
            return;
        }
        super.setActive(active);
    }

    /**
     * Crop to the given box, activating the tool. Used when applying a shared link.
     * @param {{min:Number[], max:Number[]}} box
     * @param {Boolean} [locked=false] View-only: hide handles and disable resizing.
     */
    setBox(box, locked = false) {
        this._lastBox = box;
        this._locked = !!locked;
        if (this.getActive()) {
            this._sectionBox.setBox(box);
            this._sectionBox.setLocked(this._locked);
        } else {
            this.setActive(true);
        }
    }

    /** Current crop box as {min,max}, or null. */
    getBox() {
        return this._sectionBox.getBox() || this._lastBox;
    }

    clear() {
        this._lastBox = null;
        this._locked = false;
        this._sectionBox.deactivate();
    }

    _resetToModelBounds() {
        const box = aabbToBox(this.viewer.scene.aabb);
        if (box) {
            this.setBox(box);
        }
    }

    _copyShareLink(locked) {
        const box = this.getBox();
        if (!box) {
            return;
        }
        const camera = this.viewer.camera;
        const state = {
            m: Object.keys(this.viewer.scene.models),
            box: {min: box.min.slice(), max: box.max.slice()},
            cam: {
                eye: Array.from(camera.eye),
                look: Array.from(camera.look),
                up: Array.from(camera.up),
                projection: camera.projection
            }
        };
        if (locked) {
            // Embed the lock in the payload (not a visible &lock=1) so it can't be
            // removed by editing the obvious parts of the URL.
            state.lock = true;
        }
        const projectId = this.bimViewer.getLoadedProjectId();
        const url = buildShareUrl(window.location.href, projectId, encodeShareState(state));
        const msgKey = locked ? "sectionBox.viewOnlyLinkCopied" : "sectionBox.linkCopied";
        const done = () => this._flash(this.viewer.localeService.translate(msgKey) || (locked ? "View-only link copied" : "Share link copied"));
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, () => this._flash(url));
        } else {
            this._flash(url);
        }
    }

    _flash(message) {
        if (!this._containerElement) {
            return;
        }
        const el = document.createElement("div");
        el.className = "xeokit-sectionBox-toast";
        el.innerText = message;
        el.style.cssText = "position:absolute;bottom:20px;left:50%;transform:translateX(-50%);" +
            "background:rgba(0,0,0,0.8);color:#fff;padding:8px 14px;border-radius:4px;" +
            "font-family:sans-serif;font-size:13px;z-index:200000;pointer-events:none;max-width:80%;" +
            "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        this._containerElement.appendChild(el);
        setTimeout(() => {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }, 2500);
    }

    destroy() {
        this._menu.destroy();
        this._sectionBox.destroy();
        super.destroy();
    }
}

export {SectionBoxTool};
