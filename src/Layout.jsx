import React, { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./utils";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
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
  Building2
} from "lucide-react";

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
       title: "Clinical",
       items: [
         { name: "Smart Note", icon: FileText, page: "SmartNoteAssistant" },
         { name: "Medical Scribe", icon: Activity, page: "MedicalScribe" },
         { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
         { name: "OASIS", icon: FileText, page: "OASIS" },
       ]
     },
    {
      title: "Compliance & Analytics",
      items: [
        { name: "Compliance", icon: Shield, page: "ComplianceDashboard" },
        { name: "Analytics", icon: BarChart3, page: "AnalyticsDashboard" },
        { name: "Patient Alerts", icon: Bell, page: "PatientAlerts" },
      ]
    },
    {
      title: "Training & Support",
      items: [
        { name: "Training", icon: BookOpen, page: "TrainingHub" },
        { name: "Settings", icon: Settings, page: "Settings" },
      ]
    }
  ];

  const adminNavigationGroup = user?.role === "admin" ? {
    title: "Administration",
    items: [
      { name: "Admin Dashboard", icon: Award, page: "AdminDashboard" },
      { name: "User Management", icon: UserCog, page: "UserManagement" },
      { name: "Agency Management", icon: Building2, page: "AgencyDashboard" },
    ]
  } : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-950 dark:via-blue-950/40 dark:to-slate-950">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-gradient-to-r from-blue-400 to-blue-500 dark:from-blue-700 dark:to-blue-800 backdrop-blur-md border-b border-blue-300/40 dark:border-blue-600/30 shadow-elevated">
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
            <span className="text-xs sm:text-sm font-medium text-white/90 hidden sm:block">
              {currentPageName}
            </span>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } fixed lg:sticky top-[57px] left-0 z-40 h-[calc(100vh-57px)] w-64 bg-gradient-to-b from-slate-50/80 via-slate-50/60 to-blue-50/40 dark:from-slate-900/80 dark:via-slate-900/60 dark:to-slate-900/40 border-r border-slate-200/40 dark:border-slate-700/40 transition-all duration-300 lg:translate-x-0 overflow-y-auto shadow-elevated lg:shadow-soft backdrop-blur-sm`}
        >
          <div className="p-4 border-b border-slate-200/40 dark:border-slate-700/40">
            <div className="flex items-center gap-2">
                  <img 
                    src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/6fa1398f8_CareMetric.png" 
                    alt="CareMetric AI" 
                    className="h-8 w-8 rounded-lg shadow-sm"
                  />
                  <span className="hidden sm:inline font-bold text-white">CareMetric AI</span>
                </div>
          </div>
          <nav className="p-4 space-y-6">
            {navigationGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = currentPageName === item.name;
                    return (
                      <Link 
                        key={item.page} 
                        to={createPageUrl(item.page)} 
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 border-l-4 ${
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
            
            {adminNavigationGroup && (
              <div key={adminNavigationGroup.title}>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  {adminNavigationGroup.title}
                </h3>
                <div className="space-y-0.5">
                  {adminNavigationGroup.items.map((item) => {
                     const isActive = currentPageName === item.name;
                     return (
                       <Link 
                         key={item.page} 
                         to={createPageUrl(item.page)} 
                         onClick={() => setSidebarOpen(false)}
                         className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 border-l-4 ${
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
        <main className="flex-1 min-h-[calc(100vh-57px)]">
          {children}
        </main>
      </div>

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