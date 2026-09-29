import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  LOCAL_PHI_KEYS,
  PURGE_FULL_PREFIXES,
  PURGE_AFTER_RETIREMENT_KEYS,
  QUARANTINED_OFFLINE_KEYS,
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
    ...PURGE_SYNCED_KEYS, ...QUARANTINED_OFFLINE_KEYS, ...PRESERVE_KEYS, ...NON_PHI_KEYS,
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

test("the mapped retired queues are gated behind retirement, not purged outright", () => {
  // They can hold the only copy of a visit note or incident report captured in
  // the field. clearCachedPHI removes them only once retiredOfflineQueue.js has
  // confirmed that work reached the server — purging them on any earlier logout
  // or idle timeout destroyed it.
  for (const k of [
    LOCAL_PHI_KEYS.SYNC_QUEUE,
    LOCAL_PHI_KEYS.PENDING,
    LOCAL_PHI_KEYS.VISIT_DRAFTS,
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

test("unresolved legacy conflicts are never removed by an automatic purge", () => {
  assert.deepEqual(QUARANTINED_OFFLINE_KEYS, [LOCAL_PHI_KEYS.CONFLICTS]);
  assert.ok(!PURGE_AFTER_RETIREMENT_KEYS.includes(LOCAL_PHI_KEYS.CONFLICTS));
  assert.ok(!PURGE_FULL_PREFIXES.includes(LOCAL_PHI_KEYS.CONFLICTS));
});

test("exactly one commit in this history has ever touched QUARANTINED_OFFLINE_KEYS", (t) => {
  // This symbol is the durable handle for the decision that created it: the change that
  // moved CONFLICTS out of PURGE_AFTER_RETIREMENT_KEYS, so that this store is excluded
  // from every purge rather than gated behind the retirement flag. That decision's only
  // record in the tree is the comment on the declaration, and it is referred to from
  // outside the repository as "the one change that ever touched this symbol" rather than
  // by a commit hash or a date — a date is ambiguous here, because two commits the same
  // day carry near-identical subjects.
  //
  // The reference is unique only when scoped to the DECLARING FILE, which is why the
  // pathspec below is part of the assertion and not a speed optimisation: repository-wide
  // the symbol is now named in prose by docs/audits/OFFLINE_PHI_BROWSER_STORAGE_*.md too,
  // so an unscoped search already returns more than one commit and always will.
  //
  // Read the count against a control: every symbol in this file returns 1, because the
  // file has only two commits in its whole history. So this passing does not make the
  // symbol special — it establishes only what the external reference needs, that nothing
  // has touched it a SECOND time.
  //
  // Nothing outside the repository can notice when that stops being true, which is why
  // the check lives here. If it fails, the symbol has been renamed or changed again: that
  // is not a reason to delete the test. It means an external reference has become
  // ambiguous and needs re-pointing at whatever is unique now.
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    encoding: "utf8",
  }).trim();
  if (shallow !== "false") {
    // A shallow clone can truncate history at a commit that has a real parent, so the
    // absent revisions are invisible rather than nonexistent and a pass here would assert
    // something unmeasured. Reported rather than answered; CI clones at full depth.
    t.skip("shallow clone: the full history of this file is not present");
    return;
  }

  const commits = execFileSync(
    "git",
    ["log", "--format=%H", "-S", "QUARANTINED_OFFLINE_KEYS", "--", "src/lib/localPhiKeys.js"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  assert.equal(
    commits.length,
    1,
    `QUARANTINED_OFFLINE_KEYS must have exactly one commit in its history for that ` +
      `reference to be unique; found ${commits.length}: ${commits.join(", ")}`,
  );
});
