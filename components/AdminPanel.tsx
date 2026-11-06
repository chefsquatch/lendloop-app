"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanList } from "./LoanList";
import { Badge, Button, Card, ErrorLine, Loading, useAction } from "./ui";

/** Shown only to admins; every query and mutation here also runs requireAdmin on the server. */
export function AdminPanel() {
  const users = useQuery(api.admin.listUsers);
  const loans = useQuery(api.loans.adminAll);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">People</h3>
        <ErrorLine message={error} />
        {users === undefined ? (
          <Loading rows={1} />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {users.map((u) => (
                <li key={u._id} className="py-2 flex items-center justify-between gap-2">
                  <span className="flex gap-2 items-center flex-wrap">
                    {u.name}
                    {u.role === "admin" && <Badge>Admin</Badge>}
                    {u.trustedLender && <Badge tone="accent">Trusted Lender</Badge>}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setTrusted({ userId: u._id, trusted: !u.trustedLender }),
                        u.trustedLender ? `${u.name} is no longer a Trusted Lender.` : `${u.name} is now a Trusted Lender.`,
                      )
                    }
                  >
                    {u.trustedLender ? "Remove trust" : "Mark trusted"}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">All loans</h3>
        <p className="text-xs text-muted">To remove any listing, use the remove button on its card in All tools.</p>
        <LoanList loans={loans} perspective="admin" empty={{ title: "No loans yet" }} />
      </section>
    </div>
  );
}
