/**
 * Platform detection utilities for handling different payment systems
 */

export const isIOS = () => {
  if (typeof window === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const isMacOS = () => {
  if (typeof window === 'undefined') return false;
  return navigator.platform.indexOf('Mac') > -1 && navigator.maxTouchPoints === 0;
};

export const isApplePlatform = () => {
  return isIOS() || isMacOS();
};

export const isAndroid = () => {
  if (typeof window === 'undefined') return false;
  return /Android/.test(navigator.userAgent);
};

export const isWeb = () => {
  return !isIOS() && !isMacOS() && !isAndroid();
};

export const getPlatformName = () => {
  if (isIOS()) return 'iOS';
  if (isMacOS()) return 'macOS';
  if (isAndroid()) return 'Android';
  return 'Web';
};