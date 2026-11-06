"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-4 flex flex-col gap-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover",
    secondary: "border border-border bg-surface hover:bg-background",
    danger: "border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${styles} px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  const styles = {
    neutral: "bg-background text-muted border border-border",
    good: "bg-green-50 text-green-800 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
    warn: "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
    bad: "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
    accent: "bg-accent-soft text-accent border border-transparent",
  }[tone];
  return (
    <span className={`${styles} text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap`}>{children}</span>
  );
}

/** Empty state: what this space is for, and the next step if there is one. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 flex flex-col items-center text-center gap-2">
      <p className="font-medium">{title}</p>
      {children && <p className="text-sm text-muted max-w-sm">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Placeholder cards while a live query loads, so the layout doesn't jump. */
export function Loading({ rows = 2, grid = false }: { rows?: number; grid?: boolean }) {
  return (
    <div className={grid ? "grid gap-3 sm:grid-cols-2" : "flex flex-col gap-3"} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-border" />
          <div className="h-3 w-2/3 rounded bg-border" />
          <div className="h-3 w-1/2 rounded bg-border" />
        </div>
      ))}
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
      {message}
    </p>
  );
}

/* ---- toasts: a short confirmation after an action succeeds ---- */

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    setKey((k) => k + 1);
  }, []);
  useEffect(() => {
    if (!message) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [message, key]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 inset-x-0 flex justify-center px-4 pointer-events-none z-20">
        {message && (
          <div
            key={key}
            className="animate-toast-in rounded-lg bg-foreground text-background text-sm px-4 py-2 shadow-lg"
          >
            {message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Runs a mutation, tracks busy state, and turns failures into a readable line. Server rules
 * are the real gate; this only reports what the server said. A success message, if given,
 * shows as a toast.
 */
export function useAction() {
  const toast = useContext(ToastContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm focus:outline-2 focus:outline-offset-0 focus:outline-accent";
