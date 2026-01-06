import React, { useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function PullToRefresh({ onRefresh, children }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [canPull, setCanPull] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef(null);

  const threshold = 80; // Distance needed to trigger refresh

  useEffect(() => {
    const handleTouchStart = (e) => {
      // Only allow pull-to-refresh if we're at the top of the page
      if (window.scrollY === 0) {
        startY.current = e.touches[0].clientY;
        setCanPull(true);
      }
    };

    const handleTouchMove = (e) => {
      if (!canPull || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const distance = currentY - startY.current;

      if (distance > 0 && window.scrollY === 0) {
        // Prevent default scrolling when pulling down
        e.preventDefault();
        // Apply resistance to the pull (diminishing returns)
        const resistedDistance = Math.min(distance * 0.5, threshold * 1.5);
        setPullDistance(resistedDistance);
      }
    };

    const handleTouchEnd = async () => {
      if (pullDistance > threshold && !isRefreshing) {
        setIsRefreshing(true);
        setPullDistance(threshold);
        
        try {
          await onRefresh();
        } finally {
          setTimeout(() => {
            setIsRefreshing(false);
            setPullDistance(0);
            setCanPull(false);
          }, 500);
        }
      } else {
        setPullDistance(0);
        setCanPull(false);
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd, { passive: true });
    }

    return () => {
      if (container) {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [canPull, pullDistance, isRefreshing, onRefresh, threshold]);

  return (
    <div ref={containerRef} className="relative pull-to-refresh">
      {/* Refresh Indicator */}
      <AnimatePresence>
        {pullDistance > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 flex justify-center z-50 pointer-events-none"
            style={{ 
              transform: `translateY(${Math.min(pullDistance, threshold)}px)`,
              paddingTop: 'env(safe-area-inset-top)'
            }}
          >
            <div className="bg-white dark:bg-gray-800 rounded-full shadow-lg p-3 mt-4">
              <RefreshCw 
                className={`w-6 h-6 text-blue-600 dark:text-blue-400 ${
                  isRefreshing || pullDistance > threshold ? 'animate-spin' : ''
                }`}
                style={{
                  transform: `rotate(${pullDistance * 2}deg)`
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div style={{ 
        transform: `translateY(${pullDistance > 0 ? Math.min(pullDistance * 0.3, 30) : 0}px)`,
        transition: isRefreshing ? 'transform 0.3s ease-out' : 'none'
      }}>
        {children}
      </div>
    </div>
  );
}