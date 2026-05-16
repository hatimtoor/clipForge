import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://ajhvzmdrbvtaxtmjonmh.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqaHZ6bWRyYnZ0YXh0bWpvbm1oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NDMwNzcsImV4cCI6MjA5NDQxOTA3N30.h91htClNVaZYbfcFEJkUbCz59PvQrkWMuvbcf2EgV1A";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export const authFetch = async (url, options = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "Authorization": `Bearer ${token}` },
  });
};
