export const isApplePlatform = () => {
  // Check if running in iOS native app via webkit message handlers
  if (typeof window !== 'undefined' && window.webkit?.messageHandlers?.storeKit) {
    return true;
  }
  
  // Fallback: check user agent for iOS
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
};

export const isNativePlatform = () => {
  return typeof window !== 'undefined' && window.webkit?.messageHandlers?.storeKit;
};