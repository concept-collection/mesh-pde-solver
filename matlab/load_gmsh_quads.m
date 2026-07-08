function msh = load_gmsh_quads(filename)
%LOAD_GMSH_QUADS  Minimal Gmsh MSH 2.2 ASCII reader for all-quad meshes.
%   Returns a struct with POS (n-by-3 node coordinates) and QUADS
%   (m-by-5: four 1-based node indices plus a tag), the layout that
%   surfacemesh.fromGmsh expects.
%
%   Only the canonical form written by this app's converter is supported:
%   sequential node ids starting at 1, and 4-node quadrangle elements
%   (type 3) with exactly two tags.

txt = fileread(filename);

block = extract_block(txt, '$Nodes', '$EndNodes');
vals = sscanf(block, '%f');
nn = vals(1);
if numel(vals) ~= 1 + 4*nn
    error('load_gmsh_quads:badNodes', 'Unexpected $Nodes layout.');
end
data = reshape(vals(2:end), 4, nn);
if any(data(1, :) ~= 1:nn)
    error('load_gmsh_quads:badNodes', 'Node ids must be sequential from 1.');
end
pos = data(2:4, :)';

block = extract_block(txt, '$Elements', '$EndElements');
vals = sscanf(block, '%f');
ne = vals(1);
% Each element line: id type(=3) ntags(=2) tag tag n1 n2 n3 n4
if numel(vals) ~= 1 + 9*ne
    error('load_gmsh_quads:badElements', ...
          'Expected only 4-node quadrangles with two tags.');
end
data = reshape(vals(2:end), 9, ne);
if any(data(2, :) ~= 3)
    error('load_gmsh_quads:badElements', ...
          'Expected only 4-node quadrangle elements (type 3).');
end
idx = data(6:9, :)';
if any(idx(:) < 1) || any(idx(:) > nn)
    error('load_gmsh_quads:badElements', 'Element node index out of range.');
end
quads = [idx, ones(ne, 1)];

msh = struct();
msh.POS = pos;
msh.QUADS = quads;
end

function block = extract_block(txt, startMarker, endMarker)
i1 = strfind(txt, startMarker);
i2 = strfind(txt, endMarker);
if isempty(i1) || isempty(i2)
    error('load_gmsh_quads:badFile', 'Missing %s section.', startMarker);
end
block = txt(i1(1) + length(startMarker) : i2(1) - 1);
end
