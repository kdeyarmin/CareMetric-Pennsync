import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Shield, Bell, Menu, X, ChevronLeft, Search } from "lucide-react";

const BACK_PAGES = ['PatientDetails', 'DocumentHub', 'ReferralIntake', 'TrainingCoursePlayer', 'EventReport'];

export default function MobileHeader({ currentPageName, totalNotificationCount, mobileMenuOpen, onToggleMobileMenu, onOpenNotificationCenter }) {
  return (
    <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white shadow-sm border-b border-slate-200 print:hidden safe-top">
      <div className="h-16 flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        {BACK_PAGES.includes(currentPageName) && (
          <Button variant="ghost" size="icon" className="text-slate-500 hover:text-navy-700 hover:bg-slate-100 h-10 w-10 mr-1" onClick={() => window.history.back()} aria-label="Go back">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        )}
        <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
          <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png" alt="Penn Sync Logo" className="w-8 h-8 rounded-lg" />
          <span className="font-bold text-base text-navy-900 tracking-tight">Penn<span className="text-gold-600">Sync</span></span>
        </Link>
        <div className="hidden sm:flex items-center gap-1 text-emerald-600 text-xs font-medium ml-2">
          <Shield className="w-3 h-3" /> Secure
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="text-slate-500 hover:text-navy-700 hover:bg-slate-100 h-10 w-10" onClick={() => window.dispatchEvent(new Event('open-command-palette'))} title="Search pages">
          <Search className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="relative text-slate-500 hover:text-navy-700 hover:bg-slate-100 h-10 w-10" onClick={onOpenNotificationCenter} aria-label="Notifications">
          <Bell className="w-5 h-5" />
          {totalNotificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[9px] rounded-full px-1 py-0.5 min-w-[16px] text-center font-bold leading-none">{totalNotificationCount}</span>
          )}
        </Button>
        <Button variant="ghost" size="icon" onClick={onToggleMobileMenu} className="text-slate-500 hover:text-navy-700 hover:bg-slate-100 h-10 w-10" aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileMenuOpen}>
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>
      </div>
    </div>
  );
}
