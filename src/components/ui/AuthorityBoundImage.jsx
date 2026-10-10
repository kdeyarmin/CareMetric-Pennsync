import { useLayoutEffect, useRef, useState } from 'react';
import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
} from '@/lib/tenantSdkRealmGate';
import { detachAuthorityBoundMediaTree } from '@/lib/authorityBoundMediaProcessing';

function displayableHttpsUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Show a protected picture — a private file reachable only through a
 * short-lived signed link — inside the tenant authority that asked for it.
 *
 * `resolveSrc` is an async function returning that https link; pass a stable
 * one (useCallback), since a new function asks for a new link. The link is
 * requested under the tenant lease current at mount and assigned to the
 * element by hand, never through React state, so:
 *   - a link that resolves after that authority closed is discarded unused;
 *   - when the authority closes (sign-out, tenant switch) the element is
 *     detached synchronously — src, srcset and its load callbacks removed, as
 *     detachAuthorityBoundMediaTree does for every protected media tree — and
 *     the picture is not shown again;
 *   - unmounting detaches it the same way.
 * `renderStatus(status)` draws the placeholder while it is 'loading' and once
 * it is 'unavailable' (no https link, a failed request or decode, or the
 * authority closed).
 */
export default function AuthorityBoundImage({
  resolveSrc,
  alt = '',
  className = '',
  renderStatus = null,
}) {
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    let lease = null;
    let signal = null;
    let live = true;
    const detach = () => {
      live = false;
      detachAuthorityBoundMediaTree(frame);
      setStatus('unavailable');
    };
    try {
      lease = captureTenantSdkRealmLease();
      signal = getTenantSdkRealmAbortSignal(lease);
      signal.addEventListener('abort', detach, { once: true });
      if (!isTenantSdkRealmLeaseCurrent(lease)) detach();
    } catch {
      detach();
    }
    const current = () => live && isTenantSdkRealmLeaseCurrent(lease);
    if (live) {
      setStatus('loading');
      Promise.resolve()
        .then(() => (typeof resolveSrc === 'function' ? resolveSrc() : null))
        .then((value) => {
          if (!current()) return;
          const link = displayableHttpsUrl(value);
          if (!image || !link) {
            setStatus('unavailable');
            return;
          }
          image.onerror = () => {
            if (!live) return;
            detachAuthorityBoundMediaTree(frame);
            setStatus('unavailable');
          };
          image.src = link;
          setStatus('ready');
        }, () => {
          if (current()) setStatus('unavailable');
        });
    }
    return () => {
      signal?.removeEventListener('abort', detach);
      detach();
    };
  }, [resolveSrc]);

  return (
    <span ref={frameRef} className="contents">
      <img ref={imageRef} alt={alt} className={className} hidden={status !== 'ready'} />
      {status !== 'ready' && typeof renderStatus === 'function' ? renderStatus(status) : null}
    </span>
  );
}
