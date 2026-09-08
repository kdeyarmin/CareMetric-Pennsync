import {
  Fragment,
  createContext,
  useState,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
} from 'react';
import { base44, tenantAuthorityClient } from '@/api/base44Client';
import { appParams, plantLoginReturnState } from '@/lib/app-params';
import { createAxiosClient } from '@/lib/base44AxiosClient';
import { queryClientInstance } from '@/lib/query-client';
import { toast as sonnerToast } from 'sonner';
import { clearAllToasts } from '@/components/ui/use-toast';
import {
  DRAFT_AUTHORITY_MARKER_KEY,
  DRAFT_LOGOUT_TOMBSTONE_KEY,
  invalidateAuthorityDraftLeaseForTransition,
  invalidatePersistedAuthorityDraftMarkersForLogout,
  purgeAuthorityBoundDrafts,
  purgeRefetchablePhiForAuthorityTransition,
  reconcileAuthorityBoundDrafts,
} from '@/lib/phiStorage';
import { resetAgencyRosterCache } from '@/lib/agencyRoster';
import {
  closeAuthorityBoundWindows,
} from '@/lib/authorityBoundWindows';
import { bootstrapMyTenantContext } from '@/functions/getMyTenantContext';
import { listMyTenantMemberships } from '@/functions/listMyTenantMemberships';
import {
  closeTenantSdkRealm,
  hasPinnedTenantSdkRealm,
  openTenantSdkRealm,
  poisonTenantSdkRealm,
} from '@/lib/tenantSdkRealmGate';
import { isBrowserAuthorityEpochStorageKey } from '@/lib/browserAuthorityEpoch';
import {
  bindTrustedTenantContext,
  clearTrustedTenantContext,
  getTenantAuthorityKey,
  getTrustedTenantContext,
} from '@/lib/roles';

const AuthContext = createContext(null);

export const TENANT_AUTHORITY_STATES = Object.freeze({
  LOADING: 'loading',
  SELECTION_REQUIRED: 'selection_required',
  RESOLVING: 'resolving',
  READY: 'ready',
  BLOCKED: 'blocked',
  SWITCHING: 'switching',
});

const MAX_IDENTIFIER_LENGTH = 200;

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized
    && normalized.length <= 320
    && normalized.includes('@')
    && !/\s/.test(normalized)
    ? normalized
    : null;
}

function exactPrincipal(user) {
  const email = canonicalEmail(user?.email);
  if (!exactIdentifier(user?.id) || !email) return null;
  return { user_id: user.id, user_email: email };
}

function subjectMatchesPrincipal(subject, principal) {
  return !!subject
    && !!principal
    && subject.user_id === principal.user_id
    && subject.user_email === principal.user_email
    && typeof subject.is_platform_owner === 'boolean';
}

function exactAgencyMatch(left, right) {
  if (left === null || right === null) return left === right;
  return !!left
    && !!right
    && left.id === right.id
    && left.name === right.name
    && left.status === right.status;
}

function contextMatchesMembership(context, subject, membership) {
  return !!context
    && !!subject
    && !!membership
    && context.user_id === subject.user_id
    && context.user_email === subject.user_email
    && context.is_platform_owner === false
    && subject.is_platform_owner === false
    && context.membership_id === membership.membership_id
    && context.membership_key === membership.membership_key
    && context.membership_version === membership.membership_version
    && context.agency_id === membership.agency_id
    && context.tenant_role === membership.tenant_role
    && context.membership_status === membership.membership_status
    && exactAgencyMatch(context.agency, membership.agency);
}

function contextMatchesOwner(context, subject) {
  return !!context
    && !!subject
    && subject.is_platform_owner === true
    && context.user_id === subject.user_id
    && context.user_email === subject.user_email
    && context.is_platform_owner === true
    && context.membership_id === null
    && context.membership_key === null
    && context.membership_version === null
    && context.tenant_role === 'platform_owner'
    && context.membership_status === null
    && context.agency_id === null
    && context.agency === null;
}

function frozenMemberships(memberships) {
  return Object.freeze(memberships.map((membership) => Object.freeze({
    ...membership,
    agency: Object.freeze({ ...membership.agency }),
  })));
}

function responseStatus(error) {
  return error?.response?.status ?? error?.status ?? null;
}

function tenantError(type, message) {
  return Object.freeze({ type, message });
}

function authorityIntegrityError(message) {
  const error = new Error(message);
  error.isDefinitiveTenantAuthorityFailure = true;
  return error;
}

function browserRealmAuthorityError() {
  const error = authorityIntegrityError(
    'Workspace authority changed. Sign out and reopen the app before using another workspace.',
  );
  error.isBrowserRealmAuthorityChange = true;
  return error;
}

function isDefinitiveTenantAuthorityFailure(error) {
  const status = responseStatus(error);
  return error?.isDefinitiveTenantAuthorityFailure === true
    || status === 401
    || status === 403;
}

function authoritySnapshot(principal, context) {
  if (!principal || !context) return null;
  return JSON.stringify([
    principal.user_id,
    principal.user_email,
    context.agency_id,
    context.membership_id,
    context.membership_version,
    context.tenant_role,
    context.is_platform_owner,
    context.agency?.status ?? null,
  ]);
}

function clearTenantNotifications() {
  sonnerToast.dismiss();
  clearAllToasts();
}

function scrubProtectedBrowserLocation() {
  if (typeof window === 'undefined') return '/';
  const configuredBase = import.meta.env.BASE_URL || '/';
  const neutral = new URL(configuredBase, window.location.origin);
  neutral.search = '';
  neutral.hash = '';
  try {
    window.history.replaceState(null, document.title, neutral.pathname);
  } catch {
    // Continue closing authority even if a constrained webview blocks history.
  }
  return neutral.href;
}

/**
 * Hard boundary for the protected tree. Children are not mounted until exact
 * tenant authority is ready. Changing the immutable key remounts the subtree,
 * so component state cannot cross a principal or membership transition.
 */
export function TenantAuthorityBoundary({ authorityState, authorityKey, fallback = null, children }) {
  if (authorityState !== TENANT_AUTHORITY_STATES.READY || !authorityKey) {
    return fallback;
  }
  return <Fragment key={authorityKey}>{children}</Fragment>;
}

export const AuthProvider = ({ children }) => {
  const authGeneration = useRef(0);
  const authorityStateRef = useRef(
    /** @type {string} */ (TENANT_AUTHORITY_STATES.LOADING),
  );
  const publicRouteActiveRef = useRef(false);
  const publicRoutePreparedRef = useRef(false);
  const publicRouteDesiredRef = useRef(false);
  const publicEntryPromiseRef = useRef(null);
  const selectedMembershipRef = useRef(null);
  const activeAuthorityRef = useRef(null);
  const lastAuthenticatedUserRef = useRef(null);
  const logoutInProgressRef = useRef(false);
  const teardownTailRef = useRef(Promise.resolve());
  const strictPersistentPurgeRequiredRef = useRef(true);
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);
  const [tenantAuthorityState, setTenantAuthorityStateValue] = useState(
    /** @type {string} */ (TENANT_AUTHORITY_STATES.LOADING),
  );
  const [tenantSubject, setTenantSubject] = useState(null);
  const [tenantMemberships, setTenantMemberships] = useState([]);
  const [tenantContext, setTenantContext] = useState(null);
  const [tenantAuthorityKey, setTenantAuthorityKey] = useState(null);
  const [tenantContextError, setTenantContextError] = useState(null);

  const setTenantAuthorityState = useCallback((nextState) => {
    authorityStateRef.current = nextState;
    setTenantAuthorityStateValue(nextState);
  }, []);

  /**
   * Tear down every client copy of the previous authority before a lookup for a
   * new one starts. The synchronous trusted-context clear closes role/scoping
   * access immediately; async cache and storage purges finish before the next
   * identity or tenant broker is called.
   */
  const purgePersistentPhi = useCallback(async () => {
    // This is a security boundary, not best-effort cleanup. Live drafts and
    // quarantined recovery queues are handled separately; every re-fetchable
    // PHI removal/verification must succeed before another authority is ready.
    await purgeRefetchablePhiForAuthorityTransition();
    strictPersistentPurgeRequiredRef.current = false;
  }, []);

  // Serialize every asynchronous teardown. A stale generation may already be
  // awaiting cancelQueries or IndexedDB cleanup when a newer transition starts;
  // the newer broker must wait for that work rather than becoming READY first
  // and then having stale cleanup erase its cache or drafts.
  const enqueueTenantTeardown = useCallback((work) => {
    const queued = teardownTailRef.current
      .catch(() => {})
      .then(work);
    teardownTailRef.current = queued.catch(() => {});
    return queued;
  }, []);

  const clearRuntimeTenantCaches = useCallback(async () => {
    const mutationCache = queryClientInstance.getMutationCache();
    const hasPendingMutation = () => mutationCache.getAll().some(
      (mutation) => mutation?.state?.status === 'pending',
    );

    const waitForPendingMutations = async () => {
      while (hasPendingMutation()) {
        await new Promise((resolve) => {
          let unsubscribe = () => {};
          const resolveWhenDrained = () => {
            if (hasPendingMutation()) return;
            unsubscribe();
            resolve();
          };
          unsubscribe = mutationCache.subscribe(resolveWhenDrained);
          // Close the getAll -> subscribe race if the last mutation settled
          // between the loop condition and listener registration.
          resolveWhenDrained();
        });
      }
    };

    // TanStack Query does not cancel an executing mutation when MutationCache
    // is cleared. Its retained onSuccess may still repopulate an old global
    // query key after the apparent clear. Cancel reads first, then repeatedly
    // drain mutations that may have begun while cancellation/unmounting was in
    // flight. A hung mutation intentionally keeps a tenant transition blocked;
    // logout removes the provider token independently of this async fence.
    let cancellationError = null;
    try {
      await queryClientInstance.cancelQueries();
    } catch (error) {
      cancellationError = error;
    }

    try {
      for (;;) {
        await waitForPendingMutations();

        // Let retained mutation callbacks enqueue their final cache writes, then
        // re-check because one may also have started while cancelQueries awaited.
        await Promise.resolve();
        if (hasPendingMutation()) continue;

        queryClientInstance.clear();
        await Promise.resolve();
        if (hasPendingMutation()) continue;

        // A second clear removes cache writes scheduled by a just-settled
        // mutation's onSuccess/onSettled callback after the first clear.
        queryClientInstance.clear();
        const remainingQueries = queryClientInstance.getQueryCache().getAll();
        const remainingMutations = mutationCache.getAll();
        if (remainingMutations.some((mutation) => mutation?.state?.status === 'pending')) {
          continue;
        }
        if (remainingQueries.length > 0 || remainingMutations.length > 0) {
          throw new Error('Tenant runtime cache teardown was incomplete');
        }
        break;
      }
    } finally {
      // A drained mutation can emit a patient-bearing success/error toast from
      // its retained callback after the transition-entry dismissal. Clear both
      // global toast stores again before any fresh authority broker may run.
      clearTenantNotifications();
    }
    if (cancellationError) throw cancellationError;
  }, []);

  const purgeTenantAuthority = useCallback(async ({
    nextState,
    nextUser = null,
    purgePersistent = false,
    purgeDrafts = false,
  } = {}) => {
    // First statement: prevent every protected SDK read, write, function,
    // integration, log, and subscription from being initiated by a retained
    // async continuation while React/cache/storage teardown is in progress.
    closeTenantSdkRealm();
    closeAuthorityBoundWindows();
    // Fence non-TanStack draft work synchronously. This must happen before the
    // first await so stale component/import continuations cannot write while
    // cache mutation draining or browser-store cleanup is in progress.
    invalidateAuthorityDraftLeaseForTransition();
    clearTrustedTenantContext();
    resetAgencyRosterCache();
    setTenantAuthorityState(nextState || TENANT_AUTHORITY_STATES.SWITCHING);
    setTenantContext(null);
    setTenantAuthorityKey(null);
    setTenantSubject(null);
    setTenantMemberships([]);
    setTenantContextError(null);
    setUser(nextUser ? { ...nextUser } : null);
    // Global toaster hosts intentionally survive sign-in/public screens. Purge
    // their payload stores synchronously while the authority gate is closing.
    clearTenantNotifications();

    if (purgePersistent) strictPersistentPurgeRequiredRef.current = true;

    await enqueueTenantTeardown(async () => {
      await clearRuntimeTenantCaches();
      if (purgePersistent) await purgePersistentPhi();
      if (purgeDrafts) await purgeAuthorityBoundDrafts();
    });
  }, [clearRuntimeTenantCaches, enqueueTenantTeardown, purgePersistentPhi, setTenantAuthorityState]);

  const establishTenantAuthority = useCallback(async ({
    phase = 'boot',
    explicitAgencyId = null,
    preferredSelection = null,
  } = {}) => {
    // Public capability routes deliberately run without a staff tenant
    // authority. Refuse both boot and background brokers while one is active;
    // the route lifecycle resumes with a fresh auth -> list -> context chain.
    if (logoutInProgressRef.current || publicRouteActiveRef.current) return false;
    const generation = ++authGeneration.current;
    const initialLoad = phase === 'boot';
    const previousAuthority = activeAuthorityRef.current;
    const purgePersistentAtStart = initialLoad
      || phase === 'select'
      || strictPersistentPurgeRequiredRef.current;
    let persistentPurged = false;
    // Choosing from the initial multi-membership gate is not yet a tenant
    // switch: keep prior crash-recovery drafts locked until the selected exact
    // authority can be compared with their marker. A switch from an already
    // READY authority does purge before any new broker call.
    let draftsPurged = phase === 'select' && !!previousAuthority;
    const ensurePersistentPurge = async ({ includeDrafts = false } = {}) => {
      const needsPersistentPurge = !persistentPurged;
      const needsDraftPurge = includeDrafts && !draftsPurged;
      if (!needsPersistentPurge && !needsDraftPurge) return;
      if (needsPersistentPurge) strictPersistentPurgeRequiredRef.current = true;
      try {
        await enqueueTenantTeardown(async () => {
          if (needsPersistentPurge) await purgePersistentPhi();
          if (needsDraftPurge) await purgeAuthorityBoundDrafts();
        });
      } catch (error) {
        if (!needsDraftPurge) throw error;
        const purgeError = authorityIntegrityError('Authority-bound draft purge failed');
        purgeError.cause = error;
        throw purgeError;
      }
      if (needsPersistentPurge) persistentPurged = true;
      if (needsDraftPurge) draftsPurged = true;
    };
    if (initialLoad) setIsLoadingAuth(true);
    setAuthError(null);

    let stage = 'teardown';
    let authenticatedUser = null;
    try {
      await purgeTenantAuthority({
        nextState: initialLoad
          ? TENANT_AUTHORITY_STATES.LOADING
          : TENANT_AUTHORITY_STATES.SWITCHING,
        nextUser: previousAuthority ? lastAuthenticatedUserRef.current : null,
        purgePersistent: purgePersistentAtStart,
        purgeDrafts: draftsPurged,
      });
      if (purgePersistentAtStart) persistentPurged = true;
      if (generation !== authGeneration.current) return false;

      stage = 'identity';
      authenticatedUser = await tenantAuthorityClient.me();
      if (generation !== authGeneration.current) return false;
      const principal = exactPrincipal(authenticatedUser);
      if (!principal) {
        throw authorityIntegrityError('Authenticated principal failed integrity validation');
      }
      if (
        previousAuthority
        && (previousAuthority.user_id !== principal.user_id
          || previousAuthority.user_email !== principal.user_email)
      ) {
        await ensurePersistentPurge({ includeDrafts: true });
        if (generation !== authGeneration.current) return false;
      }

      // Authentication and tenant readiness are intentionally separate. The
      // user may see a selector or blocked screen, but no protected route.
      lastAuthenticatedUserRef.current = { ...authenticatedUser };
      setUser({ ...authenticatedUser });
      setIsAuthenticated(true);

      stage = 'memberships';
      const listed = await listMyTenantMemberships();
      if (generation !== authGeneration.current) return false;
      if (!subjectMatchesPrincipal(listed?.subject, principal)) {
        throw authorityIntegrityError(
          'Tenant membership subject does not match the authenticated principal',
        );
      }

      const subject = Object.freeze({ ...listed.subject });
      const memberships = frozenMemberships(listed.memberships);
      setTenantSubject(subject);
      setTenantMemberships(memberships);

      let selectedMembership = null;
      if (subject.is_platform_owner) {
        if (explicitAgencyId !== null) {
          throw new Error('Platform owner tenant selection requires a reviewed agency workflow');
        }
      } else if (memberships.length === 0) {
        await ensurePersistentPurge({ includeDrafts: true });
        if (generation !== authGeneration.current) return false;
        if (previousAuthority) poisonTenantSdkRealm();
        activeAuthorityRef.current = null;
        selectedMembershipRef.current = null;
        setTenantContextError(tenantError(
          'no_active_tenant_membership',
          'No active agency membership is available for this account.',
        ));
        setTenantAuthorityState(TENANT_AUTHORITY_STATES.BLOCKED);
        queryClientInstance.setQueryData(['currentUser'], { ...authenticatedUser });
        return false;
      } else if (explicitAgencyId !== null) {
        if (!exactIdentifier(explicitAgencyId)) throw new Error('Tenant selection is invalid');
        selectedMembership = memberships.find(
          (membership) => membership.agency_id === explicitAgencyId,
        ) || null;
        if (!selectedMembership) {
          await ensurePersistentPurge({ includeDrafts: true });
          if (generation !== authGeneration.current) return false;
          activeAuthorityRef.current = null;
          selectedMembershipRef.current = null;
          setTenantContextError(tenantError(
            'tenant_selection_unavailable',
            'That agency is no longer available. Choose a current agency to continue.',
          ));
          setTenantAuthorityState(TENANT_AUTHORITY_STATES.SELECTION_REQUIRED);
          queryClientInstance.setQueryData(['currentUser'], { ...authenticatedUser });
          return false;
        }
      } else if (
        preferredSelection
        && preferredSelection.user_id === principal.user_id
        && preferredSelection.user_email === principal.user_email
      ) {
        const sameAgency = memberships.find(
          (membership) => membership.agency_id === preferredSelection.agency_id,
        ) || null;
        // Version and role may change under the same membership lifecycle. A
        // new membership id is a new grant and requires an explicit choice.
        if (sameAgency?.membership_id === preferredSelection.membership_id) {
          selectedMembership = sameAgency;
        } else {
          await ensurePersistentPurge({ includeDrafts: true });
          if (generation !== authGeneration.current) return false;
          if (previousAuthority) poisonTenantSdkRealm();
          activeAuthorityRef.current = null;
          selectedMembershipRef.current = null;
          setTenantContextError(tenantError(
            previousAuthority
              ? 'browser_authority_change_requires_restart'
              : 'tenant_selection_changed',
            previousAuthority
              ? 'Workspace authority changed. Sign out and reopen the app to continue safely.'
              : 'Your prior agency access changed. Choose a current agency to continue.',
          ));
          setTenantAuthorityState(previousAuthority
            ? TENANT_AUTHORITY_STATES.BLOCKED
            : TENANT_AUTHORITY_STATES.SELECTION_REQUIRED);
          queryClientInstance.setQueryData(['currentUser'], { ...authenticatedUser });
          return false;
        }
      } else if (memberships.length === 1) {
        selectedMembership = memberships[0];
      } else {
        // No draft is exposed while the selector is open. The explicit choice
        // is freshly re-listed/resolved, then its opaque marker either unlocks
        // the same-authority draft or strictly purges a different one.
        if (previousAuthority) {
          poisonTenantSdkRealm();
          activeAuthorityRef.current = null;
        }
        selectedMembershipRef.current = null;
        setTenantContextError(previousAuthority
          ? tenantError(
            'browser_authority_change_requires_restart',
            'Workspace authority changed. Sign out and reopen the app to continue safely.',
          )
          : null);
        setTenantAuthorityState(previousAuthority
          ? TENANT_AUTHORITY_STATES.BLOCKED
          : TENANT_AUTHORITY_STATES.SELECTION_REQUIRED);
        queryClientInstance.setQueryData(['currentUser'], { ...authenticatedUser });
        return false;
      }

      stage = 'context';
      setTenantAuthorityState(TENANT_AUTHORITY_STATES.RESOLVING);
      const resolved = subject.is_platform_owner
        ? await bootstrapMyTenantContext({})
        : await bootstrapMyTenantContext({
          agencyId: selectedMembership.agency_id,
          expectedMembershipId: selectedMembership.membership_id,
          expectedMembershipVersion: selectedMembership.membership_version,
        });
      if (generation !== authGeneration.current) return false;

      const resolvedContext = resolved?.tenant_context || null;
      const contextIsExact = subject.is_platform_owner
        ? contextMatchesOwner(resolvedContext, subject)
        : contextMatchesMembership(resolvedContext, subject, selectedMembership);
      if (!contextIsExact) {
        throw authorityIntegrityError(
          'Resolved tenant context does not match selected authority',
        );
      }

      const nextSnapshot = authoritySnapshot(principal, resolvedContext);
      if (previousAuthority?.snapshot && previousAuthority.snapshot !== nextSnapshot) {
        await ensurePersistentPurge({ includeDrafts: true });
        if (generation !== authGeneration.current) return false;
      }

      // Recoverable drafts are admitted only after a fresh exact authority
      // handshake matches their opaque marker. Reconciliation is serialized
      // with every other teardown so a stale generation cannot clear or mark
      // storage after a newer tenant becomes READY.
      stage = 'drafts';
      await enqueueTenantTeardown(() => reconcileAuthorityBoundDrafts(nextSnapshot));
      if (generation !== authGeneration.current) return false;

      // A JavaScript continuation cannot be forcibly cancelled by a keyed
      // React unmount. This document therefore belongs to exactly one immutable
      // authority snapshot. Bootstrap/retry may open only before anything has
      // been pinned; after READY, every refresh or route transition requires a
      // full navigation to destroy old JavaScript continuations.
      if (!openTenantSdkRealm(nextSnapshot)) {
        throw browserRealmAuthorityError();
      }

      const boundUser = bindTrustedTenantContext(authenticatedUser, resolvedContext);
      const boundContext = getTrustedTenantContext(boundUser);
      const authorityKey = getTenantAuthorityKey(boundUser);
      if (!boundContext || !authorityKey) {
        clearTrustedTenantContext();
        throw authorityIntegrityError(
          'Resolved tenant context could not be bound to authenticated principal',
        );
      }

      selectedMembershipRef.current = Object.freeze({
        ...principal,
        agency_id: resolvedContext.agency_id,
        membership_id: resolvedContext.membership_id,
      });
      activeAuthorityRef.current = Object.freeze({ ...principal, snapshot: nextSnapshot });
      setUser(boundUser);
      setTenantContext(boundContext);
      setTenantAuthorityKey(authorityKey);
      setTenantContextError(null);
      queryClientInstance.setQueryData(['currentUser'], boundUser);
      setTenantAuthorityState(TENANT_AUTHORITY_STATES.READY);
      return true;
    } catch (error) {
      if (generation !== authGeneration.current) return false;
      closeTenantSdkRealm();
      const definitiveFailure = isDefinitiveTenantAuthorityFailure(error)
        || stage === 'drafts';
      if (definitiveFailure) {
        if (hasPinnedTenantSdkRealm()) poisonTenantSdkRealm();
        try {
          await ensurePersistentPurge({ includeDrafts: true });
        } catch {
          // Remain blocked. A retry repeats serialized teardown; a destructive
          // failure never falls through to trusted binding or READY.
        }
        if (generation !== authGeneration.current) return false;
        activeAuthorityRef.current = null;
        selectedMembershipRef.current = null;
      }
      clearTrustedTenantContext();
      resetAgencyRosterCache();
      setTenantContext(null);
      setTenantAuthorityKey(null);
      const safeUser = authenticatedUser || lastAuthenticatedUserRef.current;
      queryClientInstance.setQueryData(['currentUser'], safeUser ? { ...safeUser } : null);

      const status = responseStatus(error);
      if (stage === 'identity' && (status === 401 || status === 403)) {
        scrubProtectedBrowserLocation();
        lastAuthenticatedUserRef.current = null;
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({ type: 'auth_required', message: 'Authentication required' });
        setTenantAuthorityState(TENANT_AUTHORITY_STATES.BLOCKED);
      } else {
        if (safeUser) {
          setUser({ ...safeUser });
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
          if (stage === 'identity' || stage === 'teardown') {
            setAuthError({
              type: 'identity_unavailable',
              message: 'Verified account access is temporarily unavailable.',
            });
          }
        }
        setTenantContextError(tenantError(
          error?.isBrowserRealmAuthorityChange === true
            ? 'browser_authority_change_requires_restart'
            : stage === 'identity' || stage === 'teardown'
              ? 'identity_unavailable'
              : stage === 'memberships'
                ? 'tenant_memberships_unavailable'
                : 'tenant_context_unavailable',
          error?.isBrowserRealmAuthorityChange === true
            ? 'Workspace authority changed. Sign out and reopen the app to continue safely.'
            : 'Verified agency access is unavailable. No clinical workspace has been opened.',
        ));
        setTenantAuthorityState(TENANT_AUTHORITY_STATES.BLOCKED);
      }
      console.error('Tenant authority verification failed');
      return false;
    } finally {
      if (generation === authGeneration.current) setIsLoadingAuth(false);
    }
  }, [
    enqueueTenantTeardown,
    purgePersistentPhi,
    purgeTenantAuthority,
    setTenantAuthorityState,
  ]);

  const checkAppState = useCallback(async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      if (!appParams.appId || !appParams.serverUrl) {
        await purgeTenantAuthority({
          nextState: TENANT_AUTHORITY_STATES.BLOCKED,
          purgePersistent: true,
          purgeDrafts: true,
        });
        activeAuthorityRef.current = null;
        selectedMembershipRef.current = null;
        lastAuthenticatedUserRef.current = null;
        setIsAuthenticated(false);
        setAuthError({
          type: 'configuration_error',
          message: 'Missing app configuration. Set VITE_BASE44_APP_ID and VITE_BASE44_BACKEND_URL.',
        });
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
        return;
      }

      const appClient = createAxiosClient({
        baseURL: `${appParams.serverUrl}/api/apps/public`,
        headers: { 'X-App-Id': appParams.appId },
        token: appParams.token,
        interceptResponses: true,
      });

      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        if (appParams.token) {
          await establishTenantAuthority({ phase: 'boot' });
        } else {
          await purgeTenantAuthority({
            nextState: TENANT_AUTHORITY_STATES.LOADING,
            purgePersistent: true,
            purgeDrafts: true,
          });
          activeAuthorityRef.current = null;
          selectedMembershipRef.current = null;
          lastAuthenticatedUserRef.current = null;
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        authGeneration.current += 1;
        const appFailureReason = appError.data?.extra_data?.reason;
        const definitivelyUnauthenticated = (appError.status === 401 || appError.status === 403)
          && (appFailureReason === 'auth_required' || appFailureReason === 'user_not_registered');
        await purgeTenantAuthority({
          nextState: TENANT_AUTHORITY_STATES.BLOCKED,
          purgePersistent: true,
          purgeDrafts: definitivelyUnauthenticated,
        });
        activeAuthorityRef.current = null;
        if (definitivelyUnauthenticated) {
          selectedMembershipRef.current = null;
          lastAuthenticatedUserRef.current = null;
        }
        setIsAuthenticated(false);

        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appFailureReason;
          if (reason === 'auth_required') {
            setAuthError({ type: 'auth_required', message: 'Authentication required' });
          } else if (reason === 'user_not_registered') {
            setAuthError({ type: 'user_not_registered', message: 'User not registered for this app' });
          } else if (reason === 'not_deployed') {
            const backendMessage = appError.data?.message || appError.data?.detail || appError.message;
            setAuthError({
              type: 'not_deployed',
              message: `Base44 has no deployment for app ${appParams.appId}. ${backendMessage || 'Publish it from the Base44 dashboard.'}`,
            });
          } else {
            setAuthError({ type: reason, message: appError.message });
          }
        } else {
          setAuthError({ type: 'unknown', message: appError.message || 'Failed to load app' });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      authGeneration.current += 1;
      await purgeTenantAuthority({
        nextState: TENANT_AUTHORITY_STATES.BLOCKED,
        purgePersistent: true,
      });
      activeAuthorityRef.current = null;
      setIsAuthenticated(false);
      setAuthError({ type: 'unknown', message: error.message || 'An unexpected error occurred' });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  }, [establishTenantAuthority, purgeTenantAuthority]);

  useEffect(() => {
    void checkAppState();
  }, [checkAppState]);

  useLayoutEffect(() => {
    const handleDocumentExit = () => {
      poisonTenantSdkRealm();
      closeAuthorityBoundWindows();
    };
    const handleDocumentRestore = (event) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pagehide', handleDocumentExit);
    window.addEventListener('pageshow', handleDocumentRestore);
    return () => {
      window.removeEventListener('pagehide', handleDocumentExit);
      window.removeEventListener('pageshow', handleDocumentRestore);
    };
  }, []);

  useEffect(() => () => {
    // React StrictMode intentionally runs an effect setup/cleanup probe without
    // destroying the document. `close` is safe before the first authority is
    // pinned and becomes terminal after READY; unconditional poison here would
    // break every development boot during that probe.
    closeTenantSdkRealm();
    closeAuthorityBoundWindows();
    authGeneration.current += 1;
    clearTrustedTenantContext();
    resetAgencyRosterCache();
  }, []);

  const selectTenant = useCallback(async (agencyId) => {
    if (authorityStateRef.current !== TENANT_AUTHORITY_STATES.SELECTION_REQUIRED) {
      if (authorityStateRef.current === TENANT_AUTHORITY_STATES.READY) {
        poisonTenantSdkRealm();
        await purgeTenantAuthority({
          nextState: TENANT_AUTHORITY_STATES.BLOCKED,
          purgePersistent: true,
          purgeDrafts: true,
        });
        setTenantContextError(tenantError(
          'browser_authority_change_requires_restart',
          'Sign out and reopen the app before choosing another agency.',
        ));
      }
      return false;
    }
    if (hasPinnedTenantSdkRealm()) {
      poisonTenantSdkRealm();
      await purgeTenantAuthority({
        nextState: TENANT_AUTHORITY_STATES.BLOCKED,
        purgePersistent: true,
        purgeDrafts: true,
      });
      setTenantContextError(tenantError(
        'browser_authority_change_requires_restart',
        'Workspace authority changed. Sign out and reopen the app to continue safely.',
      ));
      return false;
    }
    if (!exactIdentifier(agencyId)) {
      setTenantContextError(tenantError(
        'tenant_selection_invalid',
        'Choose a valid agency to continue.',
      ));
      return false;
    }
    return establishTenantAuthority({ phase: 'select', explicitAgencyId: agencyId });
  }, [establishTenantAuthority, purgeTenantAuthority]);

  const requireFreshBrowserRealm = useCallback(async () => {
    authGeneration.current += 1;
    poisonTenantSdkRealm();
    scrubProtectedBrowserLocation();
    try {
      await purgeTenantAuthority({
        nextState: TENANT_AUTHORITY_STATES.BLOCKED,
        purgePersistent: true,
      });
    } catch {
      // Remain terminal and blocked. Reload repeats strict cleanup.
    }
    setTenantContextError(tenantError(
      'browser_authority_change_requires_restart',
      'Reload the app to create a fresh, verified workspace session.',
    ));
    setTenantAuthorityState(TENANT_AUTHORITY_STATES.BLOCKED);
    setIsLoadingAuth(false);
    return false;
  }, [purgeTenantAuthority, setTenantAuthorityState]);

  const expireReadyBrowserRealm = useCallback(async () => {
    if (authorityStateRef.current !== TENANT_AUTHORITY_STATES.READY) return false;
    return requireFreshBrowserRealm();
  }, [requireFreshBrowserRealm]);

  useEffect(() => {
    if (!isAuthenticated || tenantAuthorityState !== TENANT_AUTHORITY_STATES.READY) {
      return undefined;
    }

    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
    const expire = () => { void expireReadyBrowserRealm(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt >= 30_000) {
        expire();
      }
    };
    const handlePageShow = (event) => {
      if (event.persisted) expire();
    };
    const handleStorage = (event) => {
      if (
        event.key === null
        || event.key === 'base44_app_id'
        || event.key === 'base44_access_token'
        || event.key === 'base44_functions_version'
        || event.key === 'base44_pending_access_token'
        || event.key === 'base44_server_url'
        || event.key === 'token'
        || isBrowserAuthorityEpochStorageKey(event.key)
        || event.key === DRAFT_AUTHORITY_MARKER_KEY
        || event.key === DRAFT_LOGOUT_TOMBSTONE_KEY
      ) {
        expire();
      }
    };
    const expiryTimer = window.setTimeout(expire, 5 * 60 * 1000);
    window.addEventListener('online', expire);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearTimeout(expiryTimer);
      window.removeEventListener('online', expire);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [expireReadyBrowserRealm, isAuthenticated, tenantAuthorityState]);

  const retryTenantAuthority = useCallback(() => (
    hasPinnedTenantSdkRealm()
      ? requireFreshBrowserRealm()
      : establishTenantAuthority({
        phase: 'retry',
        preferredSelection: selectedMembershipRef.current,
      })
  ), [establishTenantAuthority, requireFreshBrowserRealm]);

  const refreshUser = useCallback(() => (
    hasPinnedTenantSdkRealm()
      ? requireFreshBrowserRealm()
      : establishTenantAuthority({
        phase: 'revalidate',
        preferredSelection: selectedMembershipRef.current,
      })
  ), [establishTenantAuthority, requireFreshBrowserRealm]);

  /**
   * Mark entry to, or return from, a public capability/privacy route.
   *
   * Entry invalidates READY synchronously before its asynchronous cache purge,
   * so the protected boundary cannot reuse the prior authority on return.
   * Return from a previously READY staff realm requires a full navigation.
   * Only a public-first document with no pinned staff authority may run the
   * complete service-owned chain in place.
   */
  const setPublicRouteActive = useCallback(async (isPublicRoute) => {
    if (isPublicRoute === true) {
      publicRouteDesiredRef.current = true;
      if (logoutInProgressRef.current) return false;
      if (!publicRouteActiveRef.current) {
        publicRouteActiveRef.current = true;
        publicRoutePreparedRef.current = false;
        authGeneration.current += 1;
        setIsLoadingAuth(true);
      }
      if (publicRoutePreparedRef.current) return true;
      if (publicEntryPromiseRef.current) return publicEntryPromiseRef.current;

      const entryPromise = purgeTenantAuthority({
        nextState: TENANT_AUTHORITY_STATES.SWITCHING,
        // Keep recoverable drafts until the returning broker proves whether
        // this is the same exact authority. Revocation, principal drift, or a
        // membership/version/role change triggers the persistent purge there.
        purgePersistent: true,
      }).then(() => {
        if (publicRouteActiveRef.current && publicRouteDesiredRef.current) {
          publicRoutePreparedRef.current = true;
        }
        return publicRoutePreparedRef.current;
      });
      publicEntryPromiseRef.current = entryPromise;
      try {
        return await entryPromise;
      } finally {
        if (publicEntryPromiseRef.current === entryPromise) {
          publicEntryPromiseRef.current = null;
        }
      }
    }

    publicRouteDesiredRef.current = false;
    if (publicRouteActiveRef.current !== true) return false;
    const pendingEntry = publicEntryPromiseRef.current;
    if (pendingEntry) {
      try {
        await pendingEntry;
      } catch {
        // The protected boundary remains closed in SWITCHING after a failed
        // purge. Do not attempt to establish a tenant over uncleared data.
        return false;
      }
      // A newer public-route request superseded this return while teardown was
      // pending. It will reuse the same completed preparation.
      if (publicRouteDesiredRef.current) return false;
    }
    publicRouteActiveRef.current = false;
    publicRoutePreparedRef.current = false;
    if (logoutInProgressRef.current) return false;

    // Entry to a public capability route terminally closes a previously READY
    // staff realm. Returning inside the same JavaScript document could revive
    // stale clinical continuations, so require a real page reload instead of
    // attempting a same-authority reopen.
    if (hasPinnedTenantSdkRealm()) return requireFreshBrowserRealm();

    // Match the existing boot contract: without an app session token there is
    // no protected identity to resume. The public page itself remains usable.
    if (!appParams.token) {
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      return false;
    }

    return establishTenantAuthority({
      phase: 'public_return',
      preferredSelection: selectedMembershipRef.current,
    });
  }, [establishTenantAuthority, purgeTenantAuthority, requireFreshBrowserRealm]);

  const logout = useCallback(async (shouldRedirect = true) => {
    // Terminal for this document realm. Never let a later callback reopen the
    // SDK gate after provider logout; only full navigation creates a new realm.
    poisonTenantSdkRealm();
    if (logoutInProgressRef.current) return;
    const safeReturnUrl = scrubProtectedBrowserLocation();
    logoutInProgressRef.current = true;
    authGeneration.current += 1;
    selectedMembershipRef.current = null;
    activeAuthorityRef.current = null;
    lastAuthenticatedUserRef.current = null;

    try {
      // Synchronously make any surviving draft untrusted across the next boot,
      // even if navigation interrupts the asynchronous destructive purge.
      invalidatePersistedAuthorityDraftMarkersForLogout();
    } catch {
      console.error('Local draft marker invalidation failed during logout');
    }

    // Start actual draft destruction before entering the serialized runtime
    // teardown. A pending TanStack mutation may keep that teardown blocked, but
    // shared-device logout must still synchronously clear local/session drafts
    // and immediately begin the durable IndexedDB transaction. The queued pass
    // below retries and verifies destruction when the mutation fence releases.
    const immediateDraftPurge = purgeAuthorityBoundDrafts().catch(() => {
      // The logout tombstone remains set on failure, so no later authority may
      // trust the surviving bytes. The queued strict pass retries the purge.
      console.error('Immediate local draft destruction failed during logout');
    });
    const immediatePersistentPhiPurge = purgeRefetchablePhiForAuthorityTransition().catch(() => {
      // Refetchable storage is also cleared independently of the mutation
      // drain. The strict-purge latch and queued pass retain the failure for a
      // later boot rather than permitting another authority to become READY.
      console.error('Immediate refetchable PHI destruction failed during logout');
    });

    const teardown = purgeTenantAuthority({
      nextState: TENANT_AUTHORITY_STATES.SWITCHING,
      purgePersistent: true,
      purgeDrafts: true,
    }).catch(() => {
      // Keep the authority gate and logout latch closed. A future app boot must
      // repeat strict cleanup before any protected tenant can become READY.
      console.error('Local tenant teardown failed during logout');
    });

    // Provider token removal must never wait for a hung/paused mutation or an
    // unavailable browser store. Local cleanup remains serialized in the
    // background while this provider instance stays mounted.
    clearTrustedTenantContext();
    setUser(null);
    setIsAuthenticated(false);
    setIsLoadingAuth(false);
    setAuthError(null);
    if (shouldRedirect) base44.auth.logout(safeReturnUrl);
    else base44.auth.logout();
    void immediateDraftPurge;
    void immediatePersistentPhiPurge;
    void teardown;
  }, [purgeTenantAuthority]);

  const navigateToLogin = () => {
    if (window.location.pathname === '/login') return;
    const returnUrl = plantLoginReturnState(scrubProtectedBrowserLocation());
    base44.auth.redirectToLogin(returnUrl);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      tenantAuthorityState,
      tenantAuthorityKey,
      tenantSubject,
      tenantMemberships,
      tenantContext,
      tenantContextError,
      isSwitchingTenant: tenantAuthorityState === TENANT_AUTHORITY_STATES.SWITCHING
        || tenantAuthorityState === TENANT_AUTHORITY_STATES.RESOLVING,
      selectTenant,
      retryTenantAuthority,
      logout,
      navigateToLogin,
      checkAppState,
      refreshUser,
      setPublicRouteActive,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
