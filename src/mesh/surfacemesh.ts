/** The app's internal surface-mesh representation and connectivity helpers. */

export interface SurfaceMeshData {
  /** xyz triples, one per vertex */
  positions: Float32Array
  /** cellSize vertex indices per cell, Gmsh corner order (counterclockwise) */
  cells: Uint32Array
  /** nodes per cell: 3 (triangles) or 4 (quads) — never mixed */
  cellSize: 3 | 4
  /** the canonical Gmsh MSH 4.1 file the solver reads */
  mshBytes: Uint8Array
}

export interface SurfaceMeshInfo {
  numVertices: number
  numCells: number
  /** every edge shared by exactly two cells */
  closed: boolean
  /** some edge shared by more than two cells */
  nonManifold: boolean
  warnings: string[]
}

/**
 * Classify the mesh from its edge incidence: closed (all edges shared by 2
 * cells), open (some boundary edges), or non-manifold (an edge on >2 cells).
 */
export function edgeClassification(
  cells: Uint32Array,
  cellSize: number,
): {
  closed: boolean
  nonManifold: boolean
} {
  const counts = new Map<number, number>()
  const nc = cells.length / cellSize
  for (let k = 0; k < nc; k++) {
    for (let e = 0; e < cellSize; e++) {
      const a = cells[k * cellSize + e]
      const b = cells[k * cellSize + ((e + 1) % cellSize)]
      // 2^26 > any vertex count we accept; safe integer key for the pair
      const key = a < b ? a * 67108864 + b : b * 67108864 + a
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let closed = true
  let nonManifold = false
  for (const c of counts.values()) {
    if (c !== 2) closed = false
    if (c > 2) nonManifold = true
  }
  return { closed, nonManifold }
}

/** Axis-aligned bounding box diagonal, for camera framing. */
export function meshBounds(positions: Float32Array): {
  center: [number, number, number]
  size: number
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1
  return { center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2], size }
}
