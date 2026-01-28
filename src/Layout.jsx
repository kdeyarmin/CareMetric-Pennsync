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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800">
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
            <div className="flex items-center gap-2">
              <Activity className="h-6 w-6 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">CareMetric AI</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden md:block">
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
          } fixed lg:sticky top-[57px] left-0 z-40 h-[calc(100vh-57px)] w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-transform duration-300 lg:translate-x-0 overflow-y-auto`}
        >
          <nav className="p-4 space-y-6">
            {navigationGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = currentPageName === item.name;
                    return (
                      <Link key={item.page} to={createPageUrl(item.page)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={`w-full justify-start gap-3 ${
                            isActive
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
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
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  {adminNavigationGroup.title}
                </h3>
                <div className="space-y-1">
                  {adminNavigationGroup.items.map((item) => {
                    const isActive = currentPageName === item.name;
                    return (
                      <Link key={item.page} to={createPageUrl(item.page)}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={`w-full justify-start gap-3 ${
                            isActive
                              ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
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