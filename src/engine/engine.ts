// Run-per-solve engine: each solve boots a fresh numbl/browser session that
// runs matlab/main.m standalone (mip load + solve_pde), reads result.json
// back from the session VFS, and disposes the worker. numbl persists the
// installed packages in IndexedDB, so only the first-ever run downloads them;
// prewarm() triggers that download at page load.

import { createNumblSession, type NumblSession } from 'numbl/browser'
import main from '../../matlab/main.m?raw'
import solvePde from '../../matlab/solve_pde.m?raw'
import surfacemeshFromQuads from '../../matlab/surfacemesh_from_quads.m?raw'
import loadGmshQuads from '../../matlab/load_gmsh_quads.m?raw'

const SOLVE_TIMEOUT_MS = 300_000

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

export interface EngineHooks {
  /** Boot progress (package downloads, engine start). */
  onProgress?: (message: string) => void
  /** MATLAB console output (mip install logs etc.). */
  onOutput?: (text: string) => void
}

/** Install the MATLAB packages ahead of the first solve (fire at page load). */
export async function prewarm(hooks: EngineHooks = {}): Promise<void> {
  const session = await createNumblSession({
    files: [{ path: 'main.m', content: 'mip load --install surfacefun;\n' }],
    mainFile: 'main.m',
    onProgress: hooks.onProgress,
    onOutput: hooks.onOutput,
  })
  session.dispose()
}

/**
 * Solve params.pde on the mesh in a fresh session. Rejects with the MATLAB
 * error message if the solve fails (bad expression, degenerate mesh, ...).
 */
export async function solve(
  meshBytes: Uint8Array,
  params: SolveParams,
  hooks: EngineHooks = {},
): Promise<SolutionData> {
  let session: NumblSession | null = null
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('solve timed out')), SOLVE_TIMEOUT_MS)
      }),
      (async () => {
        session = await createNumblSession({
          files: [
            { path: 'main.m', content: main },
            { path: 'solve_pde.m', content: solvePde },
            { path: 'surfacemesh_from_quads.m', content: surfacemeshFromQuads },
            { path: 'load_gmsh_quads.m', content: loadGmshQuads },
            { path: 'params.json', content: JSON.stringify(params) },
            { path: 'mesh.msh', content: meshBytes },
          ],
          mainFile: 'main.m',
          onProgress: hooks.onProgress,
          onOutput: hooks.onOutput,
        })
        const bytes = await session.readFile('result.json')
        return JSON.parse(new TextDecoder().decode(bytes)) as SolutionData
      })(),
    ])
  } finally {
    clearTimeout(timeoutId)
    ;(session as NumblSession | null)?.dispose()
  }
}
