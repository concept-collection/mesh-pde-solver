// Headless validation of the solver engine — runs the same MATLAB project the
// browser worker runs, in Node, against the installed numbl. Bootstraps mip
// exactly like the worker does and lets `mip load --install surfacefun` in
// main.m fetch surfacefun/chebfun itself. Node has no synchronous
// XMLHttpRequest, so websave/webread are shimmed with curl (responses cached
// in .cache/ keyed by URL, so repeat runs are offline).
//
//   npm run engine-test

import {
  executeCode,
  VirtualFileSystem,
  BrowserFileIOAdapter,
  BrowserSystemAdapter,
} from 'numbl'
import {unzipSync} from 'fflate'
import {execFileSync} from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const cacheDir = path.join(root, '.cache')

const MIP_MHL_URL =
  'https://github.com/mip-org/mip-core/releases/download/mip-numbl/mip-numbl-any.mhl'
const MIP_SYSTEM_PREFIX = '/system/mip/packages/gh/mip-org/core/mip/'
// In the browser this is passed by numbl/browser's session worker; executeCode
// scans searchPaths directories since the same numbl change.
const MIP_SEARCH_PATH = MIP_SYSTEM_PREFIX + 'mip'

function curlCached(url) {
  fs.mkdirSync(cacheDir, {recursive: true})
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)
  const cached = path.join(cacheDir, key)
  if (!fs.existsSync(cached)) {
    console.log(`fetching ${url}`)
    execFileSync('curl', ['-sfL', '-o', cached, url], {stdio: 'inherit'})
  }
  return fs.readFileSync(cached)
}

// numbl's BrowserFileIOAdapter implements websave/webread with synchronous
// XHR (fine in a web worker, absent in Node); override with curl.
class NodeFileIOAdapter extends BrowserFileIOAdapter {
  constructor(vfs) {
    super(vfs)
    this.nodeVfs = vfs
  }
  websave(url, filename) {
    this.nodeVfs.writeFile(this.nodeVfs.normalizePath(filename), new Uint8Array(curlCached(url)))
  }
  webread(url) {
    return curlCached(url).toString('utf8')
  }
}

const readProjectFile = name =>
  fs.readFileSync(path.join(root, 'matlab', name), 'utf8')

async function main() {
  const vfs = new VirtualFileSystem()
  const enc = new TextEncoder()

  // Bootstrap mip into the system VFS, as the browser worker does.
  const mipEntries = unzipSync(new Uint8Array(curlCached(MIP_MHL_URL)))
  let nMip = 0
  for (const [name, content] of Object.entries(mipEntries)) {
    if (name.endsWith('/')) continue
    vfs.writeFile(MIP_SYSTEM_PREFIX + name, content)
    nMip++
  }
  console.log(`mip core: ${nMip} files into VFS`)

  const projectFiles = [
    'main.m',
    'solver_session.m',
    'solve_pde.m',
    'surfacemesh_from_quads.m',
    'load_gmsh_quads.m',
    'placeholder.html',
  ]
  for (const name of projectFiles) {
    vfs.writeFile(`/project/${name}`, enc.encode(readProjectFile(name)))
  }
  vfs.writeFile(
    '/project/mesh.msh',
    fs.readFileSync(path.join(root, 'public', 'samples', 'sphere.msh'))
  )
  vfs.clearChangeTracking()
  vfs.setCwd('/project')

  const events = []
  let compId = null

  console.log('running main.m (mip load --install surfacefun) ...')
  const t0 = Date.now()
  const result = executeCode(
    readProjectFile('main.m'),
    {
      onOutput: text => process.stdout.write(`[numbl] ${text}`),
      onDrawnow: () => {},
      displayResults: false,
      maxIterations: 1e9,
      optimization: '1',
      fileIO: new NodeFileIOAdapter(vfs),
      system: new BrowserSystemAdapter(vfs),
      onHtmlSourceEvent: (id, name, dataJson) =>
        events.push({name, data: JSON.parse(dataJson)}),
    },
    projectFiles
      .filter(n => n.endsWith('.m'))
      .map(n => ({name: n, source: readProjectFile(n)})),
    vfs.normalizePath('/project/main.m'),
    [MIP_SEARCH_PATH]
  )
  for (const pi of result.plotInstructions) {
    if (pi.type === 'uihtml') compId = pi.id
  }
  console.log(`boot: ${(Date.now() - t0) / 1000}s, uihtml comp = ${compId}`)
  const session = result.uihtmlSession
  if (!session || !compId) throw new Error('no live uihtml session after run')

  const solve = params => {
    events.length = 0
    const t = Date.now()
    session.dispatchEvent(compId, 'HTMLEventReceived', {
      name: 'solve',
      data: params,
    })
    const ev = events[events.length - 1]
    if (!ev) throw new Error('no event came back from solve')
    console.log(`solve [${params.pde}] -> '${ev.name}' in ${(Date.now() - t) / 1000}s`)
    return ev
  }

  // 1. Poisson on the closed sphere
  let ev = solve({pde: 'poisson', f: 'x.*y.*z', c: '', p: 6, closed: true})
  if (ev.name !== 'solution') throw new Error(`poisson failed: ${JSON.stringify(ev.data)}`)
  let d = ev.data
  console.log(`  npatches=${d.npatches} n=${d.n} u in [${d.umin.toFixed(6)}, ${d.umax.toFixed(6)}]`)
  if (d.npatches !== 216 || d.n !== 7) throw new Error('unexpected solution shape')
  if (!isFinite(d.umin) || !isFinite(d.umax) || d.umin === d.umax)
    throw new Error('degenerate solution values')

  // Eigenfunction check: x*y*z is a degree-3 solid harmonic, so on the unit
  // sphere lap_S (x*y*z) = -12 * (x*y*z). Solving with f = -12*x*y*z must
  // reproduce u = x*y*z, whose max on the sphere is 1/(3*sqrt(3)).
  ev = solve({pde: 'poisson', f: '-12*(x.*y.*z)', c: '', p: 8, closed: true})
  d = ev.data
  const expected = 1 / (3 * Math.sqrt(3))
  console.log(`  eigencheck: umax=${d.umax.toFixed(6)} expected~${expected.toFixed(6)}`)
  if (Math.abs(d.umax - expected) > 0.01) throw new Error('eigenfunction check failed')

  // 2. Helmholtz with a variable coefficient
  ev = solve({pde: 'helmholtz', f: '1 + 0*x', c: '100*(1 - z)', p: 6, closed: true})
  if (ev.name !== 'solution') throw new Error(`helmholtz failed: ${JSON.stringify(ev.data)}`)
  console.log(`  u in [${ev.data.umin.toFixed(6)}, ${ev.data.umax.toFixed(6)}]`)

  // 3. Bad expression surfaces as a solveError, session stays alive
  ev = solve({pde: 'poisson', f: 'this is not matlab', c: '', p: 4, closed: true})
  if (ev.name !== 'solveError') throw new Error('expected solveError for bad expression')
  console.log(`  error path OK: ${JSON.stringify(ev.data).slice(0, 100)}`)

  // 4. Session still works after an error
  ev = solve({pde: 'poisson', f: 'x', c: '', p: 4, closed: true})
  if (ev.name !== 'solution') throw new Error('session did not survive the error')

  console.log('engine-test: all checks passed')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
