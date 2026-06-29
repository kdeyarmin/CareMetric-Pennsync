import { useState, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Pull-to-refresh component for mobile scrollable areas
 * Triggers onRefresh when user pulls down past threshold
 */
export default function PullToRefresh({ onRefresh, children, threshold = 80, containerRef: externalRef }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const internalRef = useRef(null);
  const containerRef = externalRef || internalRef;
  const startYRef = useRef(0);
  const scrollTopRef = useRef(0);

  const handleTouchStart = (e) => {
    startYRef.current = e.touches[0].clientY;
    scrollTopRef.current = containerRef.current?.scrollTop || 0;
  };

  const handleTouchMove = (e) => {
    if (!containerRef.current) return;
    
    // Only trigger pull-to-refresh when at top of scroll
    if (scrollTopRef.current > 0) {
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - startYRef.current);
    setPullDistance(distance);
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(0);
      
      try {
        await onRefresh();
      } catch (error) {
        console.error('Pull-to-refresh error:', error);
      } finally {
        setIsRefreshing(false);
      }
    } else {
      setPullDistance(0);
    }
  };

  return (
    <div
      ref={internalRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="overflow-y-auto relative"
    >
      {/* Pull indicator */}
      {pullDistance > 0 && (
        <div className="flex justify-center items-center pt-2 px-4 select-none">
          <div className="flex flex-col items-center">
            <RefreshCw
              className={`w-5 h-5 text-slate-400 transition-transform ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              style={{
                transform: `rotate(${Math.min(pullDistance / threshold, 1) * 180}deg)`,
              }}
            />
            <span className="text-xs text-slate-500 mt-1">
              {pullDistance >= threshold ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}