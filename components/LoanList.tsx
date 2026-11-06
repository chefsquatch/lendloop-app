"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { automationLine, dateRange, statusLabel } from "@/lib/format";
import { Badge, Button, Card, Empty, ErrorLine, Loading, useAction } from "./ui";

type Loan = FunctionReturnType<typeof api.loans.myRequests>[number];
type Perspective = "borrower" | "owner" | "admin";

/**
 * One list for My requests, Incoming requests and the admin view. `perspective` only decides
 * which buttons are offered; the server checks ownership on every action.
 */
export function LoanList({
  loans,
  perspective,
  empty,
}: {
  loans: Loan[] | undefined;
  perspective: Perspective;
  empty: { title: string; body?: string; action?: ReactNode };
}) {
  if (loans === undefined) return <Loading />;
  if (loans.length === 0)
    return (
      <Empty title={empty.title} action={empty.action}>
        {empty.body}
      </Empty>
    );
  return (
    <div className="flex flex-col gap-3">
      {loans.map((l) => (
        <LoanCard key={l._id} loan={l} perspective={perspective} />
      ))}
    </div>
  );
}

function LoanCard({ loan, perspective }: { loan: Loan; perspective: Perspective }) {
  const decide = useMutation(api.loans.decide);
  const markReturned = useMutation(api.loans.markReturned);
  const { busy, error, run } = useAction();
  const tone = loan.overdue
    ? "bad"
    : loan.status === "approved"
      ? "good"
      : loan.status === "requested"
        ? "warn"
        : "neutral";
  const who =
    perspective === "borrower"
      ? `from ${loan.ownerName}`
      : perspective === "owner"
        ? `to ${loan.borrowerName}`
        : `${loan.ownerName} to ${loan.borrowerName}`;

  return (
    <Card className={loan.overdue ? "border-red-300 dark:border-red-900" : ""}>
      <div className="flex justify-between items-start gap-2">
        <div>
          <h3 className="font-semibold">{loan.toolName}</h3>
          <p className="text-sm text-muted">{who}</p>
        </div>
        <Badge tone={tone}>{statusLabel(loan.status, loan.overdue, loan.startDate)}</Badge>
      </div>
      <p className="text-sm">{dateRange(loan.startDate, loan.endDate)}</p>
      {perspective === "owner" && loan.status === "requested" && (
        <div className="flex gap-2 pt-1">
          <Button
            disabled={busy}
            onClick={() =>
              void run(() => decide({ loanId: loan._id, approve: true }), `Approved. ${loan.borrowerName} will be notified.`)
            }
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(() => decide({ loanId: loan._id, approve: false }), `Declined. ${loan.borrowerName} will be notified.`)
            }
          >
            Decline
          </Button>
        </div>
      )}
      {perspective === "owner" && loan.status === "approved" && (
        <div className="pt-1">
          <Button
            disabled={busy}
            onClick={() => void run(() => markReturned({ loanId: loan._id }), `${loan.toolName} marked returned.`)}
          >
            Mark returned
          </Button>
        </div>
      )}
      <ErrorLine message={error} />
      {loan.automation.length > 0 && (
        <details className="text-xs text-muted border-t border-border pt-2 mt-1">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Automation activity ({loan.automation.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {loan.automation.map((e, i) => (
              <li key={i} className={e.status === "failed" ? "text-red-700 dark:text-red-400" : undefined}>
                {automationLine(e)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
