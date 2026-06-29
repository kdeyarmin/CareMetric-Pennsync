import { useState, useEffect, useMemo, useCallback } from "react";

import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { queryClientInstance } from "@/lib/query-client";
import { clearCachedPHI } from "@/lib/phiStorage";
import { Bell, LogOut, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "sonner";
import { buildNavCategories, buildAdminItems, NAV_MANIFEST } from "@/lib/nav.manifest";
import { getRoleView } from "@/lib/roles";

import DesktopSidebar from "@/components/layout/DesktopSidebar";
import MobileHeader from "@/components/layout/MobileHeader";
import MobileMenu from "@/components/layout/MobileMenu";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import OfflineSyncService from "@/components/offline/OfflineSyncService";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import SessionTimeoutManager from "@/components/security/SessionTimeoutManager";
import Breadcrumbs from "@/components/navigation/Breadcrumbs";
import CommandPalette from "@/components/navigation/CommandPalette";

export default function Layout({ children, currentPageName }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);

  // PennSync ships a single, fully-designed light theme: every page and
  // component uses explicit light styles and none provide `dark:` variants.
  // Previously this effect mirrored the OS `prefers-color-scheme`, toggling the
  // `dark` class on <html>. That flipped only the CSS-variable tokens (popovers,
  // dropdown menus, charts, `muted` text) to dark while the hardcoded
  // `bg-white` / `text-slate-900` surfaces stayed light — producing an
  // inconsistent, partially-unreadable UI for anyone on a dark-mode device.
  // Keep the app in its intended light theme so every screen renders the same.
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        if (error.status === 403) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  }, [currentPageName]);

  // Match App.jsx's route guard (role === 'admin' OR the platform super admin by
  // owner-email / super_admin account_type). Without this, an unpromoted super
  // admin reaches admin routes by URL but gets NO admin nav — including the only
  // link to SuperAdminConfig, defeating the ensureSuperAdmin self-bootstrap.
  // Three-tier role model (see lib/roles.js): super_admin sees everything
  // (incl. platform/system config), facility_admin sees the full facility surface
  // (clinical + analytics + reporting + compliance), nurse sees clinical only.
  const roleView = getRoleView(currentUser);
  const isSuperAdminUser = roleView === 'super_admin';
  const isAdmin = roleView === 'super_admin' || roleView === 'facility_admin';
  const isApproved = currentUser?.is_approved === true || isAdmin;
  const isTimeOffApprover = isAdmin || currentUser?.is_manager === true;

  useEffect(() => {
    if (!currentUser?.email) return;
    const key = `login_tracked_${currentUser.email}`;
    if (sessionStorage.getItem(key)) return;
    base44.entities.UserActivity.create({
      user_email: currentUser.email,
      user_name: currentUser.full_name,
      action: 'login',
      device_type: /mobile|android|iphone/i.test(navigator.userAgent) ? 'mobile' : /tablet|ipad/i.test(navigator.userAgent) ? 'tablet' : 'desktop',
      details: { timestamp: new Date().toISOString(), user_role: currentUser.role, session_start: true },
      user_agent: navigator.userAgent,
    }).catch((e) => console.warn("Failed to log login activity:", e?.message));
    sessionStorage.setItem(key, 'true');
  }, [currentUser?.email, currentUser?.full_name, currentUser?.role]);

  const { data: messages = [] } = useQuery({
    queryKey: ['unreadMessages', currentUser?.email],
    queryFn: () => base44.entities.Message.filter({ recipients: currentUser.email }, '-created_date', 50),
    initialData: [], refetchInterval: 60000, enabled: !!currentUser?.email,
  });

  // Time-off requests awaiting this user's review (admins see all pending;
  // managers see their direct reports'). Drives the "Time Off" nav badge.
  const { data: pendingTimeOff = [] } = useQuery({
    queryKey: ['pending-timeoff', currentUser?.email, isAdmin],
    queryFn: () => isAdmin
      ? base44.entities.TimeOffRequest.filter({ status: 'pending' }, '-created_date', 100)
      : base44.entities.TimeOffRequest.filter({ manager_email: currentUser.email, status: 'pending' }, '-created_date', 100),
    initialData: [], refetchInterval: 120000, enabled: !!currentUser?.email && isTimeOffApprover,
  });
  // Exclude the reviewer's own requests — they can't approve those. Drives the
  // "Time Off" nav badge (only approvers run the query above, so non-approvers
  // naturally see 0).
  const pendingTimeOffCount = pendingTimeOff.filter((r) => r.employee_email !== currentUser?.email).length;

  // Fetch charted visits to filter alerts
  const { data: chartedVisits = [] } = useQuery({
    queryKey: ['my-charted-visits', currentUser?.email],
    queryFn: () => base44.entities.Visit.filter(
      { created_by: currentUser?.email },
      '-visit_date',
      500
    ),
    initialData: [],
    enabled: !!currentUser?.email && currentUser?.role !== 'admin',
  });

  const { data: allActiveAlerts = [] } = useQuery({
    // `chartedVisits` must be part of the key: the queryFn filters alerts against
    // it, so when the nurse charts a new patient the cache must re-key and refetch
    // (otherwise the new patient's alert stays hidden for the whole stale window).
    // Mirrors NotificationCenter's ['active-alerts-nc', email, chartedVisits] key.
    queryKey: ['active-alerts', currentUser?.email, chartedVisits],
    queryFn: async () => {
      const alerts = await base44.entities.PatientAlert.filter({ status: 'active' }, '-created_date', 50);
      // Filter to only alerts for patients this clinician has charted on
      const chartedPatientIds = new Set(chartedVisits.map(v => v.patient_id));
      return alerts.filter(a => chartedPatientIds.has(a.patient_id));
    },
    initialData: [], 
    refetchInterval: 60000, 
    enabled: !!currentUser?.email && currentUser?.role !== 'admin' && chartedVisits.length > 0,
  });

  const activeAlerts = useMemo(() => isAdmin ? [] : allActiveAlerts, [allActiveAlerts, isAdmin]);

  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['pending-tasks', currentUser?.email],
    queryFn: () => base44.entities.Task.filter({ status: 'pending', assigned_to: currentUser?.email }, '-created_date', 50),
    initialData: [], refetchInterval: 60000, enabled: !!currentUser?.email,
  });

  const { data: inAppNotifications = [] } = useQuery({
    queryKey: ['notifications', currentUser?.email],
    queryFn: () => base44.entities.Notification.filter({ user_email: currentUser?.email }, '-created_date', 50),
    initialData: [], refetchInterval: 30000, enabled: !!currentUser?.email,
  });

  const { data: unreadSmsMessages = [] } = useQuery({
    queryKey: ['unread-sms', currentUser?.email],
    queryFn: () => base44.entities.SmsMessage.filter({ nurse_email: currentUser?.email, is_read: false }, '-created_date', 50),
    initialData: [], refetchInterval: 30000, enabled: !!currentUser?.email,
  });

  const unreadMessageCount = messages.filter(m => !m.read_by?.includes(currentUser?.email)).length;
  const unreadSmsCount = unreadSmsMessages.length;
  const unreadNotificationCount = inAppNotifications.filter(n => !n.is_read).length;
  const totalNotificationCount = unreadMessageCount + activeAlerts.length + pendingTasks.length + unreadNotificationCount;

// Badge value map — keys match the `badge` field in nav.manifest entries
  const badgeValues = useMemo(() => ({
    messages: unreadMessageCount,
    sms: unreadSmsCount,
    notifications: unreadNotificationCount,
    timeOffApprovals: pendingTimeOffCount,
  }), [unreadMessageCount, unreadSmsCount, unreadNotificationCount, pendingTimeOffCount]);

  // Action map — keys match the `action` field in nav.manifest entries
  const actionHandlers = useMemo(() => ({
    openNotifications: () => setNotificationCenterOpen(true),
  }), []);

  // Build nav arrays from manifest, then inject runtime badges/actions
  const navCategories = useMemo(() => {
    const cats = buildNavCategories(NAV_MANIFEST);
    return cats.map(cat => ({
      ...cat,
      items: cat.items.map(({ _badgeKey, ...item }) => ({
        ...item,
        badge: _badgeKey ? (badgeValues[_badgeKey] ?? 0) : 0,
      })),
    }));
  }, [badgeValues]);

  const adminItems = useMemo(() => {
    const cats = buildAdminItems(NAV_MANIFEST, isSuperAdminUser);
    // Append the special Alerts action item to the (single) Administration section
    const withAlerts = cats.map(cat => {
      if (cat.category !== "Administration") {
        return {
          ...cat,
          items: cat.items.map(({ _badgeKey, _actionKey, ...item }) => ({
            ...item,
            badge: _badgeKey ? (badgeValues[_badgeKey] ?? 0) : 0,
          })),
        };
      }
      return {
        ...cat,
        items: [
          ...cat.items.map(({ _badgeKey, _actionKey, ...item }) => ({
            ...item,
            badge: _badgeKey ? (badgeValues[_badgeKey] ?? 0) : 0,
          })),
          {
            name: "Alerts",
            icon: Bell,
            page: null,
            badge: unreadNotificationCount,
            action: actionHandlers.openNotifications,
          },
        ],
      };
    });
    return withAlerts;
  }, [badgeValues, actionHandlers, unreadNotificationCount, isSuperAdminUser]);

  const handleLogout = useCallback(async () => {
    try {
      await base44.entities.UserActivity.create({
        user_email: currentUser?.email, user_name: currentUser?.full_name, action: 'logout',
        device_type: /mobile|android|iphone/i.test(navigator.userAgent) ? 'mobile' : /tablet|ipad/i.test(navigator.userAgent) ? 'tablet' : 'desktop',
        details: { logout_time: new Date().toISOString(), user_role: currentUser?.role },
        user_agent: navigator.userAgent,
      });
    } catch {}
    // HIPAA: purge cached PHI before logging out (shared-device safety). Await
    // the storage purge so the IndexedDB clear isn't abandoned by the redirect.
    try { queryClientInstance.clear(); } catch { /* no-op */ }
    try { await clearCachedPHI(); } catch { /* no-op */ }
    base44.auth.logout();

  }, [currentUser?.email, currentUser?.full_name, currentUser?.role]);

  const isActive = useCallback((pageName) => currentPageName === pageName, [currentPageName]);

  if (currentUser && !isApproved) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-navy-50 via-white to-navy-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="mb-6 flex items-center justify-center gap-2">
            <img
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png"
              alt="PennSync"
              className="h-9 w-9 rounded-lg"
            />
            <span className="text-xl font-bold tracking-tight text-navy-900">
              Penn<span className="text-gold-600">Sync</span>
            </span>
          </div>
          <Card className="relative overflow-hidden border-slate-200 shadow-xl">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-navy-600 via-navy-500 to-gold-400" />
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-gold-100 to-gold-200 rounded-2xl flex items-center justify-center mx-auto mb-6 ring-1 ring-inset ring-gold-300/60">
                <Clock className="w-8 h-8 text-gold-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Account Pending Approval</h1>
              <p className="text-slate-600 mb-6">Your account has been created successfully. Please wait for an administrator to approve your access.</p>
              <div className="bg-navy-50 border border-navy-200 rounded-xl p-4 mb-6 text-left">
                <p className="text-sm text-navy-900"><strong>Account Details:</strong><br />{currentUser.full_name}<br />{currentUser.email}</p>
              </div>
              <p className="text-sm text-slate-500 mb-6">You will receive an email notification once your account is approved.</p>
              <Button onClick={handleLogout} variant="outline" className="w-full">
                <LogOut className="w-4 h-4 mr-2" /> Sign Out
              </Button>
            </CardContent>
          </Card>
          <p className="mt-6 text-center text-xs text-slate-400">
            Secure clinical platform · HIPAA compliant
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster
        position="top-right"
        richColors
        closeButton
        theme="light"
        toastOptions={{
          classNames: {
            toast: "rounded-xl border shadow-lg",
            title: "font-semibold",
            description: "text-slate-600",
          },
        }}
      />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:text-blue-700 focus:font-medium">
        Skip to content
      </a>
      <CommandPalette isAdmin={isAdmin} isSuperAdmin={isSuperAdminUser} />
      <div className="min-h-screen flex">
        <DesktopSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
          currentUser={currentUser}
          isAdmin={isAdmin}
          navCategories={navCategories}
          adminItems={adminItems}
          isActive={isActive}
          onLogout={handleLogout}
        />

        <MobileHeader
          currentPageName={currentPageName}
          totalNotificationCount={totalNotificationCount}
          mobileMenuOpen={mobileMenuOpen}
          onToggleMobileMenu={() => setMobileMenuOpen(v => !v)}
          onOpenNotificationCenter={() => setNotificationCenterOpen(true)}
        />

        <MobileMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          navCategories={navCategories}
          adminItems={adminItems}
          isAdmin={isAdmin}
          isActive={isActive}
          currentUser={currentUser}
          onLogout={handleLogout}
        />

        <main
          id="main-content"
          className="flex-1 pt-[calc(4rem_+_env(safe-area-inset-top))] md:pt-0 pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-0 min-h-screen w-0 md:w-auto"
          style={{ background: "linear-gradient(135deg, #cbd5e1 0%, #dbe5f5 45%, #9fb8e6 100%)" }}
        >
          <div className="p-4 sm:p-6 md:p-8 lg:p-10 min-w-0 animate-fade-in max-w-[1600px] mx-auto">
            <Breadcrumbs currentPageName={currentPageName} />
            {children}
          </div>
        </main>

        <MobileBottomNav isActive={isActive} unreadMessageCount={unreadMessageCount} />

        {/* Floating Sync Status — only appears when there are pending items to sync */}
        <div className="fixed bottom-20 md:bottom-4 right-4 z-40 max-w-sm">
          <OfflineSyncService />
        </div>
        <SessionTimeoutManager timeoutMinutes={15} warningMinutes={2} />

        <Dialog open={notificationCenterOpen} onOpenChange={setNotificationCenterOpen}>
          <DialogContent className="max-w-2xl p-0 border-0 bg-white">
            <div className="sr-only"><DialogTitle>Notifications</DialogTitle></div>
            <NotificationCenter currentUser={currentUser} onClose={() => setNotificationCenterOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}