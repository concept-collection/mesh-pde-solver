# CLAUDE.md

Tips for future agents working in this repo.

## Architecture

```
matlab/            the MATLAB project the numbl session runs
  main.m           `mip load --install surfacefun` -> solver_session()
  solver_session.m opens the placeholder uihtml figure (the event bridge)
  solve_pde.m      mesh -> surfacemesh -> resample -> surfaceop -> per-patch data
  load_gmsh_quads.m       minimal MSH 2.2 ASCII reader (canonical form only)
  surfacemesh_from_quads.m  replaces surfacemesh.fromGmsh (see below)
src/mesh/          Pyodide + meshio upload pipeline (bridge.py runs in Pyodide)
src/engine/        thin wrapper over numbl/browser's createNumblSession:
                   the app-level solve protocol (mesh.msh + 'solve' events,
                   one in flight, timeout). numbl owns the worker, VFS, mip
                   bootstrap, and IndexedDB package persistence.
src/pde/presets.ts PDE definitions, presets, size limits
src/render/        three.js SurfaceView (mesh preview / solution) + parula
scripts/engine-test.mjs  headless Node check of the whole MATLAB pipeline
```

## Key gotchas

- **numbl >= 0.4.9 from npm** (`numbl/browser` entry, executeCode
  searchPaths scanning, and the flip/fieldnames/containers.Map compat fixes
  all landed in 0.4.9). To develop against a local numbl checkout, point
  package.json at `file:../../numbl` and run
  `npm run build:lib && npm run build:browser` there after source changes.
- **surfacemesh.fromGmsh is not used.** It locates the QUADS field via
  `startsWith(fieldnames(...), 'QUADS')` (cellstr startsWith — unsupported in
  numbl) and handles high-order gmsh quads. Our converter only emits 4-node
  quads, so `surfacemesh_from_quads.m` builds the 2x2 patches directly.
- **Canonical .msh only.** `load_gmsh_quads.m` assumes what
  `src/mesh/bridge.py` writes: MSH 2.2 ASCII, sequential 1-based node ids,
  type-3 elements, two tags. Uploaded .msh files in other layouts are fine —
  they pass through meshio and get rewritten canonically.
- **Solve-time errors are recoverable**: solver_session catches them and
  sends a `solveError` event; the uihtml session stays live for the next
  solve. Boot errors and dispatch-level interpreter errors are surfaced by
  the engine wrapper.
- **jsonencode collapses 1-element vectors to scalars.** Patch arrays are
  (p+1)^2 >= 9 long so it never bites here, but remember it when adding
  payload fields.
- Package caching: numbl/browser persists /system (mip + installed
  packages) in IndexedDB, wiped after 24 h of inactivity — first solve of a
  fresh day re-downloads ~28 MB. Delete the `numbl-embed-system` IndexedDB
  database to test cold boots.

## Testing

- `npm run engine-test` — full headless solve in Node against the local
  numbl build (dist-lib), including a quantitative eigenfunction check. It
  passes the mip search path explicitly, exercising the same
  searchPaths-scan behavior the numbl/browser session relies on. Downloads
  are cached in `.cache/` keyed by URL; delete the cache to test fresh
  installs.
- `python3 <venv>/bin/python` with meshio 5.3.5 can exercise
  `src/mesh/bridge.py` outside Pyodide (redirect its `/work` constant).
- Browser verification (Pyodide upload path, session boot, IndexedDB
  persistence across reloads, 3D view) is manual: `npm run dev`.
