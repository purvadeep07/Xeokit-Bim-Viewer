# Prompt: Build a BIM Viewer from Scratch

## Context
I am building a production-grade web-based BIM viewer similar to xeokit-bim-viewer. It needs to handle large IFC files efficiently and support architectural features like section cuts with filled caps. The viewer will be used in a SaaS product for AEC (Architecture, Engineering, Construction) professionals.

---

## Tech Stack
- **Renderer:** Three.js
- **IFC Parser:** web-ifc (for direct IFC loading) OR pre-convert IFC to a compressed format (like XKT) for large file performance
- **Framework:** React (or Vue) for UI
- **Language:** TypeScript

---

## Core Requirements

### 1. Model Loading
- Load IFC files (IFC2x3 and IFC4 schema support)
- Support large files (100MB+ IFC) without browser crashes
- Show loading progress
- Support loading multiple models simultaneously
- Extract metadata (IFC type, properties, storey, class) alongside geometry

### 2. 3D Rendering
- Orbit, pan, zoom camera controls
- Perspective and orthographic projection
- NavCube (orientation cube showing Front/Back/Left/Right/Top/Bottom)
- Fit model to view
- Ambient occlusion (SAO) for depth perception
- Edge rendering for object outlines
- Physically based rendering (PBR) materials

### 3. Object Interaction
- Click to select objects — highlight selected
- Hover to highlight
- Right-click context menu per object
- Pick returns: objectId, IFC type, world position, surface normal
- Marquee (drag) selection of multiple objects

### 4. Object Explorer
- Tree view organized by: Storeys → Spaces → Objects
- Tree view by IFC class (IfcWall, IfcSlab, etc.)
- Show/hide individual objects or entire classes/storeys
- X-ray mode (ghost objects to see through them)
- Isolate selection (hide everything except selected)

### 5. Section Planes (Critical — most complex feature)
- Click a surface to create a section plane at that point, oriented to the surface normal
- Drag gizmo to move/rotate section plane
- Multiple simultaneous section planes
- Flip section direction
- Enable/disable individual planes
- Clear all planes

#### Section Cut Caps (filled cross-sections)
This is the hardest part. When a section plane cuts through a wall, the cut face must show a filled grey polygon (cap), not appear hollow.

**Requirements for caps to work:**
- Geometry must be CPU-readable (kept in RAM, not only on GPU)
- Each object that should show a cap needs a cap material assigned
- The mesh must be identified as a closed solid (not an open surface)
- Cap polygon is computed by intersecting the section plane with every triangle of the object mesh
- The resulting intersection segments are assembled into a closed polygon
- The polygon is triangulated and rendered as a flat mesh at the section plane
- Cap meshes must be clippable by other section planes
- Cap meshes must be regenerated when any section plane moves

**IFC types that should NOT get caps:**
IfcRoof, IfcSpace, IfcOpeningElement, IfcDoor, IfcWindow, IfcFurnishingElement, IfcAnnotation, IfcSite, IfcBuilding, IfcBuildingStorey, IfcProject

**IFC types that SHOULD get caps:**
IfcWall, IfcWallStandardCase, IfcSlab, IfcColumn, IfcBeam, IfcStair, IfcRamp, IfcCovering, and any unknown structural types

**Critical gotcha:** Web-ifc may store wall geometry as "surface" (non-solid) even when the mesh is actually watertight. You must handle this by forcing the solid flag after loading, otherwise cap generation will be silently skipped for those objects.

### 6. Measurements
- Distance measurement between two picked points
- Angle measurement between three picked points
- Show measurement labels in 3D space
- Clear individual or all measurements

### 7. Properties Inspector
- Click object → show IFC properties panel
- Show: IFC type, Name, GlobalId, all Pset properties
- Group properties by Pset name

### 8. BCF Support (BIM Collaboration Format)
- Export current viewpoint as BCF
- Import BCF and restore viewpoint (camera position, section planes, object visibility/selection state)

### 9. Performance Requirements
- Must handle IFC files up to 500MB (pre-converted to optimized format)
- Target 60fps on mid-range GPU
- Use geometry instancing for repeated elements (windows, doors repeated across floors)
- Geometry must be quantized (compressed positions) for GPU memory efficiency
- Consider splitting large models into tiles that load progressively

---

## Architecture

### File Pipeline (for large file support)
```
IFC file
   ↓
Conversion server (Node.js)
   ↓  web-ifc parses geometry + metadata
   ↓  quantize positions (16-bit integers)
   ↓  compute edge indices
   ↓  detect solid vs surface meshes
   ↓  instance repeated geometries
   ↓  write compressed binary format
Optimized binary format (.xkt or custom)
   ↓
Browser loads binary → upload to GPU
```

Direct browser IFC loading is simpler but will crash on large files. Use server-side conversion for production.

### Solid vs Surface Mesh Detection
During conversion, for each geometry:
```js
function isMeshSolid(indices, positions) {
    // Build edge map — each edge should appear exactly twice in a solid
    const edgeMap = new Map();
    for (let i = 0; i < indices.length; i += 3) {
        for (let j = 0; j < 3; j++) {
            const a = indices[i + j];
            const b = indices[i + (j + 1) % 3];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
        }
    }
    // Solid = every edge appears exactly twice
    for (const count of edgeMap.values()) {
        if (count !== 2) return false;
    }
    return true;
}
```

### Section Cap Generation
```js
function computeSectionCap(triangles, planeNormal, planeConstant) {
    const segments = [];
    
    for (const [v0, v1, v2] of triangles) {
        const d0 = dot(planeNormal, v0) + planeConstant;
        const d1 = dot(planeNormal, v1) + planeConstant;
        const d2 = dot(planeNormal, v2) + planeConstant;
        
        // Find the two edges that cross the plane
        const intersections = [];
        const edges = [[v0,v1,d0,d1], [v1,v2,d1,d2], [v2,v0,d2,d0]];
        for (const [a, b, da, db] of edges) {
            if ((da < 0) !== (db < 0)) { // edge crosses plane
                const t = da / (da - db);
                intersections.push(lerp(a, b, t));
            }
        }
        if (intersections.length === 2) {
            segments.push(intersections);
        }
    }
    
    // Connect segments into closed polygon(s)
    // Triangulate polygon(s)
    // Return triangle mesh
}
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Home] [3D] [Classes] [Storeys] [Info] [BCF]           │  ← Toolbar left
│         [Eraser] [Select] [Marquee] [Measure] [Section] │  ← Toolbar right
├──────────┬──────────────────────────────────────┬───────┤
│          │                                      │       │
│ Explorer │           3D Viewport                │ Props │
│          │                                      │       │
│ Objects  │                                      │       │
│ tree     │                          [NavCube]   │       │
│          │                                      │       │
├──────────┴──────────────────────────────────────┴───────┤
│  Status bar                                             │
└─────────────────────────────────────────────────────────┘
```

---

## What NOT to do

- Do not load IFC directly in the browser for files over 50MB — use server-side conversion
- Do not use DataTextures (DTX/GPU texture storage) for geometry if you need section cut caps — cap generation requires CPU-readable geometry
- Do not skip the solid/surface detection step — without it, walls will silently get no caps
- Do not share a single cap material instance across models if models have different colors
- Do not generate caps on every frame — debounce cap regeneration (100ms after last section plane move)
- Do not make cap meshes unclippable — they must be clipped by all active section planes

---

## Estimated Effort

| Component | Time |
|---|---|
| Basic IFC load + render | 1-2 weeks |
| Camera controls + NavCube | 3-5 days |
| Object picking + selection | 1 week |
| Object explorer tree | 1-2 weeks |
| Section planes + gizmo | 2-3 weeks |
| **Section cut caps** | **2-4 weeks** |
| Measurements | 1-2 weeks |
| Properties inspector | 1 week |
| BCF support | 1-2 weeks |
| Performance optimization | ongoing |
| **Total** | **4-6 months** |

Section cut caps are disproportionately hard relative to how simple they look. Budget accordingly.

---

## Reference Implementations
- **xeokit-sdk** — most complete, production-grade, study its SectionCaps implementation
- **@thatopen/components** — Three.js based, modular, good starting point
- **web-ifc-three** — minimal IFC + Three.js wiring, good reference for IFC loading
