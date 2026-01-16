/**
 * Performance optimization utilities
 */

/**
 * Lazy load a component
 */
export const lazyLoadComponent = (importFunc) => {
  return React.lazy(() => 
    importFunc().then(module => ({ default: module.default }))
  );
};

/**
 * Optimize query configuration for performance
 */
export const getOptimizedQueryConfig = (queryType) => {
  const configs = {
    // Static data that rarely changes
    staticData: {
      staleTime: 1000 * 60 * 60, // 1 hour
      cacheTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: 1
    },
    // User-specific data that changes occasionally
    userData: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
      retry: 2
    },
    // Real-time data that changes frequently
    realtimeData: {
      staleTime: 0, // Always fresh
      cacheTime: 1000 * 60, // 1 minute
      retry: 3,
      refetchInterval: 1000 * 30 // Refetch every 30 seconds
    },
    // List data with pagination
    listData: {
      staleTime: 1000 * 60, // 1 minute
      cacheTime: 1000 * 60 * 10, // 10 minutes
      retry: 2
    }
  };

  return configs[queryType] || configs.userData;
};

/**
 * Debounce function for search and filter operations
 */
export const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

/**
 * Throttle function for scroll and resize events
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return (...args) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
};

/**
 * Virtualization helper - get visible items for large lists
 */
export const getVisibleItems = (items, scrollPosition, itemHeight, containerHeight) => {
  if (!items || items.length === 0) return [];

  const startIndex = Math.max(0, Math.floor(scrollPosition / itemHeight) - 5); // Buffer of 5 items
  const endIndex = Math.min(items.length, Math.ceil((scrollPosition + containerHeight) / itemHeight) + 5);

  return {
    visibleItems: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    offsetY: startIndex * itemHeight
  };
};

/**
 * Optimize images for responsive loading
 */
export const getResponsiveImageSrc = (baseUrl, width) => {
  // Add width parameter for server-side image optimization
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}w=${width}`;
};

/**
 * Cache with expiration
 */
export const createCache = () => {
  const cache = new Map();

  return {
    get: (key) => {
      const item = cache.get(key);
      if (!item) return null;

      if (item.expiry && Date.now() > item.expiry) {
        cache.delete(key);
        return null;
      }

      return item.value;
    },
    set: (key, value, ttl = null) => {
      cache.set(key, {
        value,
        expiry: ttl ? Date.now() + ttl : null
      });
    },
    clear: () => cache.clear(),
    size: () => cache.size
  };
};

/**
 * Batch operations to reduce renders
 */
export const batchUpdates = (updates) => {
  return Promise.all(updates.map(update => update()));
};