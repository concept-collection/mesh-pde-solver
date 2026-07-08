# CLAUDE.md

Tips for future agents working in this repo.

## Architecture

```
matlab/            the MATLAB project each solve runs standalone
  main.m           `mip load --install surfacefun` -> jsondecode params.json
                   -> solve_pde('mesh.msh', params) -> write result.json
  solve_pde.m      surfacemesh.import -> resample -> surfaceop -> per-patch data
src/mesh/          Pyodide + meshio upload pipeline (bridge.py runs in Pyodide)
src/engine/        run-per-solve wrapper over numbl/browser's
                   createNumblSession: solve() boots a fresh session with
                   mesh.msh + params.json staged, reads result.json back via
                   session.readFile, and disposes the worker. numbl owns the
                   worker, VFS, mip bootstrap, and IndexedDB package
                   persistence; prewarm() at page load triggers the one-time
                   package download.
src/pde/presets.ts PDE definitions, presets, size limits
src/render/        three.js SurfaceView (mesh preview / solution) + parula
scripts/engine-test.mjs  headless Node check of the whole MATLAB pipeline
```

## Key gotchas

- **numbl >= 0.4.11 from npm.** Needs `NumblSession.readFile` (0.4.10) plus
  enumeration-class support and the 1×1-tensor broadcast-assignment fix
  (0.4.11 — surfacefun's `surfacemesh.patchtype` / `dealm` idiom depend on
  both). To develop against a local numbl checkout, point package.json at
  `file:../../numbl` and run `npm run build:lib && npm run build:browser`
  there after source changes; when switching back to a `^` range,
  `rm -rf node_modules package-lock.json && npm install` (else `npm ci` fails
  on the stale `file:` link).
- **surfacemesh.import needs MSH 4.1.** surfacefun's gmsh reader
  (`+surfacemesh/+import/gmsh.m`) parses MSH 4.1 node-entity blocks, not
  2.2. `src/mesh/bridge.py` and `scripts/make_samples.py` both write the
  canonical 4.1 form (one surface entity block, sequential 1-based ids,
  type-3 quads). Uploaded .msh files in other layouts pass through meshio
  and get rewritten to 4.1.
- **Solve errors reject the solve() promise** with the MATLAB error message
  (a failed script run is a numbl bootError). Each solve is a fresh session,
  so nothing needs to stay alive across failures.
- **jsonencode collapses 1-element vectors to scalars.** Patch arrays are
  (p+1)^2 >= 9 long so it never bites here, but remember it when adding
  payload fields.
- Package caching: numbl/browser persists /system (mip + installed
  packages) in IndexedDB, wiped after 30 min of inactivity (numbl's default;
  lowered from 24 h so a rebuilt surfacefun package refreshes without a manual
  clear) — the prewarm session at page load re-downloads ~28 MB after a wipe;
  solves after that only pay a per-run `mip load` (~1 s). Delete the
  `numbl-embed-system` IndexedDB database to force a cold boot.

## Testing

- `npm run engine-test` — full headless solve in Node against the local
  numbl build (dist-lib), including a quantitative eigenfunction check. It
  runs matlab/main.m standalone per solve (as the browser does), sharing
  one VFS across solves as the stand-in for IndexedDB persistence, and
  passes the mip search path explicitly, exercising the same
  searchPaths-scan behavior the numbl/browser session relies on. Downloads
  are cached in `.cache/` keyed by URL; delete the cache to test fresh
  installs.
- `python3 <venv>/bin/python` with meshio 5.3.5 can exercise
  `src/mesh/bridge.py` outside Pyodide (redirect its `/work` constant).
- Browser verification (Pyodide upload path, session boot, IndexedDB
  persistence across reloads, 3D view) is manual: `npm run dev`.
