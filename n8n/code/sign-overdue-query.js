// Workflow 2, step 1: build the signed request for Convex's overdue-loans endpoint.
// POST with a body (not GET) so there is something to sign; `{}` = "today" by Convex's clock.
return [{ json: lendloopSignedRequest("/n8n/overdue-loans", {}) }];
