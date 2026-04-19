"use client";

import Link from "next/link";

export function LegalDocumentActions() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <Link
        href="/accept-agreement"
        className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900"
      >
        Close
      </Link>
    </div>
  );
}
