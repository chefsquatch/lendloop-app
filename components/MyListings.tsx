"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { categoryLabel, conditionLabel } from "@/lib/format";
import { ToolForm } from "./ToolForm";
import { Badge, Button, Card, Empty, ErrorLine, Loading, useAction } from "./ui";

export function MyListings() {
  const tools = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const del = useAction();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div>
          <h3 className="font-semibold">List a tool</h3>
          <p className="text-sm text-muted">Neighbors see the name, category, condition and description. Never your email.</p>
        </div>
        <ToolForm submitLabel="List tool" onSubmit={(t) => create(t)} successMessage="Listed. Neighbors can request it now." />
      </Card>
      <ErrorLine message={del.error} />
      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty title="You haven't listed anything yet">Use the form above. It takes about thirty seconds.</Empty>
      ) : (
        tools.map((t) =>
          editing === t._id ? (
            <Card key={t._id}>
              <ToolForm
                initial={{ name: t.name, category: t.category, condition: t.condition, description: t.description }}
                submitLabel="Save"
                successMessage="Saved."
                onSubmit={async (v) => {
                  await update({ toolId: t._id, ...v });
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            </Card>
          ) : (
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
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(t._id)}>
                  Edit
                </Button>
                <Button
                  variant="danger"
                  disabled={del.busy}
                  onClick={() => {
                    if (window.confirm(`Remove "${t.name}"? Pending requests for it will be declined.`)) {
                      void del.run(() => remove({ toolId: t._id }), `Removed "${t.name}".`);
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ),
        )
      )}
    </div>
  );
}
