/** LendLoop mark: two arrows chasing each other round a loop (lend, return). */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <g fill="none" className="stroke-accent-fg" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 15a6.5 6.5 0 0 1 11.6-3.6" />
        <path d="M21.6 8.2v3.6h-3.6" />
        <path d="M22.5 17a6.5 6.5 0 0 1-11.6 3.6" />
        <path d="M10.4 23.8v-3.6h3.6" />
      </g>
    </svg>
  );
}
