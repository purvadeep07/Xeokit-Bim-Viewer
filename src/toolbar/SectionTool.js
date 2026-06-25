import {Controller} from "../Controller.js";
import {SectionToolContextMenu} from "./../contextMenus/SectionToolContextMenu.js";
import {math, SectionPlanesPlugin} from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";
import {axisToDir, nearestAxisSnap} from "./sectionAxisUtils.js";
import {isSectionBoxPlaneId} from "./sectionBoxUtils.js";

// Max angle (degrees) between the cut normal and a principal axis for snap-on-release.
const SNAP_THRESHOLD_DEG = 12;

/** @private */
class SectionTool extends Controller { // XX

    constructor(parent, cfg) {

        super(parent, cfg);

        if (!cfg.buttonElement) {
            throw "Missing config: buttonElement";
        }

        if (!cfg.menuButtonElement) {
            throw "Missing config: menuButtonElement";
        }

        this._buttonElement = cfg.buttonElement;
        this._counterElement = cfg.counterElement;
        this._containerElement = cfg.containerElement;
        this._menuButtonElement = cfg.menuButtonElement;
        this._menuButtonArrowElement = cfg.menuButtonArrowElement;

        this._sectionPlanesPlugin = new SectionPlanesPlugin(this.viewer, {});

        this._sectionToolContextMenu = new SectionToolContextMenu({
            sectionPlanesPlugin: this._sectionPlanesPlugin,
            hideOnMouseDown: false,
            hideOnAction: false,
            parentNode: this._containerElement
        });

        this._sectionPlanesPlugin.setOverviewVisible(false);

        this.on("enabled", (enabled) => {
            if (!enabled) {
                this._buttonElement.classList.add("disabled");
                if (this._counterElement) {
                    this._counterElement.classList.add("disabled");
                }
                this._menuButtonElement.classList.add("disabled");
                this._menuButtonArrowElement.classList.add("disabled");
            } else {
                this._buttonElement.classList.remove("disabled");
                if (this._counterElement) {
                    this._counterElement.classList.remove("disabled");
                }
                this._menuButtonElement.classList.remove("disabled");
                this._menuButtonArrowElement.classList.remove("disabled");
            }
        });

        this.on("active", (active) => {
            if (active) {
                this._buttonElement.classList.add("active");
                if (this._counterElement) {
                    this._counterElement.classList.add("active");
                }
                this._menuButtonElement.classList.add("active");
                this._menuButtonArrowElement.classList.add("active");
            } else {
                this._buttonElement.classList.remove("active");
                if (this._counterElement) {
                    this._counterElement.classList.remove("active");
                }
                this._menuButtonElement.classList.remove("active");
                this._menuButtonArrowElement.classList.remove("active");
            }
        });

        this.on("active", (active) => {
            if (!active) {
                this._sectionPlanesPlugin.hideControl();
            }
        });

        this._buttonElement.addEventListener("click", (e) => {
            if (!this.getEnabled()) {
                return;
            }
            if (e.target === this._menuButtonElement || e.target.parentNode === this._menuButtonElement) {
                if (this._sectionToolContextMenu.shown) {
                    this._sectionToolContextMenu.hide();
                } else {
                    this._sectionToolContextMenu.context = {
                        bimViewer: this.bimViewer,
                        viewer: this.viewer,
                        sectionTool: this
                    };

                    const rect = this._menuButtonElement.getBoundingClientRect();

                    this._sectionToolContextMenu.show(rect.left + scrollX, rect.bottom + window.scrollY + 5);
                }
                return;
            }
            const active = this.getActive();
            this.setActive(!active);
            e.preventDefault();
        });

        this._sectionToolContextMenu.on("shown", () => {
            this._menuButtonArrowElement.classList.remove("xeokit-arrow-down");
            this._menuButtonArrowElement.classList.add("xeokit-arrow-up");
        });

        this._sectionToolContextMenu.on("hidden", () => {
            this._menuButtonArrowElement.classList.remove("xeokit-arrow-up");
            this._menuButtonArrowElement.classList.add("xeokit-arrow-down");
        });

        this.bimViewer.on("reset", () => {
            this.clear();
            this.setActive(false);
        });

        this.viewer.scene.on("sectionPlaneCreated", () => {
            this._updateSectionPlanesCount();
        });

        this.viewer.scene.on("sectionPlaneDestroyed", () => {
            this._updateSectionPlanesCount();
        });

        this._snapToAxisEnabled = true;
        this._snapThresholdDeg = SNAP_THRESHOLD_DEG;
        this._initAxisSnap();

        this._initSectionMode();
    }

    _initSectionMode() {

        this._containerElement.addEventListener('mouseup', (e) => {

            if (e.which === 1) {

                const coords = getMouseCanvasPos(e);
                if (!this.getActive() || !this.getEnabled()) {
                    return;
                }

                const pickResult = this.viewer.scene.pick({
                    canvasPos: coords,
                    pickSurface: true  // <<------ This causes picking to find the intersection point on the entity
                });

                if (pickResult && pickResult.entity && pickResult.entity.isObject) { // Only slice model objects, not 3D UI helpers

                    const sectionPlane = this._sectionPlanesPlugin.createSectionPlane({
                        pos: pickResult.worldPos,
                        dir: math.mulVec3Scalar(pickResult.worldNormal, -1)
                    });

                    this._sectionPlanesPlugin.showControl(sectionPlane.id);
                }
            }
        });

        this._updateSectionPlanesCount();
    }

    _updateSectionPlanesCount() {
        if (this._counterElement) {
            this._counterElement.innerText = ("" + this.getNumSections());
        }
    }

    _initAxisSnap() {
        const trySnap = () => {
            if (!this._snapToAxisEnabled) {
                return;
            }
            const shownId = this._sectionPlanesPlugin.getShownControl();
            if (!shownId) {
                return;
            }
            const sectionPlane = this.viewer.scene.sectionPlanes[shownId];
            if (!sectionPlane) {
                return;
            }
            const snapped = nearestAxisSnap(sectionPlane.dir, this._snapThresholdDeg);
            if (snapped) {
                sectionPlane.dir = snapped; // Plugin re-syncs the gizmo via its "dir" binding.
            }
        };
        this._containerElement.addEventListener("mouseup", trySnap);
        this._containerElement.addEventListener("touchend", trySnap);
    }

    /**
     * Sets whether the gizmo snaps the cut normal to the nearest principal axis on release.
     * @param {Boolean} enabled
     */
    setSnapToAxisEnabled(enabled) {
        this._snapToAxisEnabled = !!enabled;
    }

    /**
     * Gets whether axis snapping is enabled.
     * @returns {Boolean}
     */
    getSnapToAxisEnabled() {
        return this._snapToAxisEnabled;
    }

    /**
     * The slice planes this tool owns — i.e. every scene section plane EXCEPT the
     * Section Box's. The SDK's SectionPlanesPlugin registers all scene section
     * planes (including the box's), so we filter by id to keep the two tools from
     * clobbering each other (e.g. "Clear Slices" must never remove the box).
     * @private
     */
    _sliceSectionPlanes() {
        const sectionPlanes = this.viewer.scene.sectionPlanes;
        const result = [];
        for (const id in sectionPlanes) {
            if (!isSectionBoxPlaneId(id)) {
                result.push(sectionPlanes[id]);
            }
        }
        return result;
    }

    getNumSections() {
        return this._sliceSectionPlanes().length;
    }

    clear() {
        for (const sectionPlane of this._sliceSectionPlanes()) {
            sectionPlane.destroy();
        }
        this._updateSectionPlanesCount();
    }

    flipSections() {
        for (const sectionPlane of this._sliceSectionPlanes()) {
            sectionPlane.flipDir();
        }
    }

    /**
     * Creates a single axis-aligned section plane at the model center, replacing
     * any existing slice planes (but not the Section Box), and shows its editing gizmo.
     *
     * @param {String} axis One of "+x","-x","+y","-y","+z","-z".
     */
    createAxisSectionPlane(axis) {
        const scene = this.viewer.scene;
        const aabb = scene.aabb;
        // Guard: empty/degenerate AABB means no model geometry is loaded.
        if (!aabb || aabb[0] > aabb[3] || aabb[1] > aabb[4] || aabb[2] > aabb[5]) {
            return;
        }
        for (const sectionPlane of this._sliceSectionPlanes()) {
            sectionPlane.destroy();
        }
        const center = math.getAABB3Center(aabb, math.vec3());
        const sectionPlane = this._sectionPlanesPlugin.createSectionPlane({
            pos: center,
            dir: axisToDir(axis)
        });
        this._sectionPlanesPlugin.showControl(sectionPlane.id);
        this._updateSectionPlanesCount();
    }

    enableSections() {
        for (const sectionPlane of this._sliceSectionPlanes()) {
            sectionPlane.active = true;
        }
    }

    disableSections() {
        for (const sectionPlane of this._sliceSectionPlanes()) {
            sectionPlane.active = false;
        }
    }

    hideControl() {
        this._sectionPlanesPlugin.hideControl();
    }

    destroy() {
        this._sectionPlanesPlugin.destroy();
        this._sectionToolContextMenu.destroy();
        super.destroy();
    }
}

function getMouseCanvasPos(event) {
    if (!event) {
        event = window.event;
        this.mouseCanvasPos[0] = event.x;
        this.mouseCanvasPos[1] = event.y;
    } else {
        let element = event.target;
        let totalOffsetLeft = 0;
        let totalOffsetTop = 0;
        while (element.offsetParent) {
            totalOffsetLeft += element.offsetLeft;
            totalOffsetTop += element.offsetTop;
            element = element.offsetParent;
        }
        return [event.pageX - totalOffsetLeft, event.pageY - totalOffsetTop];
    }
}

export {SectionTool};