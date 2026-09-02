import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams, plantLoginReturnState } from '@/lib/app-params';
import { createAxiosClient } from '@/lib/base44AxiosClient';
import { queryClientInstance } from '@/lib/query-client';
import { clearCachedPHI } from '@/lib/phiStorage';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  // `silent` re-fetches the current user WITHOUT flipping the global
  // isLoadingAuth flag — used by refreshUser() so re-reading the user (e.g.
  // after accepting the AI content agreement) doesn't unmount the whole route
  // tree behind the boot-time <PageLoader />. A failed silent refresh also
  // leaves the existing session intact rather than tearing it down on a
  // transient error.
  const checkUserAuth = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      if (!silent) setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      if (silent) {
        // 401/403 means the token has expired or been revoked — the session is
        // genuinely invalid, not just transiently unreachable, so propagate the
        // auth error even in silent mode. Other errors (network, 5xx) are
        // transient; leave the existing session intact.
        if (error.status === 401 || error.status === 403) {
          setUser(null);
          setIsAuthenticated(false);
          setAuthError({ type: 'auth_required', message: 'Authentication required' });
        }
        return;
      }
      setIsLoadingAuth(false);
      setIsAuthenticated(false);

      // If user auth fails, it might be an expired token
      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      } else {
        // Non-auth failure (network blip, 5xx) with a token still in storage:
        // this is a backend/connectivity outage, not a missing session. With no
        // authError set, AuthenticatedApp would fall through to <SignInScreen />
        // and mislead the user into re-entering credentials to "fix" an outage
        // — the exact failure mode the public-settings fetch already guards
        // against. Surface the real error instead.
        setAuthError({
          type: 'unknown',
          message: error.message || 'Could not reach the server. Check your connection and try again.'
        });
      }
    }
  }, []);

  const checkAppState = useCallback(async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      if (!appParams.appId || !appParams.serverUrl) {
        setAuthError({
          type: 'configuration_error',
          message: 'Missing app configuration. Set VITE_BASE44_APP_ID and VITE_BASE44_BACKEND_URL.'
        });
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
        return;
      }
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `${appParams.serverUrl}/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else if (reason === 'not_deployed') {
            // The app ID resolves, but the backend has no published deployment
            // for it (a freshly created / duplicated app). This is a platform
            // publishing state, not a configuration problem.
            // Prefer the backend's own explanation over the transport-level
            // message (which can be a generic "Request failed with status 403").
            const backendMessage = appError.data?.message || appError.data?.detail || appError.message;
            setAuthError({
              type: 'not_deployed',
              message: `Base44 has no deployment for app ${appParams.appId}. ${backendMessage || 'Publish it from the Base44 dashboard.'}`
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  }, [checkUserAuth]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    // HIPAA: purge all cached PHI so the next user on a shared device can't
    // see the previous session's patient data before refetch.
    sessionStorage.clear();
    try { queryClientInstance.clear(); } catch (_e) { /* no-op */ }
    // Also purge re-fetchable PHI persisted to localStorage/IndexedDB (the
    // in-memory React Query cache is not the only copy). Await so the IndexedDB
    // clear finishes before the redirect navigation abandons it.
    try { await clearCachedPHI(); } catch (_e) { /* no-op */ }

    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Don't redirect if we're already on the login page to prevent loops
    if (window.location.pathname === '/login') return;
    // Plant a one-time auth_state on the return URL so an empty-referrer
    // handoff from hosted login can be distinguished from a phishing link
    // that only carries ?access_token= (see evaluateAccessTokenTrust /
    // pending confirm on SignInScreen).
    const returnUrl = plantLoginReturnState(window.location.href);
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
      logout,
      navigateToLogin,
      checkAppState,
      // Re-fetch the current user (e.g. after they accept the AI content
      // responsibility agreement) so gates keyed off `user` re-evaluate.
      // Silent so it doesn't flash the full-app boot loader mid-session.
      refreshUser: () => checkUserAuth({ silent: true })
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
