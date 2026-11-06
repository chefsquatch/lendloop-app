"use client";

import { useState } from "react";
import { AuthLoading, Authenticated, Unauthenticated, useQuery } from "convex/react";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { PublicTools } from "@/components/PublicTools";
import { Browse } from "@/components/Browse";
import { MyListings } from "@/components/MyListings";
import { LoanList } from "@/components/LoanList";
import { AdminPanel } from "@/components/AdminPanel";
import { LogoMark } from "@/components/Logo";
import { useStoreUser } from "@/components/useStoreUser";
import { Button, Loading, ToastProvider } from "@/components/ui";

export default function Home() {
  return (
    <ToastProvider>
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <div>
              <h1 className="text-lg font-semibold leading-tight">LendLoop</h1>
              <p className="text-xs text-muted">Borrow what you need. Lend what you don&apos;t.</p>
            </div>
          </div>
          <Authenticated>
            <UserButton />
          </Authenticated>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-6">
        <AuthLoading>
          <Loading rows={4} grid />
        </AuthLoading>
        <Unauthenticated>
          <SignedOut />
        </Unauthenticated>
        <Authenticated>
          <SignedIn />
        </Authenticated>
      </main>
    </ToastProvider>
  );
}

const STEPS = [
  { title: "List a tool", body: "Add the drill or ladder sitting in your garage, with its condition." },
  { title: "Request dates", body: "Neighbors pick the days they need it. No double bookings." },
  { title: "Approve and return", body: "You decide who borrows. Everyone gets notified along the way." },
];

function SignedOut() {
  return (
    <>
      <section className="rounded-2xl bg-accent-soft px-6 py-8 sm:px-8 flex flex-col gap-4">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight max-w-lg">
          Your neighbors already own the tool you&apos;re about to buy.
        </h2>
        <p className="text-muted max-w-lg">
          LendLoop is a tool-lending board for your street. Borrow for a weekend project, lend what sits idle.
        </p>
        <div>
          <SignInButton mode="modal">
            <button className="bg-accent text-accent-fg hover:bg-accent-hover px-4 py-2 rounded-lg font-medium transition-colors">
              Sign in to lend or borrow
            </button>
          </SignInButton>
        </div>
      </section>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-1">
            <span className="text-xs font-semibold text-accent">Step {i + 1}</span>
            <span className="font-medium">{s.title}</span>
            <span className="text-sm text-muted">{s.body}</span>
          </li>
        ))}
      </ol>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Available right now</h2>
        <PublicTools />
      </section>
    </>
  );
}

const TABS = [
  { id: "browse", label: "All tools" },
  { id: "listings", label: "My listings" },
  { id: "requests", label: "My requests" },
  { id: "incoming", label: "Incoming" },
  { id: "admin", label: "Admin" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function SignedIn() {
  const stored = useStoreUser();
  const me = useQuery(api.users.me, stored ? {} : "skip");
  const incoming = useQuery(api.loans.incoming, stored ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");
  if (!stored || me === undefined) return <Loading rows={4} grid />;
  if (me === null) return <p className="text-sm text-red-700">Could not load your account. Refresh to try again.</p>;
  const isAdmin = me.role === "admin";
  const pending = incoming?.filter((l) => l.status === "requested").length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <nav
        className="flex gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] border-b border-border -mx-4 px-4 sm:mx-0 sm:px-0"
        aria-label="Sections"
      >
        {TABS.filter((t) => t.id !== "admin" || isAdmin).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-2 text-sm -mb-px border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === t.id ? "border-accent text-foreground font-semibold" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {t.id === "incoming" && pending > 0 && (
              <span className="rounded-full bg-accent text-accent-fg text-[11px] leading-none px-1.5 py-1 font-semibold">
                {pending}
              </span>
            )}
          </button>
        ))}
      </nav>
      {tab === "browse" && <Browse isAdmin={isAdmin} onRequested={() => setTab("requests")} />}
      {tab === "listings" && <MyListings />}
      {tab === "requests" && <MyRequests onBrowse={() => setTab("browse")} />}
      {tab === "incoming" && <Incoming onList={() => setTab("listings")} />}
      {tab === "admin" && isAdmin && <AdminPanel />}
    </div>
  );
}

function MyRequests({ onBrowse }: { onBrowse: () => void }) {
  const loans = useQuery(api.loans.myRequests);
  return (
    <LoanList
      loans={loans}
      perspective="borrower"
      empty={{
        title: "No requests yet",
        body: "Find something you need and pick the dates. The owner gets notified right away.",
        action: <Button onClick={onBrowse}>Browse tools</Button>,
      }}
    />
  );
}

function Incoming({ onList }: { onList: () => void }) {
  const loans = useQuery(api.loans.incoming);
  return (
    <LoanList
      loans={loans}
      perspective="owner"
      empty={{
        title: "No requests for your tools",
        body: "When a neighbor asks to borrow something you've listed, it shows up here for you to approve.",
        action: (
          <Button variant="secondary" onClick={onList}>
            Go to my listings
          </Button>
        ),
      }}
    />
  );
}
