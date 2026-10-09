import { secrets } from 'base44:runtime';

export function isPlatformOwner(user) {
  const configured = String(secrets.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase();
  return !!configured && user?.role === 'admin'
    && String(user.email || '').trim().toLowerCase() === configured
    && user.is_active !== false && user.disabled !== true && user.is_service !== true;
}

export async function requireClinicalWorkspace(base44) {
  const response = await base44.functions.invoke('getMyTenantContext', {});
  const context = response?.data?.tenant_context;
  if (!context?.agency_id || !['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care', 'platform_owner'].includes(context.tenant_role)) {
    throw new Error('Active clinical workspace required');
  }
  return context;
}