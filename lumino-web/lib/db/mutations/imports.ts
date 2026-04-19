import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import type { AuthSessionContext } from "@/types/auth";

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
        .select("id,normalized_address")
        .in("normalized_address", uniqueAddresses)
    : { data: [], error: null };
  if (existingPropertiesError) throw existingPropertiesError;

  const leadLookup = new Map((existingLeads ?? []).map((row) => [row.normalized_address as string, row]));
  const propertyLookup = new Map((existingProperties ?? []).map((row) => [row.normalized_address as string, row]));

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

    let propertyId = propertyLookup.get(row.normalizedAddress)?.id as string | undefined;
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
        .select("id,normalized_address")
        .single();
      if (propertyError) throw propertyError;
      propertyId = createdProperty.id as string;
      propertyLookup.set(row.normalizedAddress, createdProperty);
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
