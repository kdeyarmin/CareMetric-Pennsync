import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from './debounce.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('invokes only once after the wait window for a burst of calls', async () => {
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 20);
  fn(); fn(); fn();
  assert.equal(calls, 0, 'should not invoke synchronously');
  await tick(40);
  assert.equal(calls, 1, 'should invoke once after the burst');
});

test('passes the latest arguments to the underlying fn', async () => {
  let received;
  const fn = debounce((v) => { received = v; }, 10);
  fn('a'); fn('b'); fn('c');
  await tick(30);
  assert.equal(received, 'c');
});

test('cancel() prevents a pending invocation', async () => {
  let calls = 0;
  const fn = debounce(() => { calls += 1; }, 20);
  fn();
  fn.cancel();
  await tick(40);
  assert.equal(calls, 0);
});

test('preserves `this` binding', async () => {
  const obj = {
    value: 42,
    run: debounce(function () { this.captured = this.value; }, 10),
  };
  obj.run();
  await tick(30);
  assert.equal(obj.captured, 42);
});
