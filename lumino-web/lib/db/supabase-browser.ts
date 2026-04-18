import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/utils/env";

export function createBrowserSupabaseClient() {
  try {
    const env = getSupabasePublicEnv();
    return createClient(env.supabaseUrl, env.supabaseAnonKey);
  } catch {
    return null;
  }
}
