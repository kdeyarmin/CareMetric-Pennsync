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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
        { name: "Document Visit", icon: Calendar, page: "DocumentVisit" },
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-900 dark:via-blue-950/30 dark:to-slate-900">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div className="flex items-center gap-3">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/6fa1398f8_CareMetric.png" 
                alt="CareMetric AI" 
                className="h-9 w-9 rounded-xl shadow-sm"
              />
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent">CareMetric AI</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400 hidden md:block">
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
          } fixed lg:sticky top-[57px] left-0 z-40 h-[calc(100vh-57px)] w-64 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-r border-slate-200/60 dark:border-slate-800/60 transition-transform duration-300 lg:translate-x-0 overflow-y-auto shadow-lg lg:shadow-none`}
        >
          <div className="p-4 border-b border-slate-200/60 dark:border-slate-800/60">
            <div className="flex items-center gap-2">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/6fa1398f8_CareMetric.png" 
                alt="CareMetric AI" 
                className="h-7 w-7 rounded-lg shadow-sm"
              />
              <span className="font-bold bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent">CareMetric AI</span>
            </div>
          </div>
          <nav className="p-4 space-y-6">
            {navigationGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = currentPageName === item.name;
                    return (
                      <Link key={item.page} to={createPageUrl(item.page)} onClick={() => setSidebarOpen(false)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={`w-full justify-start gap-3 transition-all ${
                            isActive
                              ? "bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 shadow-sm dark:from-blue-950/40 dark:to-blue-900/30 dark:text-blue-400 border-l-2 border-blue-500"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-blue-600 dark:hover:text-blue-400"
                          }`}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm">{item.name}</span>
                        </Button>
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
                <div className="space-y-1">
                  {adminNavigationGroup.items.map((item) => {
                    const isActive = currentPageName === item.name;
                    return (
                      <Link key={item.page} to={createPageUrl(item.page)} onClick={() => setSidebarOpen(false)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={`w-full justify-start gap-3 transition-all ${
                            isActive
                              ? "bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 shadow-sm dark:from-blue-950/40 dark:to-blue-900/30 dark:text-blue-400 border-l-2 border-blue-500"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-blue-600 dark:hover:text-blue-400"
                          }`}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm">{item.name}</span>
                        </Button>
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