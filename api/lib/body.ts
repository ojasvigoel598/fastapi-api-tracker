/**
 * Bounded request-body reader.
 *
 * The content-length header check in boot.ts rejects oversized bodies when
 * the client sends a length, but a chunked / unknown-length request (no
 * `content-length`) bypasses that check entirely. This reader consumes the
 * stream with a hard byte cap so a hostile client cannot stream an
 * unbounded body into memory. Callers use it instead of `request.json()`
 * on endpoints that accept a body.
 */

export const MAX_BODY_BYTES = 50 * 1024 * 1024;

export type BoundedBodyResult =
  | { ok: true; bytes: Uint8Array; text: string }
  | { ok: false };

/** Read at most `maxBytes` from a request body; null when the cap is hit. */
export async function readBodyBounded(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BoundedBodyResult> {
  const body = request.body;
  if (!body) return { ok: true, bytes: new Uint8Array(0), text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) return { ok: false };
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes, text: new TextDecoder().decode(bytes) };
}

/** Parse a bounded body as JSON. Returns undefined on malformed JSON. */
export async function readJsonBounded(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too_large" | "malformed" }> {
  const body = await readBodyBounded(request, maxBytes);
  if (!body.ok) return { ok: false, reason: "too_large" };
  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}
