import { NextResponse } from "next/server";
import { hasManagerAccess } from "@/lib/auth/permissions";
import { getRequestSessionContext } from "@/lib/auth/server";
import { ingestImportUpload } from "@/lib/db/mutations/imports";
import { getImportAssignmentOptions, getRecentImportBatches } from "@/lib/db/queries/imports";
import { getOrganizationSharedDatasetAccess } from "@/lib/db/queries/platform-datasets";
import { getOrganizationUploadConsentStatus } from "@/lib/platform/upload-consent";
import { maybeEscalateRepeatedSecurityEvent } from "@/lib/security/anomaly";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { recordSecurityEvent } from "@/lib/security/security-events";
import { importUploadSchema } from "@/lib/validation/imports";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [itemsResult, sharedDatasetsResult, optionsResult, consentResult] = await Promise.allSettled([
    getRecentImportBatches(context),
    getOrganizationSharedDatasetAccess(context),
    getImportAssignmentOptions(context),
    getOrganizationUploadConsentStatus(context)
  ]);

  if (itemsResult.status === "rejected") {
    console.error("Failed to load recent import batches", itemsResult.reason);
    return NextResponse.json({ error: "Failed to load recent import batches." }, { status: 500 });
  }
  if (sharedDatasetsResult.status === "rejected") {
    console.error("Failed to load shared dataset access", sharedDatasetsResult.reason);
  }

  if (optionsResult.status === "rejected") {
    console.error("Failed to load import assignment options", optionsResult.reason);
  }
  if (consentResult.status === "rejected") {
    console.error("Failed to load import upload consent status", consentResult.reason);
  }

  return NextResponse.json({
    items: itemsResult.value,
    sharedDatasets:
      sharedDatasetsResult.status === "fulfilled"
        ? sharedDatasetsResult.value
        : [],
    options:
      optionsResult.status === "fulfilled"
        ? optionsResult.value
        : { teams: [], users: [] },
    access:
      consentResult.status === "fulfilled"
        ? consentResult.value
        : {
            billingPlan: "starter",
            requiresContributionConsent: false,
            contributedUploadsOnly: false,
            hasCurrentConsent: false,
            consentVersion: null,
            acceptedAt: null
          }
  });
}

export async function POST(request: Request) {
  const context = await getRequestSessionContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasManagerAccess(context)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    request,
    context,
    bucket: "imports_create",
    limit: 10,
    windowSeconds: 600,
    logEventType: "import_create_rate_limit_exceeded"
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many import uploads. Please wait before creating another batch." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const json = await request.json();
  const parsed = importUploadSchema.safeParse(json);
  if (!parsed.success) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "import_batch_invalid_payload",
      severity: "low",
      metadata: {
        issueCount: parsed.error.issues.length
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "import_batch_invalid_payload",
      anomalyEventType: "import_batch_invalid_payload_repeated",
      threshold: 5,
      windowSeconds: 1800,
      severity: "high"
    });
    return NextResponse.json(
      {
        error: "Invalid import payload",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const consentStatus = await getOrganizationUploadConsentStatus(context);
  if (consentStatus.requiresContributionConsent && !consentStatus.hasCurrentConsent) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "import_batch_consent_blocked",
      severity: "medium",
      metadata: {
        billingPlan: consentStatus.billingPlan,
        rowCount: parsed.data.rows.length,
        filename: parsed.data.filename
      }
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "import_batch_consent_blocked",
      anomalyEventType: "import_batch_consent_bypass_attempts_repeated",
      threshold: 3,
      windowSeconds: 1800,
      severity: "high"
    });
    return NextResponse.json(
      {
        error:
          "Bulk upload requires contribution consent on the free plan. Accept the upload terms before importing a list."
      },
      { status: 403 }
    );
  }

  if (parsed.data.rows.length >= 4000) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "import_batch_large_upload",
      severity: "medium",
      metadata: {
        filename: parsed.data.filename,
        rowCount: parsed.data.rows.length,
        listType: parsed.data.listType
      }
    });
  }

  let result;
  try {
    result = await ingestImportUpload(
      {
        ...parsed.data,
        contributionMode: consentStatus.contributedUploadsOnly ? "contributed" : "private",
        contributionTermsVersion: consentStatus.hasCurrentConsent ? consentStatus.consentVersion : null,
        contributionConsentedAt: consentStatus.hasCurrentConsent ? consentStatus.acceptedAt : null
      },
      context
    );
  } catch (error) {
    await recordSecurityEvent({
      request,
      context,
      eventType: "import_batch_create_failed",
      severity: "medium",
      metadata: {
        filename: parsed.data.filename,
        rowCount: parsed.data.rows.length,
        listType: parsed.data.listType,
        visibilityScope: parsed.data.visibilityScope,
        error:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "Unknown import creation failure"
      }
    }).catch((securityError) => {
      console.error("Failed to record import_batch_create_failed security event", securityError);
    });
    await maybeEscalateRepeatedSecurityEvent({
      request,
      context,
      signalEventType: "import_batch_create_failed",
      anomalyEventType: "import_batch_create_failures_repeated",
      threshold: 3,
      windowSeconds: 1800,
      severity: "high"
    }).catch((securityError) => {
      console.error("Failed to escalate repeated import creation failures", securityError);
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create import batch."
      },
      { status: 500 }
    );
  }

  try {
    await recordSecurityEvent({
      request,
      context,
      eventType: "import_batch_created",
      severity: "info",
      metadata: {
        batchId: result.batchId,
        filename: parsed.data.filename,
        listType: parsed.data.listType,
        visibilityScope: parsed.data.visibilityScope,
        assignedTeamId: parsed.data.assignedTeamId ?? null,
        assignedUserId: parsed.data.assignedUserId ?? null,
        contributionMode: consentStatus.contributedUploadsOnly ? "contributed" : "private",
        rowCount: parsed.data.rows.length
      }
    });
  } catch (error) {
    console.error("Failed to record import_batch_created security event", error);
  }
  return NextResponse.json(result);
}
