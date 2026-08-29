// Routes are defined in src/routes.jsx (the single source of truth shared with
// NavigationTracker). Not every page file under src/pages is routed — add a page
// to ROUTES there to make it reachable, or add a REDIRECT for a renamed page.

import './App.css'
import { lazy, Suspense, useMemo } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router';
import PageNotFound from './lib/PageNotFound';
import PageLoader from '@/components/ui/PageLoader';
import SignerPortal from '@/pages/SignerPortal';
import ProviderFollowUpPortal from '@/pages/ProviderFollowUpPortal';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import SignInScreen from '@/components/auth/SignInScreen';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AIContentResponsibilityAgreement from '@/components/compliance/AIContentResponsibilityAgreement';
import Layout from '@/components/Layout';
import ErrorBoundary from '@/components/utils/ErrorBoundary';
import { ROUTES, REDIRECTS, MAIN_PAGE, ROUTER_PATHS } from '@/routes';
import { getRoleView } from '@/lib/roles';
import { hasAcceptedAiContentAgreement } from '@/lib/aiContentAgreement';
import { getRouterBasename } from '@/lib/routerBasename';
import { isPublicTokenPath } from '@/lib/publicRoutes';

// Public (no-login) patient telehealth join page. Stale-chunk auto-recovery
// (dev-server restart) is handled centrally by the ErrorBoundary, which wraps
// the whole app — so plain lazy() is sufficient here.
const JoinTelehealth = lazy(() => import('@/pages/JoinTelehealth'));

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

// Redirect that PRESERVES the original query string and router state when
// forwarding a retired/consolidated path to its new home. Consolidated pages
// became hub tabs (e.g. /ReferralIntake?tab=admission); a plain <Navigate to>
// would drop an incoming ?referral_id=/?id= or location.state, so merge the
// incoming search params onto the target (target params win on conflict).
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
      state={location.state}
      replace
    />
  );
};

const RoutePageLoader = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <PageLoader />
  </div>
);

const AuthenticatedApp = () => {
  const location = useLocation();
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated } = useAuth();
  // Three-tier role model (see lib/roles.js): super_admin > facility_admin > nurse.
  // The platform super admin (owner email or super_admin account_type) reaches
  // admin routes even before their `role` is `admin`. This is what lets the
  // owner land on SuperAdminConfig on first sign-in so its ensureSuperAdmin
  // self-bootstrap can run — without it, an unpromoted owner hits the
  // AdminOnlyFallback and the chicken-and-egg never resolves.
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
  const routeElements = useMemo(() => ROUTES.map(({ name, Component, adminOnly, superAdminOnly }) => {
    const blockedSuperAdmin = superAdminOnly && !isSuperAdminUser;
    const blockedAdmin = adminOnly && !isAdmin;
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
                : (
                  <Suspense fallback={<RoutePageLoader />}>
                    <Component />
                  </Suspense>
                )}
          </ErrorBoundary>
        }
      />
    );
  }), [isSuperAdminUser, isAdmin]);

  const redirectElements = useMemo(() => REDIRECTS.map(({ from, to }) => (
    <Route key={from} path={from} element={<RedirectTo to={to} />} />
  )), []);

  // Public patient join/signer routes render WITHOUT authentication — they are
  // gated by capability tokens in the link, not by an app login. This is
  // checked before the auth gate below so external users are never bounced to login.
  // Segment match, not a string prefix — see lib/publicRoutes.js.
  if (isPublicTokenPath(location.pathname)) {
    return (
      <Suspense fallback={
        <div className="fixed inset-0 flex items-center justify-center">
          <PageLoader />
        </div>
      }>
        <Routes>
          <Route path="/join/*" element={<JoinTelehealth />} />
          <Route path="/signer/*" element={<SignerPortal />} />
          {/* Provider follow-up response portal — token-gated, no app login */}
          <Route path="/followup/*" element={<ProviderFollowUpPortal />} />
          {/* Public privacy policy — required in-app pre-auth (App Store 5.1.1(i)) */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          {/* Catch-all so a public-segment URL that matches no inner route (e.g.
              /privacy/extra) renders the not-found page instead of a blank
              screen — this <Routes> block has no fallback otherwise. */}
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Suspense>
    );
  }

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <PageLoader />
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'configuration_error') {
      return <ConfigurationErrorScreen message={authError.message} />;
    } else if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Branded in-app sign-in (replaces the redirect to the unbranded
      // platform-hosted /login page). Rendering in place preserves the URL,
      // so deep links survive sign-in.
      return <SignInScreen />;
    }
    // Any other error type (e.g. 'unknown' from a failed public-settings fetch,
    // or a server-supplied reason we don't special-case) is an app-load
    // failure, NOT a missing session. Falling through to <SignInScreen /> would
    // mislead the user into trying to sign in to fix a backend outage — surface
    // the actual error instead.
    return <ConfigurationErrorScreen message={authError.message} />;
  }

  // Gate the whole app on authentication. The no-token path does NOT set an
  // authError, so without this an unauthenticated user would render every
  // route and fire PHI queries. Never rely on authError alone here.
  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  // Responsibility gate: before using the software, every user must sign off
  // that they are responsible for proofreading/editing AI-generated material
  // and for attesting to anything they submit. This sits AFTER the auth gate
  // (so we have a user to record acceptance against) but BEFORE any app route
  // renders. The public /join and /signer routes are handled above, so external
  // patients are never asked to accept it. Version-bumping the agreement in
  // lib/aiContentAgreement.js re-prompts everyone.
  if (!hasAcceptedAiContentAgreement(user)) {
    return <AIContentResponsibilityAgreement />;
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


function App() {
  const routerBasename = getRouterBasename({ routerPaths: ROUTER_PATHS });

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <ConfirmDialogProvider>
            <Router basename={routerBasename}>
              <NavigationTracker />
              <AuthenticatedApp />
            </Router>
            <Toaster />
            {/* The whole app toasts through sonner (query-client,
                useMutationWithToast, alert-shim). Mounted HERE —
                not inside Layout — so toasts fired while Layout isn't rendered
                (sign-in screen, AI-agreement gate, pending-approval screen)
                still appear instead of being silently dropped. */}
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
            <VisualEditAgent />
          </ConfirmDialogProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App