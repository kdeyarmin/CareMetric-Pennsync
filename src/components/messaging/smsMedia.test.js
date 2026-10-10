import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SMS_MEDIA_LIMIT, SMS_MEDIA_MAX_BYTES, inboundSmsMediaPlaceholders, isPrivateSmsFileUri,
  smsMediaContentType, smsMediaFetchUrl, smsMediaFileName,
} from "./smsMedia.js";

test("an inbound attachment is recorded pending with its provider URL, never fetched", () => {
  const media = inboundSmsMediaPlaceholders([
    { url: "https://media.example.test/mms/abc.jpg", content_type: "image/jpeg", size: 1234, hash_sha256: "x" },
  ]);
  assert.deepEqual(media, [{
    status: "pending", content_type: "image/jpeg", byte_size: 1234,
    external_url: "https://media.example.test/mms/abc.jpg", attempts: 0,
  }]);
});

test("an attachment the thread cannot hold is unavailable, and SMIL layout parts are dropped", () => {
  const media = inboundSmsMediaPlaceholders([
    { url: "https://media.example.test/a.smil", content_type: "application/smil" },
    { url: "http://media.example.test/plain-http.jpg", content_type: "image/jpeg" },
    { url: "https://media.example.test/page.html", content_type: "text/html" },
    { url: "https://media.example.test/huge.mp4", content_type: "video/mp4", size: SMS_MEDIA_MAX_BYTES + 1 },
    { url: "https://10.0.0.1/inside.jpg", content_type: "image/png" },
  ]);
  assert.deepEqual(media.map((item) => item.status), ["unavailable", "unavailable", "unavailable", "unavailable"]);
  assert.ok(media.every((item) => !("external_url" in item)), "a URL that will not be fetched is not kept");
});

test("at most SMS_MEDIA_LIMIT attachments are recorded", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ url: `https://media.example.test/${i}.png`, content_type: "image/png" }));
  assert.equal(inboundSmsMediaPlaceholders(many).length, SMS_MEDIA_LIMIT);
  assert.deepEqual(inboundSmsMediaPlaceholders(undefined), []);
});

test("only https URLs on a named public host are fetched", () => {
  assert.equal(smsMediaFetchUrl("https://media.example.test/x.jpg"), "https://media.example.test/x.jpg");
  for (const bad of [
    "http://media.example.test/x.jpg", "https://user:pw@media.example.test/x.jpg", "https://media.example.test/x.jpg#frag",
    "https://localhost/x.jpg", "https://127.0.0.1/x.jpg", "https://[::1]/x.jpg", "https://intranet/x.jpg",
    "https://svc.internal/x.jpg", "ftp://media.example.test/x", "", null, `https://a.test/${"x".repeat(2100)}`,
  ]) {
    assert.equal(smsMediaFetchUrl(bad), null, String(bad).slice(0, 60));
  }
});

test("content types are normalized and allow-listed", () => {
  assert.equal(smsMediaContentType("Image/JPEG; charset=binary"), "image/jpeg");
  assert.equal(smsMediaContentType("application/pdf"), "application/pdf");
  assert.equal(smsMediaContentType("text/html"), null);
  assert.equal(smsMediaContentType("image/svg+xml"), null, "SVG can carry script");
  assert.equal(smsMediaContentType(undefined), null);
});

test("a private file URI is recognised exactly; a public URL is not one", () => {
  assert.equal(isPrivateSmsFileUri("private/abc/mms-1-0.jpg"), true);
  assert.equal(isPrivateSmsFileUri("mp/private/0123456789abcdef01234567/mms.jpg"), true);
  assert.equal(isPrivateSmsFileUri("https://storage.example.test/public/mms.jpg"), false);
  assert.equal(isPrivateSmsFileUri(" private/abc"), false);
  assert.equal(isPrivateSmsFileUri(null), false);
});

test("a copied attachment's file name carries no PHI", () => {
  assert.equal(smsMediaFileName("SmsMessage_12", 2, "image/jpeg"), "mms-SmsMessage_12-2.jpeg");
  assert.equal(smsMediaFileName("a/../b", 0, "text/x-vcard"), "mms-ab-0.vcard");
  assert.equal(smsMediaFileName("", 0, null), "mms-message-0.bin");
});
