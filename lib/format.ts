import { ConvexError } from "convex/values";
import { CATEGORIES } from "../convex/schema";

export type Category = (typeof CATEGORIES)[number];
export type Condition = "new" | "good" | "fair" | "worn";
export type LoanStatus = "requested" | "approved" | "declined" | "returned";

export { CATEGORIES };
export const CONDITIONS: readonly Condition[] = ["new", "good", "fair", "worn"];

const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export function categoryLabel(c: Category): string {
  return CATEGORY_LABELS[c];
}

export function conditionLabel(c: Condition): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/**
 * The server's rule messages (ConvexError with a string) are written for people, so show
 * them as-is. Anything else is an unexpected failure: show a generic line, never internals.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError && typeof e.data === "string") return e.data;
  return "Something went wrong. Please try again.";
}

/** "just now", "5 minutes ago", "2 days ago". */
export function relativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "just now";
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "1 minute ago";
}

export type AutomationEvent = {
  kind: "loan_notification" | "overdue_reminder";
  status: "pending" | "sent" | "failed";
  attempts: number;
  at: number;
};

/** One line per automation run, for the per-loan activity list. */
export function automationLine(e: AutomationEvent, now: number = Date.now()): string {
  const what = e.kind === "overdue_reminder" ? "Overdue reminder" : "Notification";
  const when = relativeTime(e.at, now);
  if (e.status === "sent") return `${what} sent ${when}`;
  if (e.status === "failed") return `${what} failed after ${e.attempts} attempt${e.attempts === 1 ? "" : "s"} (${when})`;
  return e.attempts > 0 ? `${what} retrying (attempt ${e.attempts})` : `${what} queued`;
}

/** Badge text for a loan. An approved loan whose start date is still ahead reads "Approved", not "On loan". */
export function statusLabel(
  status: LoanStatus,
  overdue: boolean,
  startDate?: string,
  today: string = localIsoDate(),
): string {
  if (overdue) return "Overdue";
  if (status === "approved" && startDate && startDate > today) return "Approved";
  return { requested: "Pending", approved: "On loan", declined: "Declined", returned: "Returned" }[status];
}

/** Local calendar date as YYYY-MM-DD, for date inputs. */
export function localIsoDate(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "Fri, Nov 6" for one day, "Fri, Nov 6 to Sun, Nov 8" for a range; the year only when it isn't this year. */
export function dateRange(start: string, end: string, now: Date = new Date()): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
      ...(d.getUTCFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    });
  };
  return start === end ? fmt(start) : `${fmt(start)} to ${fmt(end)}`;
}
