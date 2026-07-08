% main.m — one solve, run standalone in a fresh numbl session each time.
% The host stages mesh.msh and params.json next to this script, runs it,
% and reads result.json back when it finishes. Installed packages persist
% across runs (IndexedDB in the browser), so only the first-ever run
% downloads surfacefun/chebfun.

mip load --install surfacefun;

params = jsondecode(fileread('params.json'));
result = solve_pde('mesh.msh', params);

fid = fopen('result.json', 'w');
fprintf(fid, '%s', jsonencode(result));
fclose(fid);
