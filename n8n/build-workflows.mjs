// Builds the exported n8n workflow JSON (n8n/workflows/*.json) from the Code-node sources in
// n8n/code/, so the logic is reviewable + unit-tested as real files and the export never drifts.
//   node n8n/build-workflows.mjs          write the JSON
//   node n8n/build-workflows.mjs --check  exit 1 if the committed JSON is stale
// The JSON contains no secrets or credentials: Code nodes read $env at runtime.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFileSync(join(here, "code", name), "utf8").replace(/\r\n/g, "\n");
const signed = (name) => `${src("_hmac.js")}\n${src(name)}`;

export const IDS = { loanEvents: "LLloanEvents0001", overdue: "LLoverdueRemind1", errors: "LLerrorHandler01" };
export const WEBHOOK_PATH = "lendloop-loan-event";

const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };
const settings = (errorWorkflow) => ({
  executionOrder: "v1",
  saveManualExecutions: true,
  ...(errorWorkflow ? { errorWorkflow } : {}),
});
const code = (id, name, jsCode, position, extra = {}) => ({
  id, name, type: "n8n-nodes-base.code", typeVersion: 2, position, parameters: { jsCode }, ...extra,
});
const link = (...pairs) =>
  Object.fromEntries(pairs.map(([from, outputs]) => [from, { main: outputs.map((to) => (to ? [{ node: to, type: "main", index: 0 }] : [])) }]));
const signedPost = (id, name, position) => ({
  id, name, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position, ...RETRY,
  parameters: {
    method: "POST",
    url: "={{ $json.url }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "x-lendloop-timestamp", value: "={{ $json.timestamp }}" },
        { name: "x-lendloop-signature", value: "={{ $json.signature }}" },
      ],
    },
    sendBody: true,
    contentType: "raw",
    rawContentType: "application/json",
    body: "={{ $json.body }}",
    options: { timeout: 10000 },
  },
});
const respond = (id, name, status, body, position) => ({
  id, name, type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.4, position,
  parameters: { respondWith: "json", responseBody: JSON.stringify(body), options: { responseCode: status } },
});

export const workflows = {
  "lendloop-loan-events.json": {
    id: IDS.loanEvents,
    name: "LendLoop 1: loan event notifications",
    nodes: [
      {
        id: "a1000000-0000-4000-8000-000000000001", name: "Convex loan event", type: "n8n-nodes-base.webhook",
        typeVersion: 2.1, position: [0, 0], webhookId: "5d0f3c2e-1a7b-4c2e-9f3a-6c656e640001",
        parameters: { httpMethod: "POST", path: WEBHOOK_PATH, responseMode: "responseNode", options: { rawBody: true } },
      },
      code("a1000000-0000-4000-8000-000000000002", "Verify HMAC + dedupe", signed("verify-loan-event.js"), [220, 0]),
      {
        id: "a1000000-0000-4000-8000-000000000003", name: "Signature valid?", type: "n8n-nodes-base.if",
        typeVersion: 2.2, position: [440, 0],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
            conditions: [{
              id: "a1000000-0000-4000-8000-0000000000c1", leftValue: "={{ $json.valid }}", rightValue: "",
              operator: { type: "boolean", operation: "true", singleValue: true },
            }],
            combinator: "and",
          },
          options: {},
        },
      },
      code("a1000000-0000-4000-8000-000000000004", "Notify recipient (logged mock)", src("notify-recipient.js"), [660, -100], RETRY),
      respond("a1000000-0000-4000-8000-000000000005", "Respond 200", 200, { ok: true }, [880, -100]),
      respond("a1000000-0000-4000-8000-000000000006", "Respond 401", 401, { error: "unauthorized" }, [660, 100]),
    ],
    connections: link(
      ["Convex loan event", ["Verify HMAC + dedupe"]],
      ["Verify HMAC + dedupe", ["Signature valid?"]],
      ["Signature valid?", ["Notify recipient (logged mock)", "Respond 401"]],
      ["Notify recipient (logged mock)", ["Respond 200"]],
    ),
    settings: settings(IDS.errors),
  },
  "lendloop-overdue-reminders.json": {
    id: IDS.overdue,
    name: "LendLoop 2: daily overdue reminders",
    nodes: [
      {
        id: "b2000000-0000-4000-8000-000000000001", name: "Daily 08:00 UTC", type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2, position: [0, 0],
        parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 8 * * *" }] } },
      },
      {
        id: "b2000000-0000-4000-8000-000000000006", name: "Run now (manual)", type: "n8n-nodes-base.manualTrigger",
        typeVersion: 1, position: [0, 200], parameters: {},
      },
      code("b2000000-0000-4000-8000-000000000002", "Sign overdue query", signed("sign-overdue-query.js"), [220, 0]),
      signedPost("b2000000-0000-4000-8000-000000000003", "Fetch overdue loans (Convex)", [440, 0]),
      code("b2000000-0000-4000-8000-000000000004", "Remind borrowers (logged mock) + sign write-back", signed("send-reminders.js"), [660, 0]),
      signedPost("b2000000-0000-4000-8000-000000000005", "Write reminder status (Convex)", [880, 0]),
    ],
    connections: link(
      ["Daily 08:00 UTC", ["Sign overdue query"]],
      ["Run now (manual)", ["Sign overdue query"]],
      ["Sign overdue query", ["Fetch overdue loans (Convex)"]],
      ["Fetch overdue loans (Convex)", ["Remind borrowers (logged mock) + sign write-back"]],
      ["Remind borrowers (logged mock) + sign write-back", ["Write reminder status (Convex)"]],
    ),
    settings: settings(IDS.errors),
  },
  "lendloop-error-handler.json": {
    id: IDS.errors,
    name: "LendLoop: error handler",
    nodes: [
      {
        id: "c3000000-0000-4000-8000-000000000001", name: "On workflow error", type: "n8n-nodes-base.errorTrigger",
        typeVersion: 1, position: [0, 0], parameters: {},
      },
      code("c3000000-0000-4000-8000-000000000002", "Log failure", src("log-failure.js"), [220, 0]),
    ],
    connections: link(["On workflow error", ["Log failure"]]),
    settings: settings(null),
  },
};

const render = (wf) => `${JSON.stringify({ ...wf, active: false, pinData: {}, tags: [] }, null, 2)}\n`;

if (process.argv[1]?.endsWith("build-workflows.mjs")) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [file, wf] of Object.entries(workflows)) {
    const path = join(here, "workflows", file);
    const want = render(wf);
    if (check) {
      let have = "";
      try { have = readFileSync(path, "utf8").replace(/\r\n/g, "\n"); } catch {}
      if (have !== want) { console.error(`stale: n8n/workflows/${file}`); stale++; }
    } else {
      writeFileSync(path, want);
      console.log(`wrote n8n/workflows/${file}`);
    }
  }
  if (stale) process.exit(1);
}
export { render };
