/**
 * React hook for managing provider permissions and access control
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  getProviderPermissions,
  getProviderPatients,
  getProviderFacilities,
  getProviderDashboardConfig,
  hasPermission,
  canAccessPatient,
  getAccessiblePatientFields
} from './granularPermissions';

/**
 * Hook to get provider's complete permission set
 */
export const useProviderPermissions = (providerEmail, providerType) => {
  const { data: permissions, isLoading: permissionsLoading, error: permissionsError } = useQuery({
    queryKey: ['providerPermissions', providerEmail],
    queryFn: () => getProviderPermissions(providerEmail, providerType),
    enabled: !!providerEmail
  });

  const checkPermission = (category, permissionName) => {
    if (!permissions) return false;
    return hasPermission(
      providerEmail,
      providerType,
      category,
      permissionName,
      permissions.customPermissions
    );
  };

  return {
    permissions,
    isLoading: permissionsLoading,
    error: permissionsError,
    checkPermission,
    canAccessFeature: (featureName) => checkPermission('feature', featureName),
    canAccessPage: (pageName) => checkPermission('page_access', pageName),
    canAccessWidget: (widgetName) => checkPermission('dashboard_widget', widgetName)
  };
};

/**
 * Hook to get provider's patient assignments
 */
export const useProviderPatientAssignments = (providerEmail) => {
  const { data: assignments = [], isLoading, error } = useQuery({
    queryKey: ['patientAssignments', providerEmail],
    queryFn: () => getProviderPatients(providerEmail),
    enabled: !!providerEmail
  });

  return {
    assignments,
    isLoading,
    error,
    canAccessPatient: (patientId) => canAccessPatient(patientId, assignments),
    getAccessibleFields: (patientId, providerType) => 
      getAccessiblePatientFields(assignments, patientId, providerType)
  };
};

/**
 * Hook to get provider's facility assignments
 */
export const useProviderFacilityAssignments = (providerEmail) => {
  const { data: facilities = [], isLoading, error } = useQuery({
    queryKey: ['facilityAssignments', providerEmail],
    queryFn: () => getProviderFacilities(providerEmail),
    enabled: !!providerEmail
  });

  return {
    facilities,
    isLoading,
    error,
    isActiveAtFacility: (facilityId) => 
      facilities.some(f => f.facility_id === facilityId && f.is_active),
    getPrimaryFacility: () => 
      facilities.find(f => f.is_primary_facility)
  };
};

/**
 * Hook to get provider's dashboard customization
 */
export const useProviderDashboardConfig = (providerEmail) => {
  const { data: config, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboardConfig', providerEmail],
    queryFn: () => getProviderDashboardConfig(providerEmail),
    enabled: !!providerEmail
  });

  const updateConfig = async (updates) => {
    try {
      if (config?.id) {
        await base44.entities.ProviderDashboardCustomization.update(config.id, updates);
      } else {
        await base44.entities.ProviderDashboardCustomization.create({
          provider_email: providerEmail,
          ...updates
        });
      }
      refetch();
    } catch (error) {
      console.error('Error updating dashboard config:', error);
      throw error;
    }
  };

  return {
    config,
    isLoading,
    error,
    updateConfig,
    getWidgetVisibility: (widgetName) => 
      config?.widget_visibility?.[widgetName] !== false,
    getWidgetPreference: (widgetName, preference) =>
      config?.widget_preferences?.[widgetName]?.[preference]
  };
};

/**
 * Combined hook for all provider access control
 */
export const useProviderAccessControl = (providerEmail, providerType) => {
  const permissions = useProviderPermissions(providerEmail, providerType);
  const patientAssignments = useProviderPatientAssignments(providerEmail);
  const facilityAssignments = useProviderFacilityAssignments(providerEmail);
  const dashboardConfig = useProviderDashboardConfig(providerEmail);

  const isLoading = 
    permissions.isLoading || 
    patientAssignments.isLoading || 
    facilityAssignments.isLoading || 
    dashboardConfig.isLoading;

  return {
    permissions,
    patientAssignments,
    facilityAssignments,
    dashboardConfig,
    isLoading,
    allErrors: [
      permissions.error,
      patientAssignments.error,
      facilityAssignments.error,
      dashboardConfig.error
    ].filter(Boolean)
  };
};