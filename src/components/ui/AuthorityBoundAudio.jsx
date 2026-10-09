import { useLayoutEffect, useRef, useState } from 'react';
import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
} from '@/lib/tenantSdkRealmGate';

// A link from `resolveSrc` is reused for a replay or a resume within this
// window, then requested again: the links it returns expire in minutes.
const RESOLVED_SRC_REUSE_MS = 4 * 60 * 1000;

function playableHttpsUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Play protected audio without exposing the browser's native media controls,
 * whose Save/Open/casting surfaces cannot be registered for tenant teardown.
 *
 * Give it either `src`, or `resolveSrc` — an async function returning a
 * short-lived https link, called when the viewer presses play (not on render),
 * so a signed link is only ever minted for audio somebody chose to hear. A
 * link that arrives after the tenant authority closed is discarded unused.
 */
export default function AuthorityBoundAudio({
  src,
  resolveSrc,
  controls: _controls,
  className = '',
  preload = 'none',
}) {
  const audioRef = useRef(null);
  const leaseRef = useRef(null);
  const generationRef = useRef(0);
  const resolvedAtRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useLayoutEffect(() => {
    const audio = audioRef.current;
    let lease = null;
    let signal = null;
    const detach = () => {
      generationRef.current += 1;
      leaseRef.current = null;
      resolvedAtRef.current = 0;
      setPlaying(false);
      setLoading(false);
      if (!audio) return;
      audio.onended = null;
      try { audio.pause(); } catch { /* already stopped */ }
      audio.removeAttribute('src');
      try { audio.load(); } catch { /* browser already discarded media */ }
    };
    try {
      lease = captureTenantSdkRealmLease();
      signal = getTenantSdkRealmAbortSignal(lease);
      leaseRef.current = lease;
      if (src) audio.src = src;
      audio.preload = preload;
      audio.onended = () => {
        if (!isTenantSdkRealmLeaseCurrent(lease)) return;
        generationRef.current += 1;
        setPlaying(false);
      };
      signal.addEventListener('abort', detach, { once: true });
      if (!isTenantSdkRealmLeaseCurrent(lease)) detach();
    } catch {
      detach();
    }
    return () => {
      signal?.removeEventListener('abort', detach);
      detach();
    };
  }, [preload, src]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    const lease = leaseRef.current;
    if (!audio || !lease || !isTenantSdkRealmLeaseCurrent(lease)) return;
    if (!audio.paused) {
      generationRef.current += 1;
      audio.pause();
      setPlaying(false);
      return;
    }
    const generation = ++generationRef.current;
    const current = () => generation === generationRef.current
      && leaseRef.current === lease
      && isTenantSdkRealmLeaseCurrent(lease);
    try {
      const needsLink = !src && typeof resolveSrc === 'function'
        && (!audio.getAttribute('src') || Date.now() - resolvedAtRef.current > RESOLVED_SRC_REUSE_MS);
      if (needsLink) {
        setUnavailable(false);
        setLoading(true);
        let link = null;
        try {
          link = playableHttpsUrl(await resolveSrc());
        } catch {
          link = null;
        }
        if (!current()) return;
        setLoading(false);
        if (!link) {
          setUnavailable(true);
          return;
        }
        audio.src = link;
        resolvedAtRef.current = Date.now();
      }
      await audio.play();
      if (current()) setPlaying(true);
    } catch {
      if (current()) setPlaying(false);
    }
  };

  return (
    <div className={className}>
      <audio
        ref={audioRef}
        preload="none"
        hidden
        controls={false}
        disableRemotePlayback
      />
      <button
        type="button"
        onClick={togglePlayback}
        className="inline-flex min-h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        aria-label={playing ? 'Pause protected audio' : 'Play protected audio'}
        aria-busy={loading || undefined}
      >
        {playing ? 'Pause audio' : loading ? 'Loading audio…' : 'Play audio'}
      </button>
      {unavailable && (
        <span role="status" className="ml-2 text-xs text-slate-500">Recording unavailable</span>
      )}
    </div>
  );
}
