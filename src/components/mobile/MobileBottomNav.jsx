import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Home, Users, FileText, ListTodo, User } from "lucide-react";

export default function MobileBottomNav({ currentPage }) {
  const navItems = [
    { page: "Dashboard", icon: Home, label: "Home" },
    { page: "Patients", icon: Users, label: "Patients" },
    { page: "SmartNoteAssistant", icon: FileText, label: "Notes" },
    { page: "Tasks", icon: ListTodo, label: "Tasks" },
    { page: "Settings", icon: User, label: "Profile" }
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-200 dark:border-slate-700 z-[9998] safe-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;
          
          return (
            <Link
              key={item.page}
              to={createPageUrl(item.page)}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-all touch-target ${
                isActive 
                  ? "text-blue-600 dark:text-blue-400" 
                  : "text-slate-600 dark:text-slate-400 active:text-blue-500"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "scale-110" : ""}`} />
              <span className={`text-xs font-medium ${isActive ? "font-semibold" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}