# mesh-pde-solver

Upload a triangle or quad surface mesh, pick a PDE, tweak its right-hand side
and coefficients, and solve it **on the surface** — entirely in your browser.
The mesh is converted to Gmsh format with [meshio](https://github.com/nschloe/meshio)
(via [Pyodide](https://pyodide.org)), and the PDE is solved by
[surfacefun](https://github.com/danfortunato/surfacefun) running on
[numbl](https://numbl.org), a MATLAB-compatible runtime, in a web worker.
The solution renders in a rotatable 3D view (drag to rotate, scroll to zoom).

## PDEs

- **Poisson (Laplace–Beltrami)** — Δu = f. On a closed surface the problem is
  rank-deficient: f is projected to mean zero and the mean-zero solution is
  returned. On an open surface, zero Dirichlet data is imposed.
- **Helmholtz (variable coefficient)** — (Δ + c)u = f with c(x, y, z) an
  arbitrary expression.

The right-hand side f and coefficient c are MATLAB expressions in the surface
coordinates x, y, z (elementwise operators: `.*`, `.^`, …), with presets to
start from. The polynomial order per patch is adjustable (accuracy vs. time).

## Meshes

Uploads go through meshio, so any of `.msh .vtk .vtu .obj .off .ply .inp
.mesh .bdf .avs` works — the mesh must contain triangle or quadrilateral
cells (surfacefun computes on either patch type, but not both at once, so a
mixed mesh has its quads split into triangles). Three sample meshes are
bundled. The converted Gmsh file can be downloaded. Whether the surface is
closed or open is detected from the edge connectivity.

## How it works

1. `src/mesh/` — meshio in Pyodide parses the upload, keeps the triangle and
   quad cells, and writes a canonical Gmsh MSH 4.1 ASCII file plus preview
   arrays.
2. `src/engine/` — each solve boots a fresh managed numbl session
   (`createNumblSession` from `numbl/browser`): numbl owns the worker and
   VFS and bootstraps the [mip](https://github.com/mip-org) package manager.
   The host stages `mesh.msh` and `params.json` and runs
   [`matlab/main.m`](matlab/main.m) standalone — it begins with
   `mip load --install surfacefun`, solves, and writes `result.json`, which
   the host reads back before disposing the worker.
3. `matlab/solve_pde.m` — loads the mesh with `surfacemesh.import`,
   `resample`s it to the requested order, and solves with `surfaceop`.
4. `src/render/SurfaceView.tsx` — three.js view of the mesh or the
   per-patch solution data with a parula colormap.

The first visit downloads the Python runtime (~15 MB, browser-cached) and
the surfacefun/chebfun packages (~28 MB). Installed MATLAB packages persist
in IndexedDB across page loads (numbl wipes them after 24 h of inactivity),
so later visits skip the package downloads.

## Development

```bash
npm install
npm run dev          # local dev server
npm run build        # static build in dist/
npm run engine-test  # headless solver check in Node (no browser)
python3 scripts/make_samples.py   # regenerate public/samples/
```

The engine test runs the exact MATLAB project the worker runs, shimming
numbl's synchronous-XHR `websave`/`webread` with curl (responses cached in
`.cache/`), and checks a Poisson solve against an exact spherical-harmonic
solution.

Requires numbl >= 0.4.12 — `NumblSession.readFile` (0.4.10), enumeration-class
support and the 1×1-tensor broadcast-assignment fix (0.4.11), which
surfacefun's `surfacemesh.import` / `patchtype` depend on, and the 1×1-tensor
gather-orientation fix (0.4.12), which surfacefun's `trianglepts` depends on.
