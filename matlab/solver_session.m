function solver_session()
%SOLVER_SESSION  Open the uihtml event bridge and serve solve requests.
%   The figure is never rendered — the host intercepts the uihtml component
%   and speaks its event protocol directly (see src/engine/).

html = fileread('placeholder.html');
fig = figure;
uihtml(fig, 'HTMLSource', html, 'Data', struct('type', 'ready'), ...
       'HTMLEventReceivedFcn', @on_event);
end

function on_event(src, ev)
if ~strcmp(ev.HTMLEventName, 'solve')
    return
end
try
    result = solve_pde('mesh.msh', ev.HTMLEventData);
    sendEventToHTMLSource(src, 'solution', result);
catch err
    sendEventToHTMLSource(src, 'solveError', struct('message', err.message));
end
end
