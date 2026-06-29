import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Contract harness for the @telnyx/video client used by the telehealth UI.
 *
 * We can't open a live video room in CI, but we CAN validate — against the
 * installed SDK's TypeScript declarations — that every Room method, event, and
 * top-level export VideoRoom.jsx / NetworkMonitor.jsx rely on actually exists in
 * the pinned @telnyx/video version. This catches the class of bug that a live
 * smoke test would (a renamed/absent SDK symbol) without needing a token, and it
 * fails loudly if a future SDK bump renames something out from under us.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const sdkLib = join(repoRoot, "node_modules", "@telnyx", "video", "lib");

const read = (p) => readFileSync(p, "utf8");
const roomDts = read(join(sdkLib, "room.d.ts"));
const indexDts = read(join(sdkLib, "index.d.ts"));

// --- parse the SDK surface from its .d.ts ---

// Top-level exports, e.g. `export { version, getDevices, initialize, Room, ... }`.
function parseIndexExports(src) {
  const m = src.match(/export\s*\{([^}]*)\}/s);
  if (!m) return new Set();
  return new Set(m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean));
}

// Method names declared on the `Room` immutable type. Matches `name:` / `name(` /
// `name<` at the start of a (trimmed) line inside the Room block.
function parseRoomMethods(src) {
  const start = src.indexOf("Room = Immutable<{");
  const block = start >= 0 ? src.slice(start, src.indexOf("}>;", start)) : src;
  const names = new Set();
  for (const line of block.split("\n")) {
    const m = line.trim().match(/^(\w+)\s*[<(:]/);
    if (m) names.add(m[1]);
  }
  return names;
}

// Event names from `interface Events { ... }`.
function parseEvents(src) {
  const start = src.indexOf("interface Events {");
  if (start < 0) return new Set();
  const block = src.slice(start, src.indexOf("}", start));
  const names = new Set();
  for (const line of block.split("\n")) {
    const m = line.trim().match(/^(\w+)\s*:/);
    if (m) names.add(m[1]);
  }
  return names;
}

const sdkExports = parseIndexExports(indexDts);
const sdkRoomMethods = parseRoomMethods(roomDts);
const sdkEvents = parseEvents(roomDts);

// --- what the telehealth components actually depend on ---

const REQUIRED_EXPORTS = ["initialize"];
const REQUIRED_ROOM_METHODS = [
  "on",
  "connect",
  "disconnect",
  "getState",
  "addStream",
  "updateStream",
  "removeStream",
  "addSubscription",
  "getParticipantStream",
  "sendMessage",
  "enableNetworkMetricsReport",
  "disableNetworkMetricsReport",
];
const REQUIRED_EVENTS = [
  "connected",
  "disconnected",
  "state_changed",
  "participant_joined",
  "participant_left",
  "stream_published",
  "stream_unpublished",
  "subscription_started",
  "subscription_ended",
  "track_enabled",
  "track_disabled",
  "message_received",
  "network_metrics_report",
];

test("required @telnyx/video top-level exports exist", () => {
  for (const name of REQUIRED_EXPORTS) {
    assert.ok(sdkExports.has(name), `@telnyx/video does not export "${name}" (exports: ${[...sdkExports].join(", ")})`);
  }
});

test("every Room method the telehealth UI calls exists on the SDK Room type", () => {
  for (const name of REQUIRED_ROOM_METHODS) {
    assert.ok(sdkRoomMethods.has(name), `Room has no "${name}" method in this @telnyx/video version`);
  }
});

test("every room event the telehealth UI subscribes to exists in the SDK Events", () => {
  for (const name of REQUIRED_EVENTS) {
    assert.ok(sdkEvents.has(name), `@telnyx/video Events has no "${name}" event`);
  }
});

// --- guard against reintroducing the pre-validation (non-existent) API names ---

const videoRoom = read(join(here, "VideoRoom.jsx"));
const networkMonitor = read(join(here, "NetworkMonitor.jsx"));

const FORBIDDEN = [
  "enableAudio",
  "disableAudio",
  "enableVideo",
  "disableVideo",
  "networkQualityLevel",
  "networkQualityLevelChanged",
  "room.state.participants", // must go through getState()
  '.on("reconnecting"', // not a real SDK event (status is derived from state_changed)
  '.on("reconnected"',
  "room.localParticipant", // it's getLocalParticipant() / getState().localParticipantId
];

test("telehealth components do not reference non-existent @telnyx/video symbols", () => {
  for (const bad of FORBIDDEN) {
    assert.ok(!videoRoom.includes(bad), `VideoRoom.jsx references removed/non-existent symbol: ${bad}`);
    assert.ok(!networkMonitor.includes(bad), `NetworkMonitor.jsx references removed/non-existent symbol: ${bad}`);
  }
  // The legacy single-arg getParticipantStream(id) call must use (id, key) now.
  assert.ok(
    !/getParticipantStream\(\s*participant\.id\s*\)/.test(videoRoom),
    "VideoRoom.jsx calls getParticipantStream with one arg; the SDK requires (participantId, key)",
  );
});

test("chat uses the SDK Message shape { type, payload } in both directions", () => {
  // The SDK's Message is { type: 'text'; payload: string }, so sendMessage must
  // pass an object (not a bare string) and the receive path must read .payload.
  const messageDts = read(join(sdkLib, "registers", "participant_register.d.ts"));
  assert.match(messageDts, /payload\s*:\s*string/, "SDK Message must carry a string payload");

  assert.ok(
    !/sendMessage\(\s*JSON\.stringify/.test(videoRoom),
    "sendMessage must pass a Message object { type, payload }, not a bare JSON string",
  );
  assert.match(videoRoom, /sendMessage\(\s*\{\s*type:\s*["']text["']/, "sendMessage should send { type: 'text', payload }");
  assert.match(videoRoom, /message\?\.payload/, "received messages must read message.payload");
});
