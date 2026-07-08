# Runs inside Pyodide. Bridges meshio to the JS app.
#
# parse_quad_mesh reads an uploaded mesh file with meshio, keeps only its
# quadrilateral cells, and produces three outputs in Pyodide's in-memory
# filesystem: the canonical Gmsh MSH 4.1 ASCII file the numbl solver reads
# with surfacemesh.import (full float64 precision), plus float32 positions
# and uint32 quad indices for the JS-side preview and connectivity checks.
# See meshio.ts.

import json
import os

import numpy as np

import meshio

WORK = "/work"
OUT_MSH = WORK + "/out.msh"
POSITIONS_F32 = WORK + "/positions.f32"
QUADS_U32 = WORK + "/quads.u32"

os.makedirs(WORK, exist_ok=True)


def _collect_quads(mesh, warnings):
    """All quad cells, corner-nodes only; reject meshes without any."""
    blocks = []
    found = set()
    for block in mesh.cells:
        data = block.data
        if not isinstance(data, np.ndarray) or data.ndim != 2:
            continue
        found.add(block.type)
        if block.type == "quad":
            blocks.append(data)
        elif block.type in ("quad8", "quad9"):
            blocks.append(data[:, :4])
            warnings.append(
                f"{len(data)} higher-order {block.type} cells reduced to corner nodes"
            )
        elif block.type == "polygon" and data.shape[1] == 4:
            blocks.append(data)
    if not blocks:
        kinds = ", ".join(sorted(found)) or "none"
        raise ValueError(
            "No quadrilateral cells found (cell types in file: "
            + kinds
            + "). surfacefun solves on quad meshes; "
            "convert your mesh to quads before uploading."
        )
    return np.ascontiguousarray(np.vstack(blocks).astype(np.int64))


def _write_msh(path, points, quads):
    """Canonical Gmsh MSH 4.1 ASCII: one surface entity block, sequential
    1-based node ids, 4-node quads (type 3) — what surfacemesh.import reads."""
    n, m = len(points), len(quads)
    lines = ["$MeshFormat", "4.1 0 8", "$EndMeshFormat"]
    lines.append("$Nodes")
    lines.append("1 %d 1 %d" % (n, n))  # numEntityBlocks numNodes minTag maxTag
    lines.append("2 1 0 %d" % n)  # entityDim entityTag parametric numNodes
    lines.extend(str(i) for i in range(1, n + 1))
    lines.extend("%.16g %.16g %.16g" % (p[0], p[1], p[2]) for p in points)
    lines.append("$EndNodes")
    lines.append("$Elements")
    lines.append("1 %d 1 %d" % (m, m))  # numEntityBlocks numElements minTag maxTag
    lines.append("2 1 3 %d" % m)  # entityDim entityTag elementType(3=quad) numElements
    for i, q in enumerate(quads, start=1):
        lines.append("%d %d %d %d %d" % (i, q[0] + 1, q[1] + 1, q[2] + 1, q[3] + 1))
    lines.append("$EndElements")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def parse_quad_mesh(path, file_format=None):
    warnings = []
    try:
        # meshio's read helper exits the interpreter when every candidate
        # reader fails; turn that into a normal exception
        mesh = meshio.read(path, file_format)
    except SystemExit:
        raise ValueError(f"Could not read file as {file_format or 'any known format'}")

    points = np.asarray(mesh.points, dtype=np.float64)
    if points.ndim != 2:
        raise ValueError(f"Unexpected points array shape {points.shape}")
    if points.shape[1] == 2:
        points = np.column_stack([points, np.zeros(len(points))])
        warnings.append("2D points: added z=0")
    points = np.ascontiguousarray(points[:, :3])

    quads = _collect_quads(mesh, warnings)
    if quads.size and (int(quads.min()) < 0 or int(quads.max()) >= len(points)):
        raise ValueError("Quad node index out of range")

    # Drop vertices not referenced by any quad (e.g. triangle-only regions of
    # a mixed mesh) so the .msh stays minimal and ids stay dense.
    used = np.unique(quads)
    if len(used) < len(points):
        remap = np.full(len(points), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        points = points[used]
        quads = remap[quads]
        warnings.append(f"dropped {len(remap) - len(used)} unused vertices")

    _write_msh(OUT_MSH, points, quads)
    with open(POSITIONS_F32, "wb") as f:
        f.write(points.astype(np.float32).tobytes())
    with open(QUADS_U32, "wb") as f:
        f.write(np.ascontiguousarray(quads.astype(np.uint32)).tobytes())

    return json.dumps(
        {
            "numVertices": len(points),
            "numQuads": len(quads),
            "warnings": warnings,
        }
    )
