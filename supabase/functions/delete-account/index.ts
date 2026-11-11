// POST {} — permanently deletes the caller's account (DPDP Act right to erasure).
// Refused while the person has a live loan, so nobody walks away with an item.
// Deleting the auth user cascades to their profile, items, memberships, messages'
// sender link (set null), notifications and trust history.
import { corsHeaders, getCaller, json, serviceClient } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  const admin = serviceClient();
  const user = await getCaller(req, admin);
  if (!user) return json(req, 401, { error: "Please sign in" });

  const blockers = await admin.rpc("account_deletion_blockers", { p_user: user.id });
  if (blockers.error) return json(req, 500, { error: "Could not check your loans" });
  if ((blockers.data as number) > 0) {
    return json(req, 409, { error: "Finish or cancel your active loans before deleting your account" });
  }

  // Remove item photos this user uploaded (best effort; DB rows cascade).
  const { data: items } = await admin.from("items").select("id, circle_id").eq("owner_id", user.id);
  for (const it of items ?? []) {
    const folder = `${it.circle_id}/${it.id}`;
    const { data: files } = await admin.storage.from("item-photos").list(folder);
    if (files?.length) await admin.storage.from("item-photos").remove(files.map((f) => `${folder}/${f.name}`));
  }

  const del = await admin.auth.admin.deleteUser(user.id);
  if (del.error) return json(req, 500, { error: "Deletion failed, please contact support" });
  return json(req, 200, { deleted: true });
});
