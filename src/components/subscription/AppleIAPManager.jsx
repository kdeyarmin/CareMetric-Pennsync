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
    const checkIAP = () => {
      const Capacitor = window.Capacitor;
      const hasCapacitor = !!Capacitor;
      const isNative = Capacitor?.isNativePlatform?.();
      
      console.log('=== Capacitor IAP Check ===');
      console.log('Capacitor exists:', hasCapacitor);
      console.log('Is native platform:', isNative);
      console.log('Platform:', Capacitor?.getPlatform?.());
      
      // Check if plugin is registered
      if (isNative && Capacitor?.Plugins) {
        console.log('Available plugins:', Object.keys(Capacitor.Plugins));
        console.log('IAPPlugin exists:', !!Capacitor.Plugins.IAPPlugin);
        setIsReady(!!Capacitor.Plugins.IAPPlugin);
      } else {
        console.log('Not on native platform or no plugins available');
        setIsReady(false);
      }
      console.log('=========================');
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
    
    console.log('=== StoreKit Purchase ===');
    console.log('Product ID:', productId);
    console.log('User Email:', userEmail);
    
    const Capacitor = window.Capacitor;
    
    if (!Capacitor?.isNativePlatform?.() || !Capacitor?.Plugins?.IAPPlugin) {
      setIsProcessing(false);
      throw new Error('IAP Plugin not available. Please use the native iOS app.');
    }
    
    try {
      const result = await Capacitor.Plugins.IAPPlugin.purchase({ productId });
      setIsProcessing(false);
      console.log('Purchase result:', result);
      
      if (result.success) {
        return {
          transactionId: result.transactionId,
          productId: result.productId,
          purchaseDate: result.purchaseDate,
          receiptData: result.receiptData
        };
      } else {
        throw new Error('Purchase failed');
      }
    } catch (error) {
      setIsProcessing(false);
      console.error('Purchase error:', error);
      throw error;
    }
  };

  const restorePurchases = async () => {
    const Capacitor = window.Capacitor;
    
    if (!Capacitor?.isNativePlatform?.() || !Capacitor?.Plugins?.IAPPlugin) {
      throw new Error('IAP Plugin not available');
    }

    try {
      const result = await Capacitor.Plugins.IAPPlugin.restore();
      if (result.success) {
        return {
          transactions: result.transactions || [],
          receiptData: result.receiptData
        };
      }
      throw new Error('Restore failed');
    } catch (error) {
      throw error;
    }
  };

  const getProductInfo = async (productId) => {
    const Capacitor = window.Capacitor;
    
    if (!Capacitor?.isNativePlatform?.() || !Capacitor?.Plugins?.IAPPlugin) {
      return null;
    }

    try {
      const result = await Capacitor.Plugins.IAPPlugin.getProductInfo({ productId });
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