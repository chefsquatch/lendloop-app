/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { sign, verify, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./lib/hmac";
import { todayIso } from "./lib/dates";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "test-signing-secret";

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

async function setup() {
  const t = convexTest(schema, modules);
  const as = (sub: string, email: string, name: string) =>
    t.withIdentity({ subject: sub, tokenIdentifier: `clerk|${sub}`, email, name });
  const alice = as("alice", "alice@example.com", "Alice Owner");
  const bob = as("bob", "bob@example.com", "Bob Borrower");
  const carol = as("carol", "carol@example.com", "Carol Other");
  const admin = as("admin", "admin@example.com", "Ada Admin");
  for (const u of [alice, bob, carol, admin]) await u.mutation(api.users.store, {});
  const drill = await alice.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V with two batteries",
  });
  return { t, alice, bob, carol, admin, drill };
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.stubEnv("N8N_SIGNING_SECRET", SECRET);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("public page data minimization", () => {
  test("signed-out list shows only name and category", async () => {
    const { t } = await setup();
    const list = await t.query(api.tools.listPublic, {});
    expect(list).toEqual([{ name: "Cordless drill", category: "power_tools" }]);
  });

  test("signed-out callers are refused everywhere else", async () => {
    const { t, drill } = await setup();
    await expect(t.query(api.tools.listAll, {})).rejects.toThrow(/Sign in/);
    await expect(t.mutation(api.loans.request, { toolId: drill, startDate: todayIso(), endDate: todayIso() })).rejects.toThrow(/Sign in/);
  });
});

describe("roles enforced in Convex functions", () => {
  test("ADMIN_EMAILS bootstrap gives admin; everyone else is a user", async () => {
    const { admin, bob } = await setup();
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
    expect((await bob.query(api.users.me, {}))?.role).toBe("user");
  });

  test("a user cannot edit or remove someone else's listing", async () => {
    const { bob, drill } = await setup();
    await expect(
      bob.mutation(api.tools.update, { toolId: drill, name: "mine now", category: "garden", condition: "worn", description: "x" }),
    ).rejects.toThrow(/own listings/);
    await expect(bob.mutation(api.tools.remove, { toolId: drill })).rejects.toThrow(/own listings/);
  });

  test("admin can remove any listing, view all loans, and mark a trusted lender", async () => {
    const { t, admin, alice, bob, drill } = await setup();
    await bob.mutation(api.loans.request, { toolId: drill, startDate: todayIso(), endDate: todayIso() });
    expect(await admin.query(api.loans.adminAll, {})).toHaveLength(1);
    const users = await admin.query(api.admin.listUsers, {});
    const aliceId = users.find((u) => u.name === "Alice Owner")!._id;
    await admin.mutation(api.admin.setTrustedLender, { userId: aliceId, trusted: true });
    expect((await alice.query(api.users.me, {}))?.trustedLender).toBe(true);
    await admin.mutation(api.tools.remove, { toolId: drill });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });

  test("admin-only functions refuse a plain user", async () => {
    const { bob } = await setup();
    await expect(bob.query(api.loans.adminAll, {})).rejects.toThrow(/Admins only/);
    await expect(bob.query(api.admin.listUsers, {})).rejects.toThrow(/Admins only/);
  });

  test("only the owner decides a request; a third party cannot approve it", async () => {
    const { alice, bob, carol, drill } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId: drill, startDate: todayIso(), endDate: todayIso() });
    await expect(carol.mutation(api.loans.decide, { loanId, approve: true })).rejects.toThrow(/owner/);
    await expect(bob.mutation(api.loans.decide, { loanId, approve: true })).rejects.toThrow(/owner/);
    await alice.mutation(api.loans.decide, { loanId, approve: true });
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("approved");
  });

  test("you cannot borrow your own tool", async () => {
    const { alice, drill } = await setup();
    await expect(alice.mutation(api.loans.request, { toolId: drill, startDate: todayIso(), endDate: todayIso() })).rejects.toThrow(/own tool/);
  });
});

describe("loan rules", () => {
  test("overlapping approved dates are refused; returned frees the tool", async () => {
    const { alice, bob, carol, drill } = await setup();
    const today = todayIso();
    const loanId = await bob.mutation(api.loans.request, { toolId: drill, startDate: today, endDate: addDays(today, 2) });
    await alice.mutation(api.loans.decide, { loanId, approve: true });
    expect((await carol.query(api.tools.listAll, {}))[0].available).toBe(false);
    await expect(
      carol.mutation(api.loans.request, { toolId: drill, startDate: addDays(today, 1), endDate: addDays(today, 3) }),
    ).rejects.toThrow(/already lent out/);
    await alice.mutation(api.loans.markReturned, { loanId });
    expect((await carol.query(api.tools.listAll, {}))[0].available).toBe(true);
  });

  test("past start dates and reversed ranges are refused", async () => {
    const { bob, drill } = await setup();
    const today = todayIso();
    await expect(bob.mutation(api.loans.request, { toolId: drill, startDate: addDays(today, -1), endDate: today })).rejects.toThrow(/past/);
    await expect(bob.mutation(api.loans.request, { toolId: drill, startDate: addDays(today, 2), endDate: today })).rejects.toThrow(/on or after/);
  });
});

describe("HMAC signing", () => {
  test("valid signature passes; tampered body, wrong secret and stale timestamp fail", async () => {
    const now = 1_800_000_000;
    const body = '{"a":1}';
    const sig = await sign(SECRET, now, body);
    expect(await verify(SECRET, body, String(now), sig, now)).toEqual({ ok: true });
    expect((await verify(SECRET, '{"a":2}', String(now), sig, now)).ok).toBe(false);
    expect((await verify("other", body, String(now), sig, now)).ok).toBe(false);
    expect(await verify(SECRET, body, String(now - 301), await sign(SECRET, now - 301, body), now)).toEqual({ ok: false, reason: "stale timestamp" });
    expect(await verify(undefined, body, String(now), sig, now)).toEqual({ ok: false, reason: "secret not configured" });
  });
});

async function signedPost(t: ReturnType<typeof convexTest>, path: string, payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  return t.fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: await sign(secret, ts, body) },
    body,
  });
}

describe("n8n endpoints", () => {
  async function overdueSetup() {
    const s = await setup();
    const today = todayIso();
    const loanId = await s.bob.mutation(api.loans.request, { toolId: s.drill, startDate: today, endDate: today });
    await s.alice.mutation(api.loans.decide, { loanId, approve: true });
    return { ...s, loanId, tomorrow: addDays(today, 1) };
  }

  test("unsigned or wrongly signed requests get 401", async () => {
    const { t } = await setup();
    const unsigned = await t.fetch("/n8n/overdue-loans", { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    expect((await signedPost(t, "/n8n/overdue-loans", {}, "wrong-secret")).status).toBe(401);
  });

  test("overdue endpoint returns only what a reminder needs", async () => {
    const { t, tomorrow, loanId } = await overdueSetup();
    const res = await signedPost(t, "/n8n/overdue-loans", { today: tomorrow });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.loans).toEqual([
      {
        loanId,
        toolName: "Cordless drill",
        endDate: todayIso(),
        borrower: { firstName: "Bob", email: "bob@example.com" },
        reminderKey: `reminder:${loanId}:${tomorrow}`,
      },
    ]);
  });

  test("reminder write-back is idempotent: a retry never creates a duplicate", async () => {
    const { t, alice, loanId, tomorrow } = await overdueSetup();
    const reminderKey = `reminder:${loanId}:${tomorrow}`;
    const first = await signedPost(t, "/n8n/reminder-status", { loanId, reminderKey, status: "sent" });
    expect(await first.json()).toEqual({ ok: true, duplicate: false });
    const retry = await signedPost(t, "/n8n/reminder-status", { loanId, reminderKey, status: "sent" });
    expect(await retry.json()).toEqual({ ok: true, duplicate: true });
    // A late failure report does not overwrite the recorded success.
    await signedPost(t, "/n8n/reminder-status", { loanId, reminderKey, status: "failed", detail: "smtp timeout" });
    const reminders = (await alice.query(api.loans.incoming, {}))[0].automation.filter((a) => a.kind === "overdue_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].status).toBe("sent");
  });

  test("a reminderKey for a different loan is rejected", async () => {
    const { t, loanId } = await overdueSetup();
    const res = await signedPost(t, "/n8n/reminder-status", { loanId, reminderKey: "reminder:someoneelse:2026-01-01", status: "sent" });
    expect(res.status).toBe(404);
  });
});

describe("outbound loan notifications", () => {
  test("each status change queues exactly one signed notification, delivered once", async () => {
    vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", "https://n8n.example/webhook/loan-events");
    const calls: { headers: Headers; body: string }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response("ok", { status: 200 });
    });
    const { t, alice, bob, drill } = await setup();
    const loanId = await bob.mutation(api.loans.request, { toolId: drill, startDate: todayIso(), endDate: todayIso() });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].body);
    // New request -> the owner is notified; nobody else's email is in the payload.
    expect(payload.recipient).toEqual({ firstName: "Alice", email: "alice@example.com" });
    expect(calls[0].body).not.toContain("bob@example.com");
    const ok = await verify(SECRET, calls[0].body, calls[0].headers.get(TIMESTAMP_HEADER), calls[0].headers.get(SIGNATURE_HEADER));
    expect(ok).toEqual({ ok: true });

    // Re-running delivery for an already-sent event sends nothing.
    await t.action(internal.notify.deliverLoanEvent, { idempotencyKey: `loan:${loanId}:requested` });
    expect(calls).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  test("failed deliveries retry, then stop at 5 attempts and show as failed", async () => {
    vi.stubEnv("N8N_LOAN_EVENT_WEBHOOK_URL", "https://n8n.example/webhook/loan-events");
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response("down", { status: 503 });
    });
    const { t, bob, drill } = await setup();
    await bob.mutation(api.loans.request, { toolId: drill, startDate: todayIso(), endDate: todayIso() });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(n).toBe(5);
    const mine = await bob.query(api.loans.myRequests, {});
    expect(mine[0].automation[0]).toMatchObject({ kind: "loan_notification", status: "failed", attempts: 5 });
    vi.unstubAllGlobals();
  });
});
