import React, { useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { motion, useAnimation } from "framer-motion";

export default function PullToRefresh({ onRefresh, children }) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef(null);
  const controls = useAnimation();

  const PULL_THRESHOLD = 80;
  const MAX_PULL = 120;

  const handleTouchStart = (e) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e) => {
    if (!isPulling || window.scrollY > 0) return;

    const currentY = e.touches[0].clientY;
    const distance = Math.min(currentY - startY.current, MAX_PULL);

    if (distance > 0) {
      setPullDistance(distance);
      e.preventDefault();
    }
  };

  const handleTouchEnd = async () => {
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      controls.start({ rotate: 360 });
      
      try {
        await onRefresh();
      } catch (error) {
        console.error('Refresh error:', error);
      }
      
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
        setIsPulling(false);
      }, 500);
    } else {
      setPullDistance(0);
      setIsPulling(false);
    }
  };

  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);

  return (
    <div 
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="pull-to-refresh"
    >
      {/* Pull indicator */}
      <div 
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center pointer-events-none transition-opacity"
        style={{
          height: `${pullDistance}px`,
          opacity: pullDistance > 0 ? 1 : 0,
          paddingTop: 'env(safe-area-inset-top)'
        }}
      >
        <div className="bg-white dark:bg-gray-800 rounded-full p-3 shadow-lg">
          <motion.div
            animate={isRefreshing ? { rotate: 360 } : { rotate: pullProgress * 360 }}
            transition={isRefreshing ? { duration: 1, repeat: Infinity, ease: "linear" } : { duration: 0 }}
          >
            <RefreshCw 
              className={`w-6 h-6 transition-colors ${
                pullDistance >= PULL_THRESHOLD 
                  ? "text-green-600" 
                  : "text-blue-600"
              }`} 
            />
          </motion.div>
        </div>
      </div>

      {/* Content */}
      <div style={{ transform: `translateY(${pullDistance * 0.5}px)`, transition: isPulling ? 'none' : 'transform 0.3s ease-out' }}>
        {children}
      </div>
    </div>
  );
}