import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Home,
  Users,
  User,
  FileText,
  WifiOff,
  GraduationCap,
  BarChart3,
  Settings,
  Menu,
  X,
  Brain,
  Target,
  Bell,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  BookOpen,
  Activity,
  CreditCard,
  Shield
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import OfflineIndicator from "../components/mobile/OfflineIndicator";
import AIChatAssistant from "../components/chat/AIChatAssistant";
import MobileQuickAccessMenu from "../components/mobile/MobileQuickAccessMenu";
import ShareAppButton from "../components/marketing/ShareAppButton";
import NotificationCenter from "../components/notifications/NotificationCenter";

/* =========================
   Layout Constants
========================= */
const MOBILE_FAB_OFFSET = "calc(8.5rem + env(safe-area-inset-bottom))";
const DESKTOP_FAB_OFFSET = "calc(1rem + env(safe-area-inset-bottom))";

export default function Layout({ children, currentPageName }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPageName]);

  const handleLogout = async () => {
    try {
      await base44.entities.UserActivity.create({
        user_email: currentUser?.email,
        user_name: currentUser?.full_name,
        action: "logout",
        details: { logout_time: new Date().toISOString() },
        page: "logout"
      });
    } catch (e) {
      console.error(e);
    }
    base44.auth.logout(createPageUrl("Home"));
  };

  const isActive = (page) => currentPageName === page;

  const userNavItems = [
    { name: "My Patients", icon: Users, page: "Patients" },
    { name: "Smart Notes", icon: Brain, page: "SmartNoteAssistant" },
    { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
    { name: "Training Hub", icon: GraduationCap, page: "StaffTrainingHub" },
    { name: "Compliance Check", icon: Shield, page: "MedicareComplianceDashboard" },
    { name: "Offline Mode", icon: WifiOff, page: "OfflineMode" },
    { name: "Settings", icon: Settings, page: "Settings" }
  ];

  const adminNavItems = currentUser?.role === 'admin' ? [
    { name: "Dashboard & Analytics", icon: BarChart3, page: "AdminDashboard" },
    { name: "User & Training Mgmt", icon: Users, page: "Admin" },
    { name: "System Monitoring", icon: Activity, page: "SystemMonitoring" },
    { name: "Agency Settings", icon: Settings, page: "AgencySettings" },
    { name: "Subscriptions", icon: CreditCard, page: "AdminSubscriptionManagement" }
  ] : [];

  const bottomNavItems = [
    { name: "About", icon: Sparkles, page: "About" },
    { name: "Features", icon: Sparkles, page: "Features" },
    { name: "Pricing", icon: CreditCard, page: "Pricing" },
    { name: "Billing", icon: CreditCard, page: "Billing" }
  ];

  return (
    <div className="min-h-screen bg-blue-100 flex">
      {/* ================= Desktop Sidebar ================= */}
      <aside className={`hidden lg:flex flex-col bg-blue-50 border-r shadow transition-all ${sidebarCollapsed ? "w-16" : "w-56"}`}>
        <div className="h-16 flex items-center justify-between px-3 border-b">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png" className="w-8 h-8 object-contain" alt="CareMetric AI Logo" />
            {!sidebarCollapsed && <span className="font-bold">CareMetric AI</span>}
          </Link>
          <Button size="icon" variant="ghost" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {userNavItems.map((item) => (
            <Link
              key={item.page}
              to={createPageUrl(item.page)}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                isActive(item.page)
                  ? "bg-blue-100 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {!sidebarCollapsed && item.name}
            </Link>
          ))}
        </nav>

        <div className="border-t p-3">
          {adminNavItems.length > 0 && (
            <>
              {!sidebarCollapsed && (
                <p className="text-xs px-3 py-2 text-gray-400 uppercase font-semibold">Admin</p>
              )}
              <div className="mb-3 space-y-1">
                {adminNavItems.map((item) => (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                      isActive(item.page)
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {!sidebarCollapsed && item.name}
                  </Link>
                ))}
              </div>
              <div className="border-t mb-3"></div>
            </>
          )}
          <div className="mb-3 space-y-1">
            {bottomNavItems.map((item) => (
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                  isActive(item.page)
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {!sidebarCollapsed && item.name}
              </Link>
            ))}
          </div>
          <Button variant="ghost" className="w-full text-red-600" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            {!sidebarCollapsed && "Logout"}
          </Button>
          {!sidebarCollapsed && <ShareAppButton className="mt-2" />}
        </div>
      </aside>

      {/* ================= Mobile Header ================= */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-blue-600 flex items-center justify-between px-4 z-[100]">
        <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
          <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png" className="w-8 h-8 object-contain" alt="CareMetric AI Logo" />
          <span className="font-bold text-white">CareMetric AI</span>
        </Link>
        <div className="flex items-center gap-2">
          <NotificationCenter />
          <Button
            size="icon"
            variant="ghost"
            className="text-white"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu />
          </Button>
        </div>
      </header>

      {/* ================= Mobile Menu Overlay ================= */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[90]"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-16 flex items-center justify-between px-4 border-b">
              <span className="font-bold">Menu</span>
              <Button size="icon" variant="ghost" onClick={() => setMobileMenuOpen(false)}>
                <X />
              </Button>
            </div>
            <nav className="p-4 space-y-1">
              {userNavItems.map(item => (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm"
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              ))}
              {adminNavItems.length > 0 && (
                <>
                  <div className="border-t pt-2 mt-2">
                    <p className="text-xs px-3 py-2 text-gray-400 uppercase font-semibold">Admin</p>
                    {adminNavItems.map(item => (
                      <Link
                        key={item.page}
                        to={createPageUrl(item.page)}
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm"
                      >
                        <item.icon className="w-4 h-4" />
                        {item.name}
                      </Link>
                    ))}
                  </div>
                </>
              )}
              <div className="border-t pt-2 mt-2">
                {bottomNavItems.map(item => (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm"
                  >
                    <item.icon className="w-4 h-4" />
                    {item.name}
                  </Link>
                ))}
              </div>
            </nav>
          </div>
        </div>
      )}

      {/* ================= Main Content ================= */}
      <main className="flex-1 pt-16 lg:pt-0 pb-32">
        <div className="p-4 lg:p-6">{children}</div>
      </main>

      {/* ================= Mobile Floating Buttons ================= */}
      <div
        className="fixed z-50 flex gap-10 px-4 lg:hidden pointer-events-none right-0"
        style={{ bottom: MOBILE_FAB_OFFSET }}
      >
        <div className="pointer-events-auto">
          <MobileQuickAccessMenu />
        </div>
        <div className="pointer-events-auto">
          {currentUser && <AIChatAssistant />}
        </div>
      </div>


      {/* ================= Desktop Floating Buttons ================= */}
      <div className="hidden lg:block">
        <div className="fixed right-4 z-50" style={{ bottom: DESKTOP_FAB_OFFSET }}>
          {currentUser && <AIChatAssistant />}
        </div>
        <div className="fixed left-4 z-50" style={{ bottom: DESKTOP_FAB_OFFSET }}>
          <MobileQuickAccessMenu className="h-12 w-12 lg:h-14 lg:w-14" side="top" sideOffset={12}/>
        </div>
      </div>

      {/* ================= Bottom Navigation ================= */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t shadow lg:hidden z-40">
        <div className="flex items-center justify-around h-full">
          <Link to={createPageUrl("Dashboard")} className={isActive("Dashboard") ? "text-blue-600" : "text-gray-500"}>
            <Home />
          </Link>
          <Link to={createPageUrl("SmartNoteAssistant")}>
            <Brain />
          </Link>
          <Link to={createPageUrl("CarePlanManagement")}>
            <Target />
          </Link>
          <Link to={createPageUrl("PatientAlerts")}>
            <Bell />
          </Link>
          <Link to={createPageUrl("Settings")}>
            <User />
          </Link>
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}