/**
 * JS side of the meshio bridge (adapted from mesh-converter). Loads Pyodide
 * from the script tag in index.html, installs meshio via micropip, and runs
 * bridge.py to turn an uploaded mesh file into the app's quad-mesh
 * representation — all client-side.
 */
import bridgeCode from './bridge.py?raw'
import type { MeshFormat } from './formats'
import type { QuadMeshData } from './quadmesh'

const MESHIO_SPEC = 'meshio==5.3.5'

const OUT_MSH = '/work/out.msh'
const POSITIONS_F32 = '/work/positions.f32'
const QUADS_U32 = '/work/quads.u32'

interface Pyodide {
  runPython(code: string): unknown
  loadPackage(names: string[]): Promise<unknown>
  pyimport(name: string): { install(spec: string): Promise<void> }
  FS: {
    writeFile(path: string, data: Uint8Array): void
    readFile(path: string): Uint8Array<ArrayBuffer>
    unlink(path: string): void
    mkdirTree(path: string): void
  }
}

declare global {
  // provided by the pyodide.js script tag in index.html
  function loadPyodide(options?: { indexURL?: string }): Promise<Pyodide>
}

export interface ParseResult {
  mesh: QuadMeshData
  numVertices: number
  numQuads: number
  warnings: string[]
}

let initPromise: Promise<Pyodide> | null = null

async function doInit(onProgress: (message: string) => void): Promise<Pyodide> {
  if (typeof loadPyodide !== 'function') {
    throw new Error('Pyodide script failed to load (offline? blocked CDN?)')
  }
  onProgress('Loading Python runtime (Pyodide)…')
  const pyodide = await loadPyodide()
  onProgress('Installing meshio…')
  await pyodide.loadPackage(['micropip'])
  await pyodide.pyimport('micropip').install(MESHIO_SPEC)
  pyodide.runPython(bridgeCode)
  return pyodide
}

/** Kick off (or join) the one-time Pyodide + meshio setup. */
export function initMeshio(onProgress: (message: string) => void = () => {}): Promise<Pyodide> {
  if (!initPromise) initPromise = doInit(onProgress)
  return initPromise
}

/** Last line of a Python traceback, without the exception class name. */
function pythonErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const lines = raw
    .trim()
    .split('\n')
    .filter((l) => l.trim())
  const last = lines[lines.length - 1] ?? raw
  return last.replace(/^[\w.]+(?:Error|Exception|Exit)\s*:\s*/, '')
}

export async function parseMeshFile(bytes: Uint8Array, format: MeshFormat): Promise<ParseResult> {
  const pyodide = await initMeshio()
  const inputPath = '/work/input' + format.extension
  pyodide.FS.mkdirTree('/work')
  pyodide.FS.writeFile(inputPath, bytes)
  let infoJson: string
  try {
    infoJson = String(
      pyodide.runPython(
        `parse_quad_mesh(${JSON.stringify(inputPath)}, ${JSON.stringify(format.id)})`,
      ),
    )
  } catch (err) {
    throw new Error(pythonErrorMessage(err))
  } finally {
    try {
      pyodide.FS.unlink(inputPath)
    } catch {
      /* not created */
    }
  }
  const info = JSON.parse(infoJson) as {
    numVertices: number
    numQuads: number
    warnings: string[]
  }
  const posBytes = pyodide.FS.readFile(POSITIONS_F32)
  const quadBytes = pyodide.FS.readFile(QUADS_U32)
  const mesh: QuadMeshData = {
    positions: new Float32Array(posBytes.buffer, posBytes.byteOffset, posBytes.byteLength / 4),
    quads: new Uint32Array(quadBytes.buffer, quadBytes.byteOffset, quadBytes.byteLength / 4),
    mshBytes: pyodide.FS.readFile(OUT_MSH),
  }
  return { mesh, ...info }
}
