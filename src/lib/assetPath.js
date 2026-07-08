import { getRouterBasename } from '@/lib/routerBasename';

export const hostedAssetPath = (assetPath, options = {}) => {
  const cleanAssetPath = String(assetPath || '').replace(/^\/+/, '');
  const basePath = getRouterBasename(options);
  return `${basePath || ''}/${cleanAssetPath}`;
};

export const hostedAbsoluteUrl = (assetPath, options = {}) => {
  const origin = options.origin || window.location.origin;
  return new URL(hostedAssetPath(assetPath, options), origin).toString();
};
