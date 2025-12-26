import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Cloud, CloudOff, Loader2 } from "lucide-react";
import offlineStorage from "./OfflineStorage";

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine);
      updatePendingCount();
    };

    const updatePendingCount = () => {
      setPendingCount(offlineStorage.getPendingCount());
    };

    const handleOnline = async () => {
      setIsOnline(true);
      setIsSyncing(true);
      await offlineStorage.syncPendingData();
      setIsSyncing(false);
      updatePendingCount();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', updateOnlineStatus);

    // Update count every 5 seconds
    const interval = setInterval(updatePendingCount, 5000);
    updatePendingCount();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', updateOnlineStatus);
      clearInterval(interval);
    };
  }, []);

  if (isOnline && pendingCount === 0 && !isSyncing) {
    return null; // Don't show when online and synced
  }

  return (
    <div className="fixed bottom-4 left-4 sm:left-auto sm:right-4 z-40 animate-in slide-in-from-bottom max-w-[calc(100vw-2rem)] sm:max-w-sm">
      {!isOnline ? (
        <Badge className="bg-red-600 text-white px-3 sm:px-4 py-2 shadow-lg text-xs sm:text-sm">
          <WifiOff className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          <span className="font-medium">Offline</span>
          {pendingCount > 0 && (
            <span className="ml-1 sm:ml-2 bg-red-700 px-1.5 sm:px-2 py-0.5 rounded-full text-xs">
              {pendingCount}
            </span>
          )}
        </Badge>
      ) : isSyncing ? (
        <Badge className="bg-blue-600 text-white px-3 sm:px-4 py-2 shadow-lg text-xs sm:text-sm">
          <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 animate-spin" />
          <span className="font-medium">Syncing...</span>
        </Badge>
      ) : pendingCount > 0 ? (
        <Badge className="bg-yellow-600 text-white px-3 sm:px-4 py-2 shadow-lg text-xs sm:text-sm">
          <Cloud className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          <span className="font-medium hidden sm:inline">{pendingCount} items pending</span>
          <span className="font-medium sm:hidden">{pendingCount} pending</span>
        </Badge>
      ) : null}
    </div>
  );
}