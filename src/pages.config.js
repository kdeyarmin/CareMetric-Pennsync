/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AdminDashboard from './pages/AdminDashboard';
import AgencyDashboard from './pages/AgencyDashboard';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import CarePlanManagement from './pages/CarePlanManagement';
import ComplianceDashboard from './pages/ComplianceDashboard';
import Dashboard from './pages/Dashboard';
import DeleteAccount from './pages/DeleteAccount';
import EULA from './pages/EULA';
import FAQ from './pages/FAQ';
import MedicalScribe from './pages/MedicalScribe';
import MyAILearning from './pages/MyAILearning';
import MySubscription from './pages/MySubscription';
import MyTraining from './pages/MyTraining';
import NurseAnalyticsDashboard from './pages/NurseAnalyticsDashboard';
import NurseEducationVideos from './pages/NurseEducationVideos';
import NursePerformanceDashboard from './pages/NursePerformanceDashboard';
import NurseTraining from './pages/NurseTraining';
import NurseTrainingHub from './pages/NurseTrainingHub';
import OASIS from './pages/OASIS';
import OASISAnalyticsDashboard from './pages/OASISAnalyticsDashboard';
import OASISAnalyzer from './pages/OASISAnalyzer';
import OASISAuditDashboard from './pages/OASISAuditDashboard';
import OASISClinicalReview from './pages/OASISClinicalReview';
import OASISComplianceReview from './pages/OASISComplianceReview';
import OASISDocumentationReview from './pages/OASISDocumentationReview';
import OASISRevenueAnalysis from './pages/OASISRevenueAnalysis';
import OASISReview from './pages/OASISReview';
import OfflineMode from './pages/OfflineMode';
import PatientAlerts from './pages/PatientAlerts';
import PatientDashboard from './pages/PatientDashboard';
import PatientDataManagement from './pages/PatientDataManagement';
import PatientDetails from './pages/PatientDetails';
import PatientEducation from './pages/PatientEducation';
import PatientEducationAnalytics from './pages/PatientEducationAnalytics';
import PatientEducationGenerator from './pages/PatientEducationGenerator';
import PatientEducationHub from './pages/PatientEducationHub';
import PatientEducationLibrary from './pages/PatientEducationLibrary';
import PatientMessaging from './pages/PatientMessaging';
import PatientRecordDashboard from './pages/PatientRecordDashboard';
import Patients from './pages/Patients';
import PaymentSuccess from './pages/PaymentSuccess';
import PersonalizedLearningPath from './pages/PersonalizedLearningPath';
import PredictiveAnalytics from './pages/PredictiveAnalytics';
import Pricing from './pages/Pricing';
import PrivacyPolicy from './pages/PrivacyPolicy';
import ProviderSettings from './pages/ProviderSettings';
import ProviderTrainingHub from './pages/ProviderTrainingHub';
import RealTimeComplianceDashboard from './pages/RealTimeComplianceDashboard';
import RegulatoryCompliance from './pages/RegulatoryCompliance';
import RegulatoryUpdates from './pages/RegulatoryUpdates';
import SecurityAudit from './pages/SecurityAudit';
import SecurityAuditReport from './pages/SecurityAuditReport';
import SecurityCompliance from './pages/SecurityCompliance';
import SecurityPolicy from './pages/SecurityPolicy';
import Settings from './pages/Settings';
import SmartNoteAssistant from './pages/SmartNoteAssistant';
import StaffTraining from './pages/StaffTraining';
import StaffTrainingHub from './pages/StaffTrainingHub';
import StaffTrainingModule from './pages/StaffTrainingModule';
import SubscriptionPlans from './pages/SubscriptionPlans';
import Support from './pages/Support';
import SystemHealthMonitoring from './pages/SystemHealthMonitoring';
import SystemJobMonitor from './pages/SystemJobMonitor';
import Tasks from './pages/Tasks';
import TemplateLibrary from './pages/TemplateLibrary';
import TermsOfUse from './pages/TermsOfUse';
import Test2FA from './pages/Test2FA';
import TestCrossPlatform from './pages/TestCrossPlatform';
import TrainingHub from './pages/TrainingHub';
import UserActivityLog from './pages/UserActivityLog';
import UserActivityReport from './pages/UserActivityReport';
import UserManagement from './pages/UserManagement';
import WorkflowAutomation from './pages/WorkflowAutomation';
import Documentation from './pages/Documentation';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "AgencyDashboard": AgencyDashboard,
    "AnalyticsDashboard": AnalyticsDashboard,
    "CarePlanManagement": CarePlanManagement,
    "ComplianceDashboard": ComplianceDashboard,
    "Dashboard": Dashboard,
    "DeleteAccount": DeleteAccount,
    "EULA": EULA,
    "FAQ": FAQ,
    "MedicalScribe": MedicalScribe,
    "MyAILearning": MyAILearning,
    "MySubscription": MySubscription,
    "MyTraining": MyTraining,
    "NurseAnalyticsDashboard": NurseAnalyticsDashboard,
    "NurseEducationVideos": NurseEducationVideos,
    "NursePerformanceDashboard": NursePerformanceDashboard,
    "NurseTraining": NurseTraining,
    "NurseTrainingHub": NurseTrainingHub,
    "OASIS": OASIS,
    "OASISAnalyticsDashboard": OASISAnalyticsDashboard,
    "OASISAnalyzer": OASISAnalyzer,
    "OASISAuditDashboard": OASISAuditDashboard,
    "OASISClinicalReview": OASISClinicalReview,
    "OASISComplianceReview": OASISComplianceReview,
    "OASISDocumentationReview": OASISDocumentationReview,
    "OASISRevenueAnalysis": OASISRevenueAnalysis,
    "OASISReview": OASISReview,
    "OfflineMode": OfflineMode,
    "PatientAlerts": PatientAlerts,
    "PatientDashboard": PatientDashboard,
    "PatientDataManagement": PatientDataManagement,
    "PatientDetails": PatientDetails,
    "PatientEducation": PatientEducation,
    "PatientEducationAnalytics": PatientEducationAnalytics,
    "PatientEducationGenerator": PatientEducationGenerator,
    "PatientEducationHub": PatientEducationHub,
    "PatientEducationLibrary": PatientEducationLibrary,
    "PatientMessaging": PatientMessaging,
    "PatientRecordDashboard": PatientRecordDashboard,
    "Patients": Patients,
    "PaymentSuccess": PaymentSuccess,
    "PersonalizedLearningPath": PersonalizedLearningPath,
    "PredictiveAnalytics": PredictiveAnalytics,
    "Pricing": Pricing,
    "PrivacyPolicy": PrivacyPolicy,
    "ProviderSettings": ProviderSettings,
    "ProviderTrainingHub": ProviderTrainingHub,
    "RealTimeComplianceDashboard": RealTimeComplianceDashboard,
    "RegulatoryCompliance": RegulatoryCompliance,
    "RegulatoryUpdates": RegulatoryUpdates,
    "SecurityAudit": SecurityAudit,
    "SecurityAuditReport": SecurityAuditReport,
    "SecurityCompliance": SecurityCompliance,
    "SecurityPolicy": SecurityPolicy,
    "Settings": Settings,
    "SmartNoteAssistant": SmartNoteAssistant,
    "StaffTraining": StaffTraining,
    "StaffTrainingHub": StaffTrainingHub,
    "StaffTrainingModule": StaffTrainingModule,
    "SubscriptionPlans": SubscriptionPlans,
    "Support": Support,
    "SystemHealthMonitoring": SystemHealthMonitoring,
    "SystemJobMonitor": SystemJobMonitor,
    "Tasks": Tasks,
    "TemplateLibrary": TemplateLibrary,
    "TermsOfUse": TermsOfUse,
    "Test2FA": Test2FA,
    "TestCrossPlatform": TestCrossPlatform,
    "TrainingHub": TrainingHub,
    "UserActivityLog": UserActivityLog,
    "UserActivityReport": UserActivityReport,
    "UserManagement": UserManagement,
    "WorkflowAutomation": WorkflowAutomation,
    "Documentation": Documentation,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};