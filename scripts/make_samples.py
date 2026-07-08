"""Generate the bundled sample quad meshes (public/samples/*.msh).

Writes Gmsh MSH 4.1 ASCII files in the same canonical form the in-app
converter produces: one surface entity block, sequential 1-based node ids,
and 4-node quadrangle elements (type 3) — the layout surfacemesh.import
reads.

Run from the repo root:  python3 scripts/make_samples.py
"""

import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "samples")


def write_msh(path, points, quads):
    n, m = len(points), len(quads)
    lines = ["$MeshFormat", "4.1 0 8", "$EndMeshFormat"]
    lines.append("$Nodes")
    lines.append(f"1 {n} 1 {n}")  # numEntityBlocks numNodes minTag maxTag
    lines.append(f"2 1 0 {n}")  # entityDim entityTag parametric numNodes
    lines.extend(str(i) for i in range(1, n + 1))
    lines.extend(f"{x:.16g} {y:.16g} {z:.16g}" for x, y, z in points)
    lines.append("$EndNodes")
    lines.append("$Elements")
    lines.append(f"1 {m} 1 {m}")  # numEntityBlocks numElements minTag maxTag
    lines.append(f"2 1 3 {m}")  # entityDim entityTag elementType(3=quad) numElements
    for i, q in enumerate(quads, start=1):
        a, b, c, d = (v + 1 for v in q)  # 0-based -> 1-based
        lines.append(f"{i} {a} {b} {c} {d}")
    lines.append("$EndElements")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


def cubed_sphere(m):
    """Cube [-1,1]^3 with m-by-m quads per face, projected onto the sphere."""
    points = []
    index = {}

    def vertex(x, y, z):
        # Normalize onto the unit sphere; dedup shared face-boundary vertices.
        r = math.sqrt(x * x + y * y + z * z)
        p = (x / r, y / r, z / r)
        key = tuple(round(v, 12) for v in p)
        if key not in index:
            index[key] = len(points)
            points.append(p)
        return index[key]

    # Each face: origin corner + two axis vectors spanning the face.
    faces = [
        ((-1, -1, 1), (1, 0, 0), (0, 1, 0)),   # +z
        ((-1, 1, -1), (1, 0, 0), (0, -1, 0)),  # -z
        ((-1, -1, -1), (0, 1, 0), (0, 0, 1)),  # -x
        ((1, -1, -1), (0, 0, 1), (0, 1, 0)),   # +x
        ((-1, -1, -1), (0, 0, 1), (1, 0, 0)),  # -y
        ((-1, 1, -1), (1, 0, 0), (0, 0, 1)),   # +y
    ]
    quads = []
    for origin, du, dv in faces:
        for i in range(m):
            for j in range(m):
                corners = []
                for di, dj in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    s = 2 * (i + di) / m
                    t = 2 * (j + dj) / m
                    corners.append(
                        vertex(
                            origin[0] + s * du[0] + t * dv[0],
                            origin[1] + s * du[1] + t * dv[1],
                            origin[2] + s * du[2] + t * dv[2],
                        )
                    )
                quads.append(tuple(corners))
    return points, quads


def torus(nu, nv, R=1.0, r=0.4):
    points = []
    for i in range(nu):
        a = 2 * math.pi * i / nu
        for j in range(nv):
            b = 2 * math.pi * j / nv
            points.append(
                (
                    (R + r * math.cos(b)) * math.cos(a),
                    (R + r * math.cos(b)) * math.sin(a),
                    r * math.sin(b),
                )
            )
    quads = []
    for i in range(nu):
        for j in range(nv):
            i2 = (i + 1) % nu
            j2 = (j + 1) % nv
            quads.append((i * nv + j, i2 * nv + j, i2 * nv + j2, i * nv + j2))
    return points, quads


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    pts, quads = cubed_sphere(6)
    write_msh(os.path.join(OUT_DIR, "sphere.msh"), pts, quads)
    print(f"sphere.msh: {len(pts)} nodes, {len(quads)} quads")
    pts, quads = torus(24, 12)
    write_msh(os.path.join(OUT_DIR, "torus.msh"), pts, quads)
    print(f"torus.msh: {len(pts)} nodes, {len(quads)} quads")


if __name__ == "__main__":
    main()
