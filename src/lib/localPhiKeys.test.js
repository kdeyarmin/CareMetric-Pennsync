import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_PHI_KEYS,
  PURGE_FULL_PREFIXES,
  PURGE_AFTER_RETIREMENT_KEYS,
  PURGE_SYNCED_KEYS,
  PRESERVE_KEYS,
  NON_PHI_KEYS,
} from "./localPhiKeys.js";

test("every local PHI key is classified exactly once", () => {
  // Forces a deliberate purge/preserve decision for any future key — the gap
  // that previously let synced visit PHI escape clearCachedPHI.
  const all = Object.values(LOCAL_PHI_KEYS);
  const classified = [
    ...PURGE_FULL_PREFIXES, ...PURGE_AFTER_RETIREMENT_KEYS,
    ...PURGE_SYNCED_KEYS, ...PRESERVE_KEYS, ...NON_PHI_KEYS,
  ];
  for (const key of all) {
    const count = classified.filter((k) => k === key).length;
    assert.equal(count, 1, `${key} must be classified exactly once (found ${count})`);
  }
  for (const k of classified) {
    assert.ok(all.includes(k), `classified value "${k}" is not a registered LOCAL_PHI_KEYS value`);
  }
});

test("no preserved (in-progress draft) key is caught by a full-purge prefix", () => {
  // HIPAA-critical invariant: clearCachedPHI must never wipe an in-progress
  // local draft. (PURGE_SYNCED keys are touched but only have their synced
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
    LOCAL_PHI_KEYS.PATIENTS,
    LOCAL_PHI_KEYS.PENN_CACHE_PREFIX,
    LOCAL_PHI_KEYS.PENN_SYNC_ERRORS, // full failed-item PHI + stack traces
    LOCAL_PHI_KEYS.PENN_SYNC_STATUS,
    LOCAL_PHI_KEYS.OASIS_DATA_PREFIX,
  ]) {
    assert.ok(PURGE_FULL_PREFIXES.includes(k), `${k} should be fully purged`);
  }
  assert.deepEqual(PURGE_SYNCED_KEYS, [LOCAL_PHI_KEYS.PENN_PENDING_VISITS, LOCAL_PHI_KEYS.PENN_PENDING_UPDATES]);
});

test("the retired offline queues are gated behind retirement, not purged outright", () => {
  // They can hold the only copy of a visit note or incident report captured in
  // the field. clearCachedPHI removes them only once retiredOfflineQueue.js has
  // confirmed that work reached the server — purging them on any earlier logout
  // or idle timeout destroyed it.
  for (const k of [
    LOCAL_PHI_KEYS.SYNC_QUEUE,
    LOCAL_PHI_KEYS.PENDING,
    LOCAL_PHI_KEYS.VISIT_DRAFTS,
    LOCAL_PHI_KEYS.CONFLICTS,
  ]) {
    assert.ok(PURGE_AFTER_RETIREMENT_KEYS.includes(k), `${k} should be retirement-gated`);
    for (const prefix of PURGE_FULL_PREFIXES) {
      assert.ok(
        !(k === prefix || k.startsWith(prefix)),
        `${k} must not also be caught by unconditional full-purge prefix "${prefix}"`
      );
    }
  }
});
