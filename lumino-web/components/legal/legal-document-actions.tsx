"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function LegalDocumentActions() {
  const router = useRouter();

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => router.back()}
        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
      >
        Back
      </button>
      <Link
        href="/accept-agreement"
        className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-900"
      >
        Return To Agreement
      </Link>
    </div>
  );
}
