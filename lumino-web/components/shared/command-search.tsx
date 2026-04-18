"use client";

import Link from "next/link";
import type { Route } from "next";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { SearchResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

export function CommandSearch() {
  const { session } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();

    if (!session?.access_token || trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await authFetch(
          session.access_token,
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!response.ok) {
          setResults([]);
          return;
        }
        const json = (await response.json()) as SearchResponse;
        setResults(json.items);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [query, session?.access_token]);

  return (
    <div className="relative w-full max-w-md">
      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150);
          }}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search address, homeowner, phone, or email"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
        />
      </div>

      {open && (query.trim().length >= 2 || loading) ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl">
          {loading ? (
            <div className="px-3 py-4 text-sm text-slate-500">Searching…</div>
          ) : results.length ? (
            results.map((item) => (
              <Link
                key={item.id}
                href={item.href as Route}
                className="block rounded-2xl px-3 py-3 transition hover:bg-slate-50"
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{item.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.subtitle}</div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    {item.kind}
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="px-3 py-4 text-sm text-slate-500">No matches found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
