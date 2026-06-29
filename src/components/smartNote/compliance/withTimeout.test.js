import test from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "./withTimeout.js";

test("resolves with the value when the promise settles in time", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000), "ok");
});

test("rejects with the given message when the promise hangs", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10, "boom"),
    /boom/,
  );
});

test("propagates the original rejection when it loses the race", async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error("inner")), 1000),
    /inner/,
  );
});
