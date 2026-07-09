/**
 * Upload formats the app accepts. All go through meshio (in Pyodide); the
 * mesh must contain triangle or quadrilateral cells — surfacefun computes
 * on either patch type (but not both at once, so mixed meshes are split
 * into all-triangle in bridge.py).
 */
export interface MeshFormat {
  id: string // meshio file_format id
  label: string
  extension: string
}

export const FORMATS: MeshFormat[] = [
  { id: 'gmsh', label: 'Gmsh MSH', extension: '.msh' },
  { id: 'vtk', label: 'VTK legacy', extension: '.vtk' },
  { id: 'vtu', label: 'VTU (VTK XML)', extension: '.vtu' },
  { id: 'obj', label: 'Wavefront OBJ', extension: '.obj' },
  { id: 'off', label: 'OFF', extension: '.off' },
  { id: 'ply', label: 'PLY', extension: '.ply' },
  { id: 'abaqus', label: 'Abaqus', extension: '.inp' },
  { id: 'medit', label: 'Medit', extension: '.mesh' },
  { id: 'nastran', label: 'Nastran', extension: '.bdf' },
  { id: 'avsucd', label: 'AVS-UCD', extension: '.avs' },
]

export const ACCEPT = FORMATS.map((f) => f.extension).join(',')

export function formatForFilename(name: string): MeshFormat | null {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  const ext = name.slice(dot).toLowerCase()
  return FORMATS.find((f) => f.extension === ext) ?? null
}
