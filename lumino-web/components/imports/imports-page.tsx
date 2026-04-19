"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Upload, FileUp, Database, RefreshCw } from "lucide-react";
import { authFetch, useAuth } from "@/lib/auth/client";
import { parseCsvText } from "@/lib/imports/csv";
import type { ImportBatchListItem, ImportsResponse, ImportUploadResponse } from "@/types/api";

function formatDateTime(value: string | null) {
  if (!value) return "Not started";
  return new Date(value).toLocaleString();
}

function statusTone(status: string) {
  switch (status) {
    case "ready_for_analysis":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "analyzing":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "uploaded":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export function ImportsPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [filename, setFilename] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [batches, setBatches] = useState<ImportBatchListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState<"idle" | "done" | "error">("idle");

  const loadBatches = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await authFetch(accessToken, "/api/imports");
      if (!response.ok) throw new Error("Failed to load imports");
      const json = (await response.json()) as ImportsResponse;
      setBatches(json.items);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsed = parseCsvText(text);
    setFilename(file.name);
    setHeaders(parsed.headers);
    setPreviewRows(parsed.rows);
    setUploadState("idle");
  }

  async function handleUpload() {
    if (!accessToken || !filename || !previewRows.length) return;
    setUploading(true);
    setUploadState("idle");
    try {
      const response = await authFetch(accessToken, "/api/imports", {
        method: "POST",
        body: JSON.stringify({
          filename,
          rows: previewRows
        })
      });
      if (!response.ok) throw new Error("Failed to upload import");
      await response.json() as ImportUploadResponse;
      setUploadState("done");
      setFilename(null);
      setHeaders([]);
      setPreviewRows([]);
      await loadBatches();
    } catch {
      setUploadState("error");
    } finally {
      setUploading(false);
    }
  }

  const previewSample = useMemo(() => previewRows.slice(0, 5), [previewRows]);

  return (
    <div className="p-4 md:p-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Imports</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Upload Manager Lists</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Upload CSV lists, preserve the raw source rows, and map them onto properties and leads for the field team.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadBatches()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Upload className="h-4 w-4" />
              Upload CSV
            </div>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center transition hover:border-slate-400">
              <FileUp className="h-8 w-8 text-slate-500" />
              <div className="mt-4 text-base font-semibold text-ink">Choose a CSV file</div>
              <div className="mt-1 text-sm text-slate-500">We’ll preview a few rows before import.</div>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            </label>

            {filename ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                <div className="font-semibold text-ink">{filename}</div>
                <div className="mt-1">{previewRows.length} detected rows</div>
                <div className="mt-1">{headers.length} detected columns</div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={!filename || !previewRows.length || uploading}
                className="rounded-2xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {uploading ? "Uploading..." : "Import Rows"}
              </button>
              {uploadState === "done" ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  Import created successfully.
                </div>
              ) : null}
              {uploadState === "error" ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">
                  Upload failed.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Database className="h-4 w-4" />
              Preview
            </div>
            {previewSample.length ? (
              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      {headers.slice(0, 6).map((header) => (
                        <th key={header} className="px-3 py-2 font-semibold text-slate-600">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewSample.map((row, index) => (
                      <tr key={`${index}-${row[headers[0]] ?? "row"}`} className="border-b border-slate-100 last:border-b-0">
                        {headers.slice(0, 6).map((header) => (
                          <td key={header} className="px-3 py-2 text-slate-600">
                            {row[header] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
                Upload a CSV to preview the first few rows here.
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="mt-6 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-mist">Recent Batches</div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Loading import history...
            </div>
          ) : batches.length ? (
            batches.map((batch) => (
              <div key={batch.batchId} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ink">{batch.filename}</div>
                    <div className="mt-1 text-xs text-slate-500">Created {formatDateTime(batch.createdAt)}</div>
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusTone(batch.status)}`}>
                    {batch.status.replaceAll("_", " ")}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4 xl:grid-cols-6">
                  {[
                    ["Rows", batch.totalRows],
                    ["Detected", batch.detectedRows],
                    ["Inserted", batch.insertedCount],
                    ["Updated", batch.updatedCount],
                    ["Duplicates", batch.duplicateMatchedCount],
                    ["Pending Analysis", batch.pendingAnalysisCount]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
                      <div className="mt-1 text-base font-semibold text-ink">{value}</div>
                    </div>
                  ))}
                </div>
                {batch.lastError ? <div className="mt-3 text-sm text-rose-600">{batch.lastError}</div> : null}
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No import batches yet. Upload your first manager list above.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
