export function getSupabasePublicEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!supabaseAnonKey) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return {
    supabaseUrl,
    supabaseAnonKey
  };
}

export function getSupabaseServerEnv() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!supabaseServiceRoleKey) {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }
  return {
    supabaseUrl,
    supabaseServiceRoleKey
  };
}

export function getGoogleMapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

export function getAppEncryptionKey() {
  const value = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!value) {
    throw new Error("Missing required environment variable: APP_ENCRYPTION_KEY");
  }
  return value;
}

export function getGoogleCalendarOAuthEnv() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const baseUrl = getAppBaseUrl();

  if (!clientId || !clientSecret || !baseUrl) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    baseUrl: baseUrl.replace(/\/$/, "")
  };
}

export function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    null
  );
}

export function getSecurityAlertWebhookUrl() {
  const value = process.env.SECURITY_ALERT_WEBHOOK_URL?.trim();
  return value ? value : null;
}

export function getProductionSecurityConfigPresence() {
  return {
    hasSupabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    hasSupabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasAppEncryptionKey: Boolean(process.env.APP_ENCRYPTION_KEY),
    hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
    hasSendEmailHookSecret: Boolean(process.env.SEND_EMAIL_HOOK_SECRET),
    hasResendFromEmail: Boolean(process.env.RESEND_FROM_EMAIL),
    hasAppUrl: Boolean(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL),
    hasGoogleCalendarClientId: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID),
    hasGoogleCalendarClientSecret: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
    hasSecurityAlertWebhookUrl: Boolean(process.env.SECURITY_ALERT_WEBHOOK_URL)
  };
}
