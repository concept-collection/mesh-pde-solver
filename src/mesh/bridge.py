# Runs inside Pyodide. Bridges meshio to the JS app.
#
# parse_mesh reads an uploaded mesh file with meshio, keeps its triangle and
# quadrilateral cells, and produces three outputs in Pyodide's in-memory
# filesystem: the canonical Gmsh MSH 4.1 ASCII file the numbl solver reads
# with surfacemesh.import (full float64 precision), plus float32 positions
# and uint32 cell indices for the JS-side preview and connectivity checks.
# surfacefun cannot mix patch types, so a mesh containing both kinds has its
# quads split into triangles; the output is always homogeneous (all cells
# 3 nodes or all 4). See meshio.ts.

import json
import os

import numpy as np

import meshio

WORK = "/work"
OUT_MSH = WORK + "/out.msh"
POSITIONS_F32 = WORK + "/positions.f32"
CELLS_U32 = WORK + "/cells.u32"

os.makedirs(WORK, exist_ok=True)


class _ObjTolerantMesh(meshio.Mesh):
    """OBJ faces index texture coordinates and normals independently of
    vertex positions, so a file with UV seams legally has more vt (or vn)
    entries than v entries. meshio shoehorns those into point_data, whose
    per-vertex length check then rejects the whole file; drop the unmappable
    arrays instead and remember what was dropped so callers can warn."""

    def __init__(self, points, cells, point_data=None, **kwargs):
        point_data = point_data or {}
        self.dropped_point_data = {
            key: len(value)
            for key, value in point_data.items()
            if len(value) != len(points)
        }
        point_data = {
            key: value
            for key, value in point_data.items()
            if key not in self.dropped_point_data
        }
        super().__init__(points, cells, point_data=point_data, **kwargs)


# the reader binds Mesh at module level, so this rebinding scopes the
# tolerance to OBJ reads only (elsewhere a mismatch means real corruption)
meshio.obj._obj.Mesh = _ObjTolerantMesh

_OBJ_POINT_DATA_NAMES = {"obj:vt": "texture coordinates", "obj:vn": "vertex normals"}


def _collect_cells(mesh, warnings):
    """Triangle and quad cells, corner-nodes only; mixed meshes are reduced
    to all-triangle; reject meshes with neither kind."""
    tris = []
    quads = []
    found = set()
    for block in mesh.cells:
        data = block.data
        if not isinstance(data, np.ndarray) or data.ndim != 2:
            continue
        found.add(block.type)
        if block.type == "triangle":
            tris.append(data)
        elif block.type in ("triangle6", "triangle7"):
            tris.append(data[:, :3])
            warnings.append(
                f"{len(data)} higher-order {block.type} cells reduced to corner nodes"
            )
        elif block.type == "quad":
            quads.append(data)
        elif block.type in ("quad8", "quad9"):
            quads.append(data[:, :4])
            warnings.append(
                f"{len(data)} higher-order {block.type} cells reduced to corner nodes"
            )
        elif block.type == "polygon" and data.shape[1] == 3:
            tris.append(data)
        elif block.type == "polygon" and data.shape[1] == 4:
            quads.append(data)
    if not tris and not quads:
        kinds = ", ".join(sorted(found)) or "none"
        raise ValueError(
            "No triangle or quadrilateral cells found (cell types in file: "
            + kinds
            + "). surfacefun solves on triangle or quad meshes."
        )
    if tris and quads:
        nq = sum(len(q) for q in quads)
        for q in quads:
            tris.append(q[:, [0, 1, 2]])
            tris.append(q[:, [0, 2, 3]])
        quads = []
        warnings.append(
            f"{nq} quads split into triangles (surfacefun cannot mix cell types)"
        )
    blocks = tris or quads
    return np.ascontiguousarray(np.vstack(blocks).astype(np.int64))


def _write_msh(path, points, cells):
    """Canonical Gmsh MSH 4.1 ASCII: one surface entity block, sequential
    1-based node ids, 3-node triangles (type 2) or 4-node quads (type 3) —
    what surfacemesh.import reads."""
    n, m = len(points), len(cells)
    etype = 2 if cells.shape[1] == 3 else 3
    lines = ["$MeshFormat", "4.1 0 8", "$EndMeshFormat"]
    lines.append("$Nodes")
    lines.append("1 %d 1 %d" % (n, n))  # numEntityBlocks numNodes minTag maxTag
    lines.append("2 1 0 %d" % n)  # entityDim entityTag parametric numNodes
    lines.extend(str(i) for i in range(1, n + 1))
    lines.extend("%.16g %.16g %.16g" % (p[0], p[1], p[2]) for p in points)
    lines.append("$EndNodes")
    lines.append("$Elements")
    lines.append("1 %d 1 %d" % (m, m))  # numEntityBlocks numElements minTag maxTag
    lines.append("2 1 %d %d" % (etype, m))  # entityDim entityTag elementType numElements
    for i, c in enumerate(cells, start=1):
        lines.append(str(i) + " " + " ".join(str(v + 1) for v in c))
    lines.append("$EndElements")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def parse_mesh(path, file_format=None):
    warnings = []
    try:
        # meshio's read helper exits the interpreter when every candidate
        # reader fails; turn that into a normal exception
        mesh = meshio.read(path, file_format)
    except SystemExit:
        raise ValueError(f"Could not read file as {file_format or 'any known format'}")

    for key, count in getattr(mesh, "dropped_point_data", {}).items():
        name = _OBJ_POINT_DATA_NAMES.get(key, key)
        warnings.append(
            f"dropped {name}: {count} entries for {len(mesh.points)} vertices"
        )

    points = np.asarray(mesh.points, dtype=np.float64)
    if points.ndim != 2:
        raise ValueError(f"Unexpected points array shape {points.shape}")
    if points.shape[1] == 2:
        points = np.column_stack([points, np.zeros(len(points))])
        warnings.append("2D points: added z=0")
    points = np.ascontiguousarray(points[:, :3])

    cells = _collect_cells(mesh, warnings)
    if cells.size and (int(cells.min()) < 0 or int(cells.max()) >= len(points)):
        raise ValueError("Cell node index out of range")

    # Drop vertices not referenced by any cell (e.g. stray line elements)
    # so the .msh stays minimal and ids stay dense.
    used = np.unique(cells)
    if len(used) < len(points):
        remap = np.full(len(points), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        points = points[used]
        cells = remap[cells]
        warnings.append(f"dropped {len(remap) - len(used)} unused vertices")

    _write_msh(OUT_MSH, points, cells)
    with open(POSITIONS_F32, "wb") as f:
        f.write(points.astype(np.float32).tobytes())
    with open(CELLS_U32, "wb") as f:
        f.write(np.ascontiguousarray(cells.astype(np.uint32)).tobytes())

    return json.dumps(
        {
            "numVertices": len(points),
            "numCells": len(cells),
            "cellSize": int(cells.shape[1]),
            "warnings": warnings,
        }
    )
