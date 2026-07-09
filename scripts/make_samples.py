"""Generate the bundled sample meshes (public/samples/*.msh).

Writes Gmsh MSH 4.1 ASCII files in the same canonical form the in-app
converter produces: one surface entity block, sequential 1-based node ids,
and 3-node triangle (type 2) or 4-node quadrangle (type 3) elements — the
layout surfacemesh.import reads.

Run from the repo root:  python3 scripts/make_samples.py
"""

import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "samples")


def write_msh(path, points, cells):
    n, m = len(points), len(cells)
    etype = 2 if len(cells[0]) == 3 else 3
    lines = ["$MeshFormat", "4.1 0 8", "$EndMeshFormat"]
    lines.append("$Nodes")
    lines.append(f"1 {n} 1 {n}")  # numEntityBlocks numNodes minTag maxTag
    lines.append(f"2 1 0 {n}")  # entityDim entityTag parametric numNodes
    lines.extend(str(i) for i in range(1, n + 1))
    lines.extend(f"{x:.16g} {y:.16g} {z:.16g}" for x, y, z in points)
    lines.append("$EndNodes")
    lines.append("$Elements")
    lines.append(f"1 {m} 1 {m}")  # numEntityBlocks numElements minTag maxTag
    lines.append(f"2 1 {etype} {m}")  # entityDim entityTag elementType numElements
    for i, cell in enumerate(cells, start=1):
        lines.append(f"{i} " + " ".join(str(v + 1) for v in cell))  # 0- -> 1-based
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


def icosphere(subdiv):
    """Icosahedron subdivided `subdiv` times, projected onto the unit sphere."""
    phi = (1 + math.sqrt(5)) / 2
    norm = math.sqrt(1 + phi * phi)
    points = [
        (x / norm, y / norm, z / norm)
        for x, y, z in (
            (-1, phi, 0), (1, phi, 0), (-1, -phi, 0), (1, -phi, 0),
            (0, -1, phi), (0, 1, phi), (0, -1, -phi), (0, 1, -phi),
            (phi, 0, -1), (phi, 0, 1), (-phi, 0, -1), (-phi, 0, 1),
        )
    ]
    tris = [
        (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
        (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
        (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
        (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
    ]
    midpoints = {}

    def midpoint(a, b):
        key = (a, b) if a < b else (b, a)
        if key not in midpoints:
            x = points[a][0] + points[b][0]
            y = points[a][1] + points[b][1]
            z = points[a][2] + points[b][2]
            r = math.sqrt(x * x + y * y + z * z)
            midpoints[key] = len(points)
            points.append((x / r, y / r, z / r))
        return midpoints[key]

    for _ in range(subdiv):
        split = []
        for a, b, c in tris:
            ab, bc, ca = midpoint(a, b), midpoint(b, c), midpoint(c, a)
            split += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]
        tris = split
    return points, tris


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
    pts, tris = icosphere(2)
    write_msh(os.path.join(OUT_DIR, "sphere-tri.msh"), pts, tris)
    print(f"sphere-tri.msh: {len(pts)} nodes, {len(tris)} triangles")
    pts, quads = torus(24, 12)
    write_msh(os.path.join(OUT_DIR, "torus.msh"), pts, quads)
    print(f"torus.msh: {len(pts)} nodes, {len(quads)} quads")


if __name__ == "__main__":
    main()
