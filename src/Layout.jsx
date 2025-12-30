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
   iOS-SAFE CONSTANTS
========================= */
const HEADER_HEIGHT = "3.75rem";   // visible header (opaque)
const NAV_HEIGHT = "4.25rem";      // taller bottom nav
const FAB_OFFSET = "calc(4rem + env(safe-area-inset-bottom))";

export default function Layout({ children, currentPageName }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const { data: currentUser, isLoading } = useQuery({
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
  const showNav = currentPageName !== "Home" && currentUser && !isLoading;

  return (
    <div className="min-h-screen bg-blue-100 flex overflow-x-hidden">
      {/* ================= MOBILE HEADER (OPAQUE) ================= */}
      {showNav && (
        <header
          className="lg:hidden fixed top-0 left-0 right-0 z-[200] bg-blue-600"
          style={{
            height: `calc(${HEADER_HEIGHT} + env(safe-area-inset-top))`,
            paddingTop: "env(safe-area-inset-top)"
          }}
        >
          <div
            className="flex items-center justify-between px-3"
            style={{ height: HEADER_HEIGHT }}
          >
            <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
              <img
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                className="w-6 h-6"
                alt="CareMetric AI"
              />
              <span className="text-white font-bold text-sm">
                CareMetric AI
              </span>
            </Link>

            <div className="flex items-center gap-1">
              <NotificationCenter />
              <Button
                size="icon"
                variant="ghost"
                className="text-white h-9 w-9"
                onClick={handleLogout}
              >
                <LogOut className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="text-white h-9 w-9">
                <Menu className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </header>
      )}

      {/* ================= MAIN ================= */}
      <main
        className="flex-1 overflow-x-hidden"
        style={
          showNav
            ? {
                paddingTop: HEADER_HEIGHT,
                paddingBottom: NAV_HEIGHT
              }
            : {}
        }
      >
        <div className="w-full max-w-full min-w-0 p-3">
          {children}
        </div>
      </main>

      {/* ================= FLOATING BUTTONS ================= */}
      {showNav && (
        <div
          className="fixed z-30 flex gap-4 right-3 pointer-events-none"
          style={{ bottom: FAB_OFFSET }}
        >
          <div className="pointer-events-auto">
            <MobileQuickAccessMenu />
          </div>
          <div className="pointer-events-auto">
            <AIChatAssistant />
          </div>
        </div>
      )}

      {/* ================= BOTTOM NAV (TALLER + SAFE) ================= */}
      {showNav && (
        <nav
          className="fixed bottom-0 left-0 right-0 bg-white border-t shadow z-40 lg:hidden"
          style={{
            height: `calc(${NAV_HEIGHT} + env(safe-area-inset-bottom))`,
            paddingBottom: "env(safe-area-inset-bottom)"
          }}
        >
          <div
            className="flex items-center justify-around"
            style={{ height: NAV_HEIGHT }}
          >
            <Link to={createPageUrl("Dashboard")} className={`flex flex-col items-center ${isActive("Dashboard") ? "text-blue-600" : "text-gray-500"}`}>
              <Home className="w-5 h-5" />
              <span className="text-[11px]">Home</span>
            </Link>
            <Link to={createPageUrl("SmartNoteAssistant")} className={`flex flex-col items-center ${isActive("SmartNoteAssistant") ? "text-blue-600" : "text-gray-500"}`}>
              <Brain className="w-5 h-5" />
              <span className="text-[11px]">Notes</span>
            </Link>
            <Link to={createPageUrl("CarePlanManagement")} className={`flex flex-col items-center ${isActive("CarePlanManagement") ? "text-blue-600" : "text-gray-500"}`}>
              <Target className="w-5 h-5" />
              <span className="text-[11px]">Plans</span>
            </Link>
            <Link to={createPageUrl("PatientAlerts")} className={`flex flex-col items-center ${isActive("PatientAlerts") ? "text-blue-600" : "text-gray-500"}`}>
              <Bell className="w-5 h-5" />
              <span className="text-[11px]">Alerts</span>
            </Link>
            <Link to={createPageUrl("Settings")} className={`flex flex-col items-center ${isActive("Settings") ? "text-blue-600" : "text-gray-500"}`}>
              <User className="w-5 h-5" />
              <span className="text-[11px]">Settings</span>
            </Link>
          </div>
        </nav>
      )}

      {showNav && <OfflineIndicator />}
    </div>
  );
}
