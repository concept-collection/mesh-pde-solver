/** The app-level solve protocol spoken over the uihtml event bridge. */

export interface SolveParams {
  pde: 'poisson' | 'helmholtz'
  /** RHS f(x,y,z), a MATLAB expression */
  f: string
  /** zeroth-order coefficient c(x,y,z) (helmholtz only) */
  c: string
  /** polynomial order per patch */
  p: number
  /** every mesh edge shared by exactly two quads (from edgeClassification) */
  closed: boolean
}

/** Per-patch solution grids, as packed by matlab/solve_pde.m. */
export interface SolutionData {
  type: 'solution'
  /** points per patch edge (p + 1) */
  n: number
  npatches: number
  x: number[][]
  y: number[][]
  z: number[][]
  u: number[][]
  umin: number
  umax: number
  pde: string
}
