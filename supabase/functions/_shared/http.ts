// Shared helpers for Edge Functions: CORS restricted to known origins, JSON errors,
// and authenticating the caller from their JWT.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.119.0";

const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5173")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Verifies the bearer token with Supabase Auth and returns the user, or null. */
export async function getCaller(req: Request, admin: SupabaseClient): Promise<User | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** Turns a Postgres error from an RPC into a safe client message. */
export function dbErrorMessage(err: { message?: string; code?: string } | null): string {
  if (!err?.message) return "Something went wrong";
  // Our functions raise human-readable messages; never leak internals for other errors.
  return /^[A-Z][\w\s'’(),.%-]{3,160}$/.test(err.message) ? err.message : "Request could not be completed";
}
