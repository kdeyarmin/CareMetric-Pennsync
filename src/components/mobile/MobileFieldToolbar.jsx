import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "../../utils";
import { Home, Users, FileText, Mic, CheckCircle, WifiOff, Cloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const NAV_ITEMS = [
  { icon: Home, label: "Home", page: "Dashboard" },
  { icon: Users, label: "Patients", page: "Patients" },
  { icon: FileText, label: "Note", page: "SmartNoteAssistant" },
  { icon: Mic, label: "Scribe", page: "MedicalScribe" },
  { icon: CheckCircle, label: "Tasks", page: "Tasks" },
];

export default function MobileFieldToolbar() {
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (!isMobile) return null;

  const currentPath = location.pathname.split("/").filter(Boolean)[0] || "dashboard";

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 safe-bottom shadow-[0_-2px_10px_rgba(0,0,0,0.08)]">
      {/* Offline indicator strip */}
      {!isOnline && (
        <div className="bg-orange-500 text-white text-[10px] font-medium text-center py-0.5 flex items-center justify-center gap-1">
          <WifiOff className="w-3 h-3" /> Offline — changes saved locally
        </div>
      )}

      <div className="flex items-center justify-around px-1 py-1.5">
        {NAV_ITEMS.map((item) => {
          const pageLower = item.page.toLowerCase();
          const isActive = currentPath.toLowerCase() === pageLower || 
                          currentPath.toLowerCase().includes(pageLower);
          return (
            <Link
              key={item.page}
              to={createPageUrl(item.page)}
              className={`flex flex-col items-center justify-center w-14 py-1 rounded-lg transition-all active:scale-90 ${
                isActive
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "stroke-[2.5px]" : ""}`} />
              <span className="text-[9px] mt-0.5 font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}