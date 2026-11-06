// Error workflow: any failed LendLoop execution (after its node-level retries) lands here.
// Logged loudly so the failure is visible in `docker compose logs n8n` and in this
// workflow's execution list; swap for a Slack/email alert in production. No payload data
// is copied here, only where it failed.
const e = $input.first().json;
const failure = {
  workflow: e.workflow && e.workflow.name,
  executionId: e.execution && e.execution.id,
  executionUrl: e.execution && e.execution.url,
  node: e.execution && e.execution.lastNodeExecuted,
  message: e.execution && e.execution.error && e.execution.error.message,
  at: new Date().toISOString(),
};
console.error(`[lendloop] WORKFLOW FAILED ${JSON.stringify(failure)}`);
return [{ json: failure }];
