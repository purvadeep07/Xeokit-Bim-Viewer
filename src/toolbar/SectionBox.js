import {
    math,
    Node,
    Mesh,
    ReadableGeometry,
    PhongMaterial,
    SectionPlane,
    buildBoxLinesGeometry,
    buildBoxGeometry,
    transformToNode
} from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";
import {boxToPlanes, faceHandlePositions, moveFace, closestPointOnAxisParam, BOX_FACES, SECTION_BOX_ID_PREFIX} from "./sectionBoxUtils.js";

const ID_PREFIX = SECTION_BOX_ID_PREFIX;

// Positive unit axis for each face, used to translate a face along its own axis.
const FACE_AXIS = {
    "+x": {i: 0, vec: [1, 0, 0]},
    "-x": {i: 0, vec: [1, 0, 0]},
    "+y": {i: 1, vec: [0, 1, 0]},
    "-y": {i: 1, vec: [0, 1, 0]},
    "+z": {i: 2, vec: [0, 0, 1]},
    "-z": {i: 2, vec: [0, 0, 1]}
};

/**
 * The 3D part of the Section Box: six inward-facing {@link SectionPlane}s that
 * crop the model to a box, a wireframe outline, and six draggable face handles.
 *
 * Built from pure helpers in sectionBoxUtils.js so the geometry/clamping math is
 * unit-tested. Mimics the SDK's TransformControl for drag handling: pick a handle,
 * disable camera pointer input, project the pointer ray onto the face's axis.
 *
 * @private
 */
class SectionBox {

    constructor(viewer) {
        this.viewer = viewer;
        this.scene = viewer.scene;

        this._box = null;            // {min,max}
        this._built = false;
        this._planes = {};           // face -> SectionPlane
        this._handles = {};          // face -> Mesh
        this._handleIdToFace = {};   // mesh id -> face
        this._wire = null;           // wireframe Mesh
        this._node = null;           // root Node
        this._minThickness = 0.01;
        this._drag = null;           // {face} while dragging
        this._visible = false;       // wireframe shown
        this._locked = false;        // view-only: handles hidden, dragging disabled

        this._org = math.vec3();
        this._dir = math.vec3();
        this._canvasPos = math.vec2();

        this._initDragListeners();
    }

    // ---- public API ---------------------------------------------------------

    /** Build (if needed), set the box, show, and enable clipping. */
    activate(box) {
        if (!this._built) {
            this._build();
        }
        this._minThickness = Math.max(boxDiag(box) * 0.005, 1e-4);
        this.setBox(box);
        this.setVisible(true);
        for (const face of BOX_FACES) {
            this._planes[face].active = true;
        }
    }

    /** Tear down all scene objects, removing the crop entirely. */
    deactivate() {
        this._drag = null;
        this.viewer.cameraControl.pointerEnabled = true;
        this._destroyObjects();
    }

    /** Update the box position/size (used during drag and when applying a link). */
    setBox(box) {
        if (!box) {
            return;
        }
        this._box = {min: box.min.slice(), max: box.max.slice()};
        if (!this._built) {
            return;
        }
        // Section planes.
        for (const desc of boxToPlanes(this._box)) {
            const plane = this._planes[desc.face];
            plane.pos = desc.pos;
            plane.dir = desc.dir;
        }
        // Wireframe: a unit box scaled to the box half-extents, centred on the box.
        const center = boxCenter(this._box);
        const half = boxHalfExtents(this._box);
        this._wire.position = center;
        this._wire.scale = half;
        // Handles.
        const handleHalf = Math.max(boxDiag(this._box) * 0.02, 1e-4);
        for (const h of faceHandlePositions(this._box)) {
            const handle = this._handles[h.face];
            handle.position = h.pos;
            handle.scale = [handleHalf, handleHalf, handleHalf];
        }
    }

    /** Current box as {min,max}, or null. */
    getBox() {
        return this._box ? {min: this._box.min.slice(), max: this._box.max.slice()} : null;
    }

    setVisible(visible) {
        this._visible = visible;
        this._applyVisibility();
    }

    /**
     * View-only mode: keeps the crop and the wireframe, but hides the face handles
     * and disables dragging so the box cannot be resized.
     * @param {Boolean} locked
     */
    setLocked(locked) {
        this._locked = !!locked;
        this._applyVisibility();
    }

    _applyVisibility() {
        if (!this._built) {
            return;
        }
        this._wire.visible = this._visible;
        const handlesVisible = this._visible && !this._locked;
        for (const face of BOX_FACES) {
            this._handles[face].visible = handlesVisible;
            this._handles[face].pickable = handlesVisible;
        }
    }

    destroy() {
        this._removeDragListeners();
        this._destroyObjects();
    }

    // ---- build / teardown ---------------------------------------------------

    _build() {
        const scene = this.scene;
        this._node = new Node(scene, {id: ID_PREFIX + "-node", isObject: false});

        // Six inward-facing section planes (positions filled in by setBox()).
        for (const face of BOX_FACES) {
            this._planes[face] = new SectionPlane(scene, {
                id: ID_PREFIX + "-plane-" + face,
                pos: [0, 0, 0],
                dir: [0, 0, -1],
                active: false
            });
        }

        // Wireframe outline (unit box, scaled by setBox()). Not clipped, not pickable.
        this._wire = new Mesh(this._node, {
            id: ID_PREFIX + "-wire",
            geometry: new ReadableGeometry(this._node, buildBoxLinesGeometry({xSize: 1, ySize: 1, zSize: 1})),
            material: new PhongMaterial(this._node, {emissive: [0.2, 0.6, 1.0], diffuse: [0, 0, 0]}),
            clippable: false,
            pickable: false,
            collidable: false,
            isObject: false,
            visible: false
        });

        // Six pickable face handles (unit cubes, scaled + placed by setBox()).
        const handleGeometry = new ReadableGeometry(this._node, buildBoxGeometry({xSize: 1, ySize: 1, zSize: 1}));
        const handleMaterial = new PhongMaterial(this._node, {diffuse: [0.2, 0.6, 1.0], emissive: [0.1, 0.3, 0.6]});
        for (const face of BOX_FACES) {
            const handle = new Mesh(this._node, {
                id: ID_PREFIX + "-handle-" + face,
                geometry: handleGeometry,
                material: handleMaterial,
                clippable: false,
                pickable: true,
                collidable: true,
                isObject: false,
                visible: false
            });
            this._handles[face] = handle;
            this._handleIdToFace[handle.id] = face;
        }

        this._built = true;
    }

    _destroyObjects() {
        for (const face of BOX_FACES) {
            if (this._planes[face]) {
                this._planes[face].destroy();
            }
        }
        this._planes = {};
        this._handles = {};
        this._handleIdToFace = {};
        this._wire = null;
        if (this._node) {
            this._node.destroy(); // destroys child handle/wire meshes + geometries
            this._node = null;
        }
        this._built = false;
    }

    // ---- drag interaction ---------------------------------------------------

    _initDragListeners() {
        const canvas = this.scene.canvas.canvas;
        this._onDown = (e) => this._handleDown(e);
        this._onMove = (e) => this._handleMove(e);
        this._onUp = () => this._handleUp();
        canvas.addEventListener("mousedown", this._onDown);
        document.addEventListener("mousemove", this._onMove);
        document.addEventListener("mouseup", this._onUp);
    }

    _removeDragListeners() {
        const canvas = this.scene.canvas.canvas;
        canvas.removeEventListener("mousedown", this._onDown);
        document.removeEventListener("mousemove", this._onMove);
        document.removeEventListener("mouseup", this._onUp);
    }

    _eventToCanvasPos(e) {
        const canvas = this.scene.canvas.canvas;
        this._canvasPos[0] = e.pageX;
        this._canvasPos[1] = e.pageY;
        transformToNode(canvas.ownerDocument.documentElement, canvas, this._canvasPos);
        return this._canvasPos;
    }

    _handleDown(e) {
        if (!this._built || this._locked || e.which !== 1) {
            return;
        }
        const canvasPos = this._eventToCanvasPos(e);
        const pickResult = this.scene.pick({canvasPos});
        const face = pickResult && pickResult.entity && this._handleIdToFace[pickResult.entity.id];
        if (face) {
            this._drag = {face};
            this.viewer.cameraControl.pointerEnabled = false;
            e.preventDefault();
        }
    }

    _handleMove(e) {
        if (!this._drag) {
            return;
        }
        const face = this._drag.face;
        const axis = FACE_AXIS[face];
        const canvasPos = this._eventToCanvasPos(e);
        const camera = this.scene.camera;
        math.canvasPosToWorldRay(
            this.scene.canvas.canvas,
            camera.viewMatrix, camera.projMatrix, camera.projection,
            canvasPos, this._org, this._dir
        );
        const axisPoint = this._planes[face].pos; // a point on the face's drag axis
        const t = closestPointOnAxisParam(this._org, this._dir, axisPoint, axis.vec);
        const worldT = axisPoint[axis.i] + t; // axis.vec is a positive unit axis
        this.setBox(moveFace(this._box, face, worldT, this._minThickness));
    }

    _handleUp() {
        if (this._drag) {
            this._drag = null;
            this.viewer.cameraControl.pointerEnabled = true;
        }
    }
}

function boxCenter(box) {
    return [
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2
    ];
}

function boxHalfExtents(box) {
    return [
        (box.max[0] - box.min[0]) / 2,
        (box.max[1] - box.min[1]) / 2,
        (box.max[2] - box.min[2]) / 2
    ];
}

function boxDiag(box) {
    const dx = box.max[0] - box.min[0];
    const dy = box.max[1] - box.min[1];
    const dz = box.max[2] - box.min[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export {SectionBox};
