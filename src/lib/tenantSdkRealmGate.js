import { hasActivePublicCapabilityRealm } from '@/lib/publicCapabilityRealmGate';
import {
  browserAuthorityEpochMatches,
  ensureBrowserAuthorityEpoch,
  invalidateBrowserAuthorityEpoch,
  readBrowserAuthorityEpoch,
} from '@/lib/browserAuthorityEpoch';

const TERMINAL_AUTH_METHODS = new Set(['logout', 'redirectToLogin']);
const CLOSED_BOOTSTRAP_AUTH_METHODS = new Set(['resetPasswordRequest', 'setToken']);
const PROTECTED_AUTH_METHODS = new Set(['me', 'updateMe']);
const MAX_AUTHORITY_SNAPSHOT_LENGTH = 2_000;

function exactAuthoritySnapshot(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_AUTHORITY_SNAPSHOT_LENGTH
    && value.trim() === value;
}

function isTerminalNativeData(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof ArrayBuffer !== 'undefined') {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  }
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return true;
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return true;
  return value instanceof Date;
}

export class TenantSdkRealmClosedError extends Error {
  constructor() {
    super('Clinical operation unavailable while workspace authority is being verified');
    this.name = 'TenantSdkRealmClosedError';
    this.code = 'TENANT_SDK_REALM_CLOSED';
  }
}

export class StaleTenantSdkOperationError extends Error {
  constructor() {
    super('Clinical operation expired because workspace authority changed');
    this.name = 'StaleTenantSdkOperationError';
    this.code = 'STALE_TENANT_SDK_OPERATION';
  }
}

/**
 * Build a shadow-facade membrane for one immutable tenant browser realm.
 * Once protected work has run, closing is terminal for this document: even
 * the same authority needs a full navigation to destroy old continuations.
 */
export function createTenantSdkRealmGate() {
  // Captured when this raw SDK/document realm is constructed, after app-params
  // has processed any login handoff. Bootstrap must resolve against this exact
  // browser epoch; a cross-tab token transition while brokers are pending may
  // not be adopted retroactively at open().
  const bootstrapBrowserAuthorityEpoch = ensureBrowserAuthorityEpoch();
  let state = 'closed';
  let epoch = 0;
  let pinnedAuthoritySnapshot = null;
  let pinnedBrowserAuthorityEpoch = null;
  let sharedEpochRevoked = false;
  let activeRealmLease = null;

  const activeSubscriptions = new Set();
  const terminalCleanups = new Set();
  const objectFacades = new WeakMap();
  const objectPropertyFacades = new WeakMap();
  const methodFacades = new WeakMap();
  const realmLeaseRecords = new WeakMap();

  const denied = () => Promise.reject(new TenantSdkRealmClosedError());
  let expireForExternalTransition = null;
  const sharedEpochIsCurrent = () => {
    if (pinnedBrowserAuthorityEpoch === null) return true;
    if (browserAuthorityEpochMatches(pinnedBrowserAuthorityEpoch)) return true;
    expireForExternalTransition?.();
    return false;
  };
  const operationIsCurrent = (operationEpoch, operationAuthority) => (
    state === 'open'
    && epoch === operationEpoch
    && pinnedAuthoritySnapshot === operationAuthority
    && sharedEpochIsCurrent()
  );

  const expireSubscriptions = () => {
    for (const unsubscribe of [...activeSubscriptions]) {
      activeSubscriptions.delete(unsubscribe);
      try { unsubscribe(); } catch { /* continue closing the boundary */ }
    }
  };

  const expireRealmLease = () => {
    if (!activeRealmLease) return;
    const record = realmLeaseRecords.get(activeRealmLease);
    activeRealmLease = null;
    try { record?.controller.abort(); } catch { /* closing remains terminal */ }
  };

  const runTerminalCleanups = () => {
    for (const cleanup of [...terminalCleanups]) {
      terminalCleanups.delete(cleanup);
      try { cleanup(); } catch { /* keep closing every raw SDK resource */ }
    }
  };

  expireForExternalTransition = () => {
    if (state === 'poisoned') return;
    epoch += 1;
    state = 'poisoned';
    sharedEpochRevoked = true;
    expireRealmLease();
    expireSubscriptions();
    runTerminalCleanups();
  };

  const protectedReflectionIsCurrent = () => {
    if (state === 'open') return sharedEpochIsCurrent();
    if (state !== 'closed' || pinnedAuthoritySnapshot !== null) return false;
    if (browserAuthorityEpochMatches(bootstrapBrowserAuthorityEpoch)) return true;
    expireForExternalTransition();
    return false;
  };

  // Property lookup and introspection can execute user code when an SDK module
  // or returned capability is a Proxy/accessor. Fence those synchronous traps
  // just like method calls, including a post-trap epoch check for reentrancy.
  const reflectProtected = (reflection) => {
    if (!protectedReflectionIsCurrent()) throw new TenantSdkRealmClosedError();
    const reflectionEpoch = epoch;
    let value;
    try {
      value = reflection();
    } catch (error) {
      if (epoch !== reflectionEpoch || !protectedReflectionIsCurrent()) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    if (epoch !== reflectionEpoch || !protectedReflectionIsCurrent()) {
      throw new StaleTenantSdkOperationError();
    }
    return value;
  };

  const revokeSharedEpoch = () => {
    if (pinnedBrowserAuthorityEpoch === null || sharedEpochRevoked) return true;
    sharedEpochRevoked = true;
    try {
      invalidateBrowserAuthorityEpoch(pinnedBrowserAuthorityEpoch);
      return true;
    } catch {
      // Local poisoning, leases, subscriptions, and raw cleanup remain
      // terminal even if a browser storage policy prevents cross-tab notice.
      return false;
    }
  };

  const guardCallbackSettlement = (
    result,
    operationEpoch,
    operationAuthority,
    operationLease,
  ) => {
    let then;
    try {
      then = result && (typeof result === 'object' || typeof result === 'function')
        ? result.then
        : null;
    } catch (error) {
      if (!operationIsCurrent(operationEpoch, operationAuthority)) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    if (!operationIsCurrent(operationEpoch, operationAuthority)) {
      throw new StaleTenantSdkOperationError();
    }
    if (typeof then !== 'function') return result;

    const signal = realmLeaseRecords.get(operationLease)?.controller.signal;
    const settlement = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', expire);
        if (!operationIsCurrent(operationEpoch, operationAuthority)) {
          reject(new StaleTenantSdkOperationError());
          return;
        }
        handler(value);
      };
      const expire = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', expire);
        reject(new StaleTenantSdkOperationError());
      };
      signal?.addEventListener('abort', expire, { once: true });
      if (signal?.aborted || !operationIsCurrent(operationEpoch, operationAuthority)) {
        expire();
        return;
      }
      try {
        Reflect.apply(then, result, [
          (value) => finish(resolve, value),
          (error) => finish(reject, error),
        ]);
      } catch (error) {
        finish(reject, error);
      }
    });
    // A custom thenable may resolve synchronously and close the realm before its
    // `then` call returns. Check again in a later reaction before the raw SDK's
    // own `await callback()` continuation can resume.
    return settlement.then(
      (value) => {
        if (!operationIsCurrent(operationEpoch, operationAuthority)) {
          throw new StaleTenantSdkOperationError();
        }
        return value;
      },
      (error) => {
        if (!operationIsCurrent(operationEpoch, operationAuthority)) {
          throw new StaleTenantSdkOperationError();
        }
        throw error;
      },
    );
  };

  const registerUnsubscribe = (unsubscribe, operationEpoch, operationAuthority) => {
    let subscribed = true;
    const guardedUnsubscribe = () => {
      if (!subscribed) return;
      subscribed = false;
      activeSubscriptions.delete(guardedUnsubscribe);
      unsubscribe();
    };
    if (!operationIsCurrent(operationEpoch, operationAuthority)) {
      try { guardedUnsubscribe(); } catch { /* preserve fixed stale error */ }
      throw new StaleTenantSdkOperationError();
    }
    activeSubscriptions.add(guardedUnsubscribe);
    return guardedUnsubscribe;
  };

  const subscriptionCleanup = (value, hadCallbackArgument) => {
    if (!hadCallbackArgument) return null;
    if (typeof value === 'function') {
      return () => Reflect.apply(value, undefined, []);
    }
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
    let cursor = value;
    const visited = new WeakSet();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      // Teardown discovery deliberately uses descriptors rather than property
      // reads and must also work for a subscription delivered after revocation.
      const descriptor = Reflect.getOwnPropertyDescriptor(cursor, 'unsubscribe');
      if (descriptor) {
        return 'value' in descriptor && typeof descriptor.value === 'function'
          ? () => Reflect.apply(descriptor.value, value, [])
          : null;
      }
      cursor = Reflect.getPrototypeOf(cursor);
    }
    return null;
  };

  const exposeGuardedUnsubscribe = (value, wrappedValue, guardedUnsubscribe) => {
    if (typeof value === 'function') return guardedUnsubscribe;
    const facade = new Proxy({}, {
      get: (_target, property) => (
        property === 'unsubscribe' ? guardedUnsubscribe : wrappedValue[property]
      ),
      getOwnPropertyDescriptor: (_target, property) => {
        if (property === 'unsubscribe') {
          return {
            configurable: true,
            enumerable: true,
            writable: false,
            value: guardedUnsubscribe,
          };
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(wrappedValue, property);
        if (!descriptor) return undefined;
        return {
          configurable: true,
          enumerable: descriptor.enumerable === true,
          writable: false,
          value: wrappedValue[property],
        };
      },
      getPrototypeOf: () => Object.prototype,
      has: (_target, property) => property === 'unsubscribe' || Reflect.has(wrappedValue, property),
      ownKeys: () => [...new Set(['unsubscribe', ...Reflect.ownKeys(wrappedValue)])],
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
      preventExtensions: () => false,
    });
    return facade;
  };

  let wrapProtectedObject;

  const wrapProtectedResult = (value, seen = new WeakMap()) => {
    if (typeof value === 'function') return wrapProtectedObject(value);
    if (!value || typeof value !== 'object') return value;
    if (reflectProtected(() => isTerminalNativeData(value))) return value;

    const prototype = reflectProtected(() => Reflect.getPrototypeOf(value));
    if (Array.isArray(value) || prototype === Object.prototype || prototype === null) {
      const prior = seen.get(value);
      if (prior) return prior;
      const copy = Array.isArray(value)
        ? []
        : prototype === null
          ? Object.create(null)
          : {};
      seen.set(value, copy);
      const properties = reflectProtected(() => Reflect.ownKeys(value));
      for (const property of properties) {
        const descriptor = reflectProtected(
          () => Reflect.getOwnPropertyDescriptor(value, property),
        );
        if (!descriptor?.enumerable || !('value' in descriptor)) continue;
        Object.defineProperty(copy, property, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: wrapProtectedResult(descriptor.value, seen),
        });
      }
      return copy;
    }
    // Response/stream readers, actor connections, and other returned transport
    // capabilities retain methods that must expire with the realm.
    return wrapProtectedObject(value);
  };

  const finishResult = (
    value,
    operationEpoch,
    operationAuthority,
    hadCallbackArgument,
  ) => {
    let cleanup = null;
    try {
      cleanup = subscriptionCleanup(value, hadCallbackArgument);
    } catch (error) {
      if (!operationIsCurrent(operationEpoch, operationAuthority)) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    if (!operationIsCurrent(operationEpoch, operationAuthority)) {
      if (cleanup) try { cleanup(); } catch { /* preserve fixed stale error */ }
      throw new StaleTenantSdkOperationError();
    }
    let wrappedValue;
    try {
      wrappedValue = wrapProtectedResult(value);
    } catch (error) {
      if (cleanup) try { cleanup(); } catch { /* preserve the boundary error */ }
      if (!operationIsCurrent(operationEpoch, operationAuthority)) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    if (!operationIsCurrent(operationEpoch, operationAuthority)) {
      if (cleanup) try { cleanup(); } catch { /* preserve fixed stale error */ }
      throw new StaleTenantSdkOperationError();
    }
    if (!cleanup) return wrappedValue;
    const guardedUnsubscribe = registerUnsubscribe(
      cleanup,
      operationEpoch,
      operationAuthority,
    );
    return exposeGuardedUnsubscribe(value, wrappedValue, guardedUnsubscribe);
  };

  const guardResult = (
    result,
    operationEpoch,
    operationAuthority,
    hadCallbackArgument = false,
  ) => {
    let then;
    try {
      then = result && (typeof result === 'object' || typeof result === 'function')
        ? result.then
        : null;
    } catch (error) {
      if (!operationIsCurrent(operationEpoch, operationAuthority)) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    if (!operationIsCurrent(operationEpoch, operationAuthority)) {
      const staleError = new StaleTenantSdkOperationError();
      if (typeof then === 'function') return Promise.reject(staleError);
      throw staleError;
    }
    if (typeof then !== 'function') {
      return finishResult(result, operationEpoch, operationAuthority, hadCallbackArgument);
    }
    const promise = new Promise((resolve, reject) => {
      try {
        Reflect.apply(then, result, [resolve, reject]);
      } catch (error) {
        reject(error);
      }
    });
    return promise.then(
      (value) => finishResult(
        value,
        operationEpoch,
        operationAuthority,
        hadCallbackArgument,
      ),
      (error) => {
        if (!operationIsCurrent(operationEpoch, operationAuthority)) {
          throw new StaleTenantSdkOperationError();
        }
        throw error;
      },
    );
  };

  const invokeProtected = (callable, thisArgument, args) => {
    if (state !== 'open' || !sharedEpochIsCurrent()) return denied();
    const operationEpoch = epoch;
    const operationAuthority = pinnedAuthoritySnapshot;
    const operationLease = activeRealmLease;
    let hadCallbackArgument = false;
    const seenArguments = new WeakMap();
    const guardArgument = (argument) => {
      if (typeof argument === 'function') {
        hadCallbackArgument = true;
        return function guardedSdkCallback(...callbackArgs) {
          if (!operationIsCurrent(operationEpoch, operationAuthority)) return undefined;
          let safeThis;
          let safeCallbackArgs;
          try {
            safeThis = wrapProtectedResult(this);
            safeCallbackArgs = callbackArgs.map(
              (callbackArgument) => wrapProtectedResult(callbackArgument),
            );
          } catch (error) {
            if (!operationIsCurrent(operationEpoch, operationAuthority)) {
              throw new StaleTenantSdkOperationError();
            }
            throw error;
          }
          if (!operationIsCurrent(operationEpoch, operationAuthority)) {
            throw new StaleTenantSdkOperationError();
          }
          let callbackResult;
          try {
            callbackResult = Reflect.apply(argument, safeThis, safeCallbackArgs);
          } catch (error) {
            if (!operationIsCurrent(operationEpoch, operationAuthority)) {
              throw new StaleTenantSdkOperationError();
            }
            throw error;
          }
          if (!operationIsCurrent(operationEpoch, operationAuthority)) {
            throw new StaleTenantSdkOperationError();
          }
          return guardCallbackSettlement(
            callbackResult,
            operationEpoch,
            operationAuthority,
            operationLease,
          );
        };
      }
      if (!argument || typeof argument !== 'object') {
        return argument;
      }
      if (reflectProtected(() => isTerminalNativeData(argument))) return argument;
      const prototype = reflectProtected(() => Reflect.getPrototypeOf(argument));
      if (!Array.isArray(argument) && prototype !== Object.prototype && prototype !== null) {
        return argument;
      }
      const prior = seenArguments.get(argument);
      if (prior) return prior;
      const copy = Array.isArray(argument)
        ? []
        : prototype === null
          ? Object.create(null)
          : {};
      seenArguments.set(argument, copy);
      const properties = reflectProtected(() => Reflect.ownKeys(argument));
      for (const property of properties) {
        const descriptor = reflectProtected(
          () => Reflect.getOwnPropertyDescriptor(argument, property),
        );
        if (!descriptor?.enumerable || !('value' in descriptor)) continue;
        Object.defineProperty(copy, property, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: guardArgument(descriptor.value),
        });
      }
      return copy;
    };
    let guardedArgs;
    try {
      guardedArgs = args.map(guardArgument);
    } catch (error) {
      if (!operationIsCurrent(operationEpoch, operationAuthority)) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    if (!operationIsCurrent(operationEpoch, operationAuthority)) {
      throw new StaleTenantSdkOperationError();
    }
    let result;
    try {
      result = Reflect.apply(callable, thisArgument, guardedArgs);
    } catch (error) {
      if (!operationIsCurrent(operationEpoch, operationAuthority)) {
        throw new StaleTenantSdkOperationError();
      }
      throw error;
    }
    return guardResult(result, operationEpoch, operationAuthority, hadCallbackArgument);
  };

  const protectedMethod = (owner, property, source) => {
    let ownerMethods = methodFacades.get(owner);
    if (!ownerMethods) {
      ownerMethods = new Map();
      methodFacades.set(owner, ownerMethods);
    }
    const prior = ownerMethods.get(property);
    if (prior?.source === source) return prior.facade;

    // An arrow shadow has no own `prototype`/`caller`/`arguments` invariants.
    // SDK operations are deliberately not constructable through the membrane.
    const callableTarget = () => undefined;
    let facade;
    let nativeCallFacade;
    let nativeApplyFacade;
    let nativeBindFacade;
    let nativeToStringFacade;
    facade = new Proxy(callableTarget, {
      apply: (_target, _thisArgument, args) => invokeProtected(source, owner, args),
      get(_target, nestedProperty) {
        // Native invocation helpers must target the facade, never the raw SDK
        // function. Otherwise callbacks hidden in apply/bind arguments bypass
        // callback expiry and subscription cleanup.
        if (nestedProperty === 'call') {
          nativeCallFacade ||= Function.prototype.call.bind(facade);
          return nativeCallFacade;
        }
        if (nestedProperty === 'apply') {
          nativeApplyFacade ||= Function.prototype.apply.bind(facade);
          return nativeApplyFacade;
        }
        if (nestedProperty === 'bind') {
          nativeBindFacade ||= Function.prototype.bind.bind(facade);
          return nativeBindFacade;
        }
        if (nestedProperty === 'toString') {
          nativeToStringFacade ||= Function.prototype.toString.bind(facade);
          return nativeToStringFacade;
        }
        if (
          nestedProperty === 'constructor'
          || nestedProperty === 'prototype'
          || nestedProperty === 'caller'
          || nestedProperty === 'arguments'
        ) return undefined;
        const value = reflectProtected(() => Reflect.get(source, nestedProperty, source));
        return typeof value === 'function'
          ? protectedMethod(source, nestedProperty, value)
          : wrapProtectedObject(value);
      },
      getOwnPropertyDescriptor(target, nestedProperty) {
        const targetDescriptor = Reflect.getOwnPropertyDescriptor(target, nestedProperty);
        if (targetDescriptor?.configurable === false) return targetDescriptor;
        const sourceDescriptor = reflectProtected(
          () => Reflect.getOwnPropertyDescriptor(source, nestedProperty),
        );
        if (!sourceDescriptor) return undefined;
        return {
          configurable: true,
          enumerable: sourceDescriptor.enumerable === true,
          writable: false,
          value: facade[nestedProperty],
        };
      },
      getPrototypeOf: () => Function.prototype,
      has: (target, nestedProperty) => (
        Reflect.has(target, nestedProperty)
        || reflectProtected(() => Reflect.has(source, nestedProperty))
      ),
      ownKeys: (target) => [...new Set([
        ...Reflect.ownKeys(target),
        ...reflectProtected(() => Reflect.ownKeys(source)),
      ])],
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
      preventExtensions: () => false,
    });
    ownerMethods.set(property, { facade, source });
    return facade;
  };

  wrapProtectedObject = (target) => {
    if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
      return target;
    }
    const cached = objectFacades.get(target);
    if (cached) return cached;
    if (typeof target === 'function') {
      const standalone = protectedMethod(target, Symbol.for('tenant-sdk-callable'), target);
      objectFacades.set(target, standalone);
      return standalone;
    }

    const facade = new Proxy({}, {
      get(_shadow, property) {
        const cachedProperty = objectPropertyFacades.get(target)?.get(property);
        if (!protectedReflectionIsCurrent()) {
          if (cachedProperty) return cachedProperty.facade;
          throw new TenantSdkRealmClosedError();
        }
        const value = reflectProtected(() => Reflect.get(target, property, target));
        if (cachedProperty && cachedProperty.source === value) return cachedProperty.facade;
        const propertyFacade = typeof value === 'function'
          ? protectedMethod(target, property, value)
          : wrapProtectedObject(value);
        let targetProperties = objectPropertyFacades.get(target);
        if (!targetProperties) {
          targetProperties = new Map();
          objectPropertyFacades.set(target, targetProperties);
        }
        targetProperties.set(property, { facade: propertyFacade, source: value });
        return propertyFacade;
      },
      getOwnPropertyDescriptor(_shadow, property) {
        const descriptor = reflectProtected(
          () => Reflect.getOwnPropertyDescriptor(target, property),
        );
        if (!descriptor) return undefined;
        return {
          configurable: true,
          enumerable: descriptor.enumerable === true,
          writable: false,
          value: facade[property],
        };
      },
      getPrototypeOf: () => Object.prototype,
      has: (_shadow, property) => reflectProtected(() => Reflect.has(target, property)),
      ownKeys: () => reflectProtected(() => Reflect.ownKeys(target)),
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
      preventExtensions: () => false,
    });
    objectFacades.set(target, facade);
    return facade;
  };

  const close = () => {
    const terminal = pinnedAuthoritySnapshot !== null || state === 'poisoned';
    epoch += 1;
    if (state !== 'poisoned') {
      state = pinnedAuthoritySnapshot === null ? 'closed' : 'poisoned';
    }
    expireRealmLease();
    expireSubscriptions();
    if (terminal) {
      try {
        revokeSharedEpoch();
      } finally {
        runTerminalCleanups();
      }
    }
  };

  const poison = () => {
    epoch += 1;
    state = 'poisoned';
    expireRealmLease();
    expireSubscriptions();
    try {
      revokeSharedEpoch();
    } finally {
      runTerminalCleanups();
    }
  };

  const open = (authoritySnapshot) => {
    if (!exactAuthoritySnapshot(authoritySnapshot)) {
      poison();
      throw new TypeError('An exact tenant authority snapshot is required');
    }
    if (state === 'poisoned') return false;
    if (pinnedAuthoritySnapshot === null) {
      if (!browserAuthorityEpochMatches(bootstrapBrowserAuthorityEpoch)) {
        expireForExternalTransition();
        return false;
      }
      pinnedBrowserAuthorityEpoch = bootstrapBrowserAuthorityEpoch;
      sharedEpochRevoked = false;
      pinnedAuthoritySnapshot = authoritySnapshot;
    }
    if (pinnedAuthoritySnapshot !== authoritySnapshot) {
      poison();
      return false;
    }
    if (!sharedEpochIsCurrent()) return false;
    if (!activeRealmLease) {
      const lease = Object.freeze({});
      realmLeaseRecords.set(lease, {
        authoritySnapshot,
        controller: new AbortController(),
        epoch,
      });
      activeRealmLease = lease;
    }
    state = 'open';
    return true;
  };

  const captureLease = () => {
    if (state !== 'open' || !activeRealmLease || !sharedEpochIsCurrent()) {
      throw new TenantSdkRealmClosedError();
    }
    return activeRealmLease;
  };

  const leaseIsCurrent = (lease) => {
    const record = lease && realmLeaseRecords.get(lease);
    return !!record
      && lease === activeRealmLease
      && state === 'open'
      && record.epoch === epoch
      && record.authoritySnapshot === pinnedAuthoritySnapshot
      && record.controller.signal.aborted === false
      && sharedEpochIsCurrent();
  };

  const assertLeaseCurrent = (lease) => {
    if (!leaseIsCurrent(lease)) throw new StaleTenantSdkOperationError();
    return lease;
  };

  const getLeaseAbortSignal = (lease) => {
    assertLeaseCurrent(lease);
    return realmLeaseRecords.get(lease).controller.signal;
  };

  const wrapClient = (client) => {
    if (!client || typeof client !== 'object') {
      throw new TypeError('A Base44 client object is required');
    }
    const protectedClient = wrapProtectedObject(client);
    const rawCleanup = reflectProtected(() => Reflect.get(client, 'cleanup', client));
    if (typeof rawCleanup === 'function') {
      let cleaned = false;
      terminalCleanups.add(() => {
        if (cleaned) return;
        cleaned = true;
        Reflect.apply(rawCleanup, client, []);
      });
    }
    const rawAuth = reflectProtected(() => Reflect.get(client, 'auth', client));
    const protectedAuth = wrapProtectedObject(rawAuth);
    const authMethodFacades = new Map();

    const resolveAuthProperty = (property) => {
      if (authMethodFacades.has(property)) return authMethodFacades.get(property);

      const terminal = TERMINAL_AUTH_METHODS.has(property);
      const closedBootstrap = CLOSED_BOOTSTRAP_AUTH_METHODS.has(property);
      const protectedMethodName = PROTECTED_AUTH_METHODS.has(property);
      if (!terminal && !closedBootstrap && !protectedMethodName) {
        if (typeof property !== 'string' || property === 'then' || property === 'toJSON') {
          return undefined;
        }
        const deniedAuthMethod = () => {
          poison();
          throw new TenantSdkRealmClosedError();
        };
        Object.freeze(deniedAuthMethod);
        authMethodFacades.set(property, deniedAuthMethod);
        return deniedAuthMethod;
      }

      const rawValue = reflectProtected(() => Reflect.get(rawAuth, property, rawAuth));
      if (typeof rawValue !== 'function') {
        authMethodFacades.set(property, undefined);
        return undefined;
      }

      let facade;
      if (terminal) {
        facade = (...args) => {
          poison();
          return Reflect.apply(rawValue, rawAuth, args);
        };
      } else if (closedBootstrap) {
        facade = (...args) => {
          if (
            state !== 'closed'
            || pinnedAuthoritySnapshot !== null
            || hasActivePublicCapabilityRealm()
          ) {
            poison();
            throw new TenantSdkRealmClosedError();
          }
          if (property === 'setToken') {
            let revocationPersisted = false;
            try {
              if (browserAuthorityEpochMatches(bootstrapBrowserAuthorityEpoch)) {
                invalidateBrowserAuthorityEpoch(bootstrapBrowserAuthorityEpoch);
                revocationPersisted = (
                  readBrowserAuthorityEpoch() === bootstrapBrowserAuthorityEpoch
                  && !browserAuthorityEpochMatches(bootstrapBrowserAuthorityEpoch)
                );
              }
            } catch {
              revocationPersisted = false;
            }
            if (!revocationPersisted) {
              poison();
              throw new TenantSdkRealmClosedError();
            }
          }
          return Reflect.apply(rawValue, rawAuth, args);
        };
      } else if (protectedMethodName) {
        return protectedAuth[property];
      }
      Object.freeze(facade);
      authMethodFacades.set(property, facade);
      return facade;
    };

    // Terminal navigation must remain callable after local poisoning without
    // touching raw auth getters in that closed state.
    for (const property of TERMINAL_AUTH_METHODS) resolveAuthProperty(property);

    const authFacade = new Proxy({}, {
      get: (_target, property) => resolveAuthProperty(property),
      getOwnPropertyDescriptor: (_target, property) => {
        if (
          !TERMINAL_AUTH_METHODS.has(property)
          && !CLOSED_BOOTSTRAP_AUTH_METHODS.has(property)
          && !PROTECTED_AUTH_METHODS.has(property)
        ) return undefined;
        const value = resolveAuthProperty(property);
        if (value === undefined) return undefined;
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value,
        };
      },
      getPrototypeOf: () => Object.prototype,
      has: (_target, property) => (
        (TERMINAL_AUTH_METHODS.has(property)
          || CLOSED_BOOTSTRAP_AUTH_METHODS.has(property)
          || PROTECTED_AUTH_METHODS.has(property))
        && resolveAuthProperty(property) !== undefined
      ),
      ownKeys: () => [...new Set([
        ...TERMINAL_AUTH_METHODS,
        ...CLOSED_BOOTSTRAP_AUTH_METHODS,
        ...PROTECTED_AUTH_METHODS,
      ])].filter((property) => resolveAuthProperty(property) !== undefined),
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
      preventExtensions: () => false,
    });

    const denyTopLevelTokenMutation = () => {
      poison();
      throw new TenantSdkRealmClosedError();
    };
    Object.freeze(denyTopLevelTokenMutation);

    return new Proxy({}, {
      get(_target, property) {
        if (property === 'auth') return authFacade;
        // The SDK duplicates setToken at the client root. Production has no
        // reason to use that alias; denying it prevents an open A realm from
        // silently swapping the raw transport token to principal B.
        if (property === 'setToken') return denyTopLevelTokenMutation;
        return protectedClient[property];
      },
      getOwnPropertyDescriptor(_target, property) {
        const descriptor = reflectProtected(
          () => Reflect.getOwnPropertyDescriptor(client, property),
        );
        if (!descriptor) return undefined;
        return {
          configurable: true,
          enumerable: descriptor.enumerable === true,
          writable: false,
          value: property === 'auth'
            ? authFacade
            : property === 'setToken'
              ? denyTopLevelTokenMutation
              : protectedClient[property],
        };
      },
      getPrototypeOf: () => Object.prototype,
      has: (_target, property) => reflectProtected(() => Reflect.has(client, property)),
      ownKeys: () => reflectProtected(() => Reflect.ownKeys(client)),
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
      setPrototypeOf: () => false,
      preventExtensions: () => false,
    });
  };

  return Object.freeze({
    assertLeaseCurrent,
    captureLease,
    close,
    getLeaseAbortSignal,
    hasPinnedAuthority: () => pinnedAuthoritySnapshot !== null,
    isOpen: () => state === 'open' && sharedEpochIsCurrent(),
    isPoisoned: () => state === 'poisoned',
    leaseIsCurrent,
    matchesPinnedAuthority: (authoritySnapshot) => (
      exactAuthoritySnapshot(authoritySnapshot)
      && pinnedAuthoritySnapshot === authoritySnapshot
    ),
    open,
    poison,
    wrapClient,
  });
}

const runtimeGate = createTenantSdkRealmGate();

export const assertTenantSdkRealmLeaseCurrent = runtimeGate.assertLeaseCurrent;
export const captureTenantSdkRealmLease = runtimeGate.captureLease;
export const closeTenantSdkRealm = runtimeGate.close;
export const getTenantSdkRealmAbortSignal = runtimeGate.getLeaseAbortSignal;
export const hasPinnedTenantSdkRealm = runtimeGate.hasPinnedAuthority;
export const isTenantSdkRealmLeaseCurrent = runtimeGate.leaseIsCurrent;
export const isTenantSdkRealmOpen = runtimeGate.isOpen;
export const openTenantSdkRealm = runtimeGate.open;
export const poisonTenantSdkRealm = runtimeGate.poison;
export const wrapTenantSdkClient = runtimeGate.wrapClient;
