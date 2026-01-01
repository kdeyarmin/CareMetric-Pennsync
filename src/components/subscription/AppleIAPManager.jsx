import { useState } from 'react';
import { Capacitor } from '@capacitor/core';

export const APPLE_PRODUCTS = {
  monthly: 'com.caremetric.monthly',
  quarterly: 'com.caremetric.quarterly',
  semiannual: 'com.caremetric.semiannual',
  annual: 'com.caremetric.annual'
};

export const useAppleIAP = () => {
  const [isProcessing, setIsProcessing] = useState(false);

  const callNativePlugin = async (method, args = {}) => {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Not running on native platform');
    }

    // Direct StoreKit integration via webkit message handlers
    return new Promise((resolve, reject) => {
      const messageId = `iap_${Date.now()}_${Math.random()}`;
      
      const handleMessage = (event) => {
        if (event.data?.messageId === messageId) {
          window.removeEventListener('message', handleMessage);
          if (event.data.success) {
            resolve(event.data.result);
          } else {
            reject(new Error(event.data.error || 'IAP failed'));
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Send to native via webkit
      if (window.webkit?.messageHandlers?.storeKit) {
        window.webkit.messageHandlers.storeKit.postMessage({
          messageId,
          method,
          ...args
        });
      } else {
        window.removeEventListener('message', handleMessage);
        reject(new Error('StoreKit bridge not available'));
      }

      // Timeout after 60 seconds
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        reject(new Error('IAP request timeout'));
      }, 60000);
    });
  };

  const purchaseSubscription = async (productId, userEmail) => {
    setIsProcessing(true);
    try {
      const result = await callNativePlugin('purchase', { productId, userEmail });
      setIsProcessing(false);
      return result;
    } catch (error) {
      setIsProcessing(false);
      throw error;
    }
  };

  const restorePurchases = async () => {
    setIsProcessing(true);
    try {
      const result = await callNativePlugin('restore', {});
      setIsProcessing(false);
      return result;
    } catch (error) {
      setIsProcessing(false);
      throw error;
    }
  };

  const getProductInfo = async (productId) => {
    return callNativePlugin('getProductInfo', { productId });
  };

  return {
    purchaseSubscription,
    restorePurchases,
    getProductInfo,
    isProcessing
  };
};