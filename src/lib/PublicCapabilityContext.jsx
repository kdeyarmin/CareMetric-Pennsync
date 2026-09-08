import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';
import { closeAuthorityBoundWindows } from '@/lib/authorityBoundWindows';
import {
  activatePublicCapabilityRealm,
  closePublicCapabilityRealm,
  isPublicCapabilityLeaseCurrent,
} from '@/lib/publicCapabilityRealmGate';
import { isBrowserAuthorityEpochStorageKey } from '@/lib/browserAuthorityEpoch';

const PublicCapabilityContext = createContext(null);

/**
 * Withhold and remount public token content until its exact URL lease is live.
 * The old subtree disappears before the new lease is activated.
 */
export function PublicCapabilityBoundary({ capabilitySnapshot, fallback = null, children }) {
  const [binding, setBinding] = useState(null);

  useLayoutEffect(() => {
    closeAuthorityBoundWindows();
    let lease = null;
    try {
      lease = activatePublicCapabilityRealm(capabilitySnapshot);
      setBinding({ capabilitySnapshot, lease });
    } catch {
      setBinding(null);
    }

    const ownerWindow = typeof window === 'undefined' ? null : window;
    const closeThisBinding = () => {
      closeAuthorityBoundWindows();
      if (lease) closePublicCapabilityRealm(lease);
      // A queued event from the previous effect must not erase a newer lease.
      setBinding((current) => (current?.lease === lease ? null : current));
    };
    const handlePageHide = () => closeThisBinding();
    const handlePageShow = (event) => {
      // A bfcache restore revives the old heap. Only a real navigation may
      // issue a new capability lease for that URL.
      if (event.persisted) ownerWindow.location.reload();
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
      ) {
        closeThisBinding();
      }
    };
    ownerWindow?.addEventListener('pagehide', handlePageHide);
    ownerWindow?.addEventListener('pageshow', handlePageShow);
    ownerWindow?.addEventListener('storage', handleStorage);

    return () => {
      ownerWindow?.removeEventListener('pagehide', handlePageHide);
      ownerWindow?.removeEventListener('pageshow', handlePageShow);
      ownerWindow?.removeEventListener('storage', handleStorage);
      closeAuthorityBoundWindows();
      if (lease) closePublicCapabilityRealm(lease);
    };
  }, [capabilitySnapshot]);

  if (
    binding?.capabilitySnapshot !== capabilitySnapshot
    || !isPublicCapabilityLeaseCurrent(binding?.lease)
  ) {
    return fallback;
  }

  return (
    <PublicCapabilityContext.Provider value={binding.lease}>
      {children}
    </PublicCapabilityContext.Provider>
  );
}

export function usePublicCapabilityLease() {
  const lease = useContext(PublicCapabilityContext);
  if (!lease || !isPublicCapabilityLeaseCurrent(lease)) {
    throw new Error('usePublicCapabilityLease requires an active PublicCapabilityBoundary');
  }
  return lease;
}
