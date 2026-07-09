// Run-per-solve engine: each solve fills matlab/solve_template.m with the
// parameters, boots a fresh numbl/browser session that runs it standalone,
// reads result.json back from the session VFS, and disposes the worker.
// numbl persists the installed packages in IndexedDB, so only the first-ever
// run downloads them; prewarm() triggers that download at page load.

import { createNumblSession, type NumblSession } from 'numbl/browser'
import solveTemplate from '../../matlab/solve_template.m?raw'

const SOLVE_TIMEOUT_MS = 300_000

export interface SolveParams {
  pde: 'poisson' | 'helmholtz'
  /** RHS f(x,y,z), a MATLAB expression */
  f: string
  /** zeroth-order coefficient c(x,y,z) (helmholtz only) */
  c: string
  /** polynomial order per patch */
  p: number
  /** every mesh edge shared by exactly two cells (from edgeClassification) */
  closed: boolean
  /** filename the mesh is staged under, referenced by the generated script */
  meshFile: string
}

/**
 * Fill matlab/solve_template.m with actual parameter values. The result is
 * the exact script a solve runs, and what the UI offers for download — it
 * also runs in desktop MATLAB with surfacefun on the path.
 */
export function buildSolveScript(params: SolveParams): string {
  const fills: Record<string, string> = {
    MESHFILE: params.meshFile,
    PDE: params.pde,
    F_EXPR: params.f,
    C_EXPR: params.pde === 'helmholtz' ? params.c : '0',
    ORDER: String(params.p),
    CLOSED: params.closed ? 'true' : 'false',
  }
  return solveTemplate.replace(/\{\{(\w+)\}\}/g, (token, key) => fills[key] ?? token)
}

/** Per-patch solution data, as packed by matlab/solve_template.m. */
export interface SolutionData {
  type: 'solution'
  /** points per patch edge (p + 1); quad patches carry n*n points
   * (column-major grid), triangle patches n*(n+1)/2 (trianglepts order) */
  n: number
  /** patch type of the mesh — never mixed */
  ptype: 'quad' | 'tri'
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
            { path: 'solve_pde.m', content: buildSolveScript(params) },
            { path: params.meshFile, content: meshBytes },
          ],
          mainFile: 'solve_pde.m',
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
