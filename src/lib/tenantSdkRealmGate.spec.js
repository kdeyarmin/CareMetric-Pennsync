import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TenantSdkRealmClosedError,
  StaleTenantSdkOperationError,
  createTenantSdkRealmGate,
} from './tenantSdkRealmGate';
import {
  browserAuthorityEpochMatches,
  rotateBrowserAuthorityEpoch,
} from './browserAuthorityEpoch';

function fakeClient() {
  return {
    cleanup: vi.fn(),
    auth: {
      me: vi.fn().mockResolvedValue({ id: 'user-a' }),
      logout: vi.fn().mockReturnValue('redirecting'),
      redirectToLogin: vi.fn().mockReturnValue('redirecting-to-login'),
      setToken: vi.fn(),
    },
    entities: {
      CarePlan: {
        filter: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'plan-a' }),
        futureMutationVerb: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: { ok: true } }),
    },
    integrations: {
      Core: {
        InvokeLLM: vi.fn().mockResolvedValue({ ok: true }),
      },
    },
    appLogs: {
      subscribe: vi.fn(),
    },
  };
}

describe('tenant SDK browser-realm gate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts closed and blocks every protected SDK method without invoking it', async () => {
    const raw = fakeClient();
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);

    await expect(client.entities.CarePlan.filter({})).rejects.toBeInstanceOf(
      TenantSdkRealmClosedError,
    );
    await expect(client.entities.CarePlan.futureMutationVerb({})).rejects.toMatchObject({
      code: 'TENANT_SDK_REALM_CLOSED',
    });
    await expect(client.functions.invoke('unsafeFunction', {})).rejects.toMatchObject({
      code: 'TENANT_SDK_REALM_CLOSED',
    });
    await expect(client.integrations.Core.InvokeLLM({ prompt: 'private' })).rejects.toMatchObject({
      code: 'TENANT_SDK_REALM_CLOSED',
    });
    expect(raw.entities.CarePlan.filter).not.toHaveBeenCalled();
    expect(raw.entities.CarePlan.futureMutationVerb).not.toHaveBeenCalled();
    expect(raw.functions.invoke).not.toHaveBeenCalled();
    expect(raw.integrations.Core.InvokeLLM).not.toHaveBeenCalled();

    // Identity reads are protected too; only authentication/navigation actions
    // required to enter or leave a closed realm remain available.
    await expect(client.auth.me()).rejects.toMatchObject({
      code: 'TENANT_SDK_REALM_CLOSED',
    });
    expect(client.auth.logout()).toBe('redirecting');
  });

  it('makes close terminal after an authority is pinned, even for that same authority', async () => {
    const raw = fakeClient();
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    const authorityA = '["user-a","agency-a","membership-a",2]';
    const authorityB = '["user-a","agency-b","membership-b",1]';

    expect(gate.open(authorityA)).toBe(true);
    await expect(client.entities.CarePlan.create({ patient_id: 'patient-a' }))
      .resolves.toEqual({ id: 'plan-a' });
    await expect(client.functions.invoke('authorizedFunction', {}))
      .resolves.toEqual({ data: { ok: true } });

    const capturedCreate = client.entities.CarePlan.create;
    gate.close();
    await expect(capturedCreate({ patient_id: 'patient-a' })).rejects.toMatchObject({
      code: 'TENANT_SDK_REALM_CLOSED',
    });
    expect(gate.isOpen()).toBe(false);
    expect(gate.isPoisoned()).toBe(true);
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
    expect(gate.open(authorityA)).toBe(false);
    expect(gate.open(authorityB)).toBe(false);
    expect(gate.isOpen()).toBe(false);
    expect(gate.isPoisoned()).toBe(true);
    expect(gate.matchesPinnedAuthority(authorityA)).toBe(true);
    expect(gate.matchesPinnedAuthority(authorityB)).toBe(false);
    await expect(client.entities.CarePlan.create({ patient_id: 'patient-b' }))
      .rejects.toMatchObject({ code: 'TENANT_SDK_REALM_CLOSED' });
    expect(raw.entities.CarePlan.create).toHaveBeenCalledTimes(1);
    expect(gate.open(authorityA)).toBe(false);

    gate.close();
    gate.poison();
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps a pre-authority close nonterminal for bootstrap lifecycle cleanup', async () => {
    const raw = fakeClient();
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    const authority = '["user-a","agency-a","membership-a",2]';

    gate.close();
    expect(gate.isPoisoned()).toBe(false);
    expect(raw.cleanup).not.toHaveBeenCalled();
    expect(gate.open(authority)).toBe(true);
    await expect(client.auth.me()).resolves.toEqual({ id: 'user-a' });

    gate.close();
    expect(gate.isPoisoned()).toBe(true);
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
  });

  it('expires in-flight results and synchronously unsubscribes on transition', async () => {
    const raw = fakeClient();
    let settleRead;
    raw.entities.CarePlan.filter.mockReturnValue(new Promise((resolve) => {
      settleRead = resolve;
    }));
    const unsubscribe = vi.fn();
    let emit;
    raw.appLogs.subscribe.mockImplementation((listener) => {
      emit = listener;
      return unsubscribe;
    });
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    const listener = vi.fn();
    const authorityA = '["user-a","agency-a","membership-a",2]';
    gate.open(authorityA);

    const pendingRead = client.entities.CarePlan.filter({ patient_id: 'patient-a' });
    const stop = client.appLogs.subscribe(listener);
    emit({ id: 'before-close' });
    expect(listener).toHaveBeenCalledTimes(1);

    gate.close();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    emit({ id: 'after-close' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => stop()).not.toThrow();
    settleRead([{ id: 'private-plan' }]);
    await expect(pendingRead).rejects.toBeInstanceOf(StaleTenantSdkOperationError);
  });

  it('deeply membranes returned capabilities and nested callback payloads', async () => {
    const raw = fakeClient();
    const rawNext = vi.fn().mockResolvedValue({ id: 'page-2' });
    const rawCursor = { page: { next: rawNext } };
    rawCursor.self = rawCursor;
    raw.entities.CarePlan.cursor = vi.fn().mockResolvedValue(rawCursor);

    let emitNested;
    let emitDirect;
    const rawUnsubscribe = vi.fn();
    const subscriptionPrototype = { unsubscribe: rawUnsubscribe };
    const rawSubscription = Object.assign(Object.create(subscriptionPrototype), {
      channel: 'care-plan-events',
    });
    raw.entities.CarePlan.observe = vi.fn((options, callback) => {
      emitNested = options.handlers[0].onEvent;
      emitDirect = callback;
      return Promise.resolve(rawSubscription);
    });

    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    const authority = '["user-a","agency-a","membership-a",2]';
    const nestedListener = vi.fn();
    const directListener = vi.fn();
    gate.open(authority);

    const cursor = await client.entities.CarePlan.cursor();
    expect(cursor).not.toBe(rawCursor);
    expect(cursor.page).not.toBe(rawCursor.page);
    expect(cursor.self).toBe(cursor);
    await expect(cursor.page.next()).resolves.toEqual({ id: 'page-2' });
    const capturedNext = cursor.page.next;

    const subscription = await client.entities.CarePlan.observe.apply(undefined, [
      { handlers: [{ onEvent: nestedListener }] },
      directListener,
    ]);
    expect(subscription.channel).toBe('care-plan-events');

    const rawPayloadRead = vi.fn().mockResolvedValue('private-payload');
    const rawContextRead = vi.fn().mockResolvedValue('private-context');
    const rawPayload = { nested: { read: rawPayloadRead } };
    const rawCallbackThis = { readContext: rawContextRead };
    emitNested.call(rawCallbackThis, rawPayload);
    emitDirect({ id: 'direct-before-close' });

    expect(nestedListener).toHaveBeenCalledTimes(1);
    expect(directListener).toHaveBeenCalledTimes(1);
    const protectedPayload = nestedListener.mock.calls[0][0];
    const protectedThis = nestedListener.mock.contexts[0];
    expect(protectedPayload).not.toBe(rawPayload);
    expect(protectedPayload.nested).not.toBe(rawPayload.nested);
    await expect(protectedPayload.nested.read()).resolves.toBe('private-payload');
    await expect(protectedThis.readContext()).resolves.toBe('private-context');

    gate.close();
    expect(rawUnsubscribe).toHaveBeenCalledTimes(1);
    expect(emitNested.call(rawCallbackThis, { id: 'after-close' })).toBeUndefined();
    expect(emitDirect({ id: 'direct-after-close' })).toBeUndefined();
    expect(nestedListener).toHaveBeenCalledTimes(1);
    expect(directListener).toHaveBeenCalledTimes(1);
    await expect(capturedNext()).rejects.toBeInstanceOf(TenantSdkRealmClosedError);
    await expect(protectedPayload.nested.read()).rejects.toBeInstanceOf(
      TenantSdkRealmClosedError,
    );
    await expect(protectedThis.readContext()).rejects.toBeInstanceOf(
      TenantSdkRealmClosedError,
    );
    expect(() => subscription.unsubscribe()).not.toThrow();
    expect(rawUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('expires custom thenables and cleans a late subscription before rejecting stale', async () => {
    const raw = fakeClient();
    let settleThenable;
    let capturedListener;
    const rawUnsubscribe = vi.fn();
    const lateSubscription = Object.create({ unsubscribe: rawUnsubscribe });
    raw.appLogs.subscribe.mockImplementation((listener) => {
      capturedListener = listener;
      return {
        then(resolve) {
          settleThenable = resolve;
        },
      };
    });

    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    const listener = vi.fn();
    gate.open('["user-a","agency-a","membership-a",2]');

    const pendingSubscription = client.appLogs.subscribe(listener);
    gate.close();
    expect(capturedListener({ id: 'after-close' })).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    settleThenable(lateSubscription);

    await expect(pendingSubscription).rejects.toBeInstanceOf(StaleTenantSdkOperationError);
    expect(rawUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('invalidates independent gates through the shared browser authority epoch', async () => {
    const rawA = fakeClient();
    const rawB = fakeClient();
    const unsubscribeB = vi.fn();
    rawB.appLogs.subscribe.mockReturnValue(unsubscribeB);
    const gateA = createTenantSdkRealmGate();
    const gateB = createTenantSdkRealmGate();
    const clientA = gateA.wrapClient(rawA);
    const clientB = gateB.wrapClient(rawB);

    expect(gateA.open('["user-a","agency-a","membership-a",1]')).toBe(true);
    expect(gateB.open('["user-b","agency-b","membership-b",1]')).toBe(true);
    const stopB = clientB.appLogs.subscribe(vi.fn());
    await expect(clientA.entities.CarePlan.filter({})).resolves.toEqual([]);
    await expect(clientB.entities.CarePlan.filter({})).resolves.toEqual([]);

    gateA.close();
    expect(rawA.cleanup).toHaveBeenCalledTimes(1);
    expect(gateB.isOpen()).toBe(false);
    expect(gateB.isPoisoned()).toBe(true);
    expect(unsubscribeB).toHaveBeenCalledTimes(1);
    expect(rawB.cleanup).toHaveBeenCalledTimes(1);
    expect(gateB.open('["user-b","agency-b","membership-b",1]')).toBe(false);
    await expect(clientB.entities.CarePlan.filter({})).rejects.toBeInstanceOf(
      TenantSdkRealmClosedError,
    );
    expect(() => stopB()).not.toThrow();
    expect(unsubscribeB).toHaveBeenCalledTimes(1);
  });

  it('never adopts an epoch that changed while tenant bootstrap was pending', () => {
    const gate = createTenantSdkRealmGate();
    rotateBrowserAuthorityEpoch();

    expect(gate.open('["user-a","agency-a","membership-a",1]')).toBe(false);
    expect(gate.isOpen()).toBe(false);
    expect(gate.isPoisoned()).toBe(true);
  });

  it('rejects a pending callback settlement before raw SDK work can resume', async () => {
    const afterCallback = vi.fn();
    let resolveCallback;
    const raw = fakeClient();
    raw.functions.withCallback = vi.fn(async (callback) => {
      await callback();
      afterCallback();
    });
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    gate.open('["user-a","agency-a","membership-a",1]');

    const pending = client.functions.withCallback(() => new Promise((resolve) => {
      resolveCallback = resolve;
    }));
    gate.close();
    resolveCallback();

    await expect(pending).rejects.toBeInstanceOf(StaleTenantSdkOperationError);
    expect(afterCallback).not.toHaveBeenCalled();
  });

  it('rechecks custom callback thenables after synchronous resolution', async () => {
    const afterCallback = vi.fn();
    const raw = fakeClient();
    raw.functions.withCallback = vi.fn(async (callback) => {
      await callback();
      afterCallback();
    });
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    gate.open('["user-a","agency-a","membership-a",1]');

    const pending = client.functions.withCallback(() => ({
      then(resolve) {
        resolve('ok');
        gate.close();
      },
    }));

    await expect(pending).rejects.toBeInstanceOf(StaleTenantSdkOperationError);
    expect(afterCallback).not.toHaveBeenCalled();
  });

  it('maps callback getter and thrown errors to stale after authority closes', async () => {
    const afterCallback = vi.fn();
    const raw = fakeClient();
    raw.functions.withCallback = vi.fn(async (callback) => {
      await callback();
      afterCallback();
    });

    const getterGate = createTenantSdkRealmGate();
    const getterClient = getterGate.wrapClient(raw);
    getterGate.open('["user-a","agency-a","membership-a",1]');
    const getterPending = getterClient.functions.withCallback(() => ({
      get then() {
        getterGate.close();
        return undefined;
      },
    }));
    await expect(getterPending).rejects.toBeInstanceOf(StaleTenantSdkOperationError);

    // Establish the next test gate only after the first one is terminal so it
    // captures the newly rotated shared epoch.
    const throwGate = createTenantSdkRealmGate();
    const throwClient = throwGate.wrapClient(raw);
    throwGate.open('["user-b","agency-b","membership-b",1]');
    const throwPending = throwClient.functions.withCallback(() => {
      throwGate.close();
      throw new Error('caller error');
    });
    await expect(throwPending).rejects.toBeInstanceOf(StaleTenantSdkOperationError);
    expect(afterCallback).not.toHaveBeenCalled();
  });

  it('never executes raw object, method, or client reflection traps after close', async () => {
    const raw = fakeClient();
    const entityTrapCounts = {
      descriptor: 0,
      get: 0,
      has: 0,
      keys: 0,
    };
    raw.entities = new Proxy(raw.entities, {
      get(target, property, receiver) {
        entityTrapCounts.get += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        entityTrapCounts.descriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has(target, property) {
        entityTrapCounts.has += 1;
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        entityTrapCounts.keys += 1;
        return Reflect.ownKeys(target);
      },
    });

    const methodTrapCounts = {
      descriptor: 0,
      get: 0,
      has: 0,
      keys: 0,
    };
    raw.entities.CarePlan.create = new Proxy(raw.entities.CarePlan.create, {
      get(target, property, receiver) {
        methodTrapCounts.get += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        methodTrapCounts.descriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has(target, property) {
        methodTrapCounts.has += 1;
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        methodTrapCounts.keys += 1;
        return Reflect.ownKeys(target);
      },
    });

    const clientTrapCounts = { descriptor: 0, has: 0, keys: 0 };
    const rawClient = new Proxy(raw, {
      getOwnPropertyDescriptor(target, property) {
        clientTrapCounts.descriptor += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has(target, property) {
        clientTrapCounts.has += 1;
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        clientTrapCounts.keys += 1;
        return Reflect.ownKeys(target);
      },
    });

    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(rawClient);
    gate.open('["user-a","agency-a","membership-a",1]');
    const entities = client.entities;
    const carePlan = entities.CarePlan;
    const create = carePlan.create;
    entityTrapCounts.descriptor = 0;
    entityTrapCounts.get = 0;
    entityTrapCounts.has = 0;
    entityTrapCounts.keys = 0;
    methodTrapCounts.descriptor = 0;
    methodTrapCounts.get = 0;
    methodTrapCounts.has = 0;
    methodTrapCounts.keys = 0;
    clientTrapCounts.descriptor = 0;
    clientTrapCounts.has = 0;
    clientTrapCounts.keys = 0;

    gate.close();

    // Previously captured property chains remain usable as denied facades and
    // do not need to touch the dynamic raw SDK proxy again.
    expect(client.entities).toBe(entities);
    expect(entities.CarePlan).toBe(carePlan);
    await expect(create({})).rejects.toBeInstanceOf(TenantSdkRealmClosedError);
    expect(entityTrapCounts.get).toBe(0);

    expect(() => entities.UnseenEntity).toThrow(TenantSdkRealmClosedError);
    expect(() => Object.getOwnPropertyDescriptor(entities, 'CarePlan')).toThrow(
      TenantSdkRealmClosedError,
    );
    expect(() => Reflect.ownKeys(entities)).toThrow(TenantSdkRealmClosedError);
    expect(() => 'CarePlan' in entities).toThrow(TenantSdkRealmClosedError);
    expect(entityTrapCounts).toEqual({ descriptor: 0, get: 0, has: 0, keys: 0 });

    expect(() => create.rawProperty).toThrow(TenantSdkRealmClosedError);
    expect(() => Object.getOwnPropertyDescriptor(create, 'rawProperty')).toThrow(
      TenantSdkRealmClosedError,
    );
    expect(() => Reflect.ownKeys(create)).toThrow(TenantSdkRealmClosedError);
    expect(() => 'rawProperty' in create).toThrow(TenantSdkRealmClosedError);
    expect(methodTrapCounts).toEqual({ descriptor: 0, get: 0, has: 0, keys: 0 });

    expect(() => Object.getOwnPropertyDescriptor(client, 'entities')).toThrow(
      TenantSdkRealmClosedError,
    );
    expect(() => Reflect.ownKeys(client)).toThrow(TenantSdkRealmClosedError);
    expect(() => 'entities' in client).toThrow(TenantSdkRealmClosedError);
    expect(clientTrapCounts).toEqual({ descriptor: 0, has: 0, keys: 0 });
  });

  it('rejects a raw reflection trap that closes the realm before returning', () => {
    const raw = fakeClient();
    const gate = createTenantSdkRealmGate();
    let armTrap = false;
    const getter = vi.fn(() => {
      if (armTrap) gate.close();
      return 'private';
    });
    raw.capability = new Proxy({}, { get: getter });
    const client = gate.wrapClient(raw);
    gate.open('["user-a","agency-a","membership-a",1]');
    const capability = client.capability;
    armTrap = true;

    expect(() => capability.secret).toThrow(StaleTenantSdkOperationError);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(gate.isPoisoned()).toBe(true);
  });

  it('cleans a subscription when result wrapping closes and throws', () => {
    const raw = fakeClient();
    const rawUnsubscribe = vi.fn();
    const gate = createTenantSdkRealmGate();
    const rawSubscription = new Proxy({ unsubscribe: rawUnsubscribe }, {
      ownKeys() {
        gate.close();
        throw new Error('raw result trap');
      },
    });
    raw.appLogs.subscribe.mockReturnValue(rawSubscription);
    const client = gate.wrapClient(raw);
    gate.open('["user-a","agency-a","membership-a",1]');

    expect(() => client.appLogs.subscribe(vi.fn())).toThrow(StaleTenantSdkOperationError);
    expect(rawUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('throws stale when callback argument wrapping closes a started operation', async () => {
    const afterCallback = vi.fn();
    const raw = fakeClient();
    const gate = createTenantSdkRealmGate();
    const callbackPayload = new Proxy({}, {
      getPrototypeOf() {
        gate.close();
        throw new Error('raw callback payload trap');
      },
    });
    raw.functions.withCallback = vi.fn(async (callback) => {
      await callback(callbackPayload);
      afterCallback();
    });
    const client = gate.wrapClient(raw);
    gate.open('["user-a","agency-a","membership-a",1]');

    await expect(client.functions.withCallback(vi.fn())).rejects.toBeInstanceOf(
      StaleTenantSdkOperationError,
    );
    expect(afterCallback).not.toHaveBeenCalled();
  });

  it('does not read or expose unknown raw auth data properties', () => {
    const raw = fakeClient();
    const rawTokenGetter = vi.fn(() => 'raw-secret-token');
    Object.defineProperty(raw.auth, 'sessionToken', {
      configurable: true,
      enumerable: true,
      get: rawTokenGetter,
    });
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);

    const deniedUnknown = client.auth.sessionToken;
    expect(rawTokenGetter).not.toHaveBeenCalled();
    expect(() => deniedUnknown()).toThrow(TenantSdkRealmClosedError);
    expect(rawTokenGetter).not.toHaveBeenCalled();
    expect(gate.isPoisoned()).toBe(true);
  });

  it('denies a captured setToken when another tab has rotated the bootstrap epoch', () => {
    const raw = fakeClient();
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(raw);
    const capturedSetToken = client.auth.setToken;
    const newerEpoch = rotateBrowserAuthorityEpoch();

    expect(() => capturedSetToken('principal-b-token')).toThrow(TenantSdkRealmClosedError);
    expect(raw.auth.setToken).not.toHaveBeenCalled();
    expect(browserAuthorityEpochMatches(newerEpoch)).toBe(true);
    expect(gate.isPoisoned()).toBe(true);
  });

  it('fails closed for malformed authority snapshots and invalid clients', async () => {
    const gate = createTenantSdkRealmGate();
    expect(() => gate.wrapClient(null)).toThrow(/client object/);
    expect(() => gate.open('')).toThrow(/authority snapshot/);
    expect(gate.isOpen()).toBe(false);
    expect(gate.isPoisoned()).toBe(true);
  });

  it('does not let consumers replace protected roots, entities, or handlers', () => {
    const gate = createTenantSdkRealmGate();
    const client = gate.wrapClient(fakeClient());

    expect(() => {
      client.entities = {};
    }).toThrow(TypeError);
    expect(() => {
      client.entities.CarePlan = {};
    }).toThrow(TypeError);
    expect(() => {
      client.entities.CarePlan.create = vi.fn();
    }).toThrow(TypeError);
    expect(() => {
      delete client.functions.invoke;
    }).toThrow(TypeError);
  });
});
