# mesh-pde-solver

Upload a quadrilateral surface mesh, pick a PDE, tweak its right-hand side
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
.mesh .bdf .avs` works — but the mesh **must contain quadrilateral cells**
(surfacefun computes on quad patches; triangle-only meshes are rejected).
Two sample meshes are bundled. The converted Gmsh file can be downloaded.
Whether the surface is closed or open is detected from the edge connectivity.

## How it works

1. `src/mesh/` — meshio in Pyodide parses the upload, keeps the quad cells,
   and writes a canonical Gmsh MSH 2.2 ASCII file plus preview arrays.
2. `src/engine/` — a managed numbl session (`createNumblSession` from
   `numbl/browser`): numbl owns the worker and VFS, bootstraps the
   [mip](https://github.com/mip-org) package manager, and runs
   [`matlab/main.m`](matlab/main.m), which begins with
   `mip load --install surfacefun`. The script opens a placeholder `uihtml`
   figure that is never rendered — it is the event bridge: the host writes
   `mesh.msh` into the VFS and dispatches `solve` events; the script solves
   and sends per-patch data back.
3. `matlab/solve_pde.m` — parses the mesh (`load_gmsh_quads.m`), builds a
   `surfacemesh` from the quads, `resample`s it to the requested order, and
   solves with `surfaceop`.
4. `src/render/SurfaceView.tsx` — three.js view of the quad mesh or the
   per-patch solution grids with a parula colormap.

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

Requires numbl >= 0.4.9 (the `numbl/browser` managed-session entry).
