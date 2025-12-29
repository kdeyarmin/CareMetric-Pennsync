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

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
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

  // Show navigation on all pages except Home, and only when user is logged in
  const showNavigationUI = currentPageName !== "Home" && currentUser && !userLoading;

  const userNavItems = [
    { name: "Dashboard", icon: Home, page: "Dashboard" },
    { name: "My Patients", icon: Users, page: "Patients" },
    { name: "Smart Notes", icon: Brain, page: "SmartNoteAssistant" },
    { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
    { name: "Training Hub", icon: GraduationCap, page: "StaffTrainingHub" },
    { name: "Offline Mode", icon: WifiOff, page: "OfflineMode" },
    { name: "Settings", icon: Settings, page: "Settings" }
  ];

  const adminNavItems = currentUser?.role === 'admin' ? [
    { name: "Dashboard & Analytics", icon: BarChart3, page: "AdminDashboard" },
    { name: "User & Training Mgmt", icon: Users, page: "Admin" },
    { name: "System Monitoring", icon: Activity, page: "SystemMonitoring" },
    { name: "Subscriptions", icon: CreditCard, page: "AdminSubscriptionManagement" }
  ] : [];



  return (
    <div className="min-h-screen bg-blue-100 flex">
      {/* ================= Desktop Sidebar ================= */}
      {showNavigationUI && (
      <aside className={`hidden lg:flex flex-col bg-blue-50 border-r shadow transition-all ${sidebarCollapsed ? "w-16" : "w-56"}`}>
        <div className="h-16 flex items-center justify-between px-3 border-b">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png" className="w-8 h-8 object-contain" alt="CareMetric AI Logo" />
            {!sidebarCollapsed && <span className="font-bold">CareMetric AI</span>}
          </Link>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={handleLogout}
              title="Logout"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <LogOut className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
            </Button>
          </div>
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

          <div className="h-px bg-gray-200 my-3 mx-2"></div>

          <Link to={createPageUrl("About")} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive("About") ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}>
            <Sparkles className="w-4 h-4" />
            {!sidebarCollapsed && "About"}
          </Link>
          <Link to={createPageUrl("Features")} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive("Features") ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}>
            <Sparkles className="w-4 h-4" />
            {!sidebarCollapsed && "Features"}
          </Link>
          <Link to={createPageUrl("Pricing")} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive("Pricing") ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}>
            <CreditCard className="w-4 h-4" />
            {!sidebarCollapsed && "Pricing"}
          </Link>
          <Link to={createPageUrl("Billing")} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${isActive("Billing") ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"}`}>
            <CreditCard className="w-4 h-4" />
            {!sidebarCollapsed && "Billing"}
          </Link>

          {adminNavItems.length > 0 && (
            <>
              <div className="h-1 bg-red-500 rounded-full my-3 mx-2"></div>
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
            </>
          )}
        </nav>

        <div className="border-t p-3 space-y-2">
          {!sidebarCollapsed && <ShareAppButton />}
          <button
            onClick={handleLogout}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm text-red-600 hover:bg-red-50 w-full ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            <LogOut className="w-4 h-4" />
            {!sidebarCollapsed && "Logout"}
          </button>
          </div>
          </aside>
          )}

          {/* ================= Mobile Header ================= */}
          {showNavigationUI && (
          <header className="lg:hidden fixed top-0 left-0 right-0 h-12 sm:h-14 bg-blue-600 flex items-center justify-between px-2 sm:px-3 z-[200]">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-1 min-w-0 flex-shrink">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png" className="w-6 h-6 sm:w-7 sm:h-7 object-contain flex-shrink-0" alt="CareMetric AI Logo" />
            <span className="font-bold text-white text-xs sm:text-sm truncate">CareMetric AI</span>
          </Link>
          <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
            <NotificationCenter />
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-red-600 h-8 w-8 sm:h-9 sm:w-9"
              onClick={handleLogout}
              title="Logout"
            >
              <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-white h-8 w-8 sm:h-9 sm:w-9"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
            </div>
            </header>
            )}

          {/* ================= Mobile Menu Overlay ================= */}
          {showNavigationUI && mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[90]"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div
              className="absolute left-0 top-0 bottom-0 w-64 sm:w-72 bg-white shadow-xl overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-12 sm:h-14 flex items-center justify-between px-3 sm:px-4 border-b sticky top-0 bg-white z-10">
                <span className="font-bold text-sm sm:text-base">Menu</span>
                <Button size="icon" variant="ghost" onClick={() => setMobileMenuOpen(false)} className="h-8 w-8 sm:h-9 sm:w-9">
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </Button>
              </div>
              <nav className="p-3 sm:p-4 space-y-1">
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
                  <div className="h-1 bg-red-500 rounded-full my-3 mx-2"></div>
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
                  </>
                  )}

                  <div className="border-t pt-2 mt-2">
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleLogout();
                    }}
                    className="flex items-center gap-3 px-3 py-2 rounded hover:bg-red-50 text-sm text-red-600 w-full"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                  </div>

                  <div className="border-t pt-2 mt-2">
                  <Link to={createPageUrl("About")} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm">
                  <Sparkles className="w-4 h-4" />
                  About
                  </Link>
                  <Link to={createPageUrl("Features")} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm">
                  <Sparkles className="w-4 h-4" />
                  Features
                  </Link>
                  <Link to={createPageUrl("Pricing")} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm">
                  <CreditCard className="w-4 h-4" />
                  Pricing
                  </Link>
                  <Link to={createPageUrl("Billing")} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 text-sm">
                    <CreditCard className="w-4 h-4" />
                    Billing
                  </Link>
                          </div>
            </nav>
          </div>
        </div>
      )}

      {/* ================= Main Content ================= */}
      <main className={`flex-1 ${showNavigationUI ? 'pt-12 sm:pt-14 lg:pt-0 lg:pb-32' : ''}`} style={showNavigationUI ? { paddingBottom: 'calc(3.5rem + max(env(safe-area-inset-bottom), 20px))' } : {}}>
        <div className={showNavigationUI ? 'p-3 sm:p-4 lg:p-6' : ''}>{children}</div>
      </main>

      {/* ================= Mobile Floating Buttons ================= */}
      {showNavigationUI && (
      <div
        className="fixed z-50 flex gap-10 px-4 lg:hidden pointer-events-none right-0"
        style={{ bottom: MOBILE_FAB_OFFSET }}
      >
        <div className="pointer-events-auto">
          <MobileQuickAccessMenu />
        </div>
        <div className="pointer-events-auto">
          <AIChatAssistant />
          </div>
          </div>
          )}


          {/* ================= Desktop Floating Buttons ================= */}
          {showNavigationUI && (
          <div className="hidden lg:block">
        <div className="fixed right-4 z-50" style={{ bottom: DESKTOP_FAB_OFFSET }}>
          <AIChatAssistant />
        </div>
        <div className="fixed left-4 z-50" style={{ bottom: DESKTOP_FAB_OFFSET }}>
          <MobileQuickAccessMenu className="h-12 w-12 lg:h-14 lg:w-14" side="top" sideOffset={12}/>
        </div>
      </div>
      )}

          {/* ================= Bottom Navigation ================= */}
          {showNavigationUI && (
          <nav className="fixed bottom-0 left-0 right-0 bg-white border-t shadow lg:hidden z-40" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}>
              <div className="flex items-center justify-around h-12 sm:h-14 px-1">
                <Link to={createPageUrl("Dashboard")} className={`flex flex-col items-center justify-center gap-0.5 py-0.5 ${isActive("Dashboard") ? "text-blue-600" : "text-gray-500"}`}>
                  <Home className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-[9px] sm:text-[10px]">Home</span>
                </Link>
                <Link to={createPageUrl("SmartNoteAssistant")} className={`flex flex-col items-center justify-center gap-0.5 py-0.5 ${isActive("SmartNoteAssistant") ? "text-blue-600" : "text-gray-500"}`}>
                  <Brain className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-[9px] sm:text-[10px]">Notes</span>
                </Link>
                <Link to={createPageUrl("CarePlanManagement")} className={`flex flex-col items-center justify-center gap-0.5 py-0.5 ${isActive("CarePlanManagement") ? "text-blue-600" : "text-gray-500"}`}>
                  <Target className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-[9px] sm:text-[10px]">Plans</span>
                </Link>
                <Link to={createPageUrl("PatientAlerts")} className={`flex flex-col items-center justify-center gap-0.5 py-0.5 ${isActive("PatientAlerts") ? "text-blue-600" : "text-gray-500"}`}>
                  <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-[9px] sm:text-[10px]">Alerts</span>
                </Link>
                <Link to={createPageUrl("Settings")} className={`flex flex-col items-center justify-center gap-0.5 py-0.5 ${isActive("Settings") ? "text-blue-600" : "text-gray-500"}`}>
                  <User className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-[9px] sm:text-[10px]">Settings</span>
                </Link>
                </div>
                </nav>
                )}

          {showNavigationUI && <OfflineIndicator />}
          </div>
          );
}