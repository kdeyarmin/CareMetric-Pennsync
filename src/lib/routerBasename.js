const normalizeBasePath = (value) => {
  if (!value || value === '/' || value === '.' || value === './') return undefined;
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, '') || undefined;
};

export const getRouterBasename = ({ pathname = window.location.pathname, baseUrl = import.meta.env.BASE_URL, routerPaths = [] } = {}) => {
  const configuredBase = normalizeBasePath(baseUrl);
  if (configuredBase) return configuredBase;

  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const trimmedPathname = normalizedPathname.replace(/\/+$/, '') || '/';
  const lowerPathname = trimmedPathname.toLowerCase();
  const routeSuffixes = routerPaths
    .map((path) => path.toLowerCase())
    .sort((a, b) => b.length - a.length);

  for (const routePath of routeSuffixes) {
    if (routePath === '/') {
      if (lowerPathname === '/') return undefined;
      if (normalizedPathname.endsWith('/')) return normalizeBasePath(trimmedPathname);
      continue;
    }
    if (lowerPathname === routePath) return undefined;
    if (lowerPathname.endsWith(routePath)) {
      return normalizeBasePath(trimmedPathname.slice(0, -routePath.length));
    }
  }

  // Nothing matched a known route: the whole path is a mount root opened
  // without a trailing slash (e.g. `/apps/pennsync`). Without a basename the
  // router would treat the full mount path as an app route and nothing would
  // match, so infer the mount root from the path itself. Only do this when the
  // caller supplied a route table — with no routes to rule out we have no
  // signal, and callers like hostedAssetPath rely on `undefined` meaning root.
  if (routeSuffixes.length > 0 && trimmedPathname !== '/') {
    return normalizeBasePath(trimmedPathname);
  }

  return undefined;
};
