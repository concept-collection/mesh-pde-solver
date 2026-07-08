// The solver engine, built on numbl/browser's managed session: numbl owns
// the worker, the VFS, the mip bootstrap (main.m does
// `mip load --install surfacefun`), and IndexedDB persistence of installed
// packages across page loads. This wrapper adds the app's solve protocol:
// mesh.msh in the VFS + one 'solve' event in flight at a time, with a
// timeout.

import { createNumblSession, type NumblSession } from 'numbl/browser'
import { PROJECT_FILES, MAIN_FILE } from './project'
import type { SolveParams, SolutionData } from './protocol'

const SOLVE_TIMEOUT_MS = 300_000

export class EngineError extends Error {}

export class SolverEngine {
  private session: NumblSession | null = null
  private compId: string | null = null
  private disposed = false
  private pendingMesh: Uint8Array | null = null

  private solveWaiter: {
    resolve: (data: SolutionData) => void
    reject: (err: Error) => void
    timeoutId: ReturnType<typeof setTimeout>
  } | null = null

  /** Boot progress messages (downloads, engine start) for the UI. */
  onProgress: (message: string) => void = () => {}
  /** MATLAB console output (mip install logs etc.), for a console panel. */
  onOutput: (text: string) => void = () => {}
  /** Hard failures (boot errors) — the engine is unusable afterwards. */
  onError: (message: string) => void = () => {}
  /** Last hard failure, for subscribers that attach after it happened. */
  lastError: string | null = null

  async start(): Promise<void> {
    try {
      const session = await createNumblSession({
        files: PROJECT_FILES.map((f) => ({ path: f.path, content: f.text })),
        mainFile: MAIN_FILE,
        onProgress: (message) => this.onProgress(message),
        onOutput: (text) => this.onOutput(text),
        onHtmlSourceEvent: (_compId, name, dataJson) =>
          this.handleScriptEvent(name, dataJson),
      })
      if (this.disposed) {
        session.dispose()
        return
      }
      this.compId = session.uihtmlComponents[0]?.compId ?? null
      if (!session.hasUihtmlSession || !this.compId) {
        session.dispose()
        throw new EngineError('script finished without a live uihtml session')
      }
      this.session = session
      if (this.pendingMesh) {
        session.writeFile('mesh.msh', this.pendingMesh)
        this.pendingMesh = null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.lastError = message
      if (!this.disposed) this.onError(message)
      throw err instanceof Error ? err : new EngineError(message)
    }
  }

  /** Make `bytes` the mesh.msh the next solve reads. */
  setMesh(bytes: Uint8Array): void {
    if (this.session) this.session.writeFile('mesh.msh', bytes)
    else this.pendingMesh = bytes
  }

  solve(params: SolveParams): Promise<SolutionData> {
    if (!this.session || !this.compId) {
      return Promise.reject(new EngineError('engine not ready'))
    }
    if (this.solveWaiter) {
      return Promise.reject(new EngineError('a solve is already running'))
    }
    const dispatched = this.session.dispatchHtmlEvent(this.compId, 'solve', params)
    return new Promise<SolutionData>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.settleSolve((w) => w.reject(new EngineError('solve timed out')))
      }, SOLVE_TIMEOUT_MS)
      this.solveWaiter = { resolve, reject, timeoutId }
      // An interpreter-level dispatch failure (vs. the solveError event the
      // script sends for caught errors) also settles the solve.
      dispatched.catch((err) => {
        this.settleSolve((w) =>
          w.reject(err instanceof Error ? err : new EngineError(String(err))),
        )
      })
    })
  }

  get isReady(): boolean {
    return this.session !== null
  }

  get isBusy(): boolean {
    return this.solveWaiter !== null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.settleSolve((w) => w.reject(new EngineError('engine disposed')))
    this.session?.dispose()
    this.session = null
  }

  // ---- internals ---------------------------------------------------------

  private settleSolve(settle: (w: NonNullable<typeof this.solveWaiter>) => void) {
    const w = this.solveWaiter
    if (!w) return
    this.solveWaiter = null
    clearTimeout(w.timeoutId)
    settle(w)
  }

  private handleScriptEvent(name: string, dataJson: string) {
    if (name === 'solution') {
      this.settleSolve((w) => {
        try {
          w.resolve(JSON.parse(dataJson) as SolutionData)
        } catch (err) {
          w.reject(new EngineError(`bad solution payload: ${String(err)}`))
        }
      })
    } else if (name === 'solveError') {
      const message =
        (JSON.parse(dataJson) as { message?: string }).message ?? 'unknown solver error'
      this.settleSolve((w) => w.reject(new EngineError(message)))
    }
  }
}
