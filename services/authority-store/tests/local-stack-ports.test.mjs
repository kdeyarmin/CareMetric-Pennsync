// The stack harness's port pre-flight, on its own.
//
// It is here because the check cost three CI re-runs: `Start fresh owned local
// Auth and API` failed `LOCAL_PORT_ALREADY_IN_USE` on otherwise idle runners
// and passed on the immediate re-run every time. A single bind collapses two
// different situations into one refusal: a port another process is holding,
// and a port that is simply not released yet. Only the second clears on its
// own, and only the first should stop the stack.
//
// The third test is the one that matters: it fails against the single-bind
// implementation this replaced. The second is what stops the fix from becoming
// a way to ignore a real collision.
//
// The fourth is the measurement the retry was originally justified by and
// which turns out to point the other way: a port in TIME_WAIT does NOT refuse
// a bind here, because Node sets `SO_REUSEADDR`. It is a test rather than a
// sentence in the harness precisely because the sentence was wrong for months
// and nothing could notice.
//
// The fifth is where the diagnostic would have died: the refusal now carries
// the port, and the module's emit filter is the only thing that prints it.
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
import { createServer, connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import {
  unusedPort, describePortHolder, emittable, PORT_ATTEMPTS, PORT_RETRY_MS,
} from './http-local-stack.mjs';

/** `/proc/net/tcp` is Linux's, and two tests here read the kernel directly. */
const procNetTcp = await readFile('/proc/net/tcp', 'utf8').then(() => true, () => false);
const linuxOnly = { skip: procNetTcp ? false : 'needs /proc/net/tcp' };

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
    // A PREFIX, because the refusal now names the port it could not bind. It
    // named none of the three for as long as this check has existed, which is
    // why every occurrence so far has been argued about rather than measured.
    assert.match(refusal, /^LOCAL_PORT_ALREADY_IN_USE \d+$/);
    assert.equal(refusal, `LOCAL_PORT_ALREADY_IN_USE ${port}`);
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

test('a port in TIME_WAIT does not refuse a bind at all', linuxOnly, async () => {
  // The measurement behind the harness comment. Plant a real TIME_WAIT socket
  // -- the server closes first, so the TIME_WAIT is on the LISTENING side's
  // port -- confirm the kernel agrees it is there, then bind that port again.
  const port = await new Promise((ready, no) => {
    const server = createServer(socket => socket.end());
    server.once('error', no);
    server.listen(0, '127.0.0.1', async () => {
      const p = server.address().port;
      await new Promise(done => {
        const client = connect(p, '127.0.0.1');
        client.on('close', done);
        client.on('error', done);
      });
      server.close(() => ready(p));
    });
  });
  await delay(300);
  const wanted = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  const timeWait = (await readFile('/proc/net/tcp', 'utf8')).split('\n').slice(1)
    .map(row => row.trim().split(/\s+/))
    .filter(field => field[1]?.endsWith(wanted) && field[3] === '06');
  assert.ok(timeWait.length, 'no TIME_WAIT socket was planted, so this proves nothing');
  await unusedPort(port); // SO_REUSEADDR: TIME_WAIT never raises EADDRINUSE
});

test('the refusal survives the filter that decides what may be printed', () => {
  // The port is the whole point of the change, and this is the only path that
  // prints it. Against the original `^LOCAL_[A-Z_]+$` the first assertion
  // fails and the operator sees LOCAL_STACK_FAILED_DETAILS_REDACTED instead.
  assert.ok(emittable('LOCAL_PORT_ALREADY_IN_USE 54321'));
  assert.ok(emittable('LOCAL_PORT_ALREADY_IN_USE'));
  assert.ok(emittable('EXPECTED_START_OR_STOP'));
  // And the widening is five digits and nothing else: the redaction exists
  // because the CLI prints credentials, so it stays shut on everything a
  // subprocess could have said.
  assert.ok(!emittable('LOCAL_PORT_ALREADY_IN_USE 54321 postgresql://postgres:secret@127.0.0.1'));
  assert.ok(!emittable('LOCAL_PORT_ALREADY_IN_USE sb_secret_abcdefghij'));
  assert.ok(!emittable('LOCAL_PORT_ALREADY_IN_USE 123456'));
  assert.ok(!emittable('failed to start: sb_secret_abcdefghij'));
});

test('every failed attempt is described as it happens, not once at the end', async () => {
  // D112. The refusal carried ONE description, taken after the last attempt, so
  // a holder that had already changed was reported as the cause. Against that
  // implementation this asserts 1 === 6 and fails.
  const { server, port } = await hold();
  try {
    let refusal = null;
    await assert.rejects(unusedPort(port), error => { refusal = error; return true; });
    assert.equal(refusal.message, `LOCAL_PORT_ALREADY_IN_USE ${port}`);
    assert.ok(Array.isArray(refusal.observed), 'the series is what makes the moment readable');
    assert.equal(refusal.observed.length, PORT_ATTEMPTS);
    refusal.observed.forEach((line, index) => {
      assert.match(line, new RegExp(`^attempt ${index + 1} `));
      // The bind's own code was discarded entirely before, so nothing could
      // tell EADDRINUSE from an EACCES that would misdirect the whole diagnosis.
      assert.match(line, /^attempt \d+ EADDRINUSE: /);
    });
  } finally {
    server.close();
  }
});

test('a holder that changes mid-window is visible as a change', linuxOnly, async () => {
  // The sharp half, and the shape the fourth occurrence actually had: the port
  // is held throughout by the listener, so all attempts fail, while what
  // /proc/net/tcp says about it changes underneath. Reading only the last
  // attempt loses the connection that was live when the bind first failed --
  // which is how `Port 54322: TIME_WAIT` came to be printed for a refusal
  // TIME_WAIT cannot cause.
  const { server, port } = await hold();
  server.on('connection', socket => socket.resume());
  const client = connect(port, '127.0.0.1');
  await new Promise((ready, no) => { client.once('connect', ready); client.once('error', no); });
  // Leave the connection up past the first attempt and drop it well before the
  // last. Destroyed from the CLIENT side, so any TIME_WAIT lands on the
  // client's own ephemeral port rather than the one under test.
  setTimeout(() => client.destroy(), PORT_RETRY_MS + 400).unref();
  try {
    let refusal = null;
    await assert.rejects(unusedPort(port), error => { refusal = error; return true; });
    const [first] = refusal.observed;
    const last = refusal.observed[refusal.observed.length - 1];
    assert.match(first, /ESTABLISHED/, 'the live connection was not captured at the failure');
    assert.ok(!/ESTABLISHED/.test(last), 'the fixture did not change, so this proves nothing');
    // Both readings are of the same port and neither is wrong; they are of
    // different moments, and only the first is the moment the bind failed.
    assert.match(first, /LISTEN/);
    assert.match(last, /LISTEN/);
  } finally {
    client.destroy();
    server.close();
  }
});

test('the holder description answers for a free port without throwing', async () => {
  const port = await freePort();
  const said = await describePortHolder(port);
  assert.equal(typeof said, 'string');
  assert.ok(said.length, 'a diagnostic that says nothing is worse than none');
});

test('the holder description names a live listener', linuxOnly, async () => {
  const { server, port } = await hold();
  try {
    const said = await describePortHolder(port);
    assert.match(said, /LISTEN/);
    // `comm` and pid, never `cmdline`: an argument vector can carry a token.
    assert.match(said, /held by \S+\(\d+\)/);
  } finally {
    server.close();
  }
});
