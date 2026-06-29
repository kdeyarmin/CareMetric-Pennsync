import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';

// Connection quality readout for the active video call. The @telnyx/video
// `connectionQuality` runs from 0 (network_broken) to 5 (excellent_network); we
// enable the room's network-metrics report for the local participant and read it
// off the `network_metrics_report` event, falling back to the browser
// online/offline signal otherwise.
//
// `room` is the connected Telnyx Video Room (a real value, not a ref) so this
// effect re-subscribes if/when the room becomes available or changes. The SDK
// surface used here (enableNetworkMetricsReport / network_metrics_report /
// getState().localParticipantId) is asserted by telnyxVideoApi.test.js.
export default function NetworkMonitor({ room }) {
  const [level, setLevel] = useState(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!room || typeof room.on !== 'function') return undefined;
    const localId = room.getState?.().localParticipantId;
    if (!localId) return undefined;
    // Ask the room to start emitting metrics for our own leg.
    try { room.enableNetworkMetricsReport([localId]); } catch { /* optional */ }
    const unsubscribe = room.on('network_metrics_report', (metrics) => {
      const q = metrics?.[localId]?.connectionQuality;
      if (typeof q === 'number') setLevel(q);
    });
    return () => {
      try { unsubscribe?.(); } catch { /* already gone */ }
      try { room.disableNetworkMetricsReport([localId]); } catch { /* optional */ }
    };
  }, [room]);

  if (!online || level === 0) {
    return (
      <Badge className="bg-red-100 text-red-700 border border-red-300 gap-1">
        <WifiOff className="w-3 h-3" />
        {online ? 'Connection lost' : 'No Internet'}
      </Badge>
    );
  }

  if (level !== null && level <= 2) {
    return (
      <Badge className="bg-amber-100 text-amber-700 border border-amber-300 gap-1">
        <AlertTriangle className="w-3 h-3" />
        Weak connection
      </Badge>
    );
  }

  if (level !== null && level === 3) {
    return (
      <Badge className="bg-yellow-100 text-yellow-700 border border-yellow-300 gap-1">
        <Wifi className="w-3 h-3" />
        Fair connection
      </Badge>
    );
  }

  return (
    <Badge className="bg-green-100 text-green-700 border border-green-300 gap-1">
      <Wifi className="w-3 h-3" />
      {level === null ? 'Checking…' : 'Good connection'}
    </Badge>
  );
}
