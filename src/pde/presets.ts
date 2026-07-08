/**
 * The PDEs the app can solve and preset right-hand sides / coefficients.
 * Expressions are MATLAB, elementwise in the surface coordinates x, y, z;
 * they are pasted verbatim into the generated solver call (everything runs
 * client-side, so this is the user talking to their own interpreter).
 */

export interface ExprPreset {
  label: string
  expr: string
}

export interface PdeDef {
  id: 'poisson' | 'helmholtz'
  label: string
  equation: string
  note: string
  fPresets: ExprPreset[]
  cPresets: ExprPreset[] | null
}

export const PDES: PdeDef[] = [
  {
    id: 'poisson',
    label: 'Poisson (Laplace–Beltrami)',
    equation: 'Δu = f',
    note:
      'On a closed surface f is projected to mean zero and the mean-zero ' +
      'solution is returned; on an open surface, u = 0 on the boundary.',
    fPresets: [
      { label: 'x·y·z', expr: 'x.*y.*z' },
      { label: 'sin(3x)·cos(3y)', expr: 'sin(3*x).*cos(3*y)' },
      { label: 'tanh(5z)', expr: 'tanh(5*z)' },
      { label: 'x', expr: 'x' },
    ],
    cPresets: null,
  },
  {
    id: 'helmholtz',
    label: 'Helmholtz (variable coefficient)',
    equation: '(Δ + c)u = f',
    note:
      'c may vary over the surface. With c near an eigenvalue of −Δ the ' +
      'problem approaches singular and the solution blows up.',
    fPresets: [
      { label: 'Constant 1', expr: '1' },
      { label: 'x·y·z', expr: 'x.*y.*z' },
      { label: 'sin(3x)·cos(3y)', expr: 'sin(3*x).*cos(3*y)' },
    ],
    cPresets: [
      { label: '100·(1 − z)', expr: '100*(1 - z)' },
      { label: 'Constant 100', expr: '100' },
      { label: '50·(1 + x)', expr: '50*(1 + x)' },
    ],
  },
]

/** Above this many quads the in-browser solve becomes unreasonably slow. */
export const MAX_QUADS = 4000
/** Above this, warn that the solve may take a while. */
export const SLOW_QUADS = 1500

export const MIN_ORDER = 2
export const MAX_ORDER = 10
export const DEFAULT_ORDER = 6
