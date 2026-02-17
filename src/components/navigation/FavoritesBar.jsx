import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Star, Users, FileText } from "lucide-react";
import { toast } from "sonner";

export default function FavoritesBar({ userEmail }) {
  const queryClient = useQueryClient();

  const { data: favorites = [] } = useQuery({
    queryKey: ["userFavorites", userEmail],
    queryFn: () => base44.entities.UserFavorite.filter({ user_email: userEmail }, "display_name", 20),
    enabled: !!userEmail,
  });

  if (favorites.length === 0) return null;

  return (
    <div className="px-4 pb-2">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
        <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> Favorites
      </p>
      <div className="space-y-0.5">
        {favorites.map((fav) => {
          const href = fav.item_type === "patient"
            ? createPageUrl("PatientDetails") + `?id=${fav.item_id}`
            : createPageUrl(fav.item_id);
          const Icon = fav.item_type === "patient" ? Users : FileText;
          return (
            <Link key={fav.id} to={href} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-slate-600 hover:bg-slate-100 hover:text-blue-600 transition-colors">
              <Icon className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{fav.display_name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export async function toggleFavorite(userEmail, itemType, itemId, displayName) {
  const existing = await base44.entities.UserFavorite.filter({ user_email: userEmail, item_type: itemType, item_id: itemId });
  if (existing.length > 0) {
    await base44.entities.UserFavorite.delete(existing[0].id);
    toast.success("Removed from favorites");
    return false;
  } else {
    await base44.entities.UserFavorite.create({ user_email: userEmail, item_type: itemType, item_id: itemId, display_name: displayName });
    toast.success("Added to favorites");
    return true;
  }
}