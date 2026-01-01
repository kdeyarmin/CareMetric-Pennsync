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
    // Check if Capacitor IAP plugin is available
    const checkIAP = async () => {
      const hasCapacitor = window.Capacitor;
      const hasIAPPlugin = window.Capacitor?.Plugins?.IAPPlugin;
      
      console.log('=== Capacitor IAP Check ===');
      console.log('Capacitor exists:', !!hasCapacitor);
      console.log('IAPPlugin exists:', !!hasIAPPlugin);
      console.log('Available plugins:', window.Capacitor?.Plugins ? Object.keys(window.Capacitor.Plugins) : 'none');
      console.log('=========================');
      
      setIsReady(!!hasIAPPlugin);
    };
    
    checkIAP();
    
    // Re-check after delays in case Capacitor loads asynchronously
    const timer1 = setTimeout(checkIAP, 500);
    const timer2 = setTimeout(checkIAP, 1000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  const purchaseSubscription = async (productId, userEmail) => {
    setIsProcessing(true);
    
    console.log('=== Capacitor IAP Purchase ===');
    console.log('Product ID:', productId);
    console.log('User Email:', userEmail);
    
    if (!window.Capacitor?.Plugins?.IAPPlugin) {
      setIsProcessing(false);
      throw new Error('IAP Plugin not available. Please use the native iOS app.');
    }
    
    try {
      const result = await window.Capacitor.Plugins.IAPPlugin.purchase({ productId });
      setIsProcessing(false);
      console.log('Purchase result:', result);
      return result;
    } catch (error) {
      setIsProcessing(false);
      console.error('Purchase error:', error);
      throw error;
    }
  };

  const restorePurchases = async () => {
    if (!window.Capacitor?.Plugins?.IAPPlugin) {
      throw new Error('IAP Plugin not available');
    }

    try {
      const result = await window.Capacitor.Plugins.IAPPlugin.restore();
      return result;
    } catch (error) {
      throw error;
    }
  };

  const getProductInfo = async (productId) => {
    if (!window.Capacitor?.Plugins?.IAPPlugin) {
      return null;
    }

    try {
      const result = await window.Capacitor.Plugins.IAPPlugin.getProductInfo({ productId });
      return result;
    } catch (error) {
      return null;
    }
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