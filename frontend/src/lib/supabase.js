import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "***SUPABASE_URL_REMOVED***";
const SUPABASE_ANON = "***SUPABASE_ANON_KEY_REMOVED***";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export const authFetch = async (url, options = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "Authorization": `Bearer ${token}` },
  });
};
