import { Capacitor } from '@capacitor/core';

export const isApplePlatform = () => {
  const platform = Capacitor.getPlatform();
  return platform === 'ios';
};

export const isNativePlatform = () => {
  return Capacitor.isNativePlatform();
};