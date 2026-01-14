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
                        CreditCard,
                        Mic,
                        Phone,
                        Video,
                        UserPlus
                      } from "lucide-react";

import OfflineIndicator from "../components/mobile/OfflineIndicator";
import AIChatAssistant from "../components/chat/AIChatAssistant";
import MobileQuickAccessMenu from "../components/mobile/MobileQuickAccessMenu";
import ShareAppButton from "../components/marketing/ShareAppButton";
import NotificationCenter from "../components/notifications/NotificationCenter";
import { ThemeProvider } from "../components/theme/ThemeProvider";
import { SessionManager } from "../components/utils/security";
import { RealTimeBreachMonitor } from "../components/security/RealTimeBreachAlerts";
import PushNotificationManager from "../components/notifications/PushNotificationManager";
import { getAccessiblePages } from "../components/utils/providerAccessControl";

/* =========================
   iOS / Layout Constants
========================= */
const HEADER_BAR_HEIGHT_REM = 3.5; // visible blue bar height (rem)
const BOTTOM_NAV_HEIGHT_REM = 4.25; // visible bottom nav height (rem)

// For FAB row placement: above bottom nav + safe area
const FAB_BOTTOM_OFFSET = `calc(${BOTTOM_NAV_HEIGHT_REM}rem + env(safe-area-inset-bottom) + 0.75rem)`;

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

  // Pre-fetch subscription to cache it for all pages
  useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getMySubscription', {});
      return response?.data?.subscription || response?.subscription;
    },
    enabled: !!currentUser?.email,
    staleTime: 300000 // Cache for 5 minutes
  });

  // Check subscription status for premium badge
  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const subs = await base44.entities.Subscription.filter({ user_email: currentUser.email });
      return subs[0];
    },
    enabled: !!currentUser?.email
  });

  const isPremium = subscription && 
    (subscription.status === 'active' || 
     subscription.status === 'trialing' || 
     subscription.status === 'lifetime_free' ||
     currentUser?.role === 'admin');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPageName]);

  // Session timeout implementation
  useEffect(() => {
    if (currentUser) {
      const sessionManager = new SessionManager(15); // 15 minute timeout

      sessionManager.startMonitoring(
        // On timeout - logout user
        () => {
          alert('Your session has expired for security. Please log in again.');
          base44.auth.logout();
        },
        // Warning 2 minutes before timeout
        () => {
          const continueSession = confirm('Your session will expire in 2 minutes due to inactivity. Click OK to continue.');
          if (continueSession) {
            sessionManager.resetSession();
          }
        }
      );

      return () => sessionManager.stopMonitoring();
    }
  }, [currentUser, currentPageName]);

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
    base44.auth.logout();
  };

  const isActive = (page) => currentPageName === page;

  // Show navigation when user is logged in
  const showNavigationUI = currentUser;

  // Get role-specific navigation items
  const allNavItems = [
    { name: "Dashboard", icon: Home, page: "Dashboard" },
    { name: "Patients", icon: Users, page: "Patients" },
    { name: "Telehealth", icon: Video, page: "TelehealthDashboard" },
    { name: "Smart Notes", icon: Brain, page: "SmartNoteAssistant" },
    { name: "Medical Scribe", icon: Mic, page: "MedicalScribe" },
    { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
    { name: "Analytics", icon: BarChart3, page: "NurseAnalyticsDashboard" },
    { name: "Training", icon: GraduationCap, page: "ProviderTrainingHub" },
    { name: "Settings", icon: Settings, page: "Settings" }
  ];

  const accessiblePages = currentUser?.provider_type 
    ? getAccessiblePages(currentUser.provider_type)
    : [];

  const userNavItems = allNavItems.filter(item => 
    item.page === "Dashboard" || 
    item.page === "Settings" || 
    accessiblePages.includes(item.page)
  );

  const adminNavItems =
    currentUser?.role === "admin"
      ? [
          { name: "Dashboard & Analytics", icon: BarChart3, page: "AdminDashboard" },
          { name: "User & Training Mgmt", icon: Users, page: "Admin" },
          { name: "System Monitoring", icon: Activity, page: "SystemMonitoring" },
          { name: "Subscriptions", icon: CreditCard, page: "AdminSubscriptionManagement" }
        ]
      : [];

  // iOS-safe computed paddings - use max() to ensure minimum height even without safe area
  const mobileHeaderTotalHeight = `calc(${HEADER_BAR_HEIGHT_REM}rem + max(env(safe-area-inset-top), 0px))`;
  const mobileBottomNavTotalHeight = `calc(${BOTTOM_NAV_HEIGHT_REM}rem + max(env(safe-area-inset-bottom), 0px))`;

  return (
          <ThemeProvider>
          <div className="min-h-screen flex overflow-x-hidden transition-colors duration-300 relative bg-transparent">
      {/* =========================
          Scoped overrides:
          Force any internal Tailwind "fixed" inside FAB components to behave like normal content
          so our horizontal row works (prevents overlapping).
      ========================= */}
      <style>{`
        /* Only affects the two FAB widgets when rendered inside our row */
        .cm-fab-scope .fixed {
          position: static !important;
          inset: auto !important;
          top: auto !important;
          right: auto !important;
          bottom: auto !important;
          left: auto !important;
          transform: none !important;
        }

        /* Ensure mobile header is always visible */
        @media (max-width: 1023px) {
          body {
            overflow-x: hidden;
          }
        }
      `}</style>

      {/* ================= Desktop Sidebar ================= */}
      {showNavigationUI && (
        <aside
             className={`hidden lg:flex flex-col bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border-r border-slate-200/50 dark:border-slate-800/50 shadow-sm transition-all duration-300 ${
               sidebarCollapsed ? "w-16" : "w-56"
             }`}
           >
          <div className="h-16 flex items-center justify-between px-3 border-b border-slate-200 dark:border-slate-800">
            <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2 min-w-0 group">
              <div className="relative flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
                <img
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                  className="w-8 h-8 object-contain"
                  alt="CareMetric AI Logo"
                />
              </div>
              {!sidebarCollapsed && (
                <span className="font-bold truncate flex items-center gap-1 dark:text-white">
                  CareMetric AI
                </span>
              )}
            </Link>
            <div className="flex items-center gap-1">
              <Button
                 size="icon"
                 variant="ghost"
                 onClick={handleLogout}
                 title="Logout"
                 className="text-slate-600 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                  isActive(item.page) 
                    ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-300 font-medium" 
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {!sidebarCollapsed && item.name}
              </Link>
            ))}



            {adminNavItems.length > 0 && (
              <>
                <div className="h-px bg-amber-200 dark:bg-amber-900 my-3 mx-2"></div>
                {adminNavItems.map((item) => (
                  <Link
                    key={item.page}
                    to={createPageUrl(item.page)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                      isActive(item.page) 
                        ? "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-300 font-medium" 
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {!sidebarCollapsed && item.name}
                  </Link>
                ))}
              </>
            )}
          </nav>

          <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
            {!sidebarCollapsed ? (
              <ShareAppButton />
            ) : (
              <button
                className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 w-full"
                onClick={() => window.open('https://caremetricai.com/refer', '_blank')}
              >
                <UserPlus className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 w-full ${
                sidebarCollapsed ? "justify-center" : ""
              }`}
            >
              <LogOut className="w-4 h-4" />
              {!sidebarCollapsed && "Logout"}
            </button>
          </div>
        </aside>
      )}

      {/* ================= Mobile Header (OPAQUE + SAFE AREA) ================= */}
      <header
        className={`lg:hidden fixed top-0 left-0 right-0 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50 shadow-sm flex flex-col transition-colors duration-300 ${
          showNavigationUI ? 'z-[9999] visible' : 'z-[-1] invisible'
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          width: "100vw",
          maxWidth: "100vw",
          position: "fixed"
        }}
      >
        {showNavigationUI && (
          <div
            className="flex items-center justify-between px-2 sm:px-3 w-full bg-transparent"
            style={{ height: `${HEADER_BAR_HEIGHT_REM}rem` }}
          >
            <Link to={createPageUrl("Dashboard")} className="flex items-center gap-1 min-w-0 flex-shrink">
              <div className="relative flex-shrink-0">
                <img
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                  className="w-9 h-9 sm:w-10 sm:h-10 object-contain"
                  alt="CareMetric AI Logo"
                />
              </div>
              <span className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm truncate">CareMetric AI</span>
            </Link>

            <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
              <PushNotificationManager userEmail={currentUser?.email} />
              <NotificationCenter />
              <Button
                size="icon"
                variant="ghost"
                className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                onClick={handleLogout}
                title="Logout"
              >
                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* ================= Mobile Menu Overlay ================= */}
      {showNavigationUI && mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-[290]" onClick={() => setMobileMenuOpen(false)}>
          <div
            className="absolute left-0 top-0 bottom-0 w-64 sm:w-72 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-12 sm:h-14 flex items-center justify-between px-3 sm:px-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md z-10">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">Menu</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setMobileMenuOpen(false)}
                className="h-8 w-8 sm:h-9 sm:w-9 text-slate-600 dark:text-slate-400"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>

            <nav className="p-3 sm:p-4 space-y-1">
              {userNavItems.map((item) => (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm text-slate-900 dark:text-slate-100"
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                </Link>
              ))}

              {adminNavItems.length > 0 && (
                <>
                  <div className="h-px bg-amber-200 dark:bg-amber-900 my-3 mx-2"></div>
                  {adminNavItems.map((item) => (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 text-sm text-slate-900 dark:text-slate-100"
                    >
                      <item.icon className="w-4 h-4" />
                      {item.name}
                    </Link>
                  ))}
                </>
              )}

              <div className="border-t border-slate-200 dark:border-slate-800 pt-2 mt-2">
                <div className="px-3 py-2">
                  <ShareAppButton />
                </div>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm text-slate-600 dark:text-slate-400 w-full"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>


            </nav>
          </div>
        </div>
      )}

      {/* ================= Main Content ================= */}
      <main
        className="flex-1 overflow-x-hidden w-full relative"
        style={{
          // Always add padding on mobile to account for header/nav
          paddingTop: showNavigationUI ? mobileHeaderTotalHeight : 0,
          paddingBottom: showNavigationUI ? mobileBottomNavTotalHeight : 0,
          minHeight: "100vh"
        }}
      >
        <div className={showNavigationUI ? "w-full max-w-full min-w-0" : "w-full"}>
          {children}
        </div>
      </main>

      {/* ================= Mobile Floating Buttons (HORIZONTAL) ================= */}
      {showNavigationUI && (
        <div className="fixed right-3 z-[9997] lg:hidden" style={{ bottom: FAB_BOTTOM_OFFSET }}>
          <div className="flex flex-row items-center gap-3">
            {/* IMPORTANT: scope override so internal fixed FABs become normal-flow */}
            <div className="cm-fab-scope flex items-center justify-center">
              <MobileQuickAccessMenu />
            </div>
            <div className="cm-fab-scope flex items-center justify-center">
              <AIChatAssistant />
            </div>
          </div>
        </div>
      )}

      {/* ================= Bottom Navigation (TALLER + SAFE AREA) ================= */}
      <nav
        className={`fixed bottom-0 left-0 right-0 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border-t border-slate-200/50 dark:border-slate-800/50 shadow-sm lg:hidden transition-colors duration-300 ${
          showNavigationUI ? 'z-[9998] visible' : 'z-[-1] invisible'
        }`}
        style={{ 
          height: mobileBottomNavTotalHeight, 
          paddingBottom: "env(safe-area-inset-bottom)",
          width: "100vw",
          maxWidth: "100vw",
          position: "fixed"
        }}
      >
        {showNavigationUI && (
          <div className="flex items-center justify-around px-1" style={{ height: `${BOTTOM_NAV_HEIGHT_REM}rem` }}>
            <Link
              to={createPageUrl("Dashboard")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${
                isActive("Dashboard") ? "text-blue-600 dark:text-blue-400 font-medium" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Home className="w-5 h-5" />
              <span className="text-[11px]">Home</span>
            </Link>

            <Link
              to={createPageUrl("MobileWorkflow")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${
                isActive("MobileWorkflow") ? "text-blue-600 dark:text-blue-400 font-medium" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Phone className="w-5 h-5" />
              <span className="text-[11px]">Mobile</span>
            </Link>

            <Link
              to={createPageUrl("CarePlanManagement")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${
                isActive("CarePlanManagement") ? "text-blue-600 dark:text-blue-400 font-medium" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Target className="w-5 h-5" />
              <span className="text-[11px]">Plans</span>
            </Link>

            <Link
              to={createPageUrl("PatientAlerts")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${
                isActive("PatientAlerts") ? "text-blue-600 dark:text-blue-400 font-medium" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Bell className="w-5 h-5" />
              <span className="text-[11px]">Alerts</span>
            </Link>

            <Link
              to={createPageUrl("Settings")}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all duration-200 ${
                isActive("Settings") ? "text-blue-600 dark:text-blue-400 font-medium" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <User className="w-5 h-5" />
              <span className="text-[11px]">Settings</span>
            </Link>
          </div>
        )}
      </nav>

      {showNavigationUI && <OfflineIndicator />}
      <RealTimeBreachMonitor />
      </div>
      </ThemeProvider>
      );
      }