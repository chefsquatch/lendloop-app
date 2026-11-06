import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { automationLine, categoryLabel, dateRange, errorMessage, relativeTime, statusLabel } from "./format";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

describe("relativeTime", () => {
  test("buckets", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2 days ago");
  });
  test("clock skew (future timestamp) reads as just now", () => {
    expect(relativeTime(NOW + 60_000, NOW)).toBe("just now");
  });
});

describe("automationLine", () => {
  test("sent reminder", () => {
    expect(automationLine({ kind: "overdue_reminder", status: "sent", attempts: 1, at: NOW - 2 * 86_400_000 }, NOW)).toBe(
      "Overdue reminder sent 2 days ago",
    );
  });
  test("failed notification shows attempts so failures are visible", () => {
    expect(automationLine({ kind: "loan_notification", status: "failed", attempts: 5, at: NOW }, NOW)).toBe(
      "Notification failed after 5 attempts (just now)",
    );
  });
  test("pending", () => {
    expect(automationLine({ kind: "loan_notification", status: "pending", attempts: 0, at: NOW }, NOW)).toBe("Notification queued");
    expect(automationLine({ kind: "loan_notification", status: "pending", attempts: 2, at: NOW }, NOW)).toBe(
      "Notification retrying (attempt 2)",
    );
  });
});

describe("errorMessage", () => {
  test("shows server rule messages", () => {
    expect(errorMessage(new ConvexError("You can only edit your own listings."))).toBe("You can only edit your own listings.");
  });
  test("hides unexpected internals", () => {
    expect(errorMessage(new Error("[CONVEX M(tools:update)] Server Error stack..."))).toBe("Something went wrong. Please try again.");
  });
});

test("labels", () => {
  expect(categoryLabel("power_tools")).toBe("Power tools");
  expect(statusLabel("approved", true)).toBe("Overdue");
  expect(statusLabel("requested", false)).toBe("Pending");
});

test("an approved loan reads Approved until its start date, then On loan", () => {
  expect(statusLabel("approved", false, "2026-11-12", "2026-11-06")).toBe("Approved");
  expect(statusLabel("approved", false, "2026-11-06", "2026-11-06")).toBe("On loan");
  expect(statusLabel("approved", false, "2026-11-01", "2026-11-06")).toBe("On loan");
});

describe("dateRange", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  test("one day reads as a single date", () => {
    expect(dateRange("2026-11-06", "2026-11-06", now)).toBe("Fri, Nov 6");
  });
  test("a range names both ends", () => {
    expect(dateRange("2026-11-06", "2026-11-08", now)).toBe("Fri, Nov 6 to Sun, Nov 8");
  });
  test("another year shows the year", () => {
    expect(dateRange("2027-01-02", "2027-01-03", now)).toBe("Sat, Jan 2, 2027 to Sun, Jan 3, 2027");
  });
});
