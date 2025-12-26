import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Home,
  Users,
  FileText,
  Calendar,
  ClipboardList,
  Shield,
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
  WifiOff
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import OfflineIndicator from "../components/mobile/OfflineIndicator";

export default function Layout({ children, currentPageName }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPageName]);

  const isAdmin = currentUser?.role === 'admin';
  const isApproved = currentUser?.is_approved === true || isAdmin;

  // Track user login and session
  useEffect(() => {
    if (currentUser?.email) {
      const sessionKey = `login_tracked_${currentUser.email}`;
      const hasTrackedLogin = sessionStorage.getItem(sessionKey);
      
      if (!hasTrackedLogin) {
        // Track via backend function
        base44.functions.invoke('trackUserLogin').then(() => {
          sessionStorage.setItem(sessionKey, 'true');
        }).catch(err => {
          console.error('Login tracking failed:', err);
        });
        
        // Also log directly to UserActivity
        base44.entities.UserActivity.create({
          user_email: currentUser.email,
          user_name: currentUser.full_name,
          action: 'login',
          details: {
            timestamp: new Date().toISOString(),
            user_role: currentUser.role,
            session_start: true
          },
          page: 'login'
        }).catch(err => {
          console.error('Direct login logging failed:', err);
        });
        
        sessionStorage.setItem(sessionKey, 'true');
      }
    }
  }, [currentUser?.email]);

  const navCategories = [
    {
      category: "Overview",
      items: [
        { name: "Dashboard", icon: Home, page: "Dashboard" },
        { name: "Patient Dashboard", icon: BarChart3, page: "PatientDashboard" }
      ]
    },
    {
      category: "Patient Care",
      items: [
        { name: "Patients", icon: Users, page: "Patients" },
        { name: "Care Plans", icon: Target, page: "CarePlanManagement" },
        { name: "Alerts", icon: Bell, page: "PatientAlerts" },
        { name: "Care Coordination", icon: Users, page: "CareCoordinationDashboard" }
      ]
    },
    {
      category: "Documentation",
      items: [
        { name: "Smart Notes", icon: Brain, page: "SmartNoteAssistant" },
        { name: "Offline Mode", icon: WifiOff, page: "OfflineMode" },
        { name: "Referral Processor", icon: FileText, page: "ReferralProcessor" },
        { name: "Patient Education", icon: FileText, page: "PatientEducationHub" },
        { name: "Education Generator", icon: BookOpen, page: "PatientEducationGenerator" }
      ]
    },
    {
      category: "Quality & Compliance",
      items: [
        { name: "Medicare Compliance", icon: Shield, page: "MedicareComplianceDashboard" },
        { name: "Training Hub", icon: GraduationCap, page: "StaffTrainingHub" },
        { name: "Guidelines Library", icon: BookOpen, page: "MedicareGuidelinesLibrary" },
        { name: "Clinical Insights", icon: BarChart3, page: "ClinicalInsightsDashboard" },
        { name: "Features", icon: Sparkles, page: "Features" }
      ]
    }
  ];

  const adminItems = [
    { name: "Admin Dashboard", icon: Settings, page: "AdminDashboard" },
    { name: "Advanced Analytics", icon: BarChart3, page: "AdvancedAnalyticsDashboard" },
    { name: "Users & Settings", icon: Users, page: "UserManagement" },
    { name: "Training Management", icon: GraduationCap, page: "TrainingManagement" },
    { name: "Analytics & Performance", icon: BarChart3, page: "AgencyAnalytics" },
    { name: "Compliance & Audit", icon: ClipboardList, page: "ComplianceRegulatory" },
    { name: "Audit Trail", icon: Shield, page: "AuditTrail" },
    { name: "Clinical & OASIS", icon: ClipboardList, page: "ClinicalPathwayManager" },
    { name: "Import Patients", icon: Users, page: "ImportPatients" },
    { name: "Patient Data Management", icon: Users, page: "PatientDataManagement" }
    ];

  const handleLogout = async () => {
    // Log logout before actually logging out
    try {
      await base44.entities.UserActivity.create({
        user_email: currentUser?.email,
        user_name: currentUser?.full_name,
        action: 'logout',
        details: { logout_time: new Date().toISOString() },
        page: 'logout'
      });
    } catch (error) {
      console.error('Failed to log logout:', error);
    }
    
    base44.auth.logout();
  };

  const isActive = (pageName) => {
    return currentPageName === pageName;
  };

  // Show pending approval screen for unapproved users
  if (currentUser && !isApproved) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <Card className="border-yellow-300 shadow-xl">
            <CardContent className="p-8 text-center">
              <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Clock className="w-10 h-10 text-yellow-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-3">
                Account Pending Approval
              </h1>
              <p className="text-gray-600 mb-6">
                Your account has been created successfully. Please wait for an administrator to approve your access.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-900">
                  <strong>Account Details:</strong><br />
                  {currentUser.full_name}<br />
                  {currentUser.email}
                </p>
              </div>
              <p className="text-sm text-gray-500 mb-6">
                You will receive an email notification once your account is approved.
              </p>
              <Button
                onClick={handleLogout}
                variant="outline"
                className="w-full"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blue-100 flex">
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col bg-gradient-to-b from-blue-50 to-blue-100 shadow-lg border-r border-blue-200 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-56'} print:hidden`}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-gray-200">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png" 
              alt="Penn Sync Logo" 
              className="w-8 h-8 rounded-lg flex-shrink-0"
            />
            {!sidebarCollapsed && <span className="font-bold text-lg text-gray-900">Penn Sync</span>}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {/* Favorites Section */}
          {(currentUser?.favorited_pages?.length > 0 || currentUser?.favorited_patients?.length > 0) && (
            <>
              {!sidebarCollapsed && <p className="px-3 py-1 text-xs font-semibold text-yellow-600 uppercase flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Favorites
              </p>}
              {currentUser?.favorited_pages?.map((pageName) => {
                const allItems = navCategories.flatMap(cat => cat.items).concat(adminItems);
                const pageItem = allItems.find(item => item.page === pageName);
                if (!pageItem) return null;
                return (
                  <Link
                    key={`fav-${pageName}`}
                    to={createPageUrl(pageName)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive(pageName)
                        ? "bg-yellow-100 text-yellow-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                    title={sidebarCollapsed ? pageItem.name : undefined}
                  >
                    <pageItem.icon className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>{pageItem.name}</span>}
                  </Link>
                );
              })}
              {currentUser?.favorited_patients?.map((patient) => (
                <Link
                  key={`fav-patient-${patient.id}`}
                  to={createPageUrl(`PatientDetails?id=${patient.id}`)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  title={sidebarCollapsed ? patient.name : undefined}
                >
                  <Users className="w-5 h-5 flex-shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{patient.name}</span>}
                </Link>
              ))}
              <div className="border-t border-gray-200 my-3" />
            </>
          )}

          {navCategories.map((category, catIndex) => (
            <React.Fragment key={catIndex}>
              {category.category && !sidebarCollapsed && (
                <p className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase mt-3">
                  {category.category}
                </p>
              )}
              {category.items.map((item) => (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.page)
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                  title={sidebarCollapsed ? item.name : undefined}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {!sidebarCollapsed && <span>{item.name}</span>}
                </Link>
              ))}
              {catIndex === 0 && <div className="border-t border-gray-200 my-3" />}
            </React.Fragment>
          ))}

          {isAdmin && (
            <>
              <div className="border-t border-gray-200 my-3" />
              {!sidebarCollapsed && <p className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase">Admin</p>}
              {adminItems.map((item) => (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.page)
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                  title={sidebarCollapsed ? item.name : undefined}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {!sidebarCollapsed && <span>{item.name}</span>}
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* User Section */}
        <div className="border-t border-gray-200 p-3">
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
              {currentUser?.full_name?.charAt(0) || 'U'}
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{currentUser?.full_name || 'User'}</p>
                <p className="text-xs text-gray-500 truncate">{currentUser?.email}</p>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className={`mt-2 text-red-600 hover:text-red-700 hover:bg-red-50 ${sidebarCollapsed ? 'w-full justify-center px-0' : 'w-full justify-start'}`}
          >
            <LogOut className="w-4 h-4" />
            {!sidebarCollapsed && <span className="ml-2">Logout</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-blue-600 shadow-sm border-b border-blue-700 h-16 flex items-center justify-between px-4 print:hidden">
        <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/52cac091f_20170AA9-BB95-4BA4-B4E7-793615312CC4.png" 
            alt="Penn Sync Logo" 
            className="w-8 h-8 rounded-lg"
          />
          <span className="font-bold text-lg text-white">Penn Sync</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-white hover:bg-blue-700 h-12 w-12">
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 flex-shrink-0">
              <span className="font-bold text-lg text-gray-900">Menu</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
              {navCategories.map((category, catIndex) => (
                <React.Fragment key={catIndex}>
                  {category.category && (
                    <p className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase mt-3">
                      {category.category}
                    </p>
                  )}
                  {category.items.map((item) => (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium ${
                        isActive(item.page)
                          ? "bg-blue-100 text-blue-700"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  ))}
                  {catIndex === 0 && <div className="border-t border-gray-200 my-2" />}
                </React.Fragment>
              ))}
              {isAdmin && (
                <>
                  <div className="border-t border-gray-200 my-3" />
                  <p className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase">Admin</p>
                  {adminItems.map((item) => (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium ${
                        isActive(item.page)
                          ? "bg-blue-100 text-blue-700"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  ))}
                </>
              )}
            </nav>
            <div className="flex-shrink-0 border-t border-gray-200 p-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                  {currentUser?.full_name?.charAt(0) || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{currentUser?.full_name}</p>
                  <p className="text-xs text-gray-500 truncate">{currentUser?.email}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="w-full justify-start text-red-600">
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 lg:overflow-auto pt-16 lg:pt-0 bg-blue-100 min-h-screen">{children}</main>

      {/* Offline Indicator */}
      <OfflineIndicator />
    </div>
  );
}