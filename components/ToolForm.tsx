"use client";

import { FormEvent, useState } from "react";
import {
  CATEGORIES,
  CONDITIONS,
  categoryLabel,
  conditionLabel,
  type Category,
  type Condition,
} from "@/lib/format";
import { Button, ErrorLine, inputClass, useAction } from "./ui";

export type ToolInput = { name: string; category: Category; condition: Condition; description: string };

export function ToolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  successMessage,
}: {
  initial?: ToolInput;
  submitLabel: string;
  onSubmit: (t: ToolInput) => Promise<unknown>;
  onCancel?: () => void;
  successMessage?: string;
}) {
  const [t, setT] = useState<ToolInput>(
    initial ?? { name: "", category: "hand_tools", condition: "good", description: "" },
  );
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => onSubmit(t), successMessage);
    if (ok && !initial) setT({ name: "", category: t.category, condition: "good", description: "" });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label className="text-sm text-muted flex flex-col gap-1">
        Name
        <input
          className={inputClass}
          value={t.name}
          maxLength={80}
          required
          onChange={(e) => setT({ ...t, name: e.target.value })}
        />
      </label>
      <div className="flex gap-2">
        <label className="text-sm text-muted flex-1 flex flex-col gap-1">
          Category
          <select
            className={inputClass}
            value={t.category}
            onChange={(e) => setT({ ...t, category: e.target.value as Category })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted flex-1 flex flex-col gap-1">
          Condition
          <select
            className={inputClass}
            value={t.condition}
            onChange={(e) => setT({ ...t, condition: e.target.value as Condition })}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {conditionLabel(c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-sm text-muted flex flex-col gap-1">
        Short description
        <textarea
          className={inputClass}
          rows={2}
          maxLength={500}
          required
          value={t.description}
          onChange={(e) => setT({ ...t, description: e.target.value })}
        />
      </label>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving..." : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
