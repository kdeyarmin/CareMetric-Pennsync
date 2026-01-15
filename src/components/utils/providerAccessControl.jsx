/**
 * Provider-based access control for features, functions, and dashboard items
 */

import { PROVIDER_VISIT_TYPES } from '@/components/utils/providerVisitTypeMapping';

/**
 * Define which dashboard widgets are available per provider type
 */
export const PROVIDER_DASHBOARD_ACCESS = {
  RN: {
    label: 'Registered Nurse',
    dashboardWidgets: [
      'smartNotes',
      'complianceScore',
      'patientAlerts',
      'recentVisits',
      'carePlans',
      'tasks',
      'incidents',
      'oasis',
      'pdgm',
      'compliance',
      'riskAlerts',
      'clinicalSupport',
      'trainingRecommendations',
      'telehealth'
    ],
    features: {
      smartNotes: true,
      medicalScribe: true,
      telehealth: true,
      scheduling: true,
      carePlanManagement: true,
      incidentReporting: true,
      oasisAccess: true,
      pdgmAnalytics: true,
      complianceChecking: true,
      patientEducation: true,
      taskManagement: true
    }
  },

  LPN: {
    label: 'Licensed Practical Nurse',
    dashboardWidgets: [
      'smartNotes',
      'recentVisits',
      'tasks',
      'incidents',
      'compliance'
    ],
    features: {
      smartNotes: true,
      medicalScribe: true,
      telehealth: true,
      scheduling: false,
      carePlanManagement: false,
      incidentReporting: true,
      oasisAccess: false,
      pdgmAnalytics: false,
      complianceChecking: true,
      patientEducation: false,
      taskManagement: true
    }
  },

  NP: {
    label: 'Nurse Practitioner',
    dashboardWidgets: [
      'smartNotes',
      'complianceScore',
      'patientAlerts',
      'recentVisits',
      'carePlans',
      'tasks',
      'incidents',
      'compliance',
      'riskAlerts',
      'clinicalSupport',
      'telehealth',
      'medicationManagement'
    ],
    features: {
      smartNotes: true,
      medicalScribe: true,
      telehealth: true,
      scheduling: true,
      carePlanManagement: true,
      incidentReporting: true,
      oasisAccess: false,
      pdgmAnalytics: false,
      complianceChecking: true,
      patientEducation: true,
      taskManagement: true,
      prescribing: true
    }
  },

  Physician: {
    label: 'Physician (MD/DO)',
    dashboardWidgets: [
      'smartNotes',
      'patientAlerts',
      'recentVisits',
      'carePlans',
      'tasks',
      'incidents',
      'clinicalSupport',
      'telehealth',
      'medicationManagement'
    ],
    features: {
      smartNotes: true,
      medicalScribe: true,
      telehealth: true,
      scheduling: true,
      carePlanManagement: true,
      incidentReporting: true,
      oasisAccess: false,
      pdgmAnalytics: false,
      complianceChecking: false,
      patientEducation: true,
      taskManagement: true,
      prescribing: true
    }
  },

  Therapist: {
    label: 'Therapist (PT/OT/ST)',
    dashboardWidgets: [
      'smartNotes',
      'recentVisits',
      'carePlans',
      'tasks',
      'clinicalSupport',
      'telehealth'
    ],
    features: {
      smartNotes: true,
      medicalScribe: true,
      telehealth: true,
      scheduling: true,
      carePlanManagement: true,
      incidentReporting: false,
      oasisAccess: false,
      pdgmAnalytics: false,
      complianceChecking: false,
      patientEducation: true,
      taskManagement: true,
      prescribing: false
    }
  },

  MSW: {
    label: 'Clinical Social Worker',
    dashboardWidgets: [
      'smartNotes',
      'recentVisits',
      'carePlans',
      'tasks',
      'telehealth'
    ],
    features: {
      smartNotes: true,
      medicalScribe: false,
      telehealth: true,
      scheduling: false,
      carePlanManagement: true,
      incidentReporting: false,
      oasisAccess: false,
      pdgmAnalytics: false,
      complianceChecking: false,
      patientEducation: true,
      taskManagement: true,
      prescribing: false
    }
  },

  Chiropractor: {
    label: 'Chiropractor',
    dashboardWidgets: [
      'smartNotes',
      'recentVisits',
      'carePlans',
      'tasks',
      'telehealth'
    ],
    features: {
      smartNotes: true,
      medicalScribe: true,
      telehealth: true,
      scheduling: true,
      carePlanManagement: true,
      incidentReporting: false,
      oasisAccess: false,
      pdgmAnalytics: false,
      complianceChecking: false,
      patientEducation: true,
      taskManagement: true,
      prescribing: false
    }
  }
};

/**
 * Define pages/functions accessible per provider type
 */
export const PROVIDER_PAGE_ACCESS = {
  RN: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'MedicalScribe',
    'DocumentVisit',
    'MobileWorkflow',
    'CarePlanManagement',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'ProviderScheduling',
    'NurseAnalyticsDashboard',
    'ComplianceDashboard',
    'OASISAnalyzer',
    'PDGMPredictiveAnalytics',
    'StaffTrainingHub',
    'MyAILearning',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings',
    'OASIS',
    'Compliance'
  ],
  LPN: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'MedicalScribe',
    'DocumentVisit',
    'MobileWorkflow',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings',
    'OASIS',
    'Compliance'
  ],
  NP: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'MedicalScribe',
    'DocumentVisit',
    'MobileWorkflow',
    'CarePlanManagement',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'ProviderScheduling',
    'NurseAnalyticsDashboard',
    'ComplianceDashboard',
    'StaffTrainingHub',
    'MyAILearning',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings'
  ],
  Physician: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'MedicalScribe',
    'DocumentVisit',
    'MobileWorkflow',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'ProviderScheduling',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings'
  ],
  Therapist: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'MedicalScribe',
    'DocumentVisit',
    'MobileWorkflow',
    'CarePlanManagement',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'ProviderScheduling',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings',
    'OASIS',
    'Compliance'
  ],
  MSW: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'DocumentVisit',
    'MobileWorkflow',
    'CarePlanManagement',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings'
  ],
  Chiropractor: [
    'Dashboard',
    'Patients',
    'Tasks',
    'SmartNoteAssistant',
    'MedicalScribe',
    'DocumentVisit',
    'MobileWorkflow',
    'PatientAlerts',
    'PatientDetails',
    'TelehealthDashboard',
    'TelehealthVisit',
    'ProviderScheduling',
    'PersonalizedLearningPath',
    'ProviderTrainingHub',
    'Settings',
    'ProviderSettings'
  ]
};

/**
 * Get dashboard access configuration for a provider type
 */
export const getDashboardAccessForProvider = (providerType) => {
  return PROVIDER_DASHBOARD_ACCESS[providerType] || null;
};

/**
 * Check if provider has access to a specific dashboard widget
 */
export const hasWidgetAccess = (providerType, widgetName) => {
  const config = PROVIDER_DASHBOARD_ACCESS[providerType];
  return config?.dashboardWidgets?.includes(widgetName) || false;
};

/**
 * Check if provider has access to a specific feature
 */
export const hasFeatureAccess = (providerType, featureName) => {
  const config = PROVIDER_DASHBOARD_ACCESS[providerType];
  return config?.features?.[featureName] || false;
};

/**
 * Get accessible pages for a provider type
 */
export const getAccessiblePages = (providerType) => {
  return PROVIDER_PAGE_ACCESS[providerType] || [];
};

/**
 * Check if provider has access to a specific page
 */
export const hasPageAccess = (providerType, pageName) => {
  const pages = PROVIDER_PAGE_ACCESS[providerType];
  return pages?.includes(pageName) || false;
};

/**
 * Get visit types for a provider (from existing mapping)
 */
export const getVisitTypesForProvider = (providerType) => {
  return PROVIDER_VISIT_TYPES[providerType]?.visitTypes || [];
};

/**
 * Filter visit types available to a provider
 */
export const filterVisitTypesForProvider = (providerType, allVisitTypes) => {
  const allowedVisitTypeIds = getVisitTypesForProvider(providerType).map(vt => vt.id);
  return allVisitTypes.filter(vt => allowedVisitTypeIds.includes(vt));
};

/**
 * Get accessible widgets for a provider type (maps to feature names)
 */
export const getAccessibleWidgets = (providerType) => {
  const config = PROVIDER_DASHBOARD_ACCESS[providerType];
  return config?.dashboardWidgets || [];
};