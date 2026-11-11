// POST multipart/form-data { loan_id, stage: "pickup"|"return", photo: File }
//
// Why this runs on the server instead of uploading straight from the browser:
//  • The client can never write to the handover-photos bucket, so neither party
//    can replace or delete evidence later.
//  • The SHA-256 and timestamp are computed here, not trusted from the client.
//  • File type is checked from the actual bytes (magic numbers), not the filename.
import { corsHeaders, dbErrorMessage, getCaller, json, serviceClient } from "../_shared/http.ts";

const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sniffImage(b: Uint8Array<ArrayBuffer>): { mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  const ascii = (from: number, to: number) => new TextDecoder("ascii").decode(b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  const admin = serviceClient();
  const user = await getCaller(req, admin);
  if (!user) return json(req, 401, { error: "Please sign in" });

  const length = Number(req.headers.get("Content-Length") ?? "0");
  if (length > MAX_BYTES + 64 * 1024) return json(req, 413, { error: "Photo must be under 5 MB" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(req, 400, { error: "Invalid upload" });
  }
  const loanId = String(form.get("loan_id") ?? "");
  const stage = String(form.get("stage") ?? "");
  const file = form.get("photo");
  if (!UUID.test(loanId) || (stage !== "pickup" && stage !== "return") || !(file instanceof File)) {
    return json(req, 400, { error: "Invalid upload" });
  }
  if (file.size === 0 || file.size > MAX_BYTES) return json(req, 413, { error: "Photo must be under 5 MB" });

  // 1. Is this person allowed to add a photo to this loan at this stage?
  const check = await admin.rpc("check_handover_upload", { p_user: user.id, p_loan: loanId, p_stage: stage });
  if (check.error) return json(req, 403, { error: dbErrorMessage(check.error) });

  // 2. Validate the bytes themselves.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return json(req, 415, { error: "Only JPEG, PNG or WebP photos are accepted" });
  const hash = await sha256Hex(bytes);

  // 3. Store at a server-chosen path. upsert:false means nothing can be overwritten.
  const path = `${loanId}/${stage}/${user.id}/${crypto.randomUUID()}.${kind.ext}`;
  const up = await admin.storage.from("handover-photos").upload(path, bytes, {
    contentType: kind.mime, upsert: false, cacheControl: "private, max-age=0",
  });
  if (up.error) return json(req, 500, { error: "Upload failed, please retry" });

  // 4. Record it (re-validates inside the database). Roll back the file on failure.
  const rec = await admin.rpc("record_handover_photo", {
    p_user: user.id, p_loan: loanId, p_stage: stage, p_path: path,
    p_sha256: hash, p_size: bytes.length, p_mime: kind.mime,
  });
  if (rec.error) {
    await admin.storage.from("handover-photos").remove([path]);
    return json(req, 409, { error: dbErrorMessage(rec.error) });
  }

  return json(req, 201, { id: rec.data, sha256: hash });
});
