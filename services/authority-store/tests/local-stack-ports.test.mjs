// The stack harness's port pre-flight, on its own.
//
// It is here because the check cost two CI re-runs: `Start fresh owned local
// Auth and API` failed `LOCAL_PORT_ALREADY_IN_USE` on otherwise idle runners
// and passed on the immediate re-run both times. A single bind collapses two
// different situations into one refusal: a port another process is holding,
// and a port that is simply not released yet. Only the second clears on its
// own, and only the first should stop the stack.
//
// The third test is the one that matters: it fails against the single-bind
// implementation this replaced. The second is what stops the fix from becoming
// a way to ignore a real collision.
//
// EVERY PORT HERE IS OS-ASSIGNED, never a literal. A suite about port
// collisions that pinned three numbers would be one unrelated local service --
// or one concurrent worktree -- away from reproducing the flake it exists to
// prevent, and `hold` on an already-taken port raises an unhandled EADDRINUSE
// rather than failing cleanly.
//
// Node builtins and this directory only — the isolated authority CI job
// installs just `services/authority-store` and does no root install.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { unusedPort, PORT_ATTEMPTS, PORT_RETRY_MS } from './http-local-stack.mjs';

/** Bind an OS-assigned loopback port and keep it. */
const hold = () => new Promise((ready, fail) => {
  const server = createServer();
  server.once('error', fail);
  server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port }));
});
/** An OS-assigned port that was just released, so it is free to bind again. */
const freePort = async () => {
  const { server, port } = await hold();
  await new Promise(done => server.close(done));
  return port;
};
const elapsed = async work => {
  const started = process.hrtime.bigint();
  await work();
  return Number((process.hrtime.bigint() - started) / 1000000n);
};

test('a free port returns without waiting', async () => {
  const port = await freePort();
  const took = await elapsed(() => unusedPort(port));
  assert.ok(took < 500, `expected an immediate return, took ${took}ms`);
});

test('a held port is still refused, after exhausting every attempt', async () => {
  const { server, port } = await hold();
  try {
    let refusal = null;
    const took = await elapsed(async () => {
      await assert.rejects(unusedPort(port), error => {
        refusal = error.message;
        return true;
      });
    });
    assert.equal(refusal, 'LOCAL_PORT_ALREADY_IN_USE');
    // It must actually have retried rather than returned the old instant no.
    assert.ok(took >= (PORT_ATTEMPTS - 1) * PORT_RETRY_MS,
      `expected ${PORT_ATTEMPTS} attempts, gave up after ${took}ms`);
  } finally {
    server.close();
  }
});

test('a port released after the first attempt is accepted', async () => {
  const { server, port } = await hold();
  setTimeout(() => server.close(), PORT_RETRY_MS + 500).unref();
  await unusedPort(port); // rejects against a single-bind implementation
});
