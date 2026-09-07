import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildPennSyncHelpUrl,
  CENTRAL_HELP_ENABLED,
  PENNSYNC_HELP_APP_VERSION,
  PENNSYNC_HELP_ENVIRONMENT,
} from '@/lib/centralHelp';

/**
 * Feature-gated link to CareMetric's first-party Support Hub. Callers supply a
 * static route allowlist; failure renders nothing and leaves their local-help
 * UI untouched.
 */
export default function CentralHelpButton({
  pathname,
  knownRoutes,
  enabled = CENTRAL_HELP_ENABLED,
  appVersion = PENNSYNC_HELP_APP_VERSION,
  environment = PENNSYNC_HELP_ENVIRONMENT,
}) {
  const href = useMemo(() => {
    if (!enabled) return null;
    try {
      return buildPennSyncHelpUrl({ pathname, knownRoutes, appVersion, environment });
    } catch {
      return null;
    }
  }, [appVersion, enabled, environment, knownRoutes, pathname]);

  if (!href) return null;

  return (
    <Button asChild className="bg-navy-700 hover:bg-navy-800 text-white font-semibold shadow-lg min-h-[48px] px-6">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="w-5 h-5 mr-2" />
        Open CareMetric Help Center
      </a>
    </Button>
  );
}
