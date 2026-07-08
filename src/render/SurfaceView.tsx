/**
 * The rotatable 3D view (plain three.js, adapted from
 * surfacefun-interactive's SurfView): shows the uploaded quad mesh until a
 * solution arrives, then the solution colored by u with a colorbar.
 * Drag to rotate, scroll to zoom.
 */
import { useRef, useEffect, type CSSProperties } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { QuadMeshData } from '../mesh/quadmesh'
import type { SolutionData } from '../engine/engine'
import { colormapLookup, colormapGradient } from './colormap'

export interface ViewContent {
  mesh: QuadMeshData | null
  solution: SolutionData | null
}

interface SceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  animId: number
}

// data (x,y,z) -> three (X=x, Y=z, Z=y), so data-z is "up" on screen

function clearScene(scene: THREE.Scene) {
  const toRemove: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) toRemove.push(obj)
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

function buildMeshPreview(scene: THREE.Scene, mesh: QuadMeshData) {
  const { positions, quads } = mesh
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

  const indices: number[] = []
  const nq = quads.length / 4
  for (let k = 0; k < nq; k++) {
    const [a, b, c, d] = [quads[k * 4], quads[k * 4 + 1], quads[k * 4 + 2], quads[k * 4 + 3]]
    indices.push(a, b, c, a, c, d)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  scene.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshPhongMaterial({
        color: 0xb8bec9,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    ),
  )

  // quad edges
  const edgePositions: number[] = []
  for (let k = 0; k < nq; k++) {
    for (let e = 0; e < 4; e++) {
      const a = quads[k * 4 + e]
      const b = quads[k * 4 + ((e + 1) % 4)]
      edgePositions.push(
        pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2],
        pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2],
      )
    }
  }
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
  scene.add(
    new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.35, transparent: true }),
    ),
  )
}

function buildSolution(scene: THREE.Scene, sol: SolutionData) {
  const { n, x, y, z, u, umin, umax } = sol
  const flat: number[] = []
  for (let k = 0; k < sol.npatches; k++) {
    for (let i = 0; i < x[k].length; i++) flat.push(x[k][i], y[k][i], z[k][i])
  }
  const { center, range } = bounds([flat])
  const cRange = umax - umin || 1

  for (let k = 0; k < sol.npatches; k++) {
    const px = x[k]
    const py = y[k]
    const pz = z[k]
    const pu = u[k]
    const nv = px.length // n*n grid, column-major
    const pos = new Float32Array(nv * 3)
    const col = new Float32Array(nv * 3)
    for (let i = 0; i < nv; i++) {
      normalizedPosition(pos, i * 3, [px[i], py[i], pz[i]], center, range)
      const [r, g, b] = colormapLookup((pu[i] - umin) / cRange)
      col[i * 3] = r
      col[i * 3 + 1] = g
      col[i * 3 + 2] = b
    }
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
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    scene.add(
      new THREE.Mesh(
        geometry,
        new THREE.MeshPhongMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          shininess: 10,
        }),
      ),
    )
  }
}

export function SurfaceView({ mesh, solution }: ViewContent) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)

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

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false

    scene.add(new THREE.AmbientLight(0xffffff, 0.65))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.6)
    dirLight.position.set(2, 3, 2)
    scene.add(dirLight)

    const animId = requestAnimationFrame(function loop() {
      controls.update()
      renderer.render(scene, camera)
      if (stateRef.current) stateRef.current.animId = requestAnimationFrame(loop)
    })
    stateRef.current = { renderer, scene, camera, controls, animId }

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      renderer.setSize(rect.width, rect.height)
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
      renderer.dispose()
      container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // Rebuild content when data changes
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    clearScene(st.scene)
    if (solution) buildSolution(st.scene, solution)
    else if (mesh) buildMeshPreview(st.scene, mesh)
  }, [mesh, solution])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {solution && <Colorbar min={solution.umin} max={solution.umax} />}
      {!mesh && !solution && (
        <div className="view-placeholder">Upload a quad mesh or load a sample to begin</div>
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
