# LendLoop automation (n8n)

Three workflows, exported in `workflows/` with no secrets or credentials in them:

| Workflow | Trigger | What it does |
|---|---|---|
| **1: loan event notifications** | Webhook `POST /webhook/lendloop-loan-event`, called by Convex (`convex/notify.ts`) when a request is created, approved, declined or returned | Verifies the HMAC over the raw body (300 s replay window), drops redelivered event ids, notifies the one person concerned (logged mock email), answers 200. Bad signature = 401, which Convex records as a failed attempt. |
| **2: daily overdue reminders** | Schedule, 08:00 UTC daily (plus "Run now (manual)") | Signed `POST /n8n/overdue-loans` to Convex, one reminder per overdue loan (logged mock), signed `POST /n8n/reminder-status` write-back per loan. |
| **error handler** | Error Trigger | Set as the error workflow on 1 and 2. Logs which workflow/node failed and the execution id (no payload data). |

## Run it

```bash
cp n8n/.env.example n8n/.env        # set N8N_SIGNING_SECRET
npx convex env set N8N_SIGNING_SECRET <same value>
npx convex env set N8N_LOAN_EVENT_WEBHOOK_URL http://localhost:5678/webhook/lendloop-loan-event
npm run n8n:up                      # docker compose, n8n 2.46.6, UI on http://localhost:5678
npm run n8n:import                  # import + publish the 3 workflows, restart n8n
```

The Convex dev backend on the host is reached at `http://host.docker.internal:3211`
(override with `LENDLOOP_CONVEX_SITE_URL` in `n8n/.env`, e.g. a `https://<deployment>.convex.site` URL).
To run workflow 2 now: open it in the n8n UI and execute, or with n8n stopped
`docker compose -f n8n/docker-compose.yml run --rm n8n execute --id=LLoverdueRemind1`.

## Editing the workflows

The Code-node JavaScript lives in `code/` and `build-workflows.mjs` assembles the JSON
(`npm run n8n:build`). `_hmac.js` is prepended to every node that signs or verifies, so the
scheme exists once on the n8n side. `workflows.test.ts` runs the exported nodes' code against
Convex's own `sign`/`verify` (`convex/lib/hmac.ts`) and fails if the JSON is stale.
If you edit a workflow in the n8n UI instead, export it back over the file and move the code into `code/`.

## Security and reliability decisions

- **HMAC both ways.** `hex(HMAC-SHA256(secret, "<unix seconds>.<raw body>"))` in
  `x-lendloop-signature` + `x-lendloop-timestamp`, 300 s window, constant-time compare.
  The webhook keeps the raw body (Webhook option *Raw Body*) because re-serialising parsed
  JSON can change bytes; no raw body = reject.
- **Secrets only in env.** `n8n/.env` (gitignored) feeds the container; Code nodes read
  `$env.N8N_SIGNING_SECRET`. n8n 2.x blocks `$env` by default, so compose opts in with
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. That is a deliberate trade-off: anyone who can edit
  workflows can read the container env. For a multi-user n8n, put the secret in an n8n
  credential (Crypto node) instead.
- **Idempotency.** Convex retries delivery with backoff (5 attempts, then `failed`, visible per
  loan in the UI). n8n remembers event ids for 7 days, so a retry after a slow success is
  acknowledged, not re-sent. Reminder write-backs are keyed `reminder:<loanId>:<day>`; Convex
  updates the same row on retry, and a late `failed` never overwrites a `sent`.
- **Retries + visible failures.** Both Convex calls in workflow 2 retry 3x (5 s apart); a
  failure after that fires the error handler (`docker compose logs n8n`, execution list).
- **Data minimization.** Payloads carry first name, email, tool name and dates for the one
  recipient, nothing else. n8n prunes execution history after 7 days. Port 5678 binds to
  loopback only; production goes behind a TLS reverse proxy.
