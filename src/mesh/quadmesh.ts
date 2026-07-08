/** The app's internal quad-mesh representation and connectivity helpers. */

export interface QuadMeshData {
  /** xyz triples, one per vertex */
  positions: Float32Array
  /** 4 vertex indices per quad, Gmsh corner order (counterclockwise) */
  quads: Uint32Array
  /** the canonical Gmsh MSH 2.2 file the solver reads */
  mshBytes: Uint8Array
}

export interface QuadMeshInfo {
  numVertices: number
  numQuads: number
  /** every edge shared by exactly two quads */
  closed: boolean
  /** some edge shared by more than two quads */
  nonManifold: boolean
  warnings: string[]
}

/**
 * Classify the mesh from its edge incidence: closed (all edges shared by 2
 * quads), open (some boundary edges), or non-manifold (an edge on >2 quads).
 */
export function edgeClassification(quads: Uint32Array): {
  closed: boolean
  nonManifold: boolean
} {
  const counts = new Map<number, number>()
  const nq = quads.length / 4
  for (let k = 0; k < nq; k++) {
    for (let e = 0; e < 4; e++) {
      const a = quads[k * 4 + e]
      const b = quads[k * 4 + ((e + 1) % 4)]
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
