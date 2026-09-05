import { useLayoutEffect, useRef, useState } from 'react';
import {
  captureTenantSdkRealmLease,
  getTenantSdkRealmAbortSignal,
  isTenantSdkRealmLeaseCurrent,
} from '@/lib/tenantSdkRealmGate';

/**
 * Play protected audio without exposing the browser's native media controls,
 * whose Save/Open/casting surfaces cannot be registered for tenant teardown.
 */
export default function AuthorityBoundAudio({
  src,
  controls: _controls,
  className = '',
  preload = 'none',
}) {
  const audioRef = useRef(null);
  const leaseRef = useRef(null);
  const generationRef = useRef(0);
  const [playing, setPlaying] = useState(false);

  useLayoutEffect(() => {
    const audio = audioRef.current;
    let lease = null;
    let signal = null;
    const detach = () => {
      generationRef.current += 1;
      leaseRef.current = null;
      setPlaying(false);
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
      audio.src = src;
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
    try {
      await audio.play();
      if (generation === generationRef.current && isTenantSdkRealmLeaseCurrent(lease)) {
        setPlaying(true);
      }
    } catch {
      if (
        generation === generationRef.current
        && isTenantSdkRealmLeaseCurrent(lease)
      ) setPlaying(false);
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
      >
        {playing ? 'Pause audio' : 'Play audio'}
      </button>
    </div>
  );
}
