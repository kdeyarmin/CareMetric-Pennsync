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
  MessageSquare
} from "lucide-react";

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Map page names to their display labels
  const pageNameMap = {
    'Dashboard': 'Dashboard',
    'Patients': 'Patients',
    'Tasks': 'Tasks',
    'SmartNoteAssistant': 'Smart Note',
    'MedicalScribe': 'Voice Scribe',
    'CarePlanManagement': 'Care Plans',
    'OASIS': 'OASIS',
    'SendFax': 'Send Fax',
    'FaxQueue': 'Fax Queue',
    'FaxAnalytics': 'Fax Analytics',
    'AIAnalyticsDashboard': 'AI Analytics',
    'DocumentLibrary': 'Doc Library',
    'SecureMessaging': 'Messages',
    'PHIVault': 'PHI Vault',
    'FaxQueue': 'Fax Queue',
    'ComplianceDashboard': 'Compliance',
    'AnalyticsDashboard': 'Analytics',
    'PatientAlerts': 'Patient Alerts',
    'TrainingHub': 'Training',
    'Documentation': 'Help & Docs',
    'Settings': 'Settings',
    'EnterpriseAnalytics': 'Agency Analytics',
    'AdminDashboard': 'Admin Dashboard',
    'UserManagement': 'User Management',
    'AgencyDashboard': 'Agency Management'
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
        { name: "Dashboard", icon: Home, page: "Dashboard" },
        { name: "Patients", icon: Users, page: "Patients" },
        { name: "Tasks", icon: CheckCircle, page: "Tasks" },
      ]
    },
    {
      title: "Documentation",
       items: [
         { name: "Smart Note", icon: FileText, page: "SmartNoteAssistant" },
         { name: "Voice Scribe", icon: Activity, page: "MedicalScribe" },
         { name: "OASIS", icon: FileText, page: "OASIS" },
         { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
       ]
     },
    {
      title: "Fax & Documents",
      items: [
        { name: "Send Fax", icon: Send, page: "SendFax" },
        { name: "Fax Queue", icon: Clock, page: "FaxQueue" },
        { name: "Doc Library", icon: FileText, page: "DocumentLibrary" },
      ]
    },
    {
      title: "Insights",
      items: [
        { name: "Analytics", icon: BarChart3, page: "AnalyticsDashboard" },
        { name: "Compliance", icon: Shield, page: "ComplianceDashboard" },
        { name: "Patient Alerts", icon: Bell, page: "PatientAlerts" },
      ]
    },
    {
      title: "Support",
      items: [
        { name: "Messages", icon: MessageSquare, page: "SecureMessaging" },
        { name: "Training", icon: BookOpen, page: "TrainingHub" },
        { name: "Help & Docs", icon: FileText, page: "Documentation" },
        { name: "Settings", icon: Settings, page: "Settings" },
      ]
    }
  ];

  const enterpriseNavigationGroup = user?.agency_id ? {
    title: "Agency",
    items: [
      { name: "Agency Analytics", icon: BarChart3, page: "EnterpriseAnalytics" },
    ]
  } : null;

  const adminNavigationGroup = user?.role === "admin" ? {
    title: "Administration",
    items: [
      { name: "Admin Dashboard", icon: Award, page: "AdminDashboard" },
      { name: "User Management", icon: UserCog, page: "UserManagement" },
      { name: "Agency Management", icon: Building2, page: "AgencyDashboard" },
    ]
  } : null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
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
          className={`fixed lg:sticky top-[57px] left-0 z-40 h-[calc(100vh-57px)] w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 overflow-y-auto shadow-lg lg:shadow-sm ${
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
          <nav className="p-4 space-y-5">
            {navigationGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = displayPageName === item.name || currentPageKey === item.page;
                    return (
                      <Link 
                        key={item.page} 
                        to={createPageUrl(item.page)} 
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 border-l-4 ${
                          isActive
                            ? "border-l-blue-600 bg-blue-100/40 text-blue-700 font-semibold dark:border-l-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
                            : "border-l-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/30 hover:text-blue-600 dark:hover:bg-slate-700/40 dark:hover:text-blue-300"
                        }`}
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            
            {enterpriseNavigationGroup && (
              <div key={enterpriseNavigationGroup.title}>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
                  {enterpriseNavigationGroup.title}
                </h3>
                <div className="space-y-1">
                  {enterpriseNavigationGroup.items.map((item) => {
                    const isActive = displayPageName === item.name || currentPageKey === item.page;
                    return (
                      <Link 
                        key={item.page} 
                        to={createPageUrl(item.page)} 
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 border-l-4 ${
                          isActive
                            ? "border-l-blue-600 bg-blue-100/40 text-blue-700 font-semibold dark:border-l-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
                            : "border-l-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/30 hover:text-blue-600 dark:hover:bg-slate-700/40 dark:hover:text-blue-300"
                        }`}
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-sm">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {adminNavigationGroup && (
              <div key={adminNavigationGroup.title}>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2.5">
                  {adminNavigationGroup.title}
                </h3>
                <div className="space-y-1">
                  {adminNavigationGroup.items.map((item) => {
                     const isActive = displayPageName === item.name || currentPageKey === item.page;
                     return (
                       <Link 
                         key={item.page} 
                         to={createPageUrl(item.page)} 
                         onClick={() => setSidebarOpen(false)}
                         className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 border-l-4 ${
                           isActive
                             ? "border-l-blue-600 bg-blue-100/40 text-blue-700 font-semibold dark:border-l-blue-400 dark:bg-blue-900/30 dark:text-blue-100"
                             : "border-l-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/30 hover:text-blue-600 dark:hover:bg-slate-700/40 dark:hover:text-blue-300"
                         }`}
                       >
                         <item.icon className="h-4 w-4 flex-shrink-0" />
                         <span className="text-sm">{item.name}</span>
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