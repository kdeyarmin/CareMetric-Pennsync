import { routeFor } from './independentEntityRoutes.js';

/**
 * The seam both owned-backend modes stand on.
 *
 * Extracted from `independentStagingAdapter.js` unchanged so the production mode
 * reaches the same refusing namespaces and the same declared entity routes
 * rather than a second implementation of them. Nothing here decides who may do
 * what: a refusal is the default and a route is a DECLARED mapping onto a ported
 * handler that does its own authorization.
 *
 * The refusal CODE is a parameter because it is part of each mode's published
 * contract — staging screens and its acceptance suites read
 * `STAGING_OPERATION_UNAVAILABLE` by name — and because a production build
 * answering with a staging code would mislabel every unported call site in the
 * one place a reader looks first.
 *
 * Every import in this module is relative on purpose: it is loaded under plain
 * `node --test` by the browser acceptance suites, where a `@/` alias does not
 * resolve.
 */

/** `then` must read as absent: a function there would make the namespace, or an
 * entity, a thenable, and `await base44.entities` would call it. */
const NOT_AN_OPERATION = new Set(['then', 'toJSON']);

export const failWith = (code, status = 403) => {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
};

export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const exact = (value, keys) => object(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));

export const CONTEXT_KEYS = Object.freeze(['user_id', 'user_email', 'membership_id', 'membership_key',
  'membership_version', 'agency_id', 'tenant_role', 'membership_status', 'is_platform_owner', 'agency']);
export const MEMBERSHIP_KEYS = Object.freeze(['membership_id', 'membership_key', 'membership_version',
  'agency_id', 'tenant_role', 'membership_status', 'agency']);
export const scopeOf = context => pick(context, ['agency_id', 'membership_id', 'membership_version', 'tenant_role']);

// Memoised per name, because the SDK's own objects are stable: a caller may
// hold `base44.entities.Patient` or one of its methods, and the realm gate
// caches its method facades by owner identity, so a fresh proxy per access
// would miss that cache on every call.
const refusingLevel = (resolve) => {
  const made = new Map();
  return new Proxy(Object.freeze({}), {
    get: (_target, name) => {
      if (typeof name !== 'string' || NOT_AN_OPERATION.has(name)) return undefined;
      if (!made.has(name)) made.set(name, resolve(name));
      return made.get(name);
    },
  });
};

export const refusalFor = (code, root, group, operation) => {
  const error = new Error(code);
  error.code = code;
  error.status = 403;
  error.operation = `${root}.${group}.${operation}`;
  return error;
};

/**
 * Every entity and Core-integration call in an owned build refuses by name.
 *
 * Both namespaces were `{}`, so an entity call such as `.TrainingCourse.list()`
 * read `.list` of `undefined` and threw a raw TypeError — measured by driving it
 * through the realm gate, not inferred. That failed closed in the sense that
 * matters (nothing can reach Base44 from here), but as an unclassified
 * TypeError no caller could tell from a bug, at every one of the frontend's
 * entity and integration call sites.
 *
 * The refusal is a REJECTED PROMISE, not a throw: the SDK methods it stands in
 * for return promises, and the realm gate refuses a closed realm the same way,
 * so "unavailable" and "realm closed" reach a caller in one shape rather than
 * two. `operation` names the call for a report; it is a method name, never an
 * argument.
 */
export const refusingNamespace = (code, root) => refusingLevel(group => refusingLevel(operation => () =>
  Promise.reject(refusalFor(code, root, group, operation))));

/**
 * The entity namespace, which refuses exactly as the refusing one does except
 * where a route is DECLARED.
 *
 * There is deliberately no GENERIC route to the record store behind this.
 * pennsync-api has no generic entity route by design — an entity reaches the
 * owned store only through a ported handler — so a generic route added here
 * would be one that service refuses to have. What this adds is the opposite of
 * generic: a DECLARED map from one entity operation to one named ported handler
 * (`independentEntityRoutes.js`), which is the seam Stage J adopts a call site
 * at a time. Everything undeclared refuses exactly as it did.
 *
 * `serve` is the mode's own `portedCall`, so a routed entity call carries the
 * same tenant fence, session lease and service contract as the function call it
 * becomes — this level adds no authorization and can remove none.
 */
export const routedEntities = (code, serve, configured) => refusingLevel(entity => refusingLevel(operation => (...args) => {
  // `configured` is the same condition a function call applies: with no service
  // to ask, a declared route is not a route. Refusing here rather than inside
  // `serve` keeps a misconfigured build answering "unavailable" instead of a
  // transport error.
  const route = configured() ? routeFor(entity, operation) : null;
  if (!route) return Promise.reject(refusalFor(code, 'entities', entity, operation));
  // `request` refuses an argument it cannot express, synchronously. Keep the
  // whole path promise-shaped: these stand in for SDK methods, and a caller
  // that gets a throw where every sibling rejects has to handle two shapes.
  let input;
  try { input = route.request(...args); } catch (error) { return Promise.reject(error); }
  // The call's own arguments reach `response` as well, because a route that
  // re-orders or narrows the answer has to know what was asked for to say
  // whether the page it got was the whole set.
  return serve(route.function, input).then(answer => route.response(answer, ...args));
}));
