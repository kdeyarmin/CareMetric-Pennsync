import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, ChevronLeft, ChevronRight, Sparkles, Users, LogOut, Search } from "lucide-react";
import FeedbackButton from "@/components/feedback/FeedbackButton";

// Active nav item: light navy tint with a gold left indicator bar.
function navItemClasses(active) {
  return `group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    active
      ? "bg-navy-700 text-white font-semibold"
      : "text-slate-200 hover:bg-navy-700 hover:text-white"
  }`;
}

function GoldIndicator() {
  return <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-gold-400" aria-hidden="true" />;
}

export default function DesktopSidebar({
  collapsed, onToggleCollapse,
  currentUser, isAdmin,
  navCategories, adminItems,
  isActive, onLogout,
}) {
  return (
    <aside className={`hidden md:flex flex-col bg-navy-800 border-r border-navy-900 transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'} print:hidden h-screen sticky top-0 flex-shrink-0`}>
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-3 border-b border-navy-900 flex-shrink-0">
        <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2 min-w-0">
          <img
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png"
            alt="Penn Sync Logo"
            className="w-8 h-8 rounded-lg flex-shrink-0"
          />
          {!collapsed && (
            <span className="font-bold text-base text-white truncate tracking-tight">
              Penn<span className="text-gold-400">Sync</span>
            </span>
          )}
        </Link>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-slate-300 hover:text-white hover:bg-navy-700 flex-shrink-0"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-hide">
        {/* Quick search — opens the command palette (also Ctrl/Cmd+K) */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          className={`flex items-center gap-2 rounded-lg border border-navy-700 bg-navy-900/40 text-slate-300 hover:bg-navy-700 hover:text-white transition-colors mb-2 ${collapsed ? 'justify-center w-10 h-10 mx-auto' : 'w-full px-3 py-2'}`}
          title="Search pages (Ctrl/Cmd+K)"
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          {!collapsed && (
            <>
              <span className="text-sm flex-1 text-left">Search…</span>
              <kbd className="text-[10px] font-mono bg-navy-900 text-slate-300 rounded px-1.5 py-0.5 border border-navy-700">⌘K</kbd>
            </>
          )}
        </button>
        {!collapsed && (
          <div className="flex items-center gap-2 px-3 py-1.5 mb-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <Shield className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
            <span className="text-xs font-semibold text-emerald-700">Secure Session</span>
          </div>
        )}

        {/* Favorites */}
        {currentUser?.favorited_patients?.length > 0 && (
          <>
            {!collapsed && (
              <p className="px-3 py-1 text-xs font-semibold text-gold-600 uppercase flex items-center gap-1 mt-2">
                <Sparkles className="w-3 h-3" /> Favorites
              </p>
            )}
            {currentUser?.favorited_patients?.map((patient) => (
              <Link
                key={`fav-patient-${patient.id}`}
                to={createPageUrl(`PatientDetails?id=${patient.id}`)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-navy-700 hover:text-white"
                title={collapsed ? patient.name : undefined}
              >
                <Users className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">{patient.name}</span>}
              </Link>
            ))}
            <div className="border-t border-navy-700 my-2" />
          </>
        )}

        {navCategories.map((category, catIndex) => (
          <div key={catIndex}>
            {category.category && !collapsed && (
              <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {category.category}
              </p>
            )}
            {category.items.map((item) => {
              const active = isActive(item.page);
              return (
                <Link
                  key={item.page}
                  to={createPageUrl(item.page)}
                  className={navItemClasses(active)}
                  title={collapsed ? item.name : undefined}
                >
                  {active && <GoldIndicator />}
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-gold-400' : ''}`} />
                  {!collapsed && (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate">{item.name}</span>
                      {item.badge > 0 && (
                        <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 ml-auto flex-shrink-0 h-5 min-w-[20px] flex items-center justify-center">
                          {item.badge}
                        </Badge>
                      )}
                    </span>
                  )}
                  {collapsed && item.badge > 0 && (
                    <div className="absolute right-1 top-1 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </Link>
              );
            })}
            {catIndex === 0 && <div className="border-t border-navy-700 my-2" />}
          </div>
        ))}

        {isAdmin && (
          <>
            <div className="border-t border-navy-700 my-2" />
            {adminItems.map((category, catIndex) => (
              <div key={catIndex}>
                {category.category && !collapsed && (
                  <p className="px-3 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {category.category}
                  </p>
                )}
                {category.items.map((item) =>
                  item.action ? (
                    <button
                      key={item.name}
                      onClick={item.action}
                      className={`${navItemClasses(false)} w-full`}
                      title={collapsed ? item.name : undefined}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {!collapsed && (
                        <span className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="truncate">{item.name}</span>
                          {item.badge > 0 && (
                            <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 ml-auto flex-shrink-0 h-5 min-w-[20px] flex items-center justify-center">
                              {item.badge}
                            </Badge>
                          )}
                        </span>
                      )}
                      {collapsed && item.badge > 0 && (
                        <div className="absolute right-1 top-1 w-2 h-2 bg-red-500 rounded-full" />
                      )}
                    </button>
                  ) : (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      className={navItemClasses(isActive(item.page))}
                      title={collapsed ? item.name : undefined}
                    >
                      {isActive(item.page) && <GoldIndicator />}
                      <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive(item.page) ? 'text-gold-400' : ''}`} />
                      {!collapsed && <span className="truncate">{item.name}</span>}
                    </Link>
                  )
                )}
                {catIndex === 0 && <div className="border-t border-navy-700 my-2" />}
              </div>
            ))}
          </>
        )}
      </nav>

      {/* User Footer */}
      <div className="border-t border-navy-700 p-3 flex-shrink-0">
        {!collapsed && <FeedbackButton />}
        <div className={`flex items-center gap-2 mt-2 ${collapsed ? 'justify-center flex-col' : ''}`}>
          <div className="w-8 h-8 bg-gradient-to-br from-navy-500 to-navy-700 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {currentUser?.full_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{currentUser?.full_name || 'User'}</p>
              <p className="text-xs text-slate-400 truncate capitalize">{currentUser?.role || 'user'}</p>
            </div>
          )}
          <Button
            variant="ghost" size="icon"
            onClick={onLogout}
            className="h-8 w-8 text-slate-300 hover:text-red-400 hover:bg-navy-700 flex-shrink-0"
            title="Logout"
            aria-label="Log out"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}