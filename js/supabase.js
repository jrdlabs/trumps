import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export async function ensureAnonymousSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const result = await supabase.auth.signInAnonymously();
  if (result.error) throw result.error;
  return result.data.session;
}

