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
                              UserPlus,
                              ShieldAlert,
                              ListTodo,
                              FileText,
                              Download,
                              TrendingUp,
                              Building2 } from
                              "lucide-react";

import OfflineIndicator from "../components/mobile/OfflineIndicator";
import AIChatAssistant from "../components/chat/AIChatAssistant";
import AIAssistantEngine from "../components/ai-assistant/AIAssistantEngine";
import ShareAppButton from "../components/marketing/ShareAppButton";
import NotificationCenter from "../components/notifications/NotificationCenter";
import { ThemeProvider } from "../components/theme/ThemeProvider";
import { SessionManager } from "../components/utils/security";
import { RealTimeBreachMonitor } from "../components/security/RealTimeBreachAlerts";
import PushNotificationManager from "../components/notifications/PushNotificationManager";
import { getAccessiblePages } from "../components/utils/providerAccessControl";
import PWAInstallPrompt from "../components/mobile/PWAInstallPrompt";
import { useAgencyFeatureAccess } from "../components/utils/useAgencyFeatureAccess";
import InvitationAcceptBanner from "../components/agency/InvitationAcceptBanner";

/* =========================
         iOS / Layout Constants
      ========================= */
const HEADER_BAR_HEIGHT_REM = 3.5; // visible blue bar height (rem)

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

  const isPremium = subscription && (
  subscription.status === 'active' ||
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

      // Redirect to onboarding if not completed
      React.useEffect(() => {
        if (currentUser && !currentUser.onboarding_completed && currentPageName !== 'Onboarding') {
          window.location.href = `/onboarding`;
        }
      }, [currentUser, currentPageName]);

      // Get role-specific navigation items
      // User items first, then admin items
      const allNavItems = [
  // User items
  { name: "Dashboard", icon: Home, page: "Dashboard" },
  { name: "Patients", icon: Users, page: "Patients" },
  { name: "Smart Notes", icon: Brain, page: "SmartNoteAssistant" },
  { name: "Visit Scribe", icon: Mic, page: "MedicalScribe" },
  { name: "Clinical Tools", icon: Activity, page: "ClinicalHub" },
  { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
  { name: "Documents", icon: FileText, page: "DocumentCenter" },
  { name: "Features", icon: Sparkles, page: "Features" },
  { name: "Patient Education", icon: GraduationCap, page: "PatientEducationAnalytics" },
  { name: "OASIS", icon: ShieldAlert, page: "OASIS" },
  { name: "Compliance", icon: ShieldAlert, page: "ComplianceHub" },
  { name: "Analytics", icon: BarChart3, page: "AnalyticsHub" },
  { name: "Training", icon: GraduationCap, page: "TrainingHub" },
  { name: "Tasks", icon: ListTodo, page: "Tasks" },
  { name: "Subscription", icon: CreditCard, page: "SubscriptionPlans" },
  { name: "Settings", icon: Settings, page: "Settings" }];


  const accessiblePages = currentUser?.credential_type ?
  getAccessiblePages(currentUser.credential_type) :
  [];

  // Get agency feature access
  const { hasFeatureAccess } = useAgencyFeatureAccess(currentUser);

  const userNavItems = allNavItems.filter((item) => {
    // Always allow these core pages
    if (["Dashboard", "Features", "Settings", "SubscriptionPlans"].includes(item.page)) {
      return true;
    }
    
    // Check provider credential access
    const hasCredentialAccess = accessiblePages.includes(item.page) || 
      ["DocumentAnalyzer", "SmartNoteAssistant", "MedicalScribe", "ClinicalReasoning"].includes(item.page);
    
    // Check agency feature access
    const hasAgencyAccess = hasFeatureAccess(item.page);
    
    return hasCredentialAccess && hasAgencyAccess;
  });

  const adminNavItems = currentUser?.role === 'admin' ? [
    { name: "Admin Dashboard", icon: BarChart3, page: "AdminDashboard" },
    { name: "Enterprise", icon: Building2, page: "EnterpriseAdminDashboard" },
    { name: "Compliance Automation", icon: ShieldAlert, page: "ComplianceAutomation" },
    { name: "Training Manager", icon: GraduationCap, page: "AdminTrainingManagement" },
    { name: "Agency Templates", icon: FileText, page: "AgencyTemplates" },
    { name: "Security Audit", icon: ShieldAlert, page: "SecurityAudit" },
    { name: "Audit Log", icon: ShieldAlert, page: "AuditLog" },
    { name: "Analytics", icon: BarChart3, page: "AdvancedAnalyticsDashboard" },
    { name: "User Management", icon: Users, page: "UserManagement" },
    { name: "Subscriptions", icon: CreditCard, page: "AdminSubscriptions" }
  ] : [];

  // Check if user is an agency admin
  const { data: isAgencyAdmin } = useQuery({
    queryKey: ['isAgencyAdmin', currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return false;
      const agencies = await base44.entities.Agency.filter({ admin_email: currentUser.email });
      return agencies.length > 0;
    },
    enabled: !!currentUser && currentUser.role !== 'admin'
  });

  // Agency admin nav items (only shown if user is agency admin but not super admin)
  const agencyAdminNavItems = isAgencyAdmin && currentUser?.role !== 'admin' ? [
    { name: "Agency Dashboard", icon: Building2, page: "AgencyDashboard" }
  ] : [];

  // iOS-safe computed paddings - use max() to ensure minimum height even without safe area
  const mobileHeaderTotalHeight = `calc(${HEADER_BAR_HEIGHT_REM}rem + max(env(safe-area-inset-top), 0px))`;

  return (
    <ThemeProvider>
                <div className="fixed inset-0 -z-10">
                  {/* Main gradient background - light grey to darker grey */}
                  <div className="absolute inset-0 bg-gradient-to-br from-gray-100 via-gray-200 to-gray-300 dark:from-gray-900 dark:via-gray-800 dark:to-gray-700" />

                  {/* Subtle grey overlays */}
                  <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-r from-gray-300/20 to-gray-400/20 dark:from-gray-700/20 dark:to-gray-600/20 rounded-full blur-3xl animate-pulse" />
                  <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-gradient-to-l from-gray-300/20 to-gray-400/20 dark:from-gray-600/15 dark:to-gray-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
                  <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-gradient-to-b from-gray-200/15 to-gray-300/15 dark:from-gray-600/10 dark:to-gray-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
                </div>
                <div className="min-h-screen flex overflow-x-hidden transition-colors duration-300 relative">
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
      {showNavigationUI &&
        <aside
          className={`hidden lg:flex flex-col bg-gradient-to-b from-white/90 to-slate-50/80 dark:from-slate-900/90 dark:to-gray-900/80 backdrop-blur-xl border-r border-slate-200/50 dark:border-slate-700/30 shadow-lg transition-all duration-300 ${
          sidebarCollapsed ? "w-16" : "w-56"}`
          }>

          <div className="h-16 flex items-center justify-between px-3 border-b border-slate-200 dark:border-slate-800">
            <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2 min-w-0 group">
              <div className="relative flex-shrink-0 transition-transform duration-300 group-hover:scale-110">
                    <img
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                  className="w-8 h-8 object-contain"
                  alt="CareMetric AI Logo" />

                  </div>
                  {!sidebarCollapsed &&
              <span className="font-bold truncate flex items-center gap-1 text-slate-800 dark:text-slate-100">
                      CareMetric AI
                    </span>
              }
            </Link>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleLogout}
                title="Logout"
                className="text-slate-600 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">

                <LogOut className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
                {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
              </Button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
            {userNavItems.map((item) =>
            <Link
              key={item.page}
              to={createPageUrl(item.page)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
              isActive(item.page) ?
              "bg-slate-100 dark:bg-slate-800 text-primary font-medium" :
              "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`
              }>

                <item.icon className="w-4 h-4" />
                {!sidebarCollapsed && item.name}
              </Link>
            )}



            {agencyAdminNavItems.length > 0 &&
            <>
                <div className="h-px bg-blue-200 dark:bg-blue-900 my-3 mx-2"></div>
                {agencyAdminNavItems.map((item) =>
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                isActive(item.page) ?
                "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-200 font-medium" :
                "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`
                }>

                    <item.icon className="w-4 h-4" />
                    {!sidebarCollapsed && item.name}
                  </Link>
              )}
              </>
            }

            {adminNavItems.length > 0 &&
            <>
                <div className="h-px bg-amber-200 dark:bg-amber-900 my-3 mx-2"></div>
                {adminNavItems.map((item) =>
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                isActive(item.page) ?
                "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-200 font-medium" :
                "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"}`
                }>

                    <item.icon className="w-4 h-4" />
                    {!sidebarCollapsed && item.name}
                  </Link>
              )}
              </>
            }
          </nav>

          <div className="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
            {!sidebarCollapsed ?
            <ShareAppButton /> :

            <button
              className="flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 w-full"
              onClick={() => window.open('https://caremetricai.com/refer', '_blank')}>

                <UserPlus className="w-4 h-4" />
              </button>
            }
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 w-full ${
              sidebarCollapsed ? "justify-center" : ""}`
              }>

              <LogOut className="w-4 h-4" />
              {!sidebarCollapsed && "Logout"}
            </button>
          </div>
        </aside>
        }

      {/* ================= Mobile Header (OPAQUE + SAFE AREA) ================= */}
      <header
          className={`lg:hidden bg-gradient-to-r from-white/90 via-slate-50/80 to-white/90 dark:from-slate-900/90 dark:via-gray-900/80 dark:to-slate-900/90 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-700/30 shadow-lg flex flex-col transition-colors duration-300 ${
          showNavigationUI ? 'visible' : 'invisible'}`
          }
          style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            width: "100vw",
            maxWidth: "100vw"
          }}>

        {showNavigationUI &&
          <div className="bg-gray-400 px-2 flex items-center justify-between sm:px-3 w-full"

          style={{ height: `${HEADER_BAR_HEIGHT_REM}rem` }}>

            <Link to={createPageUrl("Dashboard")} className="flex items-center gap-1 min-w-0 flex-shrink">
              <div className="relative flex-shrink-0">
                <img
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                  className="w-9 h-9 sm:w-10 sm:h-10 object-contain"
                  alt="CareMetric AI Logo" />

              </div>
              <span className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm truncate">CareMetric AI</span>
            </Link>

            <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
              <PushNotificationManager userEmail={currentUser?.email} />
              <NotificationCenter />
              <Button
                size="icon"
                variant="ghost"
                className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                onClick={handleLogout}
                title="Logout">

                <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 h-8 w-8 sm:h-9 sm:w-9 flex-shrink-0"
                onClick={() => setMobileMenuOpen(true)}>

                <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>
          </div>
          }
      </header>

      {/* ================= Mobile Menu Overlay ================= */}
      {showNavigationUI && mobileMenuOpen &&
        <div className="fixed inset-0 bg-black/50 z-[290]" onClick={() => setMobileMenuOpen(false)}>
          <div
            className="absolute left-0 top-0 bottom-0 w-64 sm:w-72 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>

            <div className="h-12 sm:h-14 flex items-center justify-between px-3 sm:px-4 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md z-10">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base text-slate-800 dark:text-slate-100">Menu</span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setMobileMenuOpen(false)}
                className="h-8 w-8 sm:h-9 sm:w-9 text-slate-600 dark:text-slate-400">

                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>

            <nav className="p-3 sm:p-4 space-y-1">
              {userNavItems.map((item) =>
              <Link
                key={item.page}
                to={createPageUrl(item.page)}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm text-slate-900 dark:text-slate-100">

                  <item.icon className="w-4 h-4" />
                  {item.name}
                  </Link>
              )}

              {agencyAdminNavItems.length > 0 &&
              <>
                  <div className="h-px bg-slate-200 dark:bg-slate-700 my-3 mx-2"></div>
                  {agencyAdminNavItems.map((item) =>
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950 text-sm text-slate-900 dark:text-slate-100">

                      <item.icon className="w-4 h-4" />
                      {item.name}
                    </Link>
                )}
                </>
              }

              {adminNavItems.length > 0 &&
              <>
                  <div className="h-px bg-slate-200 dark:bg-slate-700 my-3 mx-2"></div>
                  {adminNavItems.map((item) =>
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950 text-sm text-slate-900 dark:text-slate-100">

                      <item.icon className="w-4 h-4" />
                      {item.name}
                    </Link>
                )}
                </>
              }

              <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                <div className="px-3 py-2">
                  <ShareAppButton />
                </div>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-sm text-slate-600 dark:text-slate-400 w-full">

                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>


            </nav>
          </div>
        </div>
        }

      {/* ================= Main Content ================= */}
      <main
          className="flex-1 overflow-x-hidden w-full relative bg-transparent"
          style={{
            minHeight: "100vh"
          }}>

        <div className={showNavigationUI ? "w-full max-w-full min-w-0 bg-transparent" : "w-full bg-transparent"}>
          {children}
        </div>
      </main>

      {/* ================= AI Assistant Engine ================= */}
      {showNavigationUI &&
        <AIAssistantEngine currentPage={currentPageName} />
      }

      {showNavigationUI && <OfflineIndicator />}
      <InvitationAcceptBanner currentUser={currentUser} />
      <RealTimeBreachMonitor />
      <PWAInstallPrompt />
      </div>
      </ThemeProvider>);

}