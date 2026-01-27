export const isApplePlatform = () => {
  if (typeof window === 'undefined') return false;
  
  // Check if running in iOS native app via webkit message handlers
  if (window.webkit?.messageHandlers?.storeKit) {
    return true;
  }
  
  // Check user agent for iOS/iPadOS
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(userAgent);
  
  // Also check for iPad on iOS 13+ which reports as Mac
  const isTouchDevice = 'ontouchend' in document;
  const isMacLike = /macintosh/.test(userAgent);
  const isIPadOS = isMacLike && isTouchDevice;
  
  return isIOS || isIPadOS;
};

export const isAndroidPlatform = () => {
  if (typeof window === 'undefined') return false;
  const userAgent = window.navigator.userAgent.toLowerCase();
  return /android/.test(userAgent);
};

export const isDesktopPlatform = () => {
  return !isApplePlatform() && !isAndroidPlatform();
};

export const isNativePlatform = () => {
  return typeof window !== 'undefined' && window.webkit?.messageHandlers?.storeKit;
};