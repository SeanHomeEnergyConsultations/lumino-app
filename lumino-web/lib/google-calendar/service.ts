import { randomUUID } from "crypto";
import { createServerSupabaseClient } from "@/lib/db/supabase-server";
import { DEFAULT_APPOINTMENT_DURATION_MINUTES } from "@/lib/appointments/calendar";
import { getAppointmentByLeadId } from "@/lib/db/queries/appointments";
import { getTaskCalendarItem } from "@/lib/db/queries/tasks";
import { decryptSensitiveValue, encryptSensitiveValue, isEncryptedValue } from "@/lib/security/crypto";
import { getGoogleCalendarOAuthEnv } from "@/lib/utils/env";
import type { AuthSessionContext } from "@/types/auth";

const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy"
];

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

type GoogleCalendarConnectionRow = {
  id: string;
  user_id: string;
  organization_id: string;
  provider: "google_calendar";
  calendar_id: string;
  calendar_email: string | null;
  access_token: string | null;
  refresh_token: string;
  token_scope: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
};

type AuthorizedGoogleCalendarConnection = Omit<GoogleCalendarConnectionRow, "access_token" | "refresh_token"> & {
  access_token: string | null;
  refresh_token: string;
};

function requireGoogleCalendarEnv() {
  const env = getGoogleCalendarOAuthEnv();
  if (!env) {
    throw new Error("Google Calendar integration is not configured.");
  }
  return env;
}

function getGoogleCalendarRedirectUri() {
  const env = requireGoogleCalendarEnv();
  return `${env.baseUrl}/api/integrations/google-calendar/callback`;
}

async function exchangeCodeForTokens(code: string) {
  const env = requireGoogleCalendarEnv();
  const body = new URLSearchParams({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: getGoogleCalendarRedirectUri(),
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  return (await response.json()) as GoogleTokenResponse;
}

async function refreshGoogleAccessToken(connection: GoogleCalendarConnectionRow) {
  const env = requireGoogleCalendarEnv();
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: decryptSensitiveValue(connection.refresh_token),
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed: ${text}`);
  }
  return (await response.json()) as GoogleTokenResponse;
}

async function getAuthorizedConnection(userId: string) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_google_calendar_connections")
    .select(
      "id,user_id,organization_id,provider,calendar_id,calendar_email,access_token,refresh_token,token_scope,token_expires_at,last_synced_at,last_error"
    )
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const storedConnection = data as GoogleCalendarConnectionRow;
  const connection: AuthorizedGoogleCalendarConnection = {
    ...storedConnection,
    access_token: storedConnection.access_token ? decryptSensitiveValue(storedConnection.access_token) : null,
    refresh_token: decryptSensitiveValue(storedConnection.refresh_token)
  };
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  const needsRefresh = !connection.access_token || !expiresAt || expiresAt <= Date.now() + 60_000;
  const needsTokenMigration =
    Boolean(storedConnection.access_token && !isEncryptedValue(storedConnection.access_token)) ||
    !isEncryptedValue(storedConnection.refresh_token);

  if (!needsRefresh && !needsTokenMigration) {
    return { connection, accessToken: connection.access_token as string };
  }

  if (!needsRefresh && needsTokenMigration) {
    const { error: migrationError } = await supabase
      .from("user_google_calendar_connections")
      .update({
        access_token: connection.access_token ? encryptSensitiveValue(connection.access_token) : null,
        refresh_token: encryptSensitiveValue(connection.refresh_token),
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", connection.id);

    if (migrationError) throw migrationError;

    return { connection, accessToken: connection.access_token as string };
  }

  const refreshed = await refreshGoogleAccessToken(connection);
  const nextExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
    : connection.token_expires_at;

  const { error: updateError } = await supabase
    .from("user_google_calendar_connections")
    .update({
      access_token: encryptSensitiveValue(refreshed.access_token),
      refresh_token: encryptSensitiveValue(connection.refresh_token),
      token_scope: refreshed.scope ?? connection.token_scope,
      token_expires_at: nextExpiresAt,
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", connection.id);

  if (updateError) throw updateError;

  return {
    connection: {
      ...connection,
      access_token: refreshed.access_token,
      token_scope: refreshed.scope ?? connection.token_scope,
      token_expires_at: nextExpiresAt ?? null
    },
    accessToken: refreshed.access_token
  };
}

async function googleApiRequest<T>(input: {
  userId: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}) {
  const authorized = await getAuthorizedConnection(input.userId);
  if (!authorized) {
    throw new Error("Google Calendar is not connected.");
  }

  const response = await fetch(`https://www.googleapis.com/calendar/v3${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${authorized.accessToken}`,
      ...(input.body ? { "Content-Type": "application/json" } : {})
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Calendar request failed: ${text}`);
  }

  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function taskDurationMinutes(type: string) {
  switch (type) {
    case "call":
    case "text":
    case "appointment_confirm":
      return 15;
    case "revisit":
      return 30;
    default:
      return 30;
  }
}

export function isGoogleCalendarConfigured() {
  return Boolean(getGoogleCalendarOAuthEnv());
}

export async function getGoogleCalendarConnectionStatus(context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_google_calendar_connections")
    .select("calendar_email,last_synced_at,last_error,updated_at")
    .eq("user_id", context.appUser.id)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (error) throw error;

  return {
    configured: isGoogleCalendarConfigured(),
    connected: Boolean(data),
    calendarEmail: (data?.calendar_email as string | null | undefined) ?? null,
    lastSyncedAt: (data?.last_synced_at as string | null | undefined) ?? null,
    lastError: (data?.last_error as string | null | undefined) ?? null,
    updatedAt: (data?.updated_at as string | null | undefined) ?? null
  };
}

export async function createGoogleCalendarConnectUrl(
  context: AuthSessionContext,
  options?: { redirectPath?: string | null }
) {
  const env = requireGoogleCalendarEnv();
  if (!context.organizationId) {
    throw new Error("No active organization selected.");
  }

  const supabase = createServerSupabaseClient();
  const stateToken = randomUUID();
  const redirectPath = options?.redirectPath?.startsWith("/") ? options.redirectPath : "/appointments";

  await supabase.from("google_calendar_oauth_states").insert({
    user_id: context.appUser.id,
    organization_id: context.organizationId,
    provider: "google_calendar",
    state_token: stateToken,
    redirect_path: redirectPath,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
  });

  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: getGoogleCalendarRedirectUri(),
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: stateToken,
    scope: GOOGLE_CALENDAR_SCOPES.join(" ")
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function completeGoogleCalendarOAuthCallback(params: { code: string; state: string }) {
  const supabase = createServerSupabaseClient();
  const { data: stateRow, error: stateError } = await supabase
    .from("google_calendar_oauth_states")
    .select("id,user_id,organization_id,state_token,redirect_path,expires_at,consumed_at")
    .eq("state_token", params.state)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (stateError) throw stateError;
  if (!stateRow) {
    throw new Error("Invalid Google Calendar state.");
  }
  if (stateRow.consumed_at) {
    throw new Error("Google Calendar state already used.");
  }
  if (new Date(stateRow.expires_at as string).getTime() < Date.now()) {
    throw new Error("Google Calendar state expired.");
  }

  const { data: existingConnection, error: existingConnectionError } = await supabase
    .from("user_google_calendar_connections")
    .select("refresh_token")
    .eq("user_id", stateRow.user_id)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (existingConnectionError) throw existingConnectionError;

  const tokens = await exchangeCodeForTokens(params.code);
  const existingRefreshToken =
    typeof existingConnection?.refresh_token === "string"
      ? decryptSensitiveValue(existingConnection.refresh_token)
      : undefined;
  const refreshToken = tokens.refresh_token ?? existingRefreshToken;
  if (!refreshToken) {
    throw new Error("Google did not return a refresh token.");
  }
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;

  const { error: upsertError } = await supabase
    .from("user_google_calendar_connections")
    .upsert(
      {
        user_id: stateRow.user_id,
        organization_id: stateRow.organization_id,
        provider: "google_calendar",
        calendar_id: "primary",
        access_token: encryptSensitiveValue(tokens.access_token),
        refresh_token: encryptSensitiveValue(refreshToken),
        token_scope: tokens.scope ?? GOOGLE_CALENDAR_SCOPES.join(" "),
        token_expires_at: expiresAt,
        last_error: null,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "user_id,provider"
      }
    );

  if (upsertError) throw upsertError;

  await supabase
    .from("google_calendar_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", stateRow.id);

  return {
    redirectPath: ((stateRow.redirect_path as string | null | undefined) ?? "/appointments").trim() || "/appointments"
  };
}

export async function disconnectGoogleCalendar(context: AuthSessionContext) {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("user_google_calendar_connections")
    .delete()
    .eq("user_id", context.appUser.id)
    .eq("provider", "google_calendar");

  if (error) throw error;
}

export async function checkGoogleCalendarConflicts(input: {
  context: AuthSessionContext;
  startAt: string;
  endAt?: string | null;
}) {
  const start = new Date(input.startAt);
  const end = input.endAt ? new Date(input.endAt) : addMinutes(start, DEFAULT_APPOINTMENT_DURATION_MINUTES);

  const result = await googleApiRequest<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  }>({
    userId: input.context.appUser.id,
    path: "/freeBusy",
    method: "POST",
    body: {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      items: [{ id: "primary" }]
    }
  });

  const busy = result?.calendars?.primary?.busy ?? [];
  return {
    connected: true,
    hasConflict: busy.length > 0,
    busy
  };
}

function buildGoogleCalendarEventPayload(input: {
  item: NonNullable<Awaited<ReturnType<typeof getAppointmentByLeadId>>>;
  appUrl: string;
}) {
  const start = new Date(input.item.scheduledAt);
  const end = addMinutes(start, DEFAULT_APPOINTMENT_DURATION_MINUTES);
  const propertyUrl = `${input.appUrl}/properties/${encodeURIComponent(input.item.propertyId)}`;
  const mapUrl = `${input.appUrl}/map?propertyId=${encodeURIComponent(input.item.propertyId)}`;

  return {
    summary: `${input.item.contactName ?? "Homeowner appointment"} - ${input.item.address}`,
    description: [
      `Scheduled from Lumino`,
      `Contact: ${input.item.contactName ?? "Unknown homeowner"}`,
      `Phone: ${input.item.phone ?? "Not captured"}`,
      `Email: ${input.item.email ?? "Not captured"}`,
      `Lead status: ${input.item.leadStatus ?? "Unknown"}`,
      `Property: ${propertyUrl}`,
      `Map: ${mapUrl}`
    ].join("\n"),
    location: [input.item.address, [input.item.city, input.item.state].filter(Boolean).join(", ")].filter(Boolean).join(", "),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    status: "confirmed",
    extendedProperties: {
      private: {
        luminoLeadId: input.item.leadId,
        luminoPropertyId: input.item.propertyId
      }
    }
  };
}

function buildTaskGoogleCalendarEventPayload(input: {
  item: NonNullable<Awaited<ReturnType<typeof getTaskCalendarItem>>>;
  appUrl: string;
}) {
  const start = new Date(input.item.dueAt as string);
  const end = addMinutes(start, taskDurationMinutes(input.item.type));
  const propertyUrl = input.item.propertyId
    ? `${input.appUrl}/properties/${encodeURIComponent(input.item.propertyId)}`
    : `${input.appUrl}/tasks`;
  const mapUrl = input.item.propertyId
    ? `${input.appUrl}/map?propertyId=${encodeURIComponent(input.item.propertyId)}`
    : `${input.appUrl}/tasks`;

  return {
    summary: `Lumino task: ${input.item.type.replaceAll("_", " ")} - ${input.item.address}`,
    description: [
      "Scheduled from Lumino",
      `Task type: ${input.item.type.replaceAll("_", " ")}`,
      `Lead status: ${input.item.leadStatus ?? "Unknown"}`,
      `Owner: ${input.item.ownerName ?? "Unassigned"}`,
      `Notes: ${input.item.notes ?? "No notes"}`,
      `Property: ${propertyUrl}`,
      `Map: ${mapUrl}`
    ].join("\n"),
    location: [input.item.address, [input.item.city, input.item.state].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(", "),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    status: "confirmed",
    transparency: "transparent",
    visibility: "private",
    extendedProperties: {
      private: {
        luminoTaskId: input.item.taskId,
        luminoLeadId: input.item.leadId ?? "",
        luminoPropertyId: input.item.propertyId ?? ""
      }
    }
  };
}

export async function syncAppointmentToGoogleCalendar(input: {
  context: AuthSessionContext;
  leadId: string;
  appUrl: string;
}) {
  const item = await getAppointmentByLeadId(input.context, input.leadId);
  if (!item) return { synced: false, reason: "appointment_not_found" as const };

  const authorized = await getAuthorizedConnection(input.context.appUser.id);
  if (!authorized) return { synced: false, reason: "not_connected" as const };

  const supabase = createServerSupabaseClient();
  const { data: existingSync, error: syncLookupError } = await supabase
    .from("appointment_calendar_syncs")
    .select("id,external_event_id")
    .eq("user_id", input.context.appUser.id)
    .eq("lead_id", input.leadId)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (syncLookupError) throw syncLookupError;

  const payload = buildGoogleCalendarEventPayload({ item, appUrl: input.appUrl });
  let externalEventId = existingSync?.external_event_id as string | null | undefined;

  if (externalEventId) {
    await googleApiRequest({
      userId: input.context.appUser.id,
      path: `/calendars/${encodeURIComponent(authorized.connection.calendar_id)}/events/${encodeURIComponent(externalEventId)}`,
      method: "PUT",
      body: payload
    });
  } else {
    const created = await googleApiRequest<{ id: string }>({
      userId: input.context.appUser.id,
      path: `/calendars/${encodeURIComponent(authorized.connection.calendar_id)}/events`,
      method: "POST",
      body: payload
    });
    externalEventId = created.id;
  }

  const timestamp = new Date().toISOString();

  const { error: upsertError } = await supabase
    .from("appointment_calendar_syncs")
    .upsert(
      {
        organization_id: input.context.organizationId,
        user_id: input.context.appUser.id,
        lead_id: input.leadId,
        provider: "google_calendar",
        calendar_id: authorized.connection.calendar_id,
        external_event_id: externalEventId,
        sync_status: "synced",
        last_synced_at: timestamp,
        last_error: null,
        updated_at: timestamp
      },
      { onConflict: "user_id,lead_id,provider" }
    );

  if (upsertError) throw upsertError;

  await supabase
    .from("user_google_calendar_connections")
    .update({
      last_synced_at: timestamp,
      last_error: null,
      updated_at: timestamp
    })
    .eq("id", authorized.connection.id);

  return { synced: true, eventId: externalEventId };
}

export async function deleteSyncedGoogleCalendarAppointment(input: {
  context: AuthSessionContext;
  leadId: string;
}) {
  const authorized = await getAuthorizedConnection(input.context.appUser.id);
  if (!authorized) return { deleted: false, reason: "not_connected" as const };

  const supabase = createServerSupabaseClient();
  const { data: existingSync, error } = await supabase
    .from("appointment_calendar_syncs")
    .select("id,external_event_id")
    .eq("user_id", input.context.appUser.id)
    .eq("lead_id", input.leadId)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (error) throw error;
  if (!existingSync?.external_event_id) return { deleted: false, reason: "not_synced" as const };

  await googleApiRequest({
    userId: input.context.appUser.id,
    path: `/calendars/${encodeURIComponent(authorized.connection.calendar_id)}/events/${encodeURIComponent(
      existingSync.external_event_id as string
    )}`,
    method: "DELETE"
  });

  await supabase
    .from("appointment_calendar_syncs")
    .update({
      sync_status: "deleted",
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", existingSync.id);

  return { deleted: true };
}

export async function syncTaskToGoogleCalendar(input: {
  context: AuthSessionContext;
  taskId: string;
  appUrl: string;
}) {
  const item = await getTaskCalendarItem(input.context, input.taskId);
  if (!item || !item.dueAt || item.status === "completed" || item.status === "cancelled") {
    return { synced: false, reason: "task_not_syncable" as const };
  }

  const authorized = await getAuthorizedConnection(input.context.appUser.id);
  if (!authorized) return { synced: false, reason: "not_connected" as const };

  const supabase = createServerSupabaseClient();
  const { data: existingSync, error: syncLookupError } = await supabase
    .from("task_calendar_syncs")
    .select("id,external_event_id")
    .eq("user_id", input.context.appUser.id)
    .eq("task_id", input.taskId)
    .eq("provider", "google_calendar")
    .maybeSingle();

  if (syncLookupError) throw syncLookupError;

  const payload = buildTaskGoogleCalendarEventPayload({ item, appUrl: input.appUrl });
  let externalEventId = existingSync?.external_event_id as string | null | undefined;

  if (externalEventId) {
    await googleApiRequest({
      userId: input.context.appUser.id,
      path: `/calendars/${encodeURIComponent(authorized.connection.calendar_id)}/events/${encodeURIComponent(externalEventId)}`,
      method: "PUT",
      body: payload
    });
  } else {
    const created = await googleApiRequest<{ id: string }>({
      userId: input.context.appUser.id,
      path: `/calendars/${encodeURIComponent(authorized.connection.calendar_id)}/events`,
      method: "POST",
      body: payload
    });
    externalEventId = created.id;
  }

  const timestamp = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("task_calendar_syncs")
    .upsert(
      {
        organization_id: input.context.organizationId,
        user_id: input.context.appUser.id,
        task_id: input.taskId,
        provider: "google_calendar",
        calendar_id: authorized.connection.calendar_id,
        external_event_id: externalEventId,
        sync_status: "synced",
        last_synced_at: timestamp,
        last_error: null,
        updated_at: timestamp
      },
      { onConflict: "user_id,task_id,provider" }
    );

  if (upsertError) throw upsertError;

  await supabase
    .from("user_google_calendar_connections")
    .update({
      last_synced_at: timestamp,
      last_error: null,
      updated_at: timestamp
    })
    .eq("id", authorized.connection.id);

  return { synced: true, eventId: externalEventId };
}
