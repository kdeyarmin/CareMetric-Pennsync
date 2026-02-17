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
import DocumentLibrary from './pages/DocumentLibrary';
import Documentation from './pages/Documentation';
import EULA from './pages/EULA';
import EnterpriseAnalytics from './pages/EnterpriseAnalytics';
import FAQ from './pages/FAQ';
import FaxAnalytics from './pages/FaxAnalytics';
import FaxQueue from './pages/FaxQueue';
import MedicalScribe from './pages/MedicalScribe';
import MySubscription from './pages/MySubscription';
import OASIS from './pages/OASIS';
import PHIVault from './pages/PHIVault';
import PatientAlerts from './pages/PatientAlerts';
import PatientDetails from './pages/PatientDetails';
import Patients from './pages/Patients';
import PaymentSuccess from './pages/PaymentSuccess';
import PrivacyPolicy from './pages/PrivacyPolicy';
import SecureMessaging from './pages/SecureMessaging';
import SendFax from './pages/SendFax';
import Settings from './pages/Settings';
import SmartNoteAssistant from './pages/SmartNoteAssistant';
import SubscriptionPlans from './pages/SubscriptionPlans';
import Support from './pages/Support';
import Tasks from './pages/Tasks';
import TermsOfUse from './pages/TermsOfUse';
import TrainingHub from './pages/TrainingHub';
import UserManagement from './pages/UserManagement';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "AgencyDashboard": AgencyDashboard,
    "AnalyticsDashboard": AnalyticsDashboard,
    "CarePlanManagement": CarePlanManagement,
    "ComplianceDashboard": ComplianceDashboard,
    "Dashboard": Dashboard,
    "DeleteAccount": DeleteAccount,
    "DocumentLibrary": DocumentLibrary,
    "Documentation": Documentation,
    "EULA": EULA,
    "EnterpriseAnalytics": EnterpriseAnalytics,
    "FAQ": FAQ,
    "FaxAnalytics": FaxAnalytics,
    "FaxQueue": FaxQueue,
    "MedicalScribe": MedicalScribe,
    "MySubscription": MySubscription,
    "OASIS": OASIS,
    "PHIVault": PHIVault,
    "PatientAlerts": PatientAlerts,
    "PatientDetails": PatientDetails,
    "Patients": Patients,
    "PaymentSuccess": PaymentSuccess,
    "PrivacyPolicy": PrivacyPolicy,
    "SecureMessaging": SecureMessaging,
    "SendFax": SendFax,
    "Settings": Settings,
    "SmartNoteAssistant": SmartNoteAssistant,
    "SubscriptionPlans": SubscriptionPlans,
    "Support": Support,
    "Tasks": Tasks,
    "TermsOfUse": TermsOfUse,
    "TrainingHub": TrainingHub,
    "UserManagement": UserManagement,
}

export const pagesConfig = {
    mainPage: "AdminDashboard",
    Pages: PAGES,
    Layout: __Layout,
};