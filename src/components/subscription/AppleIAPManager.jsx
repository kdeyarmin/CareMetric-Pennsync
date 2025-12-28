import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Apple In-App Purchase Manager
 * Handles IAP subscription flow for iOS and macOS
 */

// Product IDs for Apple IAP
export const APPLE_PRODUCTS = {
  monthly: 'com.monthly.premium',
  quarterly: 'com.quarterly.premium',
  semiannual: 'com.semiannual.premium',
  annual: 'com.annual.premium'
};

export const useAppleIAP = () => {
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Check if Apple IAP is available (injected by native app)
    const checkIAP = () => {
      const hasIAP = window.webkit?.messageHandlers?.iap;
      console.log('IAP availability check:', {
        hasWebkit: !!window.webkit,
        hasMessageHandlers: !!window.webkit?.messageHandlers,
        hasIAP: hasIAP,
        webkitKeys: window.webkit ? Object.keys(window.webkit) : []
      });
      setIsReady(!!hasIAP);
    };
    
    checkIAP();
    
    // Re-check after a short delay in case the bridge loads asynchronously
    const timer = setTimeout(checkIAP, 500);
    return () => clearTimeout(timer);
  }, []);

  const purchaseSubscription = async (productId, userEmail) => {
    // Check for IAP handler availability
    const hasIAPHandler = window.webkit?.messageHandlers?.iap;
    
    console.log('Apple IAP check:', {
      hasWebkit: !!window.webkit,
      hasMessageHandlers: !!window.webkit?.messageHandlers,
      hasIAP: !!hasIAPHandler,
      webkit: window.webkit
    });
    
    if (!hasIAPHandler) {
      throw new Error('Apple IAP not available');
    }

    setIsProcessing(true);
    
    try {
      // Send purchase request to native iOS/macOS app
      return new Promise((resolve, reject) => {
        const messageId = `purchase_${Date.now()}`;
        
        // Listen for response from native app
        window.addEventListener('iapResponse', function handler(event) {
          if (event.detail.messageId === messageId) {
            window.removeEventListener('iapResponse', handler);
            
            if (event.detail.success) {
              resolve(event.detail);
            } else {
              reject(new Error(event.detail.error || 'Purchase failed'));
            }
          }
        });

        // Send purchase request to native app
        window.webkit.messageHandlers.iap.postMessage({
          action: 'purchase',
          productId: productId,
          userEmail: userEmail,
          messageId: messageId
        });
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const restorePurchases = async () => {
    if (!window.webkit?.messageHandlers?.iap) {
      throw new Error('Apple IAP not available');
    }

    return new Promise((resolve, reject) => {
      const messageId = `restore_${Date.now()}`;
      
      window.addEventListener('iapResponse', function handler(event) {
        if (event.detail.messageId === messageId) {
          window.removeEventListener('iapResponse', handler);
          
          if (event.detail.success) {
            resolve(event.detail);
          } else {
            reject(new Error(event.detail.error || 'Restore failed'));
          }
        }
      });

      window.webkit.messageHandlers.iap.postMessage({
        action: 'restore',
        messageId: messageId
      });
    });
  };

  const getProductInfo = async (productId) => {
    if (!window.webkit?.messageHandlers?.iap) {
      return null;
    }

    return new Promise((resolve) => {
      const messageId = `info_${Date.now()}`;
      
      window.addEventListener('iapResponse', function handler(event) {
        if (event.detail.messageId === messageId) {
          window.removeEventListener('iapResponse', handler);
          resolve(event.detail.product || null);
        }
      }, { once: true });

      window.webkit.messageHandlers.iap.postMessage({
        action: 'getProductInfo',
        productId: productId,
        messageId: messageId
      });

      // Timeout after 5 seconds
      setTimeout(() => resolve(null), 5000);
    });
  };

  return {
    isReady,
    isProcessing,
    purchaseSubscription,
    restorePurchases,
    getProductInfo
  };
};

// Component for displaying IAP-specific UI
export default function AppleIAPManager({ children }) {
  const { isReady } = useAppleIAP();

  if (!isReady) {
    return (
      <div className="text-center p-6 text-gray-500">
        <p>Initializing Apple In-App Purchases...</p>
      </div>
    );
  }

  return <>{children}</>;
}