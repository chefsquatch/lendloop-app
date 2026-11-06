"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/lib/format";
import { Badge, Empty, Loading } from "./ui";

/** Signed-out view: name + category only. The query itself returns nothing else. */
export function PublicTools() {
  const tools = useQuery(api.tools.listPublic);
  if (tools === undefined) return <Loading rows={4} grid />;
  if (tools.length === 0)
    return <Empty title="Nothing listed yet">Sign in and be the first to lend a tool.</Empty>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {tools.map((t, i) => (
        <li
          key={i}
          className="rounded-xl border border-border bg-surface px-4 py-3 flex justify-between items-center gap-4"
        >
          <span className="font-medium">{t.name}</span>
          <Badge>{categoryLabel(t.category)}</Badge>
        </li>
      ))}
    </ul>
  );
}
