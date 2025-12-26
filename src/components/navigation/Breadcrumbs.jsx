import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ChevronRight, Home } from "lucide-react";

export default function Breadcrumbs({ currentPageName }) {
  // Map page names to display names
  const pageDisplayNames = {
    "Dashboard": "Dashboard",
    "Homepage": "Home",
    "Patients": "My Patients",
    "PatientDetails": "Patient Details",
    "SmartNoteAssistant": "Smart Notes",
    "CarePlanManagement": "Care Plans",
    "PatientAlerts": "Patient Alerts",
    "StaffTrainingHub": "Training Hub",
    "MedicareGuidelinesLibrary": "Guidelines Library",
    "MedicareComplianceDashboard": "Compliance Check",
    "Settings": "Settings",
    "AdminDashboard": "Admin Dashboard",
    "UserManagement": "User Management",
    "AuditTrail": "Audit Trail",
    "Features": "Features Guide",
    "About": "About CareMetric AI",
    "PatientEducationHub": "Patient Education",
    "OfflineMode": "Offline Mode",
    "Tasks": "Tasks"
  };

  const displayName = pageDisplayNames[currentPageName] || currentPageName;
  const isHomepage = currentPageName === "Homepage";

  if (isHomepage) {
    return null; // Don't show breadcrumbs on homepage
  }

  return (
    <nav className="flex items-center gap-2 text-sm text-gray-600 mb-4 print:hidden">
      <Link 
        to={createPageUrl("Dashboard")} 
        className="flex items-center gap-1 hover:text-blue-600 transition-colors"
      >
        <Home className="w-4 h-4" />
        <span>Home</span>
      </Link>
      <ChevronRight className="w-4 h-4 text-gray-400" />
      <span className="text-gray-900 font-medium">{displayName}</span>
    </nav>
  );
}