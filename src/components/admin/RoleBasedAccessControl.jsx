import React from 'react';
import { usePermissions } from '@/components/utils/usePermissions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export function ProtectedModule({ moduleName, children, fallback }) {
  const { hasModuleAccess } = usePermissions();

  if (!hasModuleAccess(moduleName)) {
    return fallback || (
      <Alert variant="destructive" className="m-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          You don't have access to this module. Please contact your administrator.
        </AlertDescription>
      </Alert>
    );
  }

  return children;
}

export function ProtectedFeature({ permission, children, fallback }) {
  const { hasPermission } = usePermissions();

  if (!hasPermission(permission)) {
    return fallback || null;
  }

  return children;
}

export function RequirePermission({ permission, children }) {
  const { hasPermission } = usePermissions();
  return hasPermission(permission) ? children : null;
}