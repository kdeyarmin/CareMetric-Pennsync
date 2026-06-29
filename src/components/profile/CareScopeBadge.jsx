import { Home, Heart, Users } from "lucide-react";

const CONFIG = {
  home_health: {
    label: "Home Health",
    icon: Home,
    className: "bg-blue-100 text-blue-800 border border-blue-200",
  },
  hospice: {
    label: "Hospice",
    icon: Heart,
    className: "bg-navy-100 text-navy-800 border border-navy-200",
  },
  both: {
    label: "Home Health & Hospice",
    icon: Users,
    className: "bg-indigo-100 text-indigo-800 border border-indigo-200",
  },
};

export default function CareScopeBadge({ careScope, className = "" }) {
  if (!careScope) return null;
  const cfg = CONFIG[careScope];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className} ${className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}