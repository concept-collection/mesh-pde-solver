function result = solve_pde(mshfile, params)
%SOLVE_PDE  Load the quad mesh and solve the selected PDE on it.
%   params fields (from the host UI):
%     pde    - 'poisson' (lap u = f) or 'helmholtz' ((lap + c) u = f)
%     f      - right-hand side, a MATLAB expression in x, y, z
%     c      - zeroth-order coefficient expression (helmholtz only)
%     p      - polynomial order per patch
%     closed - true if every mesh edge is shared by exactly two quads
%              (determined host-side from the connectivity)

msh = load_gmsh_quads(mshfile);
dom = surfacemesh_from_quads(msh);
dom = resample(dom, params.p + 1);

fh = eval(['@(x, y, z) ', params.f]);
f = surfacefun(@(x, y, z) fh(x, y, z) + 0*x, dom);

pdo = [];
pdo.lap = 1;
isPoisson = strcmp(params.pde, 'poisson');
if ~isPoisson
    ch = eval(['@(x, y, z) ', params.c]);
    pdo.c = @(x, y, z) ch(x, y, z) + 0*x;
end

closed = params.closed;
if isPoisson && closed
    % The closed-surface Laplace-Beltrami problem is rank-deficient by one
    % and only solvable for mean-zero data; project the RHS accordingly.
    f = f - mean(f);
end

L = surfaceop(dom, pdo, f);
if closed
    if isPoisson
        L.rankdef = true;
    end
    u = L.solve();
else
    u = L.solve(0);   % zero Dirichlet boundary data on open surfaces
end

result = pack_solution(dom, u);
result.pde = params.pde;
end

function data = pack_solution(dom, u)
% One flat (column-major) x/y/z/u array per patch, each an n-by-n grid —
% the same layout surfacefun-interactive's figure app uses.
np = length(dom);
px = cell(1, np);
py = cell(1, np);
pz = cell(1, np);
pu = cell(1, np);
umin = inf;
umax = -inf;
for k = 1:np
    px{k} = real(dom.x{k}(:).');
    py{k} = real(dom.y{k}(:).');
    pz{k} = real(dom.z{k}(:).');
    vals = real(u.vals{k}(:).');
    pu{k} = vals;
    umin = min(umin, min(vals));
    umax = max(umax, max(vals));
end
data = struct();
data.type = 'solution';
data.n = size(dom.x{1}, 1);
data.npatches = np;
data.x = px;
data.y = py;
data.z = pz;
data.u = pu;
data.umin = umin;
data.umax = umax;
end
