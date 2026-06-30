import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Home, Users, Brain, Send, Mail, FileText, Pen } from "lucide-react";

// Role-aware bottom bar: every employee keeps Home / Patients / Messages, but
// the two middle slots match the role's real top tasks. Nurses chart and fax;
// facility/super admins work referrals and documents. Driven by the same role
// split as the sidebar (Layout passes isAdmin) so the mobile shortcuts never
// surface a back-office task to a nurse or hide one from an admin.
const NURSE_NAV_ITEMS = [
  { page: "Dashboard",          Icon: Home,     label: "Home" },
  { page: "Patients",           Icon: Users,    label: "Patients" },
  { page: "SmartNoteAssistant", Icon: Brain,    label: "Notes" },
  { page: "SendFax",            Icon: Send,     label: "Fax" },
  { page: "Messages",           Icon: Mail,     label: "Messages", hasBadge: true },
];

const ADMIN_NAV_ITEMS = [
  { page: "Dashboard",      Icon: Home,     label: "Home" },
  { page: "Patients",       Icon: Users,    label: "Patients" },
  { page: "ReferralIntake", Icon: FileText, label: "Referrals" },
  { page: "DocumentHub",    Icon: Pen,      label: "Documents" },
  { page: "Messages",       Icon: Mail,     label: "Messages", hasBadge: true },
];

export default function MobileBottomNav({ isActive, unreadMessageCount, isAdmin = false }) {
  const items = isAdmin ? ADMIN_NAV_ITEMS : NURSE_NAV_ITEMS;
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] print:hidden safe-bottom">
      <div className="grid grid-cols-5 h-16">
        {items.map(({ page, Icon, label, hasBadge }) => {
          const badge = hasBadge ? unreadMessageCount : 0;
          const active = isActive(page);
          return (
            <Link key={page} to={createPageUrl(page)}
              className={`flex flex-col items-center justify-center gap-0.5 relative transition-colors active:scale-95 ${
                active ? "text-navy-700" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {active && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gold-400 rounded-full" />}
              <div className={`relative p-1.5 rounded-xl ${
                active ? 'bg-navy-50' : ''
              }`}>
                <Icon className="w-5 h-5" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5 font-bold">{badge}</span>
                )}
              </div>
              <span className={`text-[10px] font-medium leading-tight ${
                active ? 'text-navy-700 font-semibold' : ''
              }`}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
