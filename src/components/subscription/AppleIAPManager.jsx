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
      const messageHandlerKeys = window.webkit?.messageHandlers ? Object.keys(window.webkit.messageHandlers) : [];
      
      console.log('=== IAP Bridge Debug ===');
      console.log('window.webkit exists:', !!window.webkit);
      console.log('window.webkit.messageHandlers exists:', !!window.webkit?.messageHandlers);
      console.log('Available message handlers:', messageHandlerKeys);
      console.log('window.webkit.messageHandlers.iap exists:', !!hasIAP);
      console.log('Full webkit object:', window.webkit);
      console.log('======================');
      
      setIsReady(!!hasIAP);
    };
    
    checkIAP();
    
    // Re-check after delays in case the bridge loads asynchronously
    const timer1 = setTimeout(checkIAP, 500);
    const timer2 = setTimeout(checkIAP, 1000);
    const timer3 = setTimeout(checkIAP, 2000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  const purchaseSubscription = async (productId, userEmail) => {
    setIsProcessing(true);
    
    // Check for IAP handler availability with detailed logging
    const hasIAPHandler = window.webkit?.messageHandlers?.iap;
    
    console.log('=== Apple IAP Purchase Attempt ===');
    console.log('hasWebkit:', !!window.webkit);
    console.log('hasMessageHandlers:', !!window.webkit?.messageHandlers);
    console.log('hasIAP:', !!hasIAPHandler);
    console.log('messageHandlers keys:', window.webkit?.messageHandlers ? Object.keys(window.webkit.messageHandlers) : 'none');
    console.log('Full webkit:', window.webkit);
    console.log('Product ID:', productId);
    console.log('User Email:', userEmail);
    console.log('================================');
    
    if (!hasIAPHandler) {
      setIsProcessing(false);
      throw new Error('Apple IAP bridge not found. Please make sure you are using the native iOS app.');
    }
    
    // Send purchase request to native iOS/macOS app
    return new Promise((resolve, reject) => {
      const messageId = `purchase_${Date.now()}`;
      let timeoutId;
      
      // Listen for response from native app
      window.addEventListener('iapResponse', function handler(event) {
        if (event.detail.messageId === messageId) {
          window.removeEventListener('iapResponse', handler);
          clearTimeout(timeoutId);
          setIsProcessing(false);
          
          if (event.detail.success) {
            resolve(event.detail);
          } else {
            reject(new Error(event.detail.error || 'Purchase failed'));
          }
        }
      });

      // Timeout after 3 minutes (Apple IAP can take time with user confirmation)
      timeoutId = setTimeout(() => {
        setIsProcessing(false);
        reject(new Error('Purchase request timed out. Please try again.'));
      }, 180000);

      // Send purchase request to native app
      window.webkit.messageHandlers.iap.postMessage({
        action: 'purchase',
        productId: productId,
        userEmail: userEmail,
        messageId: messageId
      });
    });
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