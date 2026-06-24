# xeokit BIM Viewer — Section Cut Caps Fix

## Problem
When using section planes to cut through the building model, wall cross-sections appeared hollow — no grey fill was rendered at the cut face.

---

## Root Cause

The SDK's cap generation code (`SectionCaps`) has two conditions that must **both** be true to draw a cap:

```js
if (isSolid && object.capMaterial) {
    object.getEachVertex(...)  // read vertices from CPU memory
    object.getEachIndex(...)
}
```

The original repo had **four things broken simultaneously**, any one of which alone would have silently prevented caps:

| # | What was wrong | Effect |
|---|---|---|
| 1 | `dtxEnabled: true` | Geometry stored in GPU textures — CPU can never read vertices back via `getEachVertex()` |
| 2 | `readableGeometryEnabled` missing | Even VBO geometry wasn't kept in CPU memory |
| 3 | No `capMaterial` on objects | SDK condition `isSolid && capMaterial` always false |
| 4 | `layer.solid = false` for walls | Walls stored as `"surface"` type in XKT — `isSolid()` returns false, SDK skips them |

### Why walls are stored as "surface" in XKT
`xeokit-convert` stores each geometry as either `"solid"` or `"surface"` depending on whether web-ifc can confirm the mesh is watertight. Wall geometry in IFC is often stored as BREP which web-ifc can't always verify as closed, so it comes out as `"surface"` → `layer.solid = false` → `isSolid() = false` → no cap generated.

**Note:** `layer.solid` (used only by `SectionCaps`) is separate from the per-object GPU `perObjectSolid` flag (which controls backface culling in shaders and is baked at geometry creation time). Changing `layer.solid` at runtime only affects cap generation — it does not affect rendering.

---

## Fixes Applied

### 1. `app/index.html` — Disable DTX

```js
// BEFORE
"dtxEnabled": true

// AFTER
"dtxEnabled": false  // DTX layers store geometry on GPU, readGeometryData() doesn't exist on them
```

### 2. `src/BIMViewer.js` — Add PhongMaterial import

```js
// BEFORE
import { BCFViewpointsPlugin, FastNavPlugin, math, stats, Viewer } from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";

// AFTER
import { BCFViewpointsPlugin, FastNavPlugin, math, stats, Viewer, PhongMaterial } from "@xeokit/xeokit-sdk/dist/xeokit-sdk.es.js";
```

### 3. `src/BIMViewer.js` — Enable readable geometry in Viewer constructor

```js
// BEFORE
numCachedSectionPlanes: 4

// AFTER
numCachedSectionPlanes: 4,
readableGeometryEnabled: true
```

### 4. `src/BIMViewer.js` — Assign capMaterial and force layer.solid on model load

Added inside the `modelLoaded` event handler:

```js
const sceneModel = viewer.scene.models[modelId];
if (sceneModel) {
    const noCapTypes = new Set([
        "IfcRoof", "IfcSpace", "IfcOpeningElement",
        "IfcDoor", "IfcWindow", "IfcFurnishingElement", "IfcAnnotation",
        "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcProject"
    ]);
    const capMaterial = new PhongMaterial(viewer.scene, { backfaces: true });
    for (const objectId in sceneModel.objects) {
        const object = sceneModel.objects[objectId];
        if (object.opacity < 0.7) continue;
        const metaObject = viewer.metaScene.metaObjects[objectId];
        if (!metaObject || !noCapTypes.has(metaObject.type)) {
            object.capMaterial = capMaterial;
            // Force layer.solid=true so isSolid() returns true for SectionCaps.
            // Walls may be stored as "surface" in XKT even when geometry is watertight.
            if (object.meshes) {
                for (const mesh of object.meshes) {
                    if (mesh.layer && !mesh.layer.solid) {
                        mesh.layer.solid = true;
                    }
                }
            }
        }
    }
}
```

---

## IFC → XKT Conversion

No changes to the conversion command. Use the same default:

```bash
xeokit-convert -s "your-file.ifc" -o "geometry.xkt"
```

The BREP warnings during conversion (`No basis found for brep!`) are a limitation of web-ifc on curved/arched geometry. Those elements will still appear hollow on section cuts — this is a source geometry issue, not fixable at the viewer level.

---

## IFC Schema Version (4.3 vs 2x3)

The IFC schema version has **no effect** on section caps. Both `2x3` and `4.3` files go through the same conversion and have the same `layer.solid` issue. The fix handles both equally.

---

## Known Limitations

- Curved/arched elements with BREP failures will still be hollow (no triangle data to generate a cap)
- Section cap fills are flat polygons at the cut plane. Viewed from a non-perpendicular angle they appear as thin flat shapes — this is correct and expected behavior, not a bug
- `IfcRoof`, `IfcDoor`, `IfcWindow`, `IfcSpace` etc. are intentionally excluded from caps (they either fill large areas incorrectly or are openings)

---

## How to Apply to syncdrawings.com

### If using dist files (copied xeokit-bim-viewer.es.js)
Replace with the rebuilt `dist/` files from this repo after running `npm run build`.
Also add `"dtxEnabled": false` wherever the viewer config is initialized.

### If using source (BIMViewer.js in your codebase)
Apply the 4 changes above directly to your copy of `BIMViewer.js`.

### Minimum config change (no rebuild needed)
```js
bimViewer.setConfigs({
    "dtxEnabled": false
});
```
This alone unblocks geometry readback. The `capMaterial` + `layer.solid` changes require the modified `BIMViewer.js` or rebuilt dist.

---

## Common Misconception

Setting `entity.backfaces = true` is a fix for a **different problem** — walls appearing see-through when orbiting (backface culling). It does **not** fix section cut caps. These are two separate issues.
