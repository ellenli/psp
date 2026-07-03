// ---------------------------------------------------------------------------
// Auth + save-search stub.
//
// Designed around Supabase Auth (email magic-link/password + Google OAuth) and
// a `saved_searches` table, but kept dependency-free so the app builds and runs
// without a Supabase project. When NEXT_PUBLIC_SUPABASE_URL /
// NEXT_PUBLIC_SUPABASE_ANON_KEY are set AND @supabase/supabase-js is installed,
// swap the stub bodies for real client calls (see TODOs).
// ---------------------------------------------------------------------------

export interface SearchState {
  neighbourhood: string;
  selectedLeaves: string[];
  places: unknown[];
  censusCharacteristic: string;
}

export interface AuthResult {
  ok: boolean;
  message: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// TODO: when configured, create and memoize a Supabase client:
//   import { createClient } from "@supabase/supabase-js";
//   const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);

/** Email magic-link / password sign-in. Stubbed when Supabase is not configured. */
export async function signInWithEmail(email: string): Promise<AuthResult> {
  if (!isAuthConfigured()) {
    return {
      ok: false,
      message:
        "Auth not configured. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY to enable sign-in.",
    };
  }
  // TODO: return supabase.auth.signInWithOtp({ email });
  return { ok: true, message: `Magic link sent to ${email} (stub).` };
}

/** Google OAuth sign-in. Stubbed when Supabase is not configured. */
export async function signInWithGoogle(): Promise<AuthResult> {
  if (!isAuthConfigured()) {
    return {
      ok: false,
      message:
        "Auth not configured. Set Supabase env vars to enable Google sign-in.",
    };
  }
  // TODO: return supabase.auth.signInWithOAuth({ provider: "google" });
  return { ok: true, message: "Redirecting to Google (stub)." };
}

/** Persist the current search to the user's profile. Stubbed when not configured. */
export async function saveSearch(state: SearchState): Promise<AuthResult> {
  if (!isAuthConfigured()) {
    return {
      ok: false,
      message: "Sign in to save searches (auth not configured).",
    };
  }
  // TODO: const { error } = await supabase.from("saved_searches").insert({ state });
  const count = state.selectedLeaves.length;
  return { ok: true, message: `Search saved (stub): ${count} metrics.` };
}
