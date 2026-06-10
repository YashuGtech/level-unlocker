// Server-side Supabase client with service role key - bypasses RLS.
// Values come from a committed server-only config so the project works
// without any Lovable Cloud or env setup. Override via env vars if desired.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  PUBLIC_SUPABASE_URL as FALLBACK_URL,
  SERVER_SUPABASE_SERVICE_ROLE_KEY as FALLBACK_SERVICE_ROLE,
} from './config.server';

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL || FALLBACK_URL;
  const SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || FALLBACK_SERVICE_ROLE;

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// Server-side Supabase client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Import like: import { supabaseAdmin } from "@/integrations/supabase/client.server";
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
