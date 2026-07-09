/**
 * The rotatable 3D view (plain three.js, adapted from
 * surfacefun-interactive's SurfView): shows the uploaded mesh until a
 * solution arrives, then the solution colored by u with a colorbar.
 * Drag to rotate, scroll to zoom. A toolbar (mirroring mesh-converter's)
 * picks shaded / wireframe / both / points rendering and toggles red/cyan
 * anaglyph stereo.
 */
import { useRef, useEffect, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { AnaglyphEffect } from 'three/examples/jsm/effects/AnaglyphEffect.js'
import type { SurfaceMeshData } from '../mesh/surfacemesh'
import type { SolutionData } from '../engine/engine'
import { colormapLookup, colormapGradient } from './colormap'

export interface ViewContent {
  mesh: SurfaceMeshData | null
  solution: SolutionData | null
}

type ViewMode = 'shaded' | 'wire' | 'both' | 'points'

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'shaded', label: 'Shaded' },
  { id: 'wire', label: 'Wire' },
  { id: 'both', label: 'Both' },
  { id: 'points', label: 'Points' },
]

interface SceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  /** stand-in for the ortho camera while the anaglyph effect renders
   * (the effect derives its stereo pair from a perspective projection) */
  persp: THREE.PerspectiveCamera
  effect: AnaglyphEffect
  controls: OrbitControls
  animId: number
}

// data (x,y,z) -> three (X=x, Y=z, Z=y), so data-z is "up" on screen

function clearScene(scene: THREE.Scene) {
  const toRemove: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if (
      obj instanceof THREE.Mesh ||
      obj instanceof THREE.LineSegments ||
      obj instanceof THREE.Points
    )
      toRemove.push(obj)
  })
  for (const obj of toRemove) {
    scene.remove(obj)
    ;(obj as THREE.Mesh).geometry?.dispose()
  }
}

/** Bounding box across a set of xyz-triple arrays. */
function bounds(arrays: ArrayLike<number>[]): { center: [number, number, number]; range: number } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const a of arrays) {
    for (let i = 0; i + 2 < a.length; i += 3) {
      for (let d = 0; d < 3; d++) {
        const v = a[i + d]
        if (v < min[d]) min[d] = v
        if (v > max[d]) max[d] = v
      }
    }
  }
  const range = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    range,
  }
}

function normalizedPosition(
  out: Float32Array,
  outIdx: number,
  xyz: [number, number, number],
  center: [number, number, number],
  range: number,
) {
  out[outIdx] = (xyz[0] - center[0]) / range
  out[outIdx + 1] = (xyz[2] - center[2]) / range
  out[outIdx + 2] = (xyz[1] - center[1]) / range
}

/** Pixel-sized points that read on the white background. */
function pointsMaterial(vertexColors: boolean) {
  return new THREE.PointsMaterial({
    vertexColors,
    color: vertexColors ? 0xffffff : 0x51606f,
    size: 3.5 * (window.devicePixelRatio || 1),
    sizeAttenuation: false,
  })
}

function buildMeshPreview(scene: THREE.Scene, mesh: SurfaceMeshData, mode: ViewMode) {
  const { positions, cells, cellSize } = mesh
  const { center, range } = bounds([positions])
  const nVerts = positions.length / 3

  const pos = new Float32Array(nVerts * 3)
  for (let i = 0; i < nVerts; i++) {
    normalizedPosition(
      pos,
      i * 3,
      [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
      center,
      range,
    )
  }
  const posAttr = new THREE.BufferAttribute(pos, 3)
  const nc = cells.length / cellSize

  if (mode === 'shaded' || mode === 'both') {
    const indices: number[] = []
    for (let k = 0; k < nc; k++) {
      const [a, b, c] = [cells[k * cellSize], cells[k * cellSize + 1], cells[k * cellSize + 2]]
      indices.push(a, b, c)
      if (cellSize === 4) indices.push(a, c, cells[k * cellSize + 3])
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', posAttr)
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    scene.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshPhongMaterial({
          color: 0xb8bec9,
          flatShading: true,
          side: THREE.DoubleSide,
          polygonOffset: mode === 'both',
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      ),
    )
  }

  if (mode === 'wire' || mode === 'both') {
    // cell edges (not the render triangulation, so quads show no diagonals)
    const edgeIndices: number[] = []
    for (let k = 0; k < nc; k++) {
      for (let e = 0; e < cellSize; e++) {
        edgeIndices.push(cells[k * cellSize + e], cells[k * cellSize + ((e + 1) % cellSize)])
      }
    }
    const edgeGeometry = new THREE.BufferGeometry()
    edgeGeometry.setAttribute('position', posAttr)
    edgeGeometry.setIndex(edgeIndices)
    scene.add(
      new THREE.LineSegments(
        edgeGeometry,
        mode === 'both'
          ? new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true })
          : new THREE.LineBasicMaterial({ color: 0x33404e }),
      ),
    )
  }

  if (mode === 'points') {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', posAttr)
    scene.add(new THREE.Points(geometry, pointsMaterial(false)))
  }
}

/**
 * Triangulation of the n*(n+1)/2 trianglepts(n) nodes of one triangle patch
 * into (n-1)^2 sub-triangles — a 0-based port of surfacefun's trilattice.m.
 * The nodes come in columns of decreasing height n, n-1, ..., 1.
 */
function triLattice(n: number): number[] {
  const indices: number[] = []
  let colstart = 0
  for (let i = 0; i < n - 1; i++) {
    const h = n - i - 1
    indices.push(colstart, colstart + 1, colstart + 1 + h)
    for (let s = colstart + 1; s < colstart + h; s++) {
      indices.push(s, s + h, s + h + 1, s, s + 1, s + h + 1)
    }
    colstart += h + 1
  }
  return indices
}

/** Triangulation of one quad patch's column-major n-by-n grid. */
function quadLattice(n: number): number[] {
  const indices: number[] = []
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      const b = j * n + i + 1
      const c = (j + 1) * n + i
      const d = (j + 1) * n + i + 1
      indices.push(a, b, c, b, d, c)
    }
  }
  return indices
}

/** Unique edges of the triLattice(n) triangulation, as index pairs. */
function triLatticeEdges(n: number): number[] {
  const tris = triLattice(n)
  const seen = new Set<number>()
  const pairs: number[] = []
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e]
      const b = tris[t + ((e + 1) % 3)]
      const key = a < b ? a * 65536 + b : b * 65536 + a
      if (!seen.has(key)) {
        seen.add(key)
        pairs.push(a, b)
      }
    }
  }
  return pairs
}

/** Grid lines of an n-by-n patch (no triangulation diagonals), index pairs. */
function quadGridEdges(n: number): number[] {
  const pairs: number[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (i + 1 < n) pairs.push(j * n + i, j * n + i + 1)
      if (j + 1 < n) pairs.push(j * n + i, (j + 1) * n + i)
    }
  }
  return pairs
}

function buildSolution(scene: THREE.Scene, sol: SolutionData, mode: ViewMode) {
  const { n, x, y, z, u, umin, umax } = sol
  const flat: number[] = []
  for (let k = 0; k < sol.npatches; k++) {
    for (let i = 0; i < x[k].length; i++) flat.push(x[k][i], y[k][i], z[k][i])
  }
  const { center, range } = bounds([flat])
  const cRange = umax - umin || 1
  const isTri = sol.ptype === 'tri'
  const faceIndices = isTri ? triLattice(n) : quadLattice(n)
  const edgeIndices =
    mode === 'wire' || mode === 'both' ? (isTri ? triLatticeEdges(n) : quadGridEdges(n)) : null

  for (let k = 0; k < sol.npatches; k++) {
    const px = x[k]
    const py = y[k]
    const pz = z[k]
    const pu = u[k]
    const nv = px.length // n*n grid or n*(n+1)/2 triangle nodes
    const pos = new Float32Array(nv * 3)
    const col = new Float32Array(nv * 3)
    for (let i = 0; i < nv; i++) {
      normalizedPosition(pos, i * 3, [px[i], py[i], pz[i]], center, range)
      const [r, g, b] = colormapLookup((pu[i] - umin) / cRange)
      col[i * 3] = r
      col[i * 3 + 1] = g
      col[i * 3 + 2] = b
    }
    const posAttr = new THREE.BufferAttribute(pos, 3)
    const colAttr = new THREE.BufferAttribute(col, 3)

    if (mode === 'shaded' || mode === 'both') {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', posAttr)
      geometry.setAttribute('color', colAttr)
      geometry.setIndex(faceIndices)
      geometry.computeVertexNormals()
      scene.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            shininess: 10,
            polygonOffset: mode === 'both',
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
        ),
      )
    }

    if (edgeIndices) {
      const edgeGeometry = new THREE.BufferGeometry()
      edgeGeometry.setAttribute('position', posAttr)
      edgeGeometry.setAttribute('color', colAttr)
      edgeGeometry.setIndex(edgeIndices)
      scene.add(
        new THREE.LineSegments(
          edgeGeometry,
          mode === 'both'
            ? new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true })
            : new THREE.LineBasicMaterial({ vertexColors: true }),
        ),
      )
    }

    if (mode === 'points') {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', posAttr)
      geometry.setAttribute('color', colAttr)
      scene.add(new THREE.Points(geometry, pointsMaterial(true)))
    }
  }
}

export function SurfaceView({ mesh, solution }: ViewContent) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const [mode, setMode] = useState<ViewMode>('both')
  const [anaglyph, setAnaglyph] = useState(false)
  const anaglyphRef = useRef(anaglyph)
  anaglyphRef.current = anaglyph

  // Set up the scene once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setClearColor(0xffffff)
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
    camera.position.set(1.2, 0.8, 1.2)
    camera.lookAt(0, 0, 0)
    const persp = new THREE.PerspectiveCamera(45, 1, 0.01, 100)
    const effect = new AnaglyphEffect(renderer)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false

    scene.add(new THREE.AmbientLight(0xffffff, 0.65))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6)
    dirLight.position.set(2, 3, 2)
    scene.add(dirLight)

    const animId = requestAnimationFrame(function loop() {
      controls.update()
      if (anaglyphRef.current) {
        // The effect needs a perspective projection; mirror the ortho view:
        // same pose, fov chosen so the visible height at the orbit target
        // matches the ortho frustum at the current zoom.
        const d = camera.position.distanceTo(controls.target)
        persp.position.copy(camera.position)
        persp.quaternion.copy(camera.quaternion)
        persp.fov = THREE.MathUtils.radToDeg(
          2 * Math.atan((camera.top - camera.bottom) / 2 / camera.zoom / d),
        )
        persp.aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
        persp.updateProjectionMatrix()
        // Zero parallax at the orbit target, eye separation proportional to
        // the viewing distance, so stereo depth stays comfortable at any zoom
        effect.planeDistance = d
        effect.eyeSep = d * 0.02
        effect.render(scene, persp)
      } else {
        renderer.render(scene, camera)
      }
      if (stateRef.current) stateRef.current.animId = requestAnimationFrame(loop)
    })
    stateRef.current = { renderer, scene, camera, persp, effect, controls, animId }

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      renderer.setSize(rect.width, rect.height)
      effect.setSize(rect.width, rect.height)
      const aspect = rect.width / rect.height
      const frustumSize = 0.85
      camera.left = -frustumSize * aspect
      camera.right = frustumSize * aspect
      camera.top = frustumSize
      camera.bottom = -frustumSize
      camera.updateProjectionMatrix()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(stateRef.current?.animId ?? animId)
      controls.dispose()
      effect.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // Rebuild content when data or view mode changes
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    clearScene(st.scene)
    if (solution) buildSolution(st.scene, solution, mode)
    else if (mesh) buildMeshPreview(st.scene, mesh, mode)
  }, [mesh, solution, mode])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {(mesh || solution) && (
        <div className="view-toolbar">
          {VIEW_MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? 'active' : ''}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
          <button
            className={`sep ${anaglyph ? 'active' : ''}`}
            onClick={() => setAnaglyph((a) => !a)}
            title="Anaglyph stereo — view with red/cyan 3D glasses"
          >
            3D
          </button>
        </div>
      )}
      {solution && <Colorbar min={solution.umin} max={solution.umax} />}
      {!mesh && !solution && (
        <div className="view-placeholder">Upload a surface mesh or load a sample to begin</div>
      )}
    </div>
  )
}

function Colorbar({ min, max }: { min: number; max: number }) {
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toPrecision(3))
  const style: CSSProperties = {
    position: 'absolute',
    top: 12,
    bottom: 12,
    right: 8,
    width: 60,
    display: 'flex',
    alignItems: 'stretch',
    pointerEvents: 'none',
    fontSize: 11,
    color: '#333',
  }
  return (
    <div style={style}>
      <div
        style={{
          width: 16,
          height: '100%',
          background: colormapGradient('to top'),
          border: '1px solid #999',
          boxSizing: 'border-box',
        }}
      />
      <div
        style={{
          marginLeft: 4,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <span>{fmt(max)}</span>
        <span>{fmt(min)}</span>
      </div>
    </div>
  )
}
