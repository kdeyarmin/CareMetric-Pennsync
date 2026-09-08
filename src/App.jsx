// Routes are defined in src/routes.jsx (the single source of truth shared with
// NavigationTracker). Not every page file under src/pages is routed — add a page
// to ROUTES there to make it reachable, or add a REDIRECT for a renamed page.

import './App.css'
import { lazy, Suspense, useLayoutEffect, useMemo, useState } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog"
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import {
  BrowserRouter as Router,
  Route,
  Routes,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router';
import PageNotFound from './lib/PageNotFound';
import PageLoader from '@/components/ui/PageLoader';
import SignerPortal from '@/pages/SignerPortal';
import ProviderFollowUpPortal from '@/pages/ProviderFollowUpPortal';
import {
  AuthProvider,
  TenantAuthorityBoundary,
  TENANT_AUTHORITY_STATES,
  useAuth,
} from '@/lib/AuthContext';
import SignInScreen from '@/components/auth/SignInScreen';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AIContentResponsibilityAgreement from '@/components/compliance/AIContentResponsibilityAgreement';
import Layout from '@/components/Layout';
import ErrorBoundary from '@/components/utils/ErrorBoundary';
import { ROUTES, REDIRECTS, MAIN_PAGE, ROUTER_PATHS } from '@/routes';
import { getRoleView, canAccessLevel } from '@/lib/roles';
import { hasAcceptedAiContentAgreement } from '@/lib/aiContentAgreement';
import { getAiContentAgreementStatus } from '@/functions/getAiContentAgreementStatus';
import { getRouterBasename } from '@/lib/routerBasename';
import {
  getPublicCapabilitySnapshot,
  isPublicTokenPath,
} from '@/lib/publicRoutes';
import { PublicCapabilityBoundary } from '@/lib/PublicCapabilityContext';

// Public (no-login) patient telehealth join page. Stale-chunk auto-recovery
// (dev-server restart) is handled centrally by the ErrorBoundary, which wraps
// the whole app — so plain lazy() is sufficient here.
const JoinTelehealth = lazy(() => import('@/pages/JoinTelehealth'));

// MCP OAuth consent page — public, ctx-token-gated, no app login required.
const OAuthConsent = lazy(() => import('@/pages/OAuthConsent'));

// Public privacy policy — App Store Guideline 5.1.1(i) requires it reachable
// from within the app without signing in, and the same URL is entered in App
// Store Connect, so it must render before the auth gate.
const PrivacyPolicy = lazy(() => import('@/pages/PrivacyPolicy'));

// Shown when a non-admin navigates directly to an admin-only route. Admin pages
// are hidden from the sidebar/palette for non-admins, but routes are reachable
// by URL, so this is the client-side authorization gate (server RLS is the real
// boundary). Rendered inside the layout so the user keeps their navigation.

const ConfigurationErrorScreen = ({ message }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-4">
    <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Configuration required</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Base44 app settings are missing</h1>
      <p className="mt-3 text-sm text-slate-700">
        {message || 'Set VITE_BASE44_APP_ID and VITE_BASE44_BACKEND_URL before signing in.'}
      </p>
      <p className="mt-3 text-xs text-slate-500">
        For local smoke testing without backend credentials, open /signer or /join to verify the SPA shell.
      </p>
    </div>
  </div>
);

// Shown when the app IS configured but the Base44 backend refused to serve it
// (e.g. `not_deployed` for an app that has never been published, or a network
// / 5xx failure loading public settings). Deliberately NOT the configuration
// screen above: that headline sends people hunting for missing env vars that
// are actually present. Show the backend's own message with an honest title.
//
// The server message is only echoed when it looks like short prose: a
// non-JSON error body (HTML error page, stack trace, proxy banner) would leak
// internals and wreck the layout, so anything long, multi-line or markup-like
// falls back to generic copy. React escapes the text, so this is about
// leakage and layout, not injection.
const MAX_SERVER_MESSAGE_LENGTH = 300;
const presentableServerMessage = (message) => {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_SERVER_MESSAGE_LENGTH) return null;
  if (/[<>{}]/.test(trimmed) || /\n/.test(trimmed) || /\bat\s+\S+\s*\(/.test(trimmed)) return null;
  return trimmed;
};

const AppUnavailableScreen = ({ type, message }) => {
  const notDeployed = type === 'not_deployed';
  const serverMessage = presentableServerMessage(message);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          {notDeployed ? 'App not published' : 'App unavailable'}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {notDeployed ? 'This Base44 app has not been deployed yet' : 'PennSync could not load'}
        </h1>
        <p className="mt-3 text-sm text-slate-700">
          {serverMessage || 'The Base44 backend did not return a usable response. Try again in a moment, or contact your administrator if this persists.'}
        </p>
        {notDeployed && (
          <p className="mt-3 text-xs text-slate-500">
            The app settings are present, but the Base44 backend has no deployment for this app ID.
            Publish the app from its Base44 dashboard, or open the app that is already published.
          </p>
        )}
      </div>
    </div>
  );
};

const AgreementVerificationUnavailable = ({ onRetry, onSignOut }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-4">
    <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Verification unavailable</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">PennSync could not verify your acknowledgment</h1>
      <p className="mt-3 text-sm text-slate-700">
        No clinical workspace has been opened. Retry the protected verification, or sign out and try again later.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-navy-700 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
        >
          Retry verification
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </div>
  </div>
);

const AdminOnlyFallback = ({ superAdmin = false }) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
    <h1 className="text-2xl font-bold text-slate-900">
      {superAdmin ? 'Platform administrator access required' : 'Administrator access required'}
    </h1>
    <p className="mt-2 max-w-md text-slate-600">
      {superAdmin
        ? 'This is a platform-level page reserved for the super administrator.'
        : 'You don’t have permission to view this page. If you believe this is a mistake, contact your agency administrator.'}
    </p>
  </div>
);

const RoleAccessFallback = ({ access }) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
    <h1 className="text-2xl font-bold text-slate-900">Not available for your role</h1>
    <p className="mt-2 max-w-md text-slate-600">
      {access === 'nursing'
        ? 'This clinical nursing tool is available to nursing staff. If you need access, contact your agency administrator.'
        : 'This patient-information page is not part of your role. If you need access, contact your agency administrator.'}
    </p>
  </div>
);

// Redirect that preserves the original query string when forwarding a
// retired/consolidated path to its new home. Router state is intentionally not
// forwarded: unlike the visible URL it can contain an entire clinical result
// object, and browsers retain it in session history after tenant teardown.
// Consolidated pages became hub tabs (e.g. /ReferralIntake?tab=admission), so
// merge incoming search params onto the target (target params win on conflict).
const RedirectTo = ({ to }) => {
  const location = useLocation();
  const [path, targetQuery = ''] = to.split('?');
  const params = new URLSearchParams(targetQuery);
  const incomingKeys = new Set();
  for (const [key, value] of new URLSearchParams(location.search)) {
    // append (not set) so repeated incoming keys (?id=1&id=2) all survive;
    // target params still win on conflict.
    if (!params.has(key) || incomingKeys.has(key)) {
      params.append(key, value);
      incomingKeys.add(key);
    }
  }
  const query = params.toString();
  // Forward the hash too — an old bookmark's #anchor must survive the redirect.
  return (
    <Navigate
      to={{ pathname: path, search: query ? `?${query}` : '', hash: location.hash }}
      replace
    />
  );
};

const RoutePageLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <PageLoader />
  </div>
);

const TenantAuthorityScreen = ({ memberships, error, onSelect, onRetry, onSignOut }) => {
  const selectionRequired = memberships.length > 0;
  const requiresReload = error?.type === 'browser_authority_change_requires_restart';
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">
          {selectionRequired ? 'Agency selection required' : 'Agency access unavailable'}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {selectionRequired ? 'Choose the agency workspace to open' : 'No clinical workspace was opened'}
        </h1>
        <p className="mt-3 text-sm text-slate-700">
          {error?.message || (selectionRequired
            ? 'Your account has access to more than one agency. Choose one before protected data is loaded.'
            : 'PennSync could not verify a current active agency membership. Retry, or contact your administrator.')}
        </p>

        {selectionRequired && (
          <div className="mt-5 grid gap-3" role="list" aria-label="Available agencies">
            {memberships.map((membership) => (
              <button
                key={membership.membership_id}
                type="button"
                onClick={() => onSelect(membership.agency_id)}
                className="rounded-lg border border-slate-300 px-4 py-3 text-left hover:border-navy-400 hover:bg-navy-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
              >
                <span className="block font-semibold text-slate-900">{membership.agency.name}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {membership.tenant_role.replaceAll('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!selectionRequired && (
            <button
              type="button"
              onClick={requiresReload ? () => window.location.reload() : onRetry}
              className="rounded-lg bg-navy-700 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
            >
              {requiresReload ? 'Reload app' : 'Retry verification'}
            </button>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

const TenantReadyApp = () => {
  const { user, tenantAuthorityKey, logout } = useAuth();
  const agreementStatus = useQuery({
    queryKey: [
      'aiContentAgreementStatus',
      user?.id || 'authenticated-user',
      tenantAuthorityKey,
    ],
    queryFn: getAiContentAgreementStatus,
    enabled: Boolean(user && tenantAuthorityKey),
    retry: false,
    staleTime: 0,
  });
  // Three-tier role model (see lib/roles.js): super_admin > facility_admin > nurse.
  // Facility-admin access may come from AuthContext's validated, service-owned
  // AgencyMembership binding. The owner tier still requires the protected
  // Base44 role + configured email; mutable custom User fields never elevate.
  const roleView = getRoleView(user);
  const isSuperAdminUser = roleView === 'super_admin';
  const isAdmin = roleView === 'super_admin' || roleView === 'facility_admin';

  // Memoized <Route> elements — declared before any early returns so the hooks
  // are called unconditionally on every render (rules of hooks). Only the route
  // elements are memoized (they depend on the user's role tier, which is stable
  // across navigations), NOT the <Routes> wrapper. Memoizing the entire <Routes>
  // element makes React bail out of re-rendering the route tree on navigation,
  // so link clicks do nothing. By keeping <Routes> fresh on every render while
  // reusing the same <Route> element references, React Router doesn't rebuild
  // its matcher (the original issue) but still re-renders on location change.
  const routeElements = useMemo(() => ROUTES.map(({ name, Component, adminOnly, superAdminOnly, access }) => {
    const blockedSuperAdmin = superAdminOnly && !isSuperAdminUser;
    const blockedAdmin = adminOnly && !isAdmin;
    const blockedAccess = !blockedSuperAdmin && !blockedAdmin && !canAccessLevel(user, access);
    return (
      <Route
        key={name}
        path={`/${name}`}
        element={
          <ErrorBoundary key={name}>
            {blockedSuperAdmin
              ? <AdminOnlyFallback superAdmin />
              : blockedAdmin
                ? <AdminOnlyFallback />
                : blockedAccess
                  ? <RoleAccessFallback access={access} />
                : (
                  <Suspense fallback={<RoutePageLoader />}>
                    <Component />
                  </Suspense>
                )}
          </ErrorBoundary>
        }
      />
    );
  }), [isSuperAdminUser, isAdmin, user]);

  const redirectElements = useMemo(() => REDIRECTS.map(({ from, to }) => (
    <Route key={from} path={from} element={<RedirectTo to={to} />} />
  )), []);

  // Never render a clinical route from cached agreement data while a fresh
  // protected verification is in flight. This matters when returning from a
  // public token route or re-enabling the query for the same authenticated
  // user: React Query may retain old data while it performs the new request.
  if (!user || agreementStatus.isPending || agreementStatus.isFetching) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  if (agreementStatus.isError) {
    return (
      <AgreementVerificationUnavailable
        onRetry={() => agreementStatus.refetch()}
        onSignOut={() => logout()}
      />
    );
  }

  // Responsibility gate: before using the software, every user must sign off
  // that they are responsible for proofreading/editing AI-generated material
  // and for attesting to anything they submit. This sits AFTER the auth gate
  // (so we have a user to record acceptance against) but BEFORE any app route
  // renders. The public /join and /signer routes are handled above, so external
  // patients are never asked to accept it. Only the protected status broker's
  // service-owned AIContentAgreementAttestation is trusted here; self-mutable User
  // fields cannot satisfy this gate. Version-bumping the agreement in
  // lib/aiContentAgreement.js re-prompts everyone.
  if (!hasAcceptedAiContentAgreement(agreementStatus.data)) {
    return (
      <AIContentResponsibilityAgreement
        onAccepted={async () => {
          const result = await agreementStatus.refetch({ cancelRefetch: true });
          if (result.error) throw result.error;
          if (!hasAcceptedAiContentAgreement(result.data)) {
            throw new Error('Protected agreement verification did not confirm the current version.');
          }
        }}
      />
    );
  }

  // Render the main app. A single layout route keeps the sidebar, header, and
  // bottom nav mounted across navigations — only the page content (Outlet)
  // changes. The <Route> elements are memoized above (before the early returns)
  // so the matcher is NOT rebuilt on every navigation re-render, but <Routes>
  // itself is created fresh each render so React Router re-renders on location
  // change and link clicks actually navigate.
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${MAIN_PAGE}`} replace />} />
      <Route element={<Layout />}>
        {routeElements}
        {redirectElements}
        <Route path="*" element={<PageNotFound />} />
      </Route>
    </Routes>
  );
};

const AuthenticatedApp = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    isAuthenticated,
    tenantAuthorityState,
    tenantAuthorityKey,
    tenantMemberships,
    tenantContext,
    tenantContextError,
    selectTenant,
    retryTenantAuthority,
    setPublicRouteActive,
    logout,
  } = useAuth();
  const publicTokenPath = isPublicTokenPath(location.pathname);
  const publicCapabilitySnapshot = getPublicCapabilitySnapshot(location);
  const [preparedPublicSnapshot, setPreparedPublicSnapshot] = useState(null);
  const [publicPreparationFailed, setPublicPreparationFailed] = useState(false);

  // A public capability/privacy route must not leave an existing staff tenant
  // authority reusable in memory. The provider invalidates READY immediately
  // on entry; on return it completes a fresh auth -> membership -> context
  // verification before TenantAuthorityBoundary can mount protected children.
  useLayoutEffect(() => {
    let current = true;
    setPreparedPublicSnapshot(null);
    setPublicPreparationFailed(false);

    if (!publicTokenPath) {
      void setPublicRouteActive(false);
      return () => { current = false; };
    }

    // Do not mount a token-bearing page until the staff realm and every local
    // tenant cache/window have finished closing. Exact URL changes while
    // already public are then separated by PublicCapabilityBoundary below.
    void Promise.resolve(setPublicRouteActive(true)).then(
      (prepared) => {
        if (!current) return;
        if (prepared === true) {
          setPreparedPublicSnapshot(publicCapabilitySnapshot);
        } else {
          setPublicPreparationFailed(true);
        }
      },
      () => {
        if (current) setPublicPreparationFailed(true);
      },
    );
    return () => { current = false; };
  }, [publicCapabilitySnapshot, publicTokenPath, setPublicRouteActive]);

  // Capability-token public routes stay outside both authentication and tenant
  // authority gates. No protected component or agreement query is created.
  if (publicTokenPath) {
    if (publicPreparationFailed) {
      return (
        <AppUnavailableScreen
          type="public_capability_unavailable"
          message="This secure link cannot open until local workspace data is safely cleared. Reload the page to try again."
        />
      );
    }
    const publicFallback = (
      <div className="fixed inset-0 flex items-center justify-center">
        <PageLoader />
      </div>
    );
    if (!publicCapabilitySnapshot || preparedPublicSnapshot !== publicCapabilitySnapshot) {
      return publicFallback;
    }
    return (
      <PublicCapabilityBoundary
        key={publicCapabilitySnapshot}
        capabilitySnapshot={publicCapabilitySnapshot}
        fallback={publicFallback}
      >
        <Suspense fallback={publicFallback}>
          <Routes>
            <Route path="/join/*" element={<JoinTelehealth />} />
            <Route path="/signer/*" element={<SignerPortal />} />
            <Route path="/followup/*" element={<ProviderFollowUpPortal />} />
            <Route path="/consent/*" element={<OAuthConsent />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/privacypolicy" element={<PrivacyPolicy />} />
            <Route path="/consent" element={<OAuthConsent />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </PublicCapabilityBoundary>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'configuration_error') {
      return <ConfigurationErrorScreen message={authError.message} />;
    }
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') return <SignInScreen />;
    return <AppUnavailableScreen type={authError.type} message={authError.message} />;
  }

  if (!isAuthenticated) return <SignInScreen />;

  const selectFromNeutralRoute = (agencyId) => {
    navigate(`/${MAIN_PAGE}`, { replace: true });
    void selectTenant(agencyId);
  };

  let authorityFallback = (
    <div className="fixed inset-0 flex items-center justify-center">
      <PageLoader />
    </div>
  );
  if (tenantAuthorityState === TENANT_AUTHORITY_STATES.SELECTION_REQUIRED) {
    authorityFallback = (
      <TenantAuthorityScreen
        memberships={tenantMemberships}
        error={tenantContextError}
        onSelect={selectFromNeutralRoute}
        onRetry={() => { void retryTenantAuthority(); }}
        onSignOut={() => { void logout(); }}
      />
    );
  } else if (
    tenantAuthorityState === TENANT_AUTHORITY_STATES.BLOCKED
    || (tenantAuthorityState === TENANT_AUTHORITY_STATES.READY
      && (!user || !tenantContext || !tenantAuthorityKey))
  ) {
    authorityFallback = (
      <TenantAuthorityScreen
        memberships={[]}
        error={tenantContextError}
        onSelect={selectFromNeutralRoute}
        onRetry={() => { void retryTenantAuthority(); }}
        onSignOut={() => { void logout(); }}
      />
    );
  }

  return (
    <TenantAuthorityBoundary
      authorityState={tenantAuthorityState}
      authorityKey={tenantAuthorityKey}
      fallback={authorityFallback}
    >
      <ConfirmDialogProvider>
        {/* Both agents can observe protected navigation/DOM. Keep them in the
            exact keyed realm so a tenant switch, logout, or public-route entry
            unmounts their effects and releases every captured reference. */}
        <NavigationTracker />
        <VisualEditAgent />
        <TenantReadyApp />
        <Toaster />
        <SonnerToaster
          position="top-right"
          richColors
          closeButton
          theme="light"
          toastOptions={{
            classNames: {
              toast: "rounded-xl border shadow-lg",
              title: "font-semibold",
              description: "text-slate-600",
            },
          }}
        />
      </ConfirmDialogProvider>
    </TenantAuthorityBoundary>
  );
};


function App() {
  const routerBasename = getRouterBasename({ routerPaths: ROUTER_PATHS });

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router basename={routerBasename}>
            <AuthenticatedApp />
          </Router>
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
