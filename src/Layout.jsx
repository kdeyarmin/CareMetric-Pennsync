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
  Activity,
  CreditCard
} from "lucide-react";
import OfflineIndicator from "../components/mobile/OfflineIndicator";
import AIChatAssistant from "../components/chat/AIChatAssistant";
import MobileQuickAccessMenu from "../components/mobile/MobileQuickAccessMenu";
import ShareAppButton from "../components/marketing/ShareAppButton";
import NotificationCenter from "../components/notifications/NotificationCenter";

/* =========================
   Layout Constants
========================= */
const MOBILE_FAB_OFFSET = "calc(4.5rem + env(safe-area-inset-bottom))";
const DESKTOP_FAB_OFFSET = "calc(1rem + env(safe-area-inset-bottom))";

export default function Layout({ children, currentPageName }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch {
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
    } catch {}
    base44.auth.logout(createPageUrl("Home"));
  };

  const isActive = (page) => currentPageName === page;
  const showNavigationUI = currentPageName !== "Home" && currentUser && !userLoading;

  const userNavItems = [
    { name: "Dashboard", icon: Home, page: "Dashboard" },
    { name: "My Patients", icon: Users, page: "Patients" },
    { name: "Smart Notes", icon: Brain, page: "SmartNoteAssistant" },
    { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
    { name: "My Analytics", icon: BarChart3, page: "NurseAnalyticsDashboard" },
    { name: "Training Hub", icon: GraduationCap, page: "StaffTrainingHub" },
    { name: "Offline Mode", icon: WifiOff, page: "OfflineMode" },
    { name: "Settings", icon: Settings, page: "Settings" }
  ];

  const adminNavItems =
    currentUser?.role === "admin"
      ? [
          { name: "Dashboard & Analytics", icon: BarChart3, page: "AdminDashboard" },
          { name: "User & Training Mgmt", icon: Users, page: "Admin" },
          { name: "System Monitoring", icon: Activity, page: "SystemMonitoring" },
          { name: "Subscriptions", icon: CreditCard, page: "AdminSubscriptionManagement" }
        ]
      : [];

  return (
    // 🔒 ROOT FIX: prevent horizontal overflow everywhere
    <div className="min-h-screen bg-blue-100 flex overflow-x-hidden">
      {/* ================= Desktop Sidebar ================= */}
      {showNavigationUI && (
        <aside className={`hidden lg:flex flex-col bg-blue-50 border-r shadow transition-all ${sidebarCollapsed ? "w-16" : "w-56"}`}>
          <div className="h-16 flex items-center justify-between px-3 border-b">
            <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2 min-w-0">
              <img
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                className="w-8 h-8 object-contain"
                alt="CareMetric AI Logo"
              />
              {!sidebarCollapsed && <span className="font-bold truncate">CareMetric AI</span>}
            </Link>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={handleLogout} className="text-red-600 hover:bg-red-50">
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
                  isActive(item.page) ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {!sidebarCollapsed && item.name}
              </Link>
            ))}

            {adminNavItems.length > 0 && (
              <>
                <div className="h-px bg-gray-200 my-3" />
                {adminNavItems.map((item) => (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                      isActive(item.page) ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-100"
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
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-red-600 hover:bg-red-50 w-full">
              <LogOut className="w-4 h-4" />
              {!sidebarCollapsed && "Logout"}
            </button>
          </div>
        </aside>
      )}

      {/* ================= Mobile Header ================= */}
      {showNavigationUI && (
        <header className="lg:hidden fixed top-0 left-0 right-0 h-12 sm:h-14 bg-blue-600 flex items-center justify-between px-2 z-[200] overflow-x-hidden">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-1 min-w-0">
            <img
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
              className="w-6 h-6 object-contain flex-shrink-0"
              alt="CareMetric AI Logo"
            />
            <span className="font-bold text-white text-xs truncate">CareMetric AI</span>
          </Link>

          <div className="flex items-center gap-1 flex-shrink-0">
            <NotificationCenter />
            <Button size="icon" variant="ghost" className="text-white h-8 w-8" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="text-white h-8 w-8" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>
          </div>
        </header>
      )}

      {/* ================= Main Content ================= */}
      <main
        className={`flex-1 overflow-x-hidden ${showNavigationUI ? "pt-12 sm:pt-14 lg:pt-0" : ""}`}
        style={showNavigationUI ? { paddingBottom: MOBILE_FAB_OFFSET } : {}}
      >
        <div className={`w-full max-w-full min-w-0 overflow-x-hidden ${showNavigationUI ? "p-3 sm:p-4 lg:p-6" : ""}`}>
          {children}
        </div>
      </main>

      {/* ================= Mobile Floating Buttons ================= */}
      {showNavigationUI && (
        <div
          className="fixed z-50 flex gap-4 px-2 lg:hidden pointer-events-none right-2 max-w-full overflow-hidden"
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
            <MobileQuickAccessMenu />
          </div>
        </div>
      )}

      {showNavigationUI && <OfflineIndicator />}
    </div>
  );
}
