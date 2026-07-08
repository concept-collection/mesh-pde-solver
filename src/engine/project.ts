/** The MATLAB project the solver worker runs, bundled as raw text. */

import main from '../../matlab/main.m?raw'
import solverSession from '../../matlab/solver_session.m?raw'
import solvePde from '../../matlab/solve_pde.m?raw'
import surfacemeshFromQuads from '../../matlab/surfacemesh_from_quads.m?raw'
import loadGmshQuads from '../../matlab/load_gmsh_quads.m?raw'
import placeholder from '../../matlab/placeholder.html?raw'

export interface ProjectFile {
  path: string
  text: string
}

export const PROJECT_FILES: ProjectFile[] = [
  { path: 'main.m', text: main },
  { path: 'solver_session.m', text: solverSession },
  { path: 'solve_pde.m', text: solvePde },
  { path: 'surfacemesh_from_quads.m', text: surfacemeshFromQuads },
  { path: 'load_gmsh_quads.m', text: loadGmshQuads },
  { path: 'placeholder.html', text: placeholder },
]

export const MAIN_FILE = 'main.m'
