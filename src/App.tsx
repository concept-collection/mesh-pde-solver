import { useCallback, useEffect, useState } from 'react'
import { ACCEPT, formatForFilename } from './mesh/formats'
import { initMeshio, parseMeshFile } from './mesh/meshio'
import { edgeClassification, type QuadMeshData } from './mesh/quadmesh'
import { prewarm, solve, type SolutionData } from './engine/engine'
import {
  PDES,
  MAX_QUADS,
  SLOW_QUADS,
  MIN_ORDER,
  MAX_ORDER,
  DEFAULT_ORDER,
  type PdeDef,
} from './pde/presets'
import { SurfaceView } from './render/SurfaceView'

// Module-level so React StrictMode double-mounting doesn't prewarm twice
// (the prewarm downloads the MATLAB packages into numbl's IndexedDB cache).
let prewarmPromise: Promise<void> | null = null

interface LoadedMesh {
  name: string
  data: QuadMeshData
  numVertices: number
  numQuads: number
  closed: boolean
  nonManifold: boolean
  warnings: string[]
}

const SAMPLES = [
  { label: 'Sphere (cubed)', file: 'sphere.msh' },
  { label: 'Torus', file: 'torus.msh' },
]

export default function App() {
  const [meshioStatus, setMeshioStatus] = useState('Loading Python runtime…')
  const [meshioReady, setMeshioReady] = useState(false)
  const [engineStatus, setEngineStatus] = useState('Preparing MATLAB packages…')
  const [engineReady, setEngineReady] = useState(false)
  const [consoleLines, setConsoleLines] = useState<string[]>([])

  const [mesh, setMesh] = useState<LoadedMesh | null>(null)
  const [meshError, setMeshError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  const [pde, setPde] = useState<PdeDef>(PDES[0])
  const [fExpr, setFExpr] = useState(PDES[0].fPresets[0].expr)
  const [cExpr, setCExpr] = useState('100*(1 - z)')
  const [order, setOrder] = useState(DEFAULT_ORDER)

  const [solving, setSolving] = useState(false)
  const [solveStatus, setSolveStatus] = useState('')
  const [solveError, setSolveError] = useState<string | null>(null)
  const [solution, setSolution] = useState<SolutionData | null>(null)
  const [solveSeconds, setSolveSeconds] = useState<number | null>(null)

  const appendConsole = useCallback((text: string) => {
    setConsoleLines((lines) => [...lines.slice(-199), text.replace(/\n$/, '')])
  }, [])

  useEffect(() => {
    initMeshio(setMeshioStatus)
      .then(() => {
        setMeshioReady(true)
        setMeshioStatus('')
      })
      .catch((err) => setMeshioStatus(`Mesh reader failed: ${String(err.message ?? err)}`))

    if (!prewarmPromise) {
      prewarmPromise = prewarm({ onProgress: setEngineStatus, onOutput: appendConsole })
    }
    prewarmPromise
      // A failed prewarm isn't fatal — the solve re-attempts the downloads.
      .catch((err) => appendConsole(`package prewarm failed: ${String(err?.message ?? err)}`))
      .finally(() => {
        setEngineReady(true)
        setEngineStatus('')
      })
  }, [appendConsole])

  const loadMesh = useCallback(
    async (name: string, bytes: Uint8Array) => {
      setMeshError(null)
      setSolveError(null)
      setSolution(null)
      setParsing(true)
      try {
        const format = formatForFilename(name)
        if (!format) throw new Error(`Unsupported file extension on "${name}"`)
        const result = await parseMeshFile(bytes, format)
        if (result.numQuads > MAX_QUADS) {
          throw new Error(
            `${result.numQuads} quads is too many for an in-browser solve ` +
              `(limit ${MAX_QUADS}); please upload a coarser mesh.`,
          )
        }
        const cls = edgeClassification(result.mesh.quads)
        setMesh({
          name,
          data: result.mesh,
          numVertices: result.numVertices,
          numQuads: result.numQuads,
          closed: cls.closed,
          nonManifold: cls.nonManifold,
          warnings: result.warnings,
        })
      } catch (err) {
        setMesh(null)
        setMeshError(err instanceof Error ? err.message : String(err))
      } finally {
        setParsing(false)
      }
    },
    [],
  )

  const onUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      await loadMesh(file.name, new Uint8Array(await file.arrayBuffer()))
    },
    [loadMesh],
  )

  const onSample = useCallback(
    async (file: string) => {
      const resp = await fetch(`${import.meta.env.BASE_URL}samples/${file}`)
      if (!resp.ok) {
        setMeshError(`Failed to fetch sample: HTTP ${resp.status}`)
        return
      }
      await loadMesh(file, new Uint8Array(await resp.arrayBuffer()))
    },
    [loadMesh],
  )

  const onSolve = useCallback(async () => {
    if (!mesh) return
    setSolveError(null)
    setSolving(true)
    setSolveStatus('')
    setSolveSeconds(null)
    const t0 = performance.now()
    try {
      const result = await solve(
        mesh.data.mshBytes,
        {
          pde: pde.id,
          f: fExpr.trim(),
          c: cExpr.trim(),
          p: order,
          closed: mesh.closed,
        },
        { onProgress: setSolveStatus, onOutput: appendConsole },
      )
      setSolution(result)
      setSolveSeconds((performance.now() - t0) / 1000)
    } catch (err) {
      setSolveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSolving(false)
    }
  }, [mesh, pde, fExpr, cExpr, order, appendConsole])

  const onDownloadMsh = useCallback(() => {
    if (!mesh) return
    const blob = new Blob([mesh.data.mshBytes as BlobPart], { type: 'application/octet-stream' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = mesh.name.replace(/\.[^.]*$/, '') + '.msh'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [mesh])

  const onPdeChange = (id: string) => {
    const def = PDES.find((p) => p.id === id) ?? PDES[0]
    setPde(def)
    setFExpr(def.fPresets[0].expr)
  }

  const booting = !meshioReady || !engineReady
  const dof = mesh ? mesh.numQuads * (order + 1) * (order + 1) : 0
  const canSolve = !!mesh && engineReady && !solving && fExpr.trim() !== ''

  return (
    <div className="app">
      <header>
        <h1>Mesh PDE Solver</h1>
        <p>
          Upload a quadrilateral surface mesh, pick a PDE, and solve it on the surface with{' '}
          <a href="https://github.com/danfortunato/surfacefun" target="_blank" rel="noreferrer">
            surfacefun
          </a>{' '}
          running in your browser via <a href="https://numbl.org" target="_blank" rel="noreferrer">numbl</a>.
        </p>
      </header>

      <div className="columns">
        <aside>
          <section>
            <h2>1 · Mesh</h2>
            <div className="row">
              <label className="button">
                Upload mesh…
                <input type="file" accept={ACCEPT} onChange={onUpload} hidden />
              </label>
              {SAMPLES.map((s) => (
                <button key={s.file} onClick={() => onSample(s.file)} disabled={!meshioReady}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="hint">
              Quad meshes in any format meshio reads ({ACCEPT.replaceAll(',', ' ')}); converted to
              Gmsh format for surfacefun.
            </p>
            <div className="meshinfo">
              {parsing ? (
                <div className="status">Reading mesh…</div>
              ) : meshError ? (
                <div className="error">{meshError}</div>
              ) : mesh ? (
                <>
                  <div>
                    <strong>{mesh.name}</strong> — {mesh.numVertices} vertices, {mesh.numQuads}{' '}
                    quads, {mesh.closed ? 'closed surface' : 'open surface (boundary present)'}
                  </div>
                  {mesh.nonManifold && (
                    <div className="warn">Non-manifold edges detected; the solve may fail.</div>
                  )}
                  {mesh.numQuads > SLOW_QUADS && (
                    <div className="warn">Large mesh — the solve may take a while.</div>
                  )}
                  {mesh.warnings.map((w) => (
                    <div className="warn" key={w}>
                      {w}
                    </div>
                  ))}
                  <button className="linkish" onClick={onDownloadMsh}>
                    Download converted .msh
                  </button>
                </>
              ) : (
                <div className="placeholder">No mesh loaded — upload a file or pick a sample.</div>
              )}
            </div>
          </section>

          <section>
            <h2>2 · PDE</h2>
            <label className="field">
              <span>Equation</span>
              <select value={pde.id} onChange={(e) => onPdeChange(e.target.value)}>
                {PDES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} — {p.equation}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint pde-note">{pde.note}</p>

            <label className="field">
              <span>Right-hand side f(x, y, z)</span>
              <div className="preset-row">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setFExpr(e.target.value)
                  }}
                >
                  <option value="">presets…</option>
                  {pde.fPresets.map((p) => (
                    <option key={p.label} value={p.expr}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={fExpr}
                  onChange={(e) => setFExpr(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </label>

            <label className={pde.cPresets ? 'field' : 'field inactive'}>
              <span>Coefficient c(x, y, z)</span>
              <div className="preset-row">
                <select
                  value=""
                  disabled={!pde.cPresets}
                  onChange={(e) => {
                    if (e.target.value) setCExpr(e.target.value)
                  }}
                >
                  <option value="">presets…</option>
                  {(pde.cPresets ?? []).map((p) => (
                    <option key={p.label} value={p.expr}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={pde.cPresets ? cExpr : ''}
                  placeholder={pde.cPresets ? undefined : 'not used by this equation'}
                  disabled={!pde.cPresets}
                  onChange={(e) => setCExpr(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </label>

            <label className="field">
              <span>
                Polynomial order p = {order}
                {mesh ? ` (~${dof.toLocaleString()} unknowns)` : ''}
              </span>
              <input
                type="range"
                min={MIN_ORDER}
                max={MAX_ORDER}
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
              />
            </label>
          </section>

          <section>
            <h2>3 · Solve</h2>
            <button className="solve" onClick={onSolve} disabled={!canSolve}>
              {solving ? 'Solving…' : 'Solve'}
            </button>
            <div className="solve-status">
              {solving ? (
                <p className="status">{solveStatus || 'Solving…'}</p>
              ) : booting ? (
                <p className="status">
                  {[meshioStatus, engineStatus].filter(Boolean).join(' · ') || 'Preparing…'}
                </p>
              ) : solveError ? (
                <p className="error">{solveError}</p>
              ) : solution && solveSeconds !== null ? (
                <p className="status">
                  Solved in {solveSeconds.toFixed(1)} s · u ∈ [{solution.umin.toPrecision(4)},{' '}
                  {solution.umax.toPrecision(4)}]
                </p>
              ) : null}
            </div>
          </section>

          <section>
            <details>
              <summary>Engine console</summary>
              <pre className="console">{consoleLines.join('\n') || '(no output yet)'}</pre>
            </details>
          </section>
        </aside>

        <main>
          <SurfaceView mesh={mesh?.data ?? null} solution={solution} />
        </main>
      </div>
    </div>
  )
}
