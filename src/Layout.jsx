import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "./utils";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import MobileFieldToolbar from "@/components/mobile/MobileFieldToolbar";
import FaxNotificationBell from "@/components/fax/FaxNotificationBell";
import FavoritesBar from "@/components/navigation/FavoritesBar";
import {
  Home,
  Users,
  FileText,
  Calendar,
  CheckCircle,
  BarChart3,
  Settings,
  Menu,
  X,
  Activity,
  Target,
  Award,
  BookOpen,
  Bell,
  Shield,
  UserCog,
  Building2,
  Send,
  Clock,
  Lock,
  MessageSquare,
  DollarSign
} from "lucide-react";

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Map page names to their display labels
  const pageNameMap = {
    'Home': 'Dashboard',
    'Dashboard': 'Dashboard',
    'Patients': 'Patients',
    'Patient360View': 'Patient 360',
    'Tasks': 'Tasks',
    'SmartNoteAssistant': 'Smart Note',
    'MedicalScribe': 'Voice Scribe',
    'CarePlanManagement': 'Care Plans',
    'OASIS': 'OASIS',
    'SendFax': 'Send Fax',
    'FaxCenter': 'Fax Center',
    'TeamCollaboration': 'Team',
    'InternalMessaging': 'Team Messages',
    'FaxQueue': 'Fax Queue',
    'FaxAnalytics': 'Fax Analytics',
    'AIAnalyticsDashboard': 'AI Analytics',
    'DocumentLibrary': 'Doc Library',
    'SecureMessaging': 'Patient Messages',
    'PHIVault': 'PHI Vault',
    'ComplianceDashboard': 'Compliance',
    'ComplianceRulesEngine': 'Rules Engine',
    'AnalyticsDashboard': 'Analytics',
    'KPIDashboard': 'KPI Dashboard',
    'PDGMAnalytics': 'PDGM Analytics',
    'PatientAlerts': 'Alerts',
    'ReferralIntake': 'Referrals',
    'RegulatoryUpdates': 'Updates',
    'TrainingHub': 'Training',
    'Documentation': 'Help & Docs',
    'Settings': 'Settings',
    'EnterpriseAnalytics': 'Agency Analytics',
    'AdminDashboard': 'Admin Dashboard',
    'UserManagement': 'User Management',
    'AgencyDashboard': 'Agency Management',
    'ReportsCenter': 'Reports',
    'BillingManagement': 'Billing',
    'ClinicalPathways': 'Clinical Pathways'
  };

  // Determine current page name from URL path
  const getPageNameFromPath = (pathname) => {
    const path = pathname.split('/').filter(Boolean)[0];
    if (!path) return 'Dashboard';
    return path.charAt(0).toUpperCase() + path.slice(1);
  };

  const currentPageKey = getPageNameFromPath(location.pathname) || currentPageName || 'Dashboard';
  const displayPageName = pageNameMap[currentPageKey] || currentPageKey;

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const navigationGroups = [
    {
      title: "Main",
      items: [
        { name: "Dashboard", icon: Home, page: "Home" },
        { name: "Patients", icon: Users, page: "Patients" },
        { name: "Tasks", icon: CheckCircle, page: "Tasks" },
      ]
    },
    {
      title: "Clinical",
       items: [
         { name: "Smart Note", icon: FileText, page: "SmartNoteAssistant" },
         { name: "Voice Scribe", icon: Activity, page: "MedicalScribe" },
         { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
         { name: "OASIS", icon: FileText, page: "OASIS" },
       ]
     },
    {
      title: "Revenue & Billing",
      items: [
        { name: "PDGM Analytics", icon: DollarSign, page: "PDGMAnalytics" },
        { name: "KPI Dashboard", icon: BarChart3, page: "KPIDashboard" },
        { name: "Billing", icon: DollarSign, page: "BillingManagement" },
      ]
    },
    {
      title: "Compliance",
      items: [
        { name: "Compliance", icon: Shield, page: "ComplianceDashboard" },
        { name: "Rules Engine", icon: Lock, page: "ComplianceRulesEngine" },
        { name: "Patient Alerts", icon: Bell, page: "PatientAlerts" },
        { name: "Regulatory Updates", icon: Shield, page: "RegulatoryUpdates" },
      ]
    },
    {
      title: "Workflow",
      items: [
        { name: "Referral Intake", icon: UserCog, page: "ReferralIntake" },
        { name: "Clinical Pathways", icon: Activity, page: "ClinicalPathways" },
        { name: "Fax Center", icon: Send, page: "FaxCenter" },
      ]
    },
    {
      title: "Communication",
      items: [
        { name: "Team Messages", icon: MessageSquare, page: "InternalMessaging" },
        { name: "Patient Messages", icon: MessageSquare, page: "SecureMessaging" },
      ]
    },
    {
      title: "Reports & Analytics",
      items: [
        { name: "Analytics", icon: BarChart3, page: "AnalyticsDashboard" },
        { name: "Reports Center", icon: FileText, page: "ReportsCenter" },
      ]
    },
    {
      title: "Support",
      items: [
        { name: "Training", icon: BookOpen, page: "TrainingHub" },
        { name: "Help & Docs", icon: FileText, page: "Documentation" },
        { name: "Settings", icon: Settings, page: "Settings" },
      ]
    }
  ];

  const enterpriseNavigationGroup = user?.agency_id ? {
    title: "Agency",
    items: [
      { name: "Team", icon: Users, page: "TeamCollaboration" },
      { name: "Agency Analytics", icon: BarChart3, page: "EnterpriseAnalytics" },
    ]
  } : null;

  const adminNavigationGroup = user?.role === "admin" ? {
    title: "Administration",
    items: [
      { name: "Admin Dashboard", icon: Award, page: "AdminDashboard" },
      { name: "User Management", icon: Users, page: "UserManagement" },
      { name: "Agency Management", icon: Building2, page: "AgencyDashboard" },
    ]
  } : null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600 shadow-md">
        <div className="flex items-start justify-between px-4 py-2">
          <div className="flex items-start gap-4 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden mt-1"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/879f7eecc_caremetric_ai_logo-removebg-preview.png" 
              alt="CareMetric AI" 
              className="h-12 sm:h-14 w-auto flex-shrink-0"
            />
          </div>
          <div className="flex items-center gap-2">
            {user?.email && <FaxNotificationBell userEmail={user.email} />}
            <span className="text-xs sm:text-sm font-medium text-blue-900 hidden sm:block">
              {displayPageName}
            </span>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`fixed lg:sticky top-[57px] left-0 z-40 h-[calc(100vh-57px)] w-56 bg-white dark:bg-slate-800 border-r border-slate-300 dark:border-slate-600 transition-all duration-300 overflow-y-auto shadow-md ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="p-4 pb-3 border-b border-slate-200/40 dark:border-slate-700/40">
            <div className="flex items-center gap-2">
                    <img 
                      src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/879f7eecc_caremetric_ai_logo-removebg-preview.png" 
                      alt="CareMetric AI" 
                      className="h-8 w-8 rounded-lg shadow-sm"
                    />
                    <span className="hidden sm:inline font-bold text-sm text-blue-900">{displayPageName}</span>
                  </div>
          </div>
          {user?.email && <FavoritesBar userEmail={user.email} />}
          <nav className="p-3 space-y-3">
            {navigationGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-2">
                  {group.title}
                </h3>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = displayPageName === item.name || currentPageKey === item.page;
                    return (
                      <Link 
                        key={item.page} 
                        to={createPageUrl(item.page)} 
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-300 border-l-3 ${
                          isActive
                            ? "border-l-blue-600 bg-blue-100/40 text-blue-700 font-semibold dark:border-l-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
                            : "border-l-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/30 hover:text-blue-600 dark:hover:bg-slate-700/40 dark:hover:text-blue-300"
                        }`}
                      >
                        <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="text-xs">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            
            {enterpriseNavigationGroup && (
              <div key={enterpriseNavigationGroup.title}>
                <h3 className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-2">
                  {enterpriseNavigationGroup.title}
                </h3>
                <div className="space-y-0.5">
                  {enterpriseNavigationGroup.items.map((item) => {
                    const isActive = displayPageName === item.name || currentPageKey === item.page;
                    return (
                      <Link 
                        key={item.page} 
                        to={createPageUrl(item.page)} 
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-300 border-l-3 ${
                          isActive
                            ? "border-l-blue-600 bg-blue-100/40 text-blue-700 font-semibold dark:border-l-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
                            : "border-l-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/30 hover:text-blue-600 dark:hover:bg-slate-700/40 dark:hover:text-blue-300"
                        }`}
                      >
                        <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="text-xs">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {adminNavigationGroup && (
              <div key={adminNavigationGroup.title}>
                <h3 className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 px-2">
                  {adminNavigationGroup.title}
                </h3>
                <div className="space-y-0.5">
                  {adminNavigationGroup.items.map((item) => {
                     const isActive = displayPageName === item.name || currentPageKey === item.page;
                     return (
                       <Link 
                         key={item.page} 
                         to={createPageUrl(item.page)} 
                         onClick={() => setSidebarOpen(false)}
                         className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-all duration-300 border-l-3 ${
                           isActive
                             ? "border-l-blue-600 bg-blue-100/40 text-blue-700 font-semibold dark:border-l-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
                             : "border-l-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/30 hover:text-blue-600 dark:hover:bg-slate-700/40 dark:hover:text-blue-300"
                         }`}
                       >
                         <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                         <span className="text-xs">{item.name}</span>
                       </Link>
                     );
                   })}
                </div>
              </div>
            )}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-h-[calc(100vh-57px)] pb-16 md:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileFieldToolbar />

      {/* Overlay for mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}