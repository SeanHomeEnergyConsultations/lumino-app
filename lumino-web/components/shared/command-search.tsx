"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SearchResponse } from "@/types/api";
import { authFetch, useAuth } from "@/lib/auth/client";

export function CommandSearch() {
  const router = useRouter();
  const { session } = useAuth();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogTitleId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse["items"]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const trimmedQuery = query.trim();

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const timeout = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open || !session?.access_token || trimmedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await authFetch(session.access_token, `/api/search?q=${encodeURIComponent(trimmedQuery)}`);
        if (!response.ok) {
          setResults([]);
          return;
        }
        const json = (await response.json()) as SearchResponse;
        setResults(json.items);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [open, trimmedQuery, session?.access_token]);

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setResults([]);
    triggerRef.current?.focus();
  }

  function handleOpenAddressOnMap() {
    if (!trimmedQuery) return;
    closeSearch();
    router.push(`/map?address=${encodeURIComponent(trimmedQuery)}` as Route);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="app-glass-input app-focus-ring app-focus-button flex w-full max-w-md items-center gap-2 rounded-full px-4 py-2.5 text-left text-sm text-[rgba(var(--app-primary-rgb),0.72)] transition hover:brightness-105"
        aria-label="Open search"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Search className="h-4 w-4 text-[rgba(var(--app-primary-rgb),0.5)]" />
        <span className="flex-1 truncate text-[rgba(var(--app-primary-rgb),0.58)]">
          Search address, homeowner, phone, or email
        </span>
        <span className="hidden rounded-full border border-[rgba(var(--app-primary-rgb),0.14)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.48)] sm:inline">
          Cmd K
        </span>
      </button>

      {open && portalReady
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-start justify-center bg-black/35 px-4 py-20 backdrop-blur-sm"
              onClick={closeSearch}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                className="app-panel w-full max-w-2xl rounded-[2rem] border shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <form
                  className="flex items-center gap-3 border-b border-[rgba(var(--app-primary-rgb),0.08)] px-5 py-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleOpenAddressOnMap();
                  }}
                >
                  <h2 id={dialogTitleId} className="sr-only">
                    Search Lumino
                  </h2>
                  <Search className="h-5 w-5 text-[rgba(var(--app-primary-rgb),0.52)]" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search address, homeowner, phone, or email…"
                    aria-label="Search address, homeowner, phone, or email"
                    className="app-focus-ring w-full bg-transparent text-base text-ink placeholder:text-[rgba(var(--app-primary-rgb),0.4)]"
                  />
                  <button
                    type="button"
                    onClick={closeSearch}
                    className="app-glass-button app-focus-button inline-flex h-10 w-10 items-center justify-center rounded-full text-[rgba(var(--app-primary-rgb),0.58)] transition hover:brightness-105"
                    aria-label="Close search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>

                <div className="max-h-[70vh] overflow-y-auto p-3">
                  {trimmedQuery.length < 2 ? (
                    <div className="px-3 py-8 text-center text-sm text-[rgba(var(--app-primary-rgb),0.56)]">
                      Start typing to find a saved lead or open a new address on the map.
                    </div>
                  ) : loading ? (
                    <div className="px-3 py-8 text-center text-sm text-[rgba(var(--app-primary-rgb),0.56)]">Searching…</div>
                  ) : results.length ? (
                    <div className="space-y-2">
                      {results.map((item) => (
                        <Link
                          key={item.id}
                          href={item.href as Route}
                          className="block rounded-[1.4rem] border border-[rgba(var(--app-primary-rgb),0.08)] px-4 py-4 transition hover:bg-[rgba(var(--app-primary-rgb),0.04)]"
                          onClick={closeSearch}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-ink">{item.title}</div>
                              <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.54)]">{item.subtitle}</div>
                            </div>
                            <div className="rounded-full border border-[rgba(var(--app-primary-rgb),0.12)] bg-[rgba(var(--app-surface-rgb),0.5)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(var(--app-primary-rgb),0.56)]">
                              {item.kind}
                            </div>
                          </div>
                        </Link>
                      ))}

                      <button
                        type="button"
                        onClick={handleOpenAddressOnMap}
                        className="app-focus-ring app-focus-button block w-full rounded-[1.4rem] border border-dashed border-[rgba(var(--app-primary-rgb),0.18)] px-4 py-4 text-left transition hover:bg-[rgba(var(--app-primary-rgb),0.04)]"
                      >
                        <div className="text-sm font-semibold text-ink">Open &quot;{trimmedQuery}&quot; on the map</div>
                        <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.54)]">
                          Use this when the address is not already saved in Lumino.
                        </div>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleOpenAddressOnMap}
                      className="app-focus-ring app-focus-button block w-full rounded-[1.4rem] border border-dashed border-[rgba(var(--app-primary-rgb),0.18)] px-4 py-5 text-left transition hover:bg-[rgba(var(--app-primary-rgb),0.04)]"
                    >
                      <div className="text-sm font-semibold text-ink">Open &quot;{trimmedQuery}&quot; on the map</div>
                      <div className="mt-1 text-xs text-[rgba(var(--app-primary-rgb),0.54)]">
                        No saved match found. Search and preview this address instead.
                      </div>
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
