function result = solve_pde(mshfile, params)
%SOLVE_PDE  Load the surface mesh and solve the selected PDE on it.
%   params fields (from the host UI):
%     pde    - 'poisson' (lap u = f) or 'helmholtz' ((lap + c) u = f)
%     f      - right-hand side, a MATLAB expression in x, y, z
%     c      - zeroth-order coefficient expression (helmholtz only)
%     p      - polynomial order per patch
%     closed - true if every mesh edge is shared by exactly two cells
%              (determined host-side from the connectivity)

dom = surfacemesh.import(mshfile, 'gmsh');
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
% One flat x/y/z/u array per patch: a column-major n-by-n grid for quad
% patches (the layout surfacefun-interactive's figure app uses), or the
% n*(n+1)/2-point trianglepts(n) set for triangle patches. data.n is the
% number of points per patch edge in both cases.
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
if ( dom.ptype(1) == surfacemesh.patchtype.tri )
    npts = length(dom.x{1});
    data.n = round((sqrt(8*npts + 1) - 1) / 2);
    data.ptype = 'tri';
else
    data.n = size(dom.x{1}, 1);
    data.ptype = 'quad';
end
data.npatches = np;
data.x = px;
data.y = py;
data.z = pz;
data.u = pu;
data.umin = umin;
data.umax = umax;
end
