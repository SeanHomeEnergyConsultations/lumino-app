import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv, getSupabaseServerEnv } from "@/lib/utils/env";

export function createServerSupabaseClient() {
  const env = getSupabaseServerEnv();
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false
    }
  });
}

export function createServerSupabaseAnonClient() {
  const env = getSupabasePublicEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false
    }
  });
}
