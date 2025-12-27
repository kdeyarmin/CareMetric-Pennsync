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
  Clock,
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
const MOBILE_BOTTOM_OFFSET = "calc(4.75rem + env(safe-area-inset-bottom))";
const DESKTOP_BOTTOM_OFFSET = "calc(1rem + env(safe-area-inset-bottom))";

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
    } catch (err) {
      console.error(err);
    }
    base44.auth.logout();
  };

  const isActive = (page) => currentPageName === page;

  const navCategories = [
    {
      category: "",
      items: [{ name: "My Patients", icon: Users, page: "Patients" }]
    },
    {
      category: "Clinical Work",
      items: [{ name: "Offline Mode", icon: WifiOff, page: "OfflineMode" }]
    },
    {
      category: "Resources",
      items: [
        { name: "About CareMetric AI", icon: Sparkles, page: "About" },
        { name: "Features Guide", icon: Sparkles, page: "Features" },
        { name: "Pricing", icon: CreditCard, page: "Pricing" },
        { name: "Patient Education", icon: FileText, page: "PatientEducationHub" },
        { name: "Education Library", icon: BookOpen, page: "PatientEducationLibrary" },
        { name: "Training Hub", icon: GraduationCap, page: "StaffTrainingHub" },
        { name: "Compliance Check", icon: Shield, page: "MedicareComplianceDashboard" },
        { name: "Billing", icon: CreditCard, page: "Billing" },
        { name: "Settings", icon: Settings, page: "Settings" }
      ]
    }
  ];

  return (
    <div className="min-h-screen flex bg-blue-100">
      {/* ================= Desktop Sidebar ================= */}
      <aside className={`hidden lg:flex flex-col bg-blue-50 border-r shadow transition-all ${sidebarCollapsed ? "w-16" : "w-56"}`}>
        <div className="h-16 flex items-center justify-between px-3 border-b">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
            <img src="/logo.png" className="w-8 h-8" />
            {!sidebarCollapsed && <span className="font-bold">CareMetric AI</span>}
          </Link>
          <Button size="icon" variant="ghost" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
            {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {navCategories.map((cat, i) => (
            <React.Fragment key={i}>
              {cat.category && !sidebarCollapsed && (
                <p className="text-xs px-3 py-1 text-gray-400 uppercase">{cat.category}</p>
              )}
              {cat.items.map((item) => (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md ${
                    isActive(item.page)
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  {!sidebarCollapsed && item.name}
                </Link>
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className="border-t p-3">
          <Button variant="ghost" className="w-full text-red-600" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            {!sidebarCollapsed && "Logout"}
          </Button>
          {!sidebarCollapsed && <ShareAppButton className="mt-2" />}
        </div>
      </aside>

      {/* ================= Mobile Header ================= */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-blue-600 flex items-center justify-between px-4 z-50">
        <span className="font-bold text-white">CareMetric AI</span>
        <Button size="icon" variant="ghost" className="text-white" onClick={() => setMobileMenuOpen(true)}>
          <Menu />
        </Button>
      </header>

      {/* ================= Main Content ================= */}
      <main className="flex-1 pt-16 lg:pt-0 pb-32">
        <div className="p-4 lg:p-6">{children}</div>
      </main>

      {/* ================= Mobile Floating Buttons ================= */}
      <div
        className="fixed left-0 right-0 z-50 flex justify-center gap-4 lg:hidden"
        style={{ bottom: MOBILE_BOTTOM_OFFSET }}
      >
        <MobileQuickAccessMenu />
        {currentUser && <AIChatAssistant />}
      </div>

      {/* ================= Desktop Floating Buttons ================= */}
      <div className="hidden lg:block">
        <div className="fixed right-4 z-50" style={{ bottom: DESKTOP_BOTTOM_OFFSET }}>
          <AIChatAssistant />
        </div>
        <div className="fixed left-4 z-50" style={{ bottom: DESKTOP_BOTTOM_OFFSET }}>
          <MobileQuickAccessMenu />
        </div>
      </div>

      {/* ================= Bottom Nav ================= */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white border-t shadow lg:hidden z-40">
        <div className="flex justify-around items-center h-full">
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
