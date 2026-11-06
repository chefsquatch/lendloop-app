// @vitest-environment node
// Runs the Code-node JavaScript exactly as exported in n8n/workflows/*.json against
// Convex's own sign/verify (convex/lib/hmac.ts), so both directions of the HMAC contract
// are tested with the code that actually ships on each side.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { sign, verify } from "../convex/lib/hmac";

const require = createRequire(import.meta.url);
const SECRET = "test-secret-0123456789";
const ENV = { N8N_SIGNING_SECRET: SECRET, LENDLOOP_CONVEX_SITE_URL: "http://convex.test/" };
const dir = join(__dirname, "workflows");
const FILES = ["lendloop-loan-events.json", "lendloop-overdue-reminders.json", "lendloop-error-handler.json"];

type Node = { name: string; type: string; parameters: Record<string, unknown>; retryOnFail?: boolean };
type Workflow = { id: string; name: string; nodes: Node[]; settings: Record<string, unknown> };
const load = (file: string): Workflow => JSON.parse(readFileSync(join(dir, file), "utf8"));
const [loanEvents, overdue, errors] = FILES.map(load);
const jsOf = (wf: Workflow, name: string) => {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`no node ${name}`);
  return node.parameters.jsCode as string;
};

type Item = { json: Record<string, any>; binary?: Record<string, { data: string }> };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const quiet = { log: () => {}, error: () => {} };
async function runCode(js: string, items: Item[], staticData: Record<string, any> = {}): Promise<Item[]> {
  const fn = new AsyncFunction("$input", "$env", "$getWorkflowStaticData", "require", "console", js);
  const helpers = {
    getBinaryDataBuffer: async (i: number, prop: string) => Buffer.from(items[i].binary![prop].data, "base64"),
  };
  return fn.call(
    { helpers },
    { first: () => items[0], all: () => items },
    ENV,
    () => staticData,
    require,
    quiet,
  );
}

const event = {
  eventId: "loan:abc:approved",
  type: "loan.approved",
  loanId: "abc",
  toolName: "Drill",
  startDate: "2026-11-10",
  endDate: "2026-11-12",
  recipient: { firstName: "Ben", email: "ben@example.com" },
};
async function webhookItem(body: string, opts: { secret?: string; tsOffset?: number } = {}): Promise<Item> {
  const ts = Math.floor(Date.now() / 1000) + (opts.tsOffset ?? 0);
  return {
    json: {
      headers: {
        "x-lendloop-timestamp": String(ts),
        "x-lendloop-signature": await sign(opts.secret ?? SECRET, ts, body),
      },
    },
    binary: { data: { data: Buffer.from(body, "utf8").toString("base64") } },
  };
}

describe("exported workflow JSON", () => {
  test("is up to date with n8n/code sources", () => {
    expect(() => execFileSync("node", [join(__dirname, "build-workflows.mjs"), "--check"], { stdio: "pipe" })).not.toThrow();
  });

  test("holds no secrets or stored credentials; Code nodes read the secret from $env", () => {
    for (const file of FILES) {
      const raw = readFileSync(join(dir, file), "utf8");
      expect(raw).not.toMatch(/"credentials"\s*:/);
      expect(raw).not.toMatch(/[0-9a-f]{32,}/i); // no hex secret pasted in
    }
    expect(jsOf(loanEvents, "Verify HMAC + dedupe")).toContain("$env.N8N_SIGNING_SECRET");
  });

  test("both workflows route failures to the error workflow; Convex calls retry", () => {
    expect(loanEvents.settings.errorWorkflow).toBe(errors.id);
    expect(overdue.settings.errorWorkflow).toBe(errors.id);
    const posts = overdue.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest");
    expect(posts).toHaveLength(2);
    for (const n of posts) expect(n.retryOnFail).toBe(true);
  });
});

describe("workflow 1: verify HMAC + dedupe", () => {
  const js = jsOf(loanEvents, "Verify HMAC + dedupe");

  test("accepts an event signed by Convex's sign()", async () => {
    const [out] = await runCode(js, [await webhookItem(JSON.stringify(event))]);
    expect(out.json).toEqual({ valid: true, duplicate: false, event });
  });

  test("rejects a wrong secret, a tampered body, a stale timestamp and a missing raw body", async () => {
    const body = JSON.stringify(event);
    const wrong = await webhookItem(body, { secret: "not-the-secret" });
    expect((await runCode(js, [wrong]))[0].json).toEqual({ valid: false, reason: "bad signature" });

    const tampered = await webhookItem(body);
    tampered.binary!.data.data = Buffer.from(body.replace("ben@", "eve@")).toString("base64");
    expect((await runCode(js, [tampered]))[0].json).toEqual({ valid: false, reason: "bad signature" });

    const stale = await webhookItem(body, { tsOffset: -301 });
    expect((await runCode(js, [stale]))[0].json).toEqual({ valid: false, reason: "stale timestamp" });

    const noRaw = await webhookItem(body);
    delete noRaw.binary;
    expect((await runCode(js, [noRaw]))[0].json).toEqual({ valid: false, reason: "raw body unavailable" });
  });

  test("a redelivered event id is marked duplicate and not notified twice", async () => {
    const store = {};
    const body = JSON.stringify(event);
    const first = await runCode(js, [await webhookItem(body)], store);
    const second = await runCode(js, [await webhookItem(body)], store);
    expect(first[0].json.duplicate).toBe(false);
    expect(second[0].json.duplicate).toBe(true);

    const notify = jsOf(loanEvents, "Notify recipient (logged mock)");
    const [sent] = await runCode(notify, first);
    const [skipped] = await runCode(notify, second);
    expect(sent.json.notified).toBe(true);
    expect(sent.json.message.to).toBe("ben@example.com");
    expect(skipped.json).toEqual({ eventId: event.eventId, notified: false, reason: "duplicate delivery" });
  });
});

describe("workflow 2: signed calls to Convex", () => {
  test("the overdue query is signed so Convex's verify() accepts it", async () => {
    const [out] = await runCode(jsOf(overdue, "Sign overdue query"), [{ json: {} }]);
    expect(out.json.url).toBe("http://convex.test/n8n/overdue-loans");
    expect(await verify(SECRET, out.json.body, out.json.timestamp, out.json.signature)).toEqual({ ok: true });
    expect(await verify(SECRET, `${out.json.body} `, out.json.timestamp, out.json.signature)).toEqual({
      ok: false,
      reason: "bad signature",
    });
  });

  test("each overdue loan gets one signed write-back carrying only loanId, reminderKey, status", async () => {
    const response = {
      today: "2026-11-06",
      loans: [
        { loanId: "l1", toolName: "Drill", endDate: "2026-11-03", borrower: { firstName: "Ben", email: "b@x.io" }, reminderKey: "reminder:l1:2026-11-06" },
        { loanId: "l2", toolName: "Saw", endDate: "2026-11-01", borrower: { firstName: "Ana", email: "a@x.io" }, reminderKey: "reminder:l2:2026-11-06" },
      ],
    };
    const out = await runCode(jsOf(overdue, "Remind borrowers (logged mock) + sign write-back"), [{ json: response }]);
    expect(out).toHaveLength(2);
    for (const [i, item] of out.entries()) {
      expect(item.json.url).toBe("http://convex.test/n8n/reminder-status");
      expect(JSON.parse(item.json.body)).toEqual({
        loanId: response.loans[i].loanId,
        reminderKey: response.loans[i].reminderKey,
        status: "sent",
      });
      expect(await verify(SECRET, item.json.body, item.json.timestamp, item.json.signature)).toEqual({ ok: true });
    }
  });

  test("no overdue loans means no write-backs", async () => {
    const out = await runCode(jsOf(overdue, "Remind borrowers (logged mock) + sign write-back"), [
      { json: { today: "2026-11-06", loans: [] } },
    ]);
    expect(out).toEqual([]);
  });
});
