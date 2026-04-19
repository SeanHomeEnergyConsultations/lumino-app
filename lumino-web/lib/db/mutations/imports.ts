import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { analyzeImportLead, makeAnalysisCacheKey } from "@/lib/imports/analysis";
import { computeAnalysisBackedPropertyPriority, propertyPriorityBand } from "@/lib/properties/priority";
import type { AuthSessionContext } from "@/types/auth";
import type { ImportBatchAnalysisResponse } from "@/types/api";

type RawImportRow = Record<string, string>;

interface CanonicalImportRow {
  sourceRowNumber: number;
  rawAddress: string;
  address: string;
  normalizedAddress: string;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  unqualifiedReason: string | null;
  listingAgent: string | null;
  source: string | null;
  sourceLatitude: number | null;
  sourceLongitude: number | null;
  payload: Record<string, string>;
}

function stringOrNull(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function propertyIdentityKey(input: {
  address?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  postalCode?: string | null;
}) {
  const line1 = (input.addressLine1 ?? input.address ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const city = (input.city ?? "").trim().toLowerCase();
  const state = (input.state ?? "").trim().toLowerCase();
  const postal = (input.zipcode ?? input.postalCode ?? "").trim().toLowerCase();
  return [line1, city, state, postal].join("|");
}

function safeNumber(value: unknown) {
  const trimmed = String(value ?? "").trim().replace(/,/g, "");
  if (!trimmed) return null;
  const match = trimmed.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function safeInt(value: unknown) {
  const number = safeNumber(value);
  return number === null ? null : Math.round(number);
}

function safeIsoDate(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const asDate = new Date(trimmed);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toISOString().slice(0, 10);
}

function getValue(row: RawImportRow, aliases: string[]) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const exact = row[alias];
    if (exact && exact.trim()) return exact.trim();
    const found = entries.find(([key, value]) => key.trim().toLowerCase() === alias.trim().toLowerCase() && value.trim());
    if (found) return found[1].trim();
  }
  return "";
}

function combineName(firstName: string | null, lastName: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ") || null;
}

function coerceImportRow(row: RawImportRow, index: number): CanonicalImportRow | null {
  const rawAddress =
    getValue(row, ["Address", "ADDRESS", "raw_address", "address"]) ||
    [
      getValue(row, ["Address Line 1", "address_line_1"]),
      getValue(row, ["City", "CITY", "city"]),
      getValue(row, ["State", "STATE", "state"]),
      getValue(row, ["Zip", "ZIP", "ZIP OR POSTAL CODE", "zipcode", "postal_code"])
    ]
      .filter(Boolean)
      .join(", ");

  const address = stringOrNull(rawAddress);
  if (!address) return null;

  const city = stringOrNull(getValue(row, ["City", "CITY", "city"]));
  const state = stringOrNull(getValue(row, ["State", "STATE", "STATE OR PROVINCE", "state"]));
  const zipcode = stringOrNull(
    getValue(row, ["Zip", "ZIP", "ZIP OR POSTAL CODE", "postal_code", "zipcode"])
  );
  const firstName = stringOrNull(getValue(row, ["First Name", "FIRST NAME", "first_name"]));
  const lastName = stringOrNull(getValue(row, ["Last Name", "LAST NAME", "last_name"]));
  const notes = [getValue(row, ["Notes", "NOTES", "notes"]), getValue(row, ["Unqualified Reason Notes", "unqualified_reason_notes"])]
    .filter(Boolean)
    .join(" | ");

  return {
    sourceRowNumber: index + 2,
    rawAddress: address,
    address,
    normalizedAddress: normalizeAddress(address),
    city,
    state,
    zipcode,
    firstName,
    lastName,
    phone: stringOrNull(getValue(row, ["Phone", "PHONE", "phone"])),
    email: stringOrNull(getValue(row, ["Email", "EMAIL", "email"])),
    notes: stringOrNull(notes),
    unqualifiedReason: stringOrNull(getValue(row, ["Unqualified Reason", "unqualified_reason"])),
    listingAgent: stringOrNull(getValue(row, ["Listing Agent", "listing_agent"])),
    source: stringOrNull(getValue(row, ["SOURCE", "Source", "source"])),
    sourceLatitude: safeNumber(getValue(row, ["LATITUDE", "Latitude", "latitude", "source_latitude"])),
    sourceLongitude: safeNumber(getValue(row, ["LONGITUDE", "Longitude", "longitude", "source_longitude"])),
    payload: row
  };
}

function extractPropertyFacts(payload: RawImportRow) {
  return {
    beds: safeNumber(getValue(payload, ["Beds", "BEDS", "beds"])),
    baths: safeNumber(getValue(payload, ["Baths", "BATHS", "baths"])),
    square_feet: safeInt(getValue(payload, ["SqFt", "SQFT", "SQUARE FEET", "square feet"])),
    lot_size_sqft: safeNumber(getValue(payload, ["LOT SIZE", "Lot Size", "lot_size_sqft"])),
    year_built: safeInt(getValue(payload, ["YEAR BUILT", "Year Built", "year_built"])),
    last_sale_date: safeIsoDate(getValue(payload, ["Sale Date", "SOLD DATE", "sale_date", "sold_date"])),
    last_sale_price: safeNumber(getValue(payload, ["Price", "PRICE", "price"])),
    property_type: stringOrNull(getValue(payload, ["PROPERTY TYPE", "Property Type", "property_type"])),
    listing_status: stringOrNull(getValue(payload, ["STATUS", "Status", "listing_status"])),
    sale_type: stringOrNull(getValue(payload, ["SALE TYPE", "Sale Type", "sale_type"])),
    days_on_market: safeInt(getValue(payload, ["DAYS ON MARKET", "Days On Market", "days_on_market"])),
    hoa_monthly: safeNumber(getValue(payload, ["HOA/MONTH", "HOA", "hoa_monthly"]))
  };
}

function propertyCompletenessScore(facts: Record<string, unknown>) {
  const fields = Object.values(facts);
  const populated = fields.filter((value) => value !== null && value !== "").length;
  return Math.round((populated / fields.length) * 100);
}

export async function ingestImportUpload(
  input: { filename: string; rows: RawImportRow[] },
  context: AuthSessionContext
) {
  if (!context.organizationId) throw new Error("No active organization found.");

  const supabase = createServerSupabaseClient();
  const canonicalRows = input.rows
    .map((row, index) => coerceImportRow(row, index))
    .filter((row): row is CanonicalImportRow => Boolean(row));

  const skippedRows = Math.max(input.rows.length - canonicalRows.length, 0);

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      organization_id: context.organizationId,
      created_by: context.appUser.id,
      source_name: input.filename,
      filename: input.filename,
      original_filename: input.filename,
      source_type: "csv",
      status: "ready_for_analysis",
      row_count: input.rows.length,
      valid_row_count: canonicalRows.length,
      skipped_row_count: skippedRows,
      total_rows: input.rows.length,
      detected_rows: canonicalRows.length,
      started_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (batchError) throw batchError;

  const uniqueAddresses = Array.from(new Set(canonicalRows.map((row) => row.normalizedAddress)));
  const { data: existingLeads, error: existingLeadsError } = uniqueAddresses.length
    ? await supabase
        .from("leads")
        .select("id,property_id,normalized_address,address,zipcode,city,state,lat,lng")
        .eq("organization_id", context.organizationId)
        .in("normalized_address", uniqueAddresses)
    : { data: [], error: null };
  if (existingLeadsError) throw existingLeadsError;

  const { data: existingProperties, error: existingPropertiesError } = uniqueAddresses.length
    ? await supabase
        .from("properties")
        .select("id,normalized_address,address_line_1,raw_address,city,state,postal_code,zipcode")
        .in("normalized_address", uniqueAddresses)
    : { data: [], error: null };
  if (existingPropertiesError) throw existingPropertiesError;

  const leadLookup = new Map((existingLeads ?? []).map((row) => [row.normalized_address as string, row]));
  const propertyLookup = new Map((existingProperties ?? []).map((row) => [row.normalized_address as string, row]));
  const propertyIdentityLookup = new Map(
    (existingProperties ?? []).map((row) => [
      propertyIdentityKey({
        addressLine1: (row.address_line_1 as string | null) ?? null,
        address: (row.raw_address as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        state: (row.state as string | null) ?? null,
        zipcode: (row.zipcode as string | null) ?? null,
        postalCode: (row.postal_code as string | null) ?? null
      }),
      row
    ])
  );

  let insertedCount = 0;
  let updatedCount = 0;
  let duplicateMatchedCount = 0;
  const importItems: Record<string, unknown>[] = [];

  for (const row of canonicalRows) {
    const existingLead = leadLookup.get(row.normalizedAddress);

    const leadPayload = {
      organization_id: context.organizationId,
      created_by: context.appUser.id,
      import_batch_id: batch.id,
      last_import_batch_id: batch.id,
      normalized_address: row.normalizedAddress,
      address: row.address,
      city: row.city,
      state: row.state,
      zipcode: row.zipcode,
      lat: row.sourceLatitude,
      lng: row.sourceLongitude,
      owner_name: combineName(row.firstName, row.lastName),
      first_name: row.firstName,
      last_name: row.lastName,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      unqualified_reason: row.unqualifiedReason,
      listing_agent: row.listingAgent,
      status: "open",
      lead_status: "New",
      assignment_status: "unassigned",
      analysis_status: "pending",
      last_analysis_requested_at: new Date().toISOString(),
      last_analysis_error: null,
      needs_reanalysis: true,
      source: row.source ?? "imported"
    };

    let leadId: string | null = null;
    if (existingLead?.id) {
      const { data: updatedLead, error: updatedLeadError } = await supabase
        .from("leads")
        .update(leadPayload)
        .eq("id", existingLead.id as string)
        .select("id,normalized_address,property_id,address,zipcode,city,state,lat,lng")
        .single();
      if (updatedLeadError) throw updatedLeadError;
      leadId = updatedLead.id as string;
      leadLookup.set(row.normalizedAddress, updatedLead);
      updatedCount += 1;
      duplicateMatchedCount += 1;
    } else {
      const { data: insertedLead, error: insertedLeadError } = await supabase
        .from("leads")
        .insert(leadPayload)
        .select("id,normalized_address,property_id,address,zipcode,city,state,lat,lng")
        .single();
      if (insertedLeadError) throw insertedLeadError;
      leadId = insertedLead.id as string;
      leadLookup.set(row.normalizedAddress, insertedLead);
      insertedCount += 1;
    }

    let propertyId =
      (propertyLookup.get(row.normalizedAddress)?.id as string | undefined) ??
      (propertyIdentityLookup.get(
        propertyIdentityKey({
          address: row.address,
          city: row.city,
          state: row.state,
          zipcode: row.zipcode
        })
      )?.id as string | undefined);

    if (!propertyId) {
      const { data: fallbackProperty, error: fallbackPropertyError } = await supabase
        .from("properties")
        .select("id,normalized_address,address_line_1,raw_address,city,state,postal_code,zipcode")
        .eq("address_line_1", row.address.split(",")[0]?.trim() || row.address)
        .eq("city", row.city)
        .eq("state", row.state)
        .or(`postal_code.eq.${row.zipcode ?? ""},zipcode.eq.${row.zipcode ?? ""}`)
        .maybeSingle();

      if (fallbackPropertyError) throw fallbackPropertyError;
      if (fallbackProperty?.id) {
        propertyId = fallbackProperty.id as string;
        if (fallbackProperty.normalized_address) {
          propertyLookup.set(fallbackProperty.normalized_address as string, fallbackProperty);
        }
        propertyIdentityLookup.set(
          propertyIdentityKey({
            addressLine1: (fallbackProperty.address_line_1 as string | null) ?? null,
            address: (fallbackProperty.raw_address as string | null) ?? null,
            city: (fallbackProperty.city as string | null) ?? null,
            state: (fallbackProperty.state as string | null) ?? null,
            zipcode: (fallbackProperty.zipcode as string | null) ?? null,
            postalCode: (fallbackProperty.postal_code as string | null) ?? null
          }),
          fallbackProperty
        );
      }
    }

    if (!propertyId) {
      const facts = extractPropertyFacts(row.payload);
      const dataCompletenessScore = propertyCompletenessScore(facts);
      const { data: createdProperty, error: propertyError } = await supabase
        .from("properties")
        .insert({
          normalized_address: row.normalizedAddress,
          raw_address: row.address,
          address_line_1: row.address.split(",")[0]?.trim() || row.address,
          city: row.city,
          state: row.state,
          postal_code: row.zipcode,
          zipcode: row.zipcode,
          lat: row.sourceLatitude,
          lng: row.sourceLongitude,
          current_lead_id: leadId,
          data_completeness_score: dataCompletenessScore,
          ...facts
        })
        .select("id,normalized_address,address_line_1,raw_address,city,state,postal_code,zipcode")
        .single();
      if (propertyError) throw propertyError;
      propertyId = createdProperty.id as string;
      propertyLookup.set(row.normalizedAddress, createdProperty);
      propertyIdentityLookup.set(
        propertyIdentityKey({
          address: row.address,
          city: row.city,
          state: row.state,
          zipcode: row.zipcode
        }),
        createdProperty
      );
    } else {
      const facts = extractPropertyFacts(row.payload);
      const dataCompletenessScore = propertyCompletenessScore(facts);
      await supabase
        .from("properties")
        .update({
          raw_address: row.address,
          address_line_1: row.address.split(",")[0]?.trim() || row.address,
          city: row.city,
          state: row.state,
          postal_code: row.zipcode,
          zipcode: row.zipcode,
          lat: row.sourceLatitude,
          lng: row.sourceLongitude,
          current_lead_id: leadId,
          data_completeness_score: dataCompletenessScore,
          ...facts
        })
        .eq("id", propertyId);
    }

    if (leadId && propertyId) {
      await supabase.from("leads").update({ property_id: propertyId }).eq("id", leadId);
    }

    await supabase.from("property_source_records").insert({
      organization_id: context.organizationId,
      property_id: propertyId,
      source_type: "csv_import",
      source_name: input.filename,
      source_batch_id: batch.id,
      source_record_id: String(row.sourceRowNumber),
      record_date: safeIsoDate(
        getValue(row.payload, ["Sale Date", "SOLD DATE", "sale_date", "sold_date"])
      ),
      payload: row.payload,
      created_by: context.appUser.id
    });

    importItems.push({
      import_batch_id: batch.id,
      organization_id: context.organizationId,
      lead_id: leadId,
      source_row_number: row.sourceRowNumber,
      raw_address: row.rawAddress,
      normalized_address: row.normalizedAddress,
      source_payload: row.payload,
      ingest_status: existingLead?.id ? "matched_existing" : "inserted",
      analysis_status: "pending",
      dedupe_match_type: existingLead?.id ? "exact_address" : "new_lead"
    });
  }

  if (importItems.length) {
    const { error: itemError } = await supabase.from("import_batch_items").insert(importItems);
    if (itemError) throw itemError;
  }

  const pendingAnalysisCount = importItems.length;
  await supabase
    .from("import_batches")
    .update({
      status: pendingAnalysisCount > 0 ? "ready_for_analysis" : "uploaded",
      inserted_count: insertedCount,
      updated_count: updatedCount,
      duplicate_matched_count: duplicateMatchedCount,
      pending_analysis_count: pendingAnalysisCount,
      failed_count: 0
    })
    .eq("id", batch.id);

  return {
    batchId: batch.id as string,
    insertedCount,
    updatedCount,
    duplicateMatchedCount,
    pendingAnalysisCount
  };
}

type ImportBatchItemRow = {
  id: string;
  lead_id: string | null;
  source_payload: Record<string, unknown> | null;
  analysis_status: string | null;
  analysis_error: string | null;
  source_row_number: number | null;
  raw_address: string | null;
  normalized_address: string | null;
};

type LeadRow = {
  id: string;
  property_id: string | null;
  address: string | null;
  normalized_address: string | null;
  zipcode: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  listing_agent: string | null;
  source: string | null;
  analysis_attempt_count: number | null;
};

function importAnalysisErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Analysis failed.";
}

async function refreshImportBatchProgress(batchId: string) {
  const supabase = createServerSupabaseClient();
  const [{ count: pending }, { count: analyzing }, { count: analyzed }, { count: failed }] =
    await Promise.all([
      supabase.from("import_batch_items").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId).eq("analysis_status", "pending"),
      supabase.from("import_batch_items").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId).eq("analysis_status", "analyzing"),
      supabase.from("import_batch_items").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId).eq("analysis_status", "analyzed"),
      supabase.from("import_batch_items").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId).eq("analysis_status", "failed")
    ]);

  const status =
    (pending ?? 0) > 0 || (analyzing ?? 0) > 0
      ? "analyzing"
      : (failed ?? 0) > 0
        ? "completed_with_errors"
        : "completed";

  const completedAt = status === "analyzing" ? null : new Date().toISOString();
  await supabase
    .from("import_batches")
    .update({
      status,
      pending_analysis_count: pending ?? 0,
      analyzing_count: analyzing ?? 0,
      analyzed_count: analyzed ?? 0,
      failed_count: failed ?? 0,
      completed_at: completedAt
    })
    .eq("id", batchId);

  return {
    status,
    pendingAnalysisCount: pending ?? 0,
    analyzingCount: analyzing ?? 0,
    analyzedCount: analyzed ?? 0,
    failedItemCount: failed ?? 0
  };
}

async function claimBatchItems(batchId: string, statuses: string[], chunkSize: number) {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from("import_batch_items")
    .select("id,lead_id,source_payload,analysis_status,analysis_error,source_row_number,raw_address,normalized_address")
    .eq("import_batch_id", batchId)
    .order("source_row_number", { ascending: true })
    .limit(chunkSize);

  if (statuses.length === 1) {
    query = query.eq("analysis_status", statuses[0]);
  } else {
    query = query.in("analysis_status", statuses);
  }

  const { data, error } = await query;
  if (error) throw error;

  const items = (data ?? []) as ImportBatchItemRow[];
  if (!items.length) return [];

  await supabase
    .from("import_batch_items")
    .update({
      analysis_status: "analyzing",
      analysis_error: null
    })
    .in("id", items.map((item) => item.id));

  const leadIds = items.map((item) => item.lead_id).filter(Boolean) as string[];
  if (leadIds.length) {
    await supabase
      .from("leads")
      .update({
        analysis_status: "analyzing",
        last_analysis_requested_at: new Date().toISOString(),
        last_analysis_error: null
      })
      .in("id", leadIds);
  }

  await supabase.from("import_batches").update({ status: "analyzing" }).eq("id", batchId);
  return items;
}

async function resetBatchItemsForReanalysis(batchId: string, statuses: string[]) {
  const supabase = createServerSupabaseClient();

  let itemQuery = supabase
    .from("import_batch_items")
    .update({
      analysis_status: "pending",
      analysis_error: null
    })
    .eq("import_batch_id", batchId);

  if (statuses.length === 1) {
    itemQuery = itemQuery.eq("analysis_status", statuses[0]);
  } else {
    itemQuery = itemQuery.in("analysis_status", statuses);
  }

  const { error: itemError } = await itemQuery;
  if (itemError) throw itemError;

  const { data: leadRows, error: leadRowsError } = await supabase
    .from("import_batch_items")
    .select("lead_id")
    .eq("import_batch_id", batchId)
    .not("lead_id", "is", null);

  if (leadRowsError) throw leadRowsError;

  const leadIds = Array.from(new Set((leadRows ?? []).map((row) => row.lead_id).filter(Boolean))) as string[];
  if (leadIds.length) {
    const { error: leadError } = await supabase
      .from("leads")
      .update({
        analysis_status: "pending",
        last_analysis_error: null,
        needs_reanalysis: true
      })
      .in("id", leadIds);
    if (leadError) throw leadError;
  }

  const { error: batchError } = await supabase
    .from("import_batches")
    .update({
      status: "ready_for_analysis",
      last_error: null,
      completed_at: null
    })
    .eq("id", batchId);
  if (batchError) throw batchError;
}

async function loadLeads(leadIds: string[]) {
  const supabase = createServerSupabaseClient();
  if (!leadIds.length) return new Map<string, LeadRow>();
  const { data, error } = await supabase
    .from("leads")
    .select("id,property_id,address,normalized_address,zipcode,city,state,lat,lng,first_name,last_name,phone,email,notes,listing_agent,source,analysis_attempt_count")
    .in("id", leadIds);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id as string, row as LeadRow]));
}

async function completeItemAnalysis(
  batchId: string,
  item: ImportBatchItemRow,
  leadId: string,
  status: "analyzed" | "failed",
  analysisError: string | null,
  analysisAttemptCount: number
) {
  const supabase = createServerSupabaseClient();
  await supabase
    .from("import_batch_items")
    .update({
      lead_id: leadId,
      analysis_status: status,
      analysis_error: analysisError
    })
    .eq("id", item.id);

  const leadPayload: Record<string, unknown> = {
    analysis_status: status,
    analysis_attempt_count: Math.max(1, analysisAttemptCount),
    last_analysis_error: analysisError,
    last_import_batch_id: batchId
  };
  if (status === "analyzed") {
    leadPayload.last_analysis_completed_at = new Date().toISOString();
    leadPayload.needs_reanalysis = false;
  }

  await supabase.from("leads").update(leadPayload).eq("id", leadId);
}

async function persistAnalysisResult(
  lead: LeadRow,
  payload: Record<string, unknown>,
  result: Awaited<ReturnType<typeof analyzeImportLead>>,
  organizationId: string
) {
  const supabase = createServerSupabaseClient();
  const cacheKey = makeAnalysisCacheKey(payload);
  const { data: existingAnalysis } = await supabase
    .from("lead_analysis")
    .select("id")
    .eq("lead_id", lead.id)
    .order("updated_at", { ascending: false })
    .limit(1);

  const analysisPayload = {
    lead_id: lead.id,
    cache_key: cacheKey,
    sale_price: result.salePrice,
    price_display: result.priceDisplay,
    value_badge: result.valueBadge,
    sqft: result.sqft,
    sqft_display: result.sqftDisplay,
    beds: result.beds,
    baths: result.baths,
    sold_date: result.soldDate,
    permit_pulled: result.permitPulled,
    sun_hours: result.sunHours,
    sun_hours_display: result.sunHoursDisplay,
    category: result.category,
    solar_details: result.solarDetails,
    priority_score: result.priorityScore,
    priority_label: result.priorityLabel,
    parking_address: result.parkingAddress,
    parking_ease: result.parkingEase,
    doors_to_knock: result.doorsToKnock,
    ideal_count: result.idealCount,
    good_count: result.goodCount,
    walkable_count: result.walkableCount,
    street_view_link: result.streetViewLink,
    value_score: result.valueScore,
    sqft_score: result.sqftScore,
    analysis_error: null,
    source_hash: cacheKey
  };

  let analysisId: string | null = null;
  if (existingAnalysis?.[0]?.id) {
    const { data, error } = await supabase
      .from("lead_analysis")
      .update(analysisPayload)
      .eq("id", existingAnalysis[0].id as string)
      .select("id")
      .single();
    if (error) throw error;
    analysisId = data.id as string;
  } else {
    const { data, error } = await supabase
      .from("lead_analysis")
      .insert(analysisPayload)
      .select("id")
      .single();
    if (error) throw error;
    analysisId = data.id as string;
  }

  if (analysisId) {
    await supabase.from("lead_neighbors").delete().eq("lead_analysis_id", analysisId);
  }

  if (lead.property_id) {
    const solarPayload = result.solarDetails;
    const { data: existingEnrichment } = await supabase
      .from("property_enrichments")
      .select("id")
      .eq("property_id", lead.property_id)
      .eq("provider", "google_solar")
      .eq("enrichment_type", "solar")
      .maybeSingle();

    const enrichmentPayload = {
      organization_id: organizationId,
      property_id: lead.property_id,
      provider: "google_solar",
      enrichment_type: "solar",
      status: "success",
      fetched_at: new Date().toISOString(),
      payload: solarPayload
    };

    if (existingEnrichment?.id) {
      const { error } = await supabase
        .from("property_enrichments")
        .update(enrichmentPayload)
        .eq("id", existingEnrichment.id as string);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("property_enrichments").insert(enrichmentPayload);
      if (error) throw error;
    }

    const propertyPriorityScore = computeAnalysisBackedPropertyPriority({
      analysisPriorityScore: result.priorityScore,
      solarFitScore: result.solarFitScore,
      valueScore: result.valueScore,
      sqftScore: result.sqftScore,
      systemCapacityKw: (result.solarDetails.system_capacity_kw as number | null | undefined) ?? null
    });

    const { error: propertyUpdateError } = await supabase
      .from("properties")
      .update({
        solar_fit_score: result.solarFitScore,
        roof_capacity_score: result.roofCapacityScore,
        roof_complexity_score: result.roofComplexityScore,
        estimated_system_capacity_kw: (result.solarDetails.system_capacity_kw as number | null | undefined) ?? null,
        estimated_yearly_energy_kwh: (result.solarDetails.yearly_energy_dc_kwh as number | null | undefined) ?? null,
        solar_imagery_quality: (result.solarDetails.imagery_quality as string | null | undefined) ?? null,
        property_priority_score: propertyPriorityScore,
        property_priority_label: propertyPriorityBand(propertyPriorityScore),
        priority_last_computed_at: new Date().toISOString(),
        lat: result.lat ?? lead.lat,
        lng: result.lng ?? lead.lng,
        updated_at: new Date().toISOString()
      })
      .eq("id", lead.property_id);
    if (propertyUpdateError) throw propertyUpdateError;
  }
}

export async function runImportBatchAnalysis(
  batchId: string,
  context: AuthSessionContext,
  options?: { retryFailed?: boolean; chunkSize?: number }
): Promise<ImportBatchAnalysisResponse> {
  if (!context.organizationId) throw new Error("No active organization found.");
  const chunkSize = Math.max(1, Math.min(options?.chunkSize ?? 3, 10));
  let statuses = options?.retryFailed ? ["pending", "failed"] : ["pending"];
  let items = await claimBatchItems(batchId, statuses, chunkSize);

  if (!items.length && !options?.retryFailed) {
    await resetBatchItemsForReanalysis(batchId, ["analyzed", "failed"]);
    statuses = ["pending"];
    items = await claimBatchItems(batchId, statuses, chunkSize);
  }

  if (!items.length) {
    const progress = await refreshImportBatchProgress(batchId);
    return {
      batchId,
      status: progress.status,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      continued: progress.pendingAnalysisCount > 0 || (options?.retryFailed ? progress.failedItemCount > 0 : false),
      pendingAnalysisCount: progress.pendingAnalysisCount,
      analyzingCount: progress.analyzingCount,
      analyzedCount: progress.analyzedCount,
      failedItemCount: progress.failedItemCount,
      lastError: null
    };
  }

  const leads = await loadLeads(items.map((item) => item.lead_id).filter(Boolean) as string[]);
  let succeededCount = 0;
  let failedCount = 0;
  let lastError: string | null = null;

  for (const item of items) {
    const lead = item.lead_id ? leads.get(item.lead_id) : null;
    if (!lead) {
      failedCount += 1;
      lastError = "Lead record missing for import batch item.";
      await completeItemAnalysis(batchId, item, item.lead_id ?? "", "failed", lastError, 1);
      continue;
    }

    const payload = {
      ...(item.source_payload ?? {}),
      address: (item.source_payload ?? {}).address ?? lead.address ?? item.raw_address,
      zipcode: (item.source_payload ?? {}).zipcode ?? lead.zipcode,
      city: (item.source_payload ?? {}).city ?? lead.city,
      state: (item.source_payload ?? {}).state ?? lead.state,
      source_latitude: (item.source_payload ?? {}).source_latitude ?? lead.lat,
      source_longitude: (item.source_payload ?? {}).source_longitude ?? lead.lng,
      first_name: (item.source_payload ?? {}).first_name ?? lead.first_name,
      last_name: (item.source_payload ?? {}).last_name ?? lead.last_name,
      phone: (item.source_payload ?? {}).phone ?? lead.phone,
      email: (item.source_payload ?? {}).email ?? lead.email,
      notes: (item.source_payload ?? {}).notes ?? lead.notes,
      listing_agent: (item.source_payload ?? {}).listing_agent ?? lead.listing_agent,
      source: (item.source_payload ?? {}).source ?? lead.source ?? "imported"
    } as Record<string, unknown>;

    try {
      const result = await analyzeImportLead(payload, lead);
      await persistAnalysisResult(lead, payload, result, context.organizationId);
      await completeItemAnalysis(
        batchId,
        item,
        lead.id,
        "analyzed",
        null,
        Number(lead.analysis_attempt_count ?? 0) + 1
      );
      succeededCount += 1;
    } catch (error) {
      lastError = importAnalysisErrorMessage(error);
      await completeItemAnalysis(
        batchId,
        item,
        lead.id,
        "failed",
        lastError,
        Number(lead.analysis_attempt_count ?? 0) + 1
      );
      failedCount += 1;
    }
  }

  const progress = await refreshImportBatchProgress(batchId);
  if (lastError) {
    await createServerSupabaseClient().from("import_batches").update({ last_error: lastError }).eq("id", batchId);
  }

  return {
    batchId,
    status: progress.status,
    processedCount: items.length,
    succeededCount,
    failedCount,
    continued: progress.pendingAnalysisCount > 0 || (options?.retryFailed ? progress.failedItemCount > 0 : false),
    pendingAnalysisCount: progress.pendingAnalysisCount,
    analyzingCount: progress.analyzingCount,
    analyzedCount: progress.analyzedCount,
    failedItemCount: progress.failedItemCount,
    lastError
  };
}
