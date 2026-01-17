import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Smartphone, Monitor, Tablet } from 'lucide-react';

/**
 * Detect platform and apply optimizations
 */
export function usePlatformDetection() {
  const [platform, setPlatform] = useState({
    type: 'desktop',
    os: 'unknown',
    isTouch: false,
    isMobile: false,
    isIOS: false,
    isAndroid: false,
    hasBiometric: false
  });

  useEffect(() => {
    const ua = navigator.userAgent;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    
    let type = 'desktop';
    if (/iPad/.test(ua)) type = 'tablet';
    else if (isMobile) type = 'mobile';

    let os = 'unknown';
    if (isIOS) os = 'iOS';
    else if (isAndroid) os = 'Android';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    // Check for biometric support
    const checkBiometric = async () => {
      try {
        const available = window.PublicKeyCredential && 
          await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        
        setPlatform({
          type,
          os,
          isTouch,
          isMobile,
          isIOS,
          isAndroid,
          hasBiometric: available
        });
      } catch {
        setPlatform({
          type,
          os,
          isTouch,
          isMobile,
          isIOS,
          isAndroid,
          hasBiometric: false
        });
      }
    };

    checkBiometric();

    // Apply iOS-specific optimizations
    if (isIOS) {
      // Prevent zoom on input focus
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      if (viewportMeta) {
        viewportMeta.setAttribute('content', 
          'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
        );
      }

      // Add iOS safe area support
      document.body.style.paddingTop = 'env(safe-area-inset-top)';
      document.body.style.paddingBottom = 'env(safe-area-inset-bottom)';
    }

    // Apply Android-specific optimizations
    if (isAndroid) {
      // Enable pull-to-refresh
      document.body.style.overscrollBehavior = 'contain';
    }

  }, []);

  return platform;
}

export function PlatformBadge() {
  const platform = usePlatformDetection();

  const getIcon = () => {
    if (platform.type === 'mobile') return <Smartphone className="w-3 h-3" />;
    if (platform.type === 'tablet') return <Tablet className="w-3 h-3" />;
    return <Monitor className="w-3 h-3" />;
  };

  return (
    <Badge variant="outline" className="text-xs">
      {getIcon()}
      <span className="ml-1">{platform.os}</span>
      {platform.hasBiometric && <span className="ml-1">• 🔐</span>}
    </Badge>
  );
}

/**
 * Apply haptic feedback on supported devices
 */
export function hapticFeedback(style = 'light') {
  if (navigator.vibrate) {
    const patterns = {
      light: [10],
      medium: [20],
      heavy: [30],
      success: [10, 50, 10],
      error: [20, 100, 20]
    };
    navigator.vibrate(patterns[style] || patterns.light);
  }
}

/**
 * Request persistent storage for PWA
 */
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    return isPersisted;
  }
  return false;
}

/**
 * Check if app is running as PWA
 */
export function isPWA() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}