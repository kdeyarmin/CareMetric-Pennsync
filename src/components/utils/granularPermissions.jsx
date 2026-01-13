/**
 * Granular permission checking system for provider access control
 */

import { base44 } from '@/api/base44Client';
import { hasFeatureAccess, hasPageAccess, hasWidgetAccess } from './providerAccessControl';

/**
 * Get all permissions for a provider (role defaults + custom overrides)
 */
export const getProviderPermissions = async (providerEmail, providerType) => {
  try {
    const customPerms = await base44.entities.ProviderPermission.filter({
      provider_email: providerEmail
    });
    
    return {
      roleDefaults: providerType,
      customPermissions: customPerms
    };
  } catch (error) {
    console.error('Error fetching provider permissions:', error);
    return { roleDefaults: providerType, customPermissions: [] };
  }
};

/**
 * Check if provider has permission (considers custom overrides)
 */
export const hasPermission = (providerEmail, providerType, category, permissionName, customPerms = []) => {
  // Check for custom override
  const customPerm = customPerms.find(p => 
    p.provider_email === providerEmail && 
    p.permission_category === category &&
    p.permission_name === permissionName
  );

  if (customPerm && customPerm.custom_override) {
    // Check expiration
    if (customPerm.expiration_date && new Date(customPerm.expiration_date) < new Date()) {
      return null; // Permission expired, fall back to role default
    }
    return customPerm.is_allowed;
  }

  // Fall back to role-based defaults
  switch (category) {
    case 'feature':
      return hasFeatureAccess(providerType, permissionName);
    case 'page_access':
      return hasPageAccess(providerType, permissionName);
    case 'dashboard_widget':
      return hasWidgetAccess(providerType, permissionName);
    default:
      return false;
  }
};

/**
 * Get assigned patients for a provider
 */
export const getProviderPatients = async (providerEmail) => {
  try {
    const assignments = await base44.entities.ProviderPatientAssignment.filter({
      provider_email: providerEmail,
      is_active: true
    });
    
    return assignments;
  } catch (error) {
    console.error('Error fetching patient assignments:', error);
    return [];
  }
};

/**
 * Check if provider can access a specific patient
 */
export const canAccessPatient = (patientId, assignments, accessLevel = 'full') => {
  const assignment = assignments.find(a => a.patient_id === patientId);
  
  if (!assignment) return false;
  if (!assignment.is_active) return false;
  
  return assignment.access_level !== 'summary_only';
};

/**
 * Get accessible patient data fields for a provider
 */
export const getAccessiblePatientFields = (assignments, patientId, providerType) => {
  const assignment = assignments.find(a => a.patient_id === patientId);
  
  if (!assignment) return [];
  
  // Default fields based on role
  const defaultFields = getDefaultPatientFields(providerType);
  
  if (assignment.accessible_fields?.length > 0) {
    // Use custom accessible fields
    return assignment.accessible_fields;
  }
  
  if (assignment.restricted_fields?.length > 0) {
    // Remove restricted fields
    return defaultFields.filter(f => !assignment.restricted_fields.includes(f));
  }
  
  return defaultFields;
};

/**
 * Get default accessible patient fields by provider type
 */
export const getDefaultPatientFields = (providerType) => {
  const allFields = [
    'first_name', 'last_name', 'date_of_birth', 'medical_record_number',
    'primary_diagnosis', 'secondary_diagnoses', 'allergies',
    'current_medications', 'baseline_vitals', 'functional_status',
    'social_history', 'insurance_info', 'goals_of_care'
  ];
  
  const restrictions = {
    LPN: ['insurance_primary', 'insurance_secondary', 'physician_email'],
    PT: ['allergies', 'current_medications', 'psychiatric_history'],
    OT: ['allergies', 'current_medications', 'psychiatric_history'],
    ST: ['allergies', 'current_medications', 'psychiatric_history'],
    MSW: ['baseline_vitals', 'current_medications'],
    Chiropractor: ['mental_health', 'psychiatric_history']
  };
  
  const restricted = restrictions[providerType] || [];
  return allFields.filter(f => !restricted.includes(f));
};

/**
 * Get provider's assigned facilities
 */
export const getProviderFacilities = async (providerEmail) => {
  try {
    const assignments = await base44.entities.ProviderFacilityAssignment.filter({
      provider_email: providerEmail,
      is_active: true
    });
    
    return assignments;
  } catch (error) {
    console.error('Error fetching facility assignments:', error);
    return [];
  }
};

/**
 * Check if provider is active at a facility
 */
export const isActiveAtFacility = (facilityId, facilityAssignments) => {
  return facilityAssignments.some(a => a.facility_id === facilityId && a.is_active);
};

/**
 * Get provider's dashboard customization
 */
export const getProviderDashboardConfig = async (providerEmail) => {
  try {
    const configs = await base44.entities.ProviderDashboardCustomization.filter({
      provider_email: providerEmail
    });
    
    return configs[0] || null;
  } catch (error) {
    console.error('Error fetching dashboard config:', error);
    return null;
  }
};

/**
 * Filter patient list based on provider's assignments
 */
export const filterPatientsByProviderAccess = (patients, assignments) => {
  const assignedPatientIds = assignments
    .filter(a => a.is_active)
    .map(a => a.patient_id);
  
  return patients.filter(p => assignedPatientIds.includes(p.id));
};

/**
 * Check if provider has data access at a facility level
 */
export const canAccessFacilityData = (facilityId, facilityAssignments, accessType = 'view') => {
  const assignment = facilityAssignments.find(a => a.facility_id === facilityId && a.is_active);
  
  if (!assignment) return false;
  
  return true;
};

/**
 * Get supervision scope for a provider at a facility
 */
export const getSupervisionScope = (facilityId, facilityAssignments) => {
  const assignment = facilityAssignments.find(a => a.facility_id === facilityId);
  
  if (!assignment?.supervision_permissions?.can_supervise) {
    return null;
  }
  
  return {
    canSupervise: true,
    supervisesRoles: assignment.supervision_permissions.supervises_roles,
    numSupervisedStaff: assignment.supervision_permissions.num_supervised_staff
  };
};