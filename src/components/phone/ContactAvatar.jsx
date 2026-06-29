import { User } from "lucide-react";
import { cn } from "@/lib/utils";

// A small, deterministic palette so the same contact always gets the same color
// (like the tinted initial bubbles in a real phone's Contacts / Messages app).
const COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-navy-500",
  "bg-red-500",
  "bg-amber-500",
  "bg-navy-600",
  "bg-indigo-500",
  "bg-gold-500",
  "bg-navy-500",
  "bg-orange-500",
];

function colorFor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initialsFrom(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-lg",
};

/**
 * ContactAvatar — the tinted, initialed circle a real phone shows next to each
 * conversation/call. Falls back to a person icon when we only know a number.
 */
export default function ContactAvatar({ name, number, size = "md", className }) {
  const seed = (name || number || "?").toString();
  const initials = initialsFrom(name);
  return (
    <div
      className={cn(
        "flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm",
        SIZES[size] || SIZES.md,
        colorFor(seed),
        className
      )}
      aria-hidden="true"
    >
      {initials || <User className="h-1/2 w-1/2" />}
    </div>
  );
}
