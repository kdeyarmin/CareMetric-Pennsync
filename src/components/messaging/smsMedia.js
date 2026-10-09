/**
 * smsMedia — the rules for MMS attachments on SmsMessage.media.
 *
 * Inbound: Telnyx's message.received payload lists `media` as
 * `{ url, content_type, size, hash_sha256 }` (InboundMessagePayload, Telnyx
 * OpenAPI spec read 2026-10-09). The spec does not say how long that URL lives,
 * and Telnyx retries a messaging webhook not answered within about two seconds,
 * so the webhook downloads nothing: it records each item as `pending` with the
 * provider URL, and the copyInboundSmsMedia cron copies it into private storage
 * within minutes and drops the URL. The provider URL is never the durable
 * reference; a private `file_uri` is, read only through getSmsMediaUrl.
 *
 * Outbound: the https URLs a sender supplied (`external_url`, status `sent`),
 * recorded so the thread shows an attachment went out and the redrive refuses
 * to re-send an MMS as text only.
 *
 * Pure + unit-tested; generated into the backend functions verbatim
 * (base44/_shared/backendHelpers.mjs, smsMedia).
 */

/** At most this many attachments are recorded for one message. */
export const SMS_MEDIA_LIMIT = 10;
/** An attachment larger than this is not copied (and never downloaded past it). */
export const SMS_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** The attachment types a nurse's thread can hold. Anything else is not copied. */
export const SMS_MEDIA_CONTENT_TYPE =
  /^(?:image\/(?:jpeg|jpg|png|gif|webp|heic|heif|bmp)|audio\/(?:amr|mpeg|mp3|mp4|aac|ogg|wav|x-wav|3gpp)|video\/(?:mp4|3gpp|3gpp2|quicktime|mpeg|webm)|application\/pdf|text\/(?:plain|vcard|x-vcard|calendar|directory))$/;
// MMS presentation parts (SMIL) carry layout, not content: they are not kept.
export const SMS_MEDIA_LAYOUT_TYPE = /^application\/smil$/;

/** A lower-cased MIME type without parameters, when it is one the thread holds. */
export function smsMediaContentType(value) {
  if (typeof value !== "string") return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return SMS_MEDIA_CONTENT_TYPE.test(type) ? type : null;
}

/**
 * The URL to fetch an attachment from, or null: https only, no credentials or
 * fragment, a dotted host name (never an IP literal or a single-label/local
 * name), bounded length.
 */
export function smsMediaFetchUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host === "localhost"
    || /^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) return null;
  return url.toString();
}

/**
 * The `media` an inbound row is created with: each supported item pending with
 * its provider URL, anything else unavailable, layout parts dropped. Never
 * fetches. Returns [] when the payload has no media.
 */
export function inboundSmsMediaPlaceholders(rawMedia) {
  const items = Array.isArray(rawMedia) ? rawMedia : [];
  const placeholders = [];
  for (const item of items) {
    if (placeholders.length >= SMS_MEDIA_LIMIT) break;
    const declared = typeof item?.content_type === "string" ? item.content_type.split(";")[0].trim().toLowerCase() : "";
    if (SMS_MEDIA_LAYOUT_TYPE.test(declared)) continue;
    const contentType = smsMediaContentType(declared);
    const size = Number.isSafeInteger(item?.size) && item.size >= 0 ? item.size : null;
    const url = smsMediaFetchUrl(item?.url);
    if (!contentType || !url || (size != null && size > SMS_MEDIA_MAX_BYTES)) {
      placeholders.push({ status: "unavailable", content_type: contentType, byte_size: size });
    } else {
      placeholders.push({ status: "pending", content_type: contentType, byte_size: size, external_url: url, attempts: 0 });
    }
  }
  return placeholders;
}

/** True for a private file URI as UploadPrivateFile returns one. */
export function isPrivateSmsFileUri(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && ![...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    && (value.startsWith("private/") || value.startsWith("private://")
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}

/** A file name for a copied attachment that carries no PHI. */
export function smsMediaFileName(rowId, index, contentType) {
  const subtype = String(contentType || "").split("/")[1] || "bin";
  const extension = subtype.replace(/^x-/, "").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const id = String(rowId || "message").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "message";
  return `mms-${id}-${Number(index) || 0}.${extension}`;
}
