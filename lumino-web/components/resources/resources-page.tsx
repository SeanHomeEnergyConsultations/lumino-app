"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Printer, UploadCloud, Video } from "lucide-react";
import {
  ProductEmptyState,
  ProductFilterBar,
  ProductHero,
  ProductNotice,
  ProductSection,
  ProductStatGrid,
  productFieldClassName,
  productFieldLabelClassName,
  productFileInputClassName,
  productTextAreaClassName
} from "@/components/shared/product-primitives";
import { buildResourcesSearchParams } from "@/components/shared/workspace-url-state";
import { trackAppEvent } from "@/lib/analytics/app-events";
import { authFetch, useAuth } from "@/lib/auth/client";
import type { OrganizationResourceItem, ResourceMaterialType, ResourcesResponse, TerritoriesResponse } from "@/types/api";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function resourceLabel(value: ResourceMaterialType) {
  switch (value) {
    case "video":
      return "Video";
    case "printable":
      return "Printable";
    default:
      return "Document";
  }
}

function ResourceTypeIcon({ type }: { type: ResourceMaterialType }) {
  if (type === "video") return <Video className="h-4 w-4" />;
  if (type === "printable") return <Printer className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

export function ResourcesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, supabase } = useAuth();
  const hasTrackedFilters = useRef(false);
  const [library, setLibrary] = useState<ResourcesResponse | null>(null);
  const [territories, setTerritories] = useState<TerritoriesResponse["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "uploading" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resourceType, setResourceType] = useState<ResourceMaterialType>("document");
  const [territoryId, setTerritoryId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | ResourceMaterialType>(
    () => (searchParams.get("type") as "all" | ResourceMaterialType | null) ?? "all"
  );
  const [territoryFilter, setTerritoryFilter] = useState<"all" | "untagged" | string>(
    () => searchParams.get("territory") ?? "all"
  );

  const loadLibrary = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const [resourcesResponse, territoriesResponse] = await Promise.all([
        authFetch(session.access_token, "/api/resources"),
        authFetch(session.access_token, "/api/territories")
      ]);

      if (!resourcesResponse.ok) {
        throw new Error("Could not load resources.");
      }

      const resourcesJson = (await resourcesResponse.json()) as ResourcesResponse;
      setLibrary(resourcesJson);

      if (territoriesResponse.ok) {
        const territoryJson = (await territoriesResponse.json()) as TerritoriesResponse;
        setTerritories(territoryJson.items);
      } else {
        setTerritories([]);
      }

      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load resources.");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    const nextSearch = buildResourcesSearchParams({
      currentSearch: searchParams.toString(),
      type: typeFilter,
      territory: territoryFilter
    });
    const currentSearch = searchParams.toString();
    if (nextSearch === currentSearch) return;
    startTransition(() => {
      router.replace((nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route, { scroll: false });
    });
  }, [pathname, router, searchParams, territoryFilter, typeFilter]);

  useEffect(() => {
    if (!hasTrackedFilters.current) {
      hasTrackedFilters.current = true;
      return;
    }
    trackAppEvent("resources.filters_changed", {
      typeFilter,
      territoryFilter
    });
  }, [territoryFilter, typeFilter]);

  const filteredItems = useMemo(() => {
    const items = library?.items ?? [];
    return items.filter((item) => {
      if (typeFilter !== "all" && item.resourceType !== typeFilter) return false;
      if (territoryFilter === "untagged") return !item.territoryId;
      if (territoryFilter !== "all" && item.territoryId !== territoryFilter) return false;
      return true;
    });
  }, [library?.items, territoryFilter, typeFilter]);

  const stats = useMemo(() => {
    const items = library?.items ?? [];
    return {
      documents: items.filter((item) => item.resourceType === "document").length,
      videos: items.filter((item) => item.resourceType === "video").length,
      printables: items.filter((item) => item.resourceType === "printable").length
    };
  }, [library?.items]);

  async function uploadResource() {
    if (!session?.access_token || !supabase || !selectedFile) return;

    setSaveState("uploading");
    setError(null);
    try {
      const uploadTargetResponse = await authFetch(session.access_token, "/api/resources/upload-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: selectedFile.name,
          mimeType: selectedFile.type || null,
          fileSizeBytes: selectedFile.size
        })
      });

      const uploadTargetJson = (await uploadTargetResponse.json()) as {
        error?: string;
        bucket?: string;
        path?: string;
        token?: string;
      };
      if (!uploadTargetResponse.ok || !uploadTargetJson.bucket || !uploadTargetJson.path || !uploadTargetJson.token) {
        throw new Error(uploadTargetJson.error || "Could not prepare file upload.");
      }

      const storageUpload = await supabase.storage
        .from(uploadTargetJson.bucket)
        .uploadToSignedUrl(uploadTargetJson.path, uploadTargetJson.token, selectedFile);
      if (storageUpload.error) {
        throw storageUpload.error;
      }

      const createResponse = await authFetch(session.access_token, "/api/resources", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description || null,
          resourceType,
          territoryId: territoryId || null,
          storageBucket: uploadTargetJson.bucket,
          storagePath: uploadTargetJson.path,
          fileName: selectedFile.name,
          mimeType: selectedFile.type || null,
          fileSizeBytes: selectedFile.size
        })
      });

      const createJson = (await createResponse.json()) as { error?: string };
      if (!createResponse.ok) {
        throw new Error(createJson.error || "Could not save this resource.");
      }

      setSaveState("saved");
      setTitle("");
      setDescription("");
      setResourceType("document");
      setTerritoryId("");
      setSelectedFile(null);
      trackAppEvent("resources.uploaded", {
        resourceType,
        territoryScoped: Boolean(territoryId)
      });
      await loadLibrary();
    } catch (saveError) {
      setSaveState("error");
      setError(saveError instanceof Error ? saveError.message : "Could not upload this resource.");
    }
  }

  return (
    <div className="p-4 md:p-6">
      <ProductHero
        eyebrow="Resources"
        title="Training, printables, and field materials"
        description="Managers upload once, reps pull what they need in the field. Keep scripts, handouts, printable leave-behinds, and training videos in one clean workspace."
      >
        <ProductStatGrid
          items={[
            { label: "Documents", value: loading ? "…" : stats.documents, detail: "Scripts, one-pagers, and reference sheets" },
            { label: "Videos", value: loading ? "…" : stats.videos, detail: "Training clips and walkthroughs" },
            { label: "Printables", value: loading ? "…" : stats.printables, detail: "Door materials ready to print" }
          ]}
        />
      </ProductHero>

      <div className="mt-6 grid gap-6 xl:grid-cols-[400px_1fr]">
        {library?.canManageResources ? (
          <ProductSection eyebrow="Manager Upload" title="Add a new material" className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-950 p-3 text-white">
                <UploadCloud className="h-5 w-5" />
              </div>
            </div>

            <div className="space-y-4">
              <label className="block space-y-2">
                <div className={productFieldLabelClassName}>Title</div>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Storm objection handling sheet"
                  className={productFieldClassName}
                />
              </label>

              <label className="block space-y-2">
                <div className={productFieldLabelClassName}>Description</div>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Quick rebuttals and framing for common homeowner concerns."
                  className={productTextAreaClassName}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-2">
                  <div className={productFieldLabelClassName}>Material type</div>
                  <select
                    value={resourceType}
                    onChange={(event) => setResourceType(event.target.value as ResourceMaterialType)}
                    className={productFieldClassName}
                  >
                    <option value="document">Document</option>
                    <option value="video">Video</option>
                    <option value="printable">Printable</option>
                  </select>
                </label>

                <label className="block space-y-2">
                  <div className={productFieldLabelClassName}>Territory</div>
                  <select
                    value={territoryId}
                    onChange={(event) => setTerritoryId(event.target.value)}
                    className={productFieldClassName}
                  >
                    <option value="">Whole organization</option>
                    {territories.map((item) => (
                      <option key={item.territoryId} value={item.territoryId}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-2">
                <div className={productFieldLabelClassName}>File</div>
                <input
                  type="file"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className={productFileInputClassName}
                />
                <div className="text-xs text-[rgba(var(--app-primary-rgb),0.58)]">
                  Great for PDFs, slide decks, print sheets, and training clips.
                </div>
              </label>

              <button
                type="button"
                onClick={() => void uploadResource()}
                disabled={saveState === "uploading" || !title.trim() || !selectedFile}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[rgba(var(--app-primary-rgb),0.96)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UploadCloud className="h-4 w-4" />
                {saveState === "uploading" ? "Uploading..." : "Upload Material"}
              </button>

              {error ? <ProductNotice tone="error" message={error} /> : null}
              {saveState === "saved" ? (
                <ProductNotice tone="success" message="Resource uploaded. The library reflects it immediately for the team." />
              ) : null}
            </div>
          </ProductSection>
        ) : null}

        <section className="space-y-4">
          <ProductFilterBar className="p-5">
            <div className="flex flex-wrap items-end gap-4">
              <label className="block space-y-2">
                <div className={productFieldLabelClassName}>Type</div>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value as "all" | ResourceMaterialType)}
                  className={productFieldClassName}
                >
                  <option value="all">All types</option>
                  <option value="document">Documents</option>
                  <option value="video">Videos</option>
                  <option value="printable">Printables</option>
                </select>
              </label>

              <label className="block space-y-2">
                <div className={productFieldLabelClassName}>Territory</div>
                <select
                  value={territoryFilter}
                  onChange={(event) => setTerritoryFilter(event.target.value)}
                  className={productFieldClassName}
                >
                  <option value="all">All territories</option>
                  <option value="untagged">Org-wide only</option>
                  {territories.map((item) => (
                    <option key={item.territoryId} value={item.territoryId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </ProductFilterBar>

          {filteredItems.map((item) => (
            <article key={item.resourceId} className="app-panel rounded-[2rem] border p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">
                    <ResourceTypeIcon type={item.resourceType} />
                    {resourceLabel(item.resourceType)}
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-ink">{item.title}</div>
                  <div className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
                    Uploaded by {item.uploaderName ?? "Team"} · {new Date(item.createdAt).toLocaleDateString()}
                  </div>
                </div>

                <a
                  href={item.signedUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                    item.signedUrl
                      ? "border-[rgba(var(--app-primary-rgb),0.08)] text-ink hover:bg-[rgba(var(--app-surface-rgb),0.48)]"
                      : "cursor-not-allowed border-slate-200 text-slate-400"
                  }`}
                >
                  <FolderOpen className="h-4 w-4" />
                  {item.resourceType === "video" ? "Watch" : "Open"}
                </a>
              </div>

              {item.description ? (
                <div className="mt-4 text-sm text-[rgba(var(--app-primary-rgb),0.72)]">{item.description}</div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3 text-sm text-[rgba(var(--app-primary-rgb),0.68)]">
                <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
                  <FileText className="h-4 w-4" />
                  {item.fileName}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
                  {formatBytes(item.fileSizeBytes)}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--app-primary-rgb),0.08)] px-3 py-2">
                  {item.territoryName ?? "All reps / all territories"}
                </div>
              </div>
            </article>
          ))}

          {!loading && !filteredItems.length ? (
            <ProductEmptyState
              title="No resources match this filter"
              description="Try widening the territory or material type filter to bring more field material back into view."
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
