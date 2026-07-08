function dom = surfacemesh_from_quads(msh)
%SURFACEMESH_FROM_QUADS  Build a surfacemesh from a 4-node quad msh struct.
%   Adapted from surfacemesh.fromGmsh (surfacefun): that version locates a
%   QUADS* field via startsWith over fieldnames — which numbl's startsWith
%   does not support for cell arrays — and handles high-order gmsh quads.
%   Our converter only ever emits plain 4-node quads (Gmsh corner order
%   1-2-3-4 counterclockwise), where the equispaced and Chebyshev 2-point
%   grids coincide, so each patch is just its corner values arranged as a
%   2-by-2 tensor grid.

quads = msh.QUADS;
nelem = size(quads, 1);
x = cell(nelem, 1);
y = cell(nelem, 1);
z = cell(nelem, 1);

for k = 1:nelem
    idx = quads(k, 1:4);
    px = msh.POS(idx, 1);
    py = msh.POS(idx, 2);
    pz = msh.POS(idx, 3);
    % Gmsh corners 1,2,3,4 -> tensor grid (1,1),(2,1),(2,2),(1,2)
    x{k} = [px(1) px(4); px(2) px(3)];
    y{k} = [py(1) py(4); py(2) py(3)];
    z{k} = [pz(1) pz(4); pz(2) pz(3)];
end

dom = surfacemesh(x, y, z);
end
