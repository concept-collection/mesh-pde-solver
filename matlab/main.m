% main.m — persistent solver session for mesh-pde-solver.
%
% Runs once inside a numbl/browser managed session, which bootstraps the mip
% package manager (and puts it on the path) before this script starts. mip
% fetches surfacefun and its chebfun dependency on first use; the session
% persists installed packages across page loads. The script then opens a
% placeholder uihtml figure purely as an event bridge: the host writes
% mesh.msh into the VFS and dispatches 'solve' events with the PDE
% parameters; solver_session solves and sends back per-patch data.

mip load --install surfacefun;

solver_session();
