"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, categoryLabel, conditionLabel, localIsoDate, type Category } from "@/lib/format";
import { Badge, Button, Card, Empty, ErrorLine, Loading, inputClass, useAction } from "./ui";

export function Browse({ isAdmin, onRequested }: { isAdmin: boolean; onRequested: () => void }) {
  const [category, setCategory] = useState<Category | "">("");
  const tools = useQuery(api.tools.listAll, category ? { category } : {});
  const remove = useMutation(api.tools.remove);
  const del = useAction();
  return (
    <div className="flex flex-col gap-4">
      <label className="text-sm text-muted flex items-center gap-2">
        Category
        <select
          className={inputClass.replace("w-full", "w-auto")}
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | "")}
        >
          <option value="">All</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </label>
      <ErrorLine message={del.error} />
      {tools === undefined ? (
        <Loading rows={4} grid />
      ) : tools.length === 0 ? (
        <Empty title={category ? "Nothing in this category yet" : "No tools listed yet"}>
          {category ? "Try another category, or list one of yours." : "List something from My listings to get the loop going."}
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <Card key={t._id}>
              <div className="flex justify-between items-start gap-2">
                <h3 className="font-semibold">{t.name}</h3>
                {t.available ? <Badge tone="good">Available</Badge> : <Badge tone="warn">Lent out</Badge>}
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge>{categoryLabel(t.category)}</Badge>
                <Badge>{conditionLabel(t.condition)}</Badge>
              </div>
              <p className="text-sm">{t.description}</p>
              <p className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
                Lent by {t.isMine ? "you" : t.ownerName}
                {t.ownerTrusted && <Badge tone="accent">Trusted Lender</Badge>}
              </p>
              {!t.isMine && <RequestForm toolId={t._id} onDone={onRequested} />}
              {isAdmin && !t.isMine && (
                <div>
                  <Button
                    variant="danger"
                    disabled={del.busy}
                    onClick={() => {
                      if (window.confirm(`Remove "${t.name}" as admin? Pending requests will be declined.`)) {
                        void del.run(() => remove({ toolId: t._id }), `Removed "${t.name}".`);
                      }
                    }}
                  >
                    Remove listing (admin)
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const today = localIsoDate();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const request = useMutation(api.loans.request);
  const { busy, error, run } = useAction();

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Request to borrow
        </Button>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => request({ toolId, startDate: start, endDate: end }), "Request sent. The owner has been notified.")) {
      setOpen(false);
      onDone();
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg bg-background p-3 border border-border">
      <div className="flex gap-2">
        <label className="text-xs flex-1">
          From
          <input
            type="date"
            className={inputClass}
            min={today}
            value={start}
            required
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="text-xs flex-1">
          To
          <input
            type="date"
            className={inputClass}
            min={start}
            value={end}
            required
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Sending..." : "Send request"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
