import { test } from "node:test";
import assert from "node:assert/strict";
import { configNotReadyMessage } from "./aiFeatureError.js";

test("matches each provider's 'not configured' message", () => {
  assert.match(
    configNotReadyMessage(new Error("OpenAI API key not configured")),
    /audio transcription and AI documentation/,
  );
  assert.match(
    configNotReadyMessage(new Error("Anthropic API key not configured")),
    /AI fax cover-page generation/,
  );
  assert.match(
    configNotReadyMessage(new Error("HeyGen API key not configured")),
    /AI training-video generation/,
  );
  assert.match(
    configNotReadyMessage(new Error("Telnyx API key not configured")),
    /telehealth and messaging/,
  );
});

test("reads the message off a Base44 SDK error shape (response.data.error)", () => {
  const sdkErr = { response: { data: { error: "OpenAI API key not configured" } } };
  assert.match(configNotReadyMessage(sdkErr), /set up yet/);
});

test("reads the message off err.data.error and raw strings", () => {
  assert.ok(configNotReadyMessage({ data: { error: "HeyGen API key not configured" } }));
  assert.ok(configNotReadyMessage("Telnyx API key not configured"));
});

test("is case-insensitive and tolerant of surrounding text", () => {
  assert.ok(
    configNotReadyMessage(new Error("500: openai api key NOT CONFIGURED for this app")),
  );
});

test("returns null for unrelated errors so callers fall back", () => {
  assert.equal(configNotReadyMessage(new Error("Network request failed")), null);
  assert.equal(configNotReadyMessage(new Error("Could not transcribe audio")), null);
  assert.equal(configNotReadyMessage(null), null);
  assert.equal(configNotReadyMessage(undefined), null);
  assert.equal(configNotReadyMessage({}), null);
});

test("does not match a configured/success case mentioning a provider", () => {
  assert.equal(configNotReadyMessage(new Error("OpenAI request timed out")), null);
});
