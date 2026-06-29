import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_KEYS,
  PURGE_FULL_PREFIXES,
  PURGE_SYNCED_KEYS,
  PRESERVE_KEYS,
  NON_PHI_KEYS,
} from "./offlineKeys.js";

test("every offline key is classified exactly once", () => {
  // Forces a deliberate purge/preserve decision for any future key — the gap
  // that previously let synced visit PHI escape clearCachedPHI.
  const all = Object.values(OFFLINE_KEYS);
  const classified = [...PURGE_FULL_PREFIXES, ...PURGE_SYNCED_KEYS, ...PRESERVE_KEYS, ...NON_PHI_KEYS];
  for (const key of all) {
    const count = classified.filter((k) => k === key).length;
    assert.equal(count, 1, `${key} must be classified exactly once (found ${count})`);
  }
  for (const k of classified) {
    assert.ok(all.includes(k), `classified value "${k}" is not a registered OFFLINE_KEYS value`);
  }
});

test("no preserved (unsynced field-work) key is caught by a full-purge prefix", () => {
  // HIPAA-critical invariant: clearCachedPHI must never wipe unsynced field
  // documentation. (PURGE_SYNCED keys are touched but only have their synced
  // entries dropped, so they're intentionally excluded here.)
  for (const preserved of PRESERVE_KEYS) {
    for (const prefix of PURGE_FULL_PREFIXES) {
      assert.ok(
        !(preserved === prefix || preserved.startsWith(prefix)),
        `preserved key "${preserved}" must not match full-purge prefix "${prefix}"`
      );
    }
  }
});

test("the high-risk re-fetchable / diagnostic PHI keys are in the full-purge set", () => {
  for (const k of [
    OFFLINE_KEYS.PATIENTS,
    OFFLINE_KEYS.PENN_CACHE_PREFIX,
    OFFLINE_KEYS.PENN_SYNC_ERRORS, // full failed-item PHI + stack traces
    OFFLINE_KEYS.PENN_SYNC_STATUS,
    OFFLINE_KEYS.OASIS_DATA_PREFIX,
  ]) {
    assert.ok(PURGE_FULL_PREFIXES.includes(k), `${k} should be fully purged`);
  }
  assert.deepEqual(PURGE_SYNCED_KEYS, [OFFLINE_KEYS.PENN_PENDING_VISITS, OFFLINE_KEYS.PENN_PENDING_UPDATES]);
});
