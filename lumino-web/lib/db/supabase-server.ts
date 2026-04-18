import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerEnv } from "@/lib/utils/env";

export function createServerSupabaseClient() {
  const env = getSupabaseServerEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false
    }
  });
}
