import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadFailureMessage,
  readUploadErrorDetail,
  MISSING_FILE_URL_MESSAGE,
} from "./uploadError.js";

// A rejection shaped like the SDK's Base44Error (status + message + data).
const sdkError = (status, message = "", data = undefined) =>
  Object.assign(new Error(message), { status, data });

test("offline is reported as offline, whatever the underlying error looks like", () => {
  assert.match(
    uploadFailureMessage(sdkError(500, "boom"), { online: false }),
    /offline/i,
  );
});

test("a rejection with no status means the request never got a response", () => {
  const msg = uploadFailureMessage(new Error("Network Error"), { online: true });
  assert.match(msg, /Couldn't reach the server/);
  assert.match(msg, /check your connection/i);
});

test("auth and permission failures tell the user what to do instead of 'try again'", () => {
  assert.match(uploadFailureMessage(sdkError(401), { online: true }), /session has expired/i);
  assert.doesNotMatch(uploadFailureMessage(sdkError(401), { online: true }), /try again/i);
  assert.match(uploadFailureMessage(sdkError(403), { online: true }), /permission/i);
});

test("a server-side size rejection is distinguishable from a generic failure", () => {
  assert.match(uploadFailureMessage(sdkError(413), { online: true }), /too large/i);
});

test("quota, rate-limit, media-type, and misconfiguration each get their own message", () => {
  assert.match(uploadFailureMessage(sdkError(402), { online: true }), /quota/i);
  assert.match(uploadFailureMessage(sdkError(429), { online: true }), /too many uploads/i);
  assert.match(uploadFailureMessage(sdkError(415), { online: true }), /file type/i);
  assert.match(uploadFailureMessage(sdkError(404), { online: true }), /app configuration/i);
});

test("5xx is reported as temporary", () => {
  assert.match(uploadFailureMessage(sdkError(503), { online: true }), /temporarily unavailable/i);
  assert.match(uploadFailureMessage(sdkError(500), { online: true }), /temporarily unavailable/i);
});

test("the noun is used so the message names what failed to upload", () => {
  assert.match(
    uploadFailureMessage(sdkError(413), { online: true, noun: "referral document" }),
    /referral document/,
  );
});

test("an unmapped 4xx echoes the server's own short explanation", () => {
  const err = sdkError(409, "", { detail: "A file with that name is still processing" });
  assert.match(uploadFailureMessage(err, { online: true }), /still processing/);
});

test("readUploadErrorDetail refuses HTML bodies, long blobs, and axios boilerplate", () => {
  assert.equal(readUploadErrorDetail({ data: { error: "<html><body>502</body></html>" } }), "");
  assert.equal(readUploadErrorDetail(new Error("x".repeat(500))), "");
  assert.equal(readUploadErrorDetail(new Error("Network Error")), "");
  assert.equal(readUploadErrorDetail(new Error("Request failed with status code 500")), "");
  assert.equal(readUploadErrorDetail(new Error("Storage bucket is full")), "Storage bucket is full");
});

test("readUploadErrorDetail reads every shape the SDK and axios produce", () => {
  assert.equal(readUploadErrorDetail({ response: { data: { detail: "from detail" } } }), "from detail");
  assert.equal(readUploadErrorDetail({ response: { data: { message: "from message" } } }), "from message");
  assert.equal(readUploadErrorDetail({ data: { error: "from data.error" } }), "from data.error");
  assert.equal(readUploadErrorDetail("plain string"), "plain string");
  assert.equal(readUploadErrorDetail(undefined), "");
});

test("a response without a file_url has its own message and is never silent", () => {
  assert.match(MISSING_FILE_URL_MESSAGE, /no file link/i);
});
