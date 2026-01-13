import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Star, Plus, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function SavedFiltersManager({ currentUser, onFilterSelect, currentFilters }) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [filterDescription, setFilterDescription] = useState("");
  const queryClient = useQueryClient();

  const { data: savedFilters = [], isLoading } = useQuery({
    queryKey: ["savedPatientFilters", currentUser?.email],
    queryFn: () =>
      base44.entities.SavedPatientFilter.filter({
        user_email: currentUser?.email,
      }, '-last_used'),
    enabled: !!currentUser?.email,
  });

  const saveFilterMutation = useMutation({
    mutationFn: (filterData) =>
      base44.entities.SavedPatientFilter.create(filterData),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["savedPatientFilters", currentUser?.email],
      });
      setShowSaveDialog(false);
      setFilterName("");
      setFilterDescription("");
      toast.success("Filter saved successfully");
    },
    onError: () => {
      toast.error("Failed to save filter");
    },
  });

  const deleteFilterMutation = useMutation({
    mutationFn: (filterId) =>
      base44.entities.SavedPatientFilter.delete(filterId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["savedPatientFilters", currentUser?.email],
      });
      toast.success("Filter deleted");
    },
    onError: () => {
      toast.error("Failed to delete filter");
    },
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ filterId, isFavorite }) =>
      base44.entities.SavedPatientFilter.update(filterId, {
        is_favorite: !isFavorite,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["savedPatientFilters", currentUser?.email],
      });
    },
  });

  const updateUsageMutation = useMutation({
    mutationFn: (filterId) =>
      base44.entities.SavedPatientFilter.update(filterId, {
        last_used: new Date().toISOString(),
        usage_count: (savedFilters.find((f) => f.id === filterId)?.usage_count || 0) + 1,
      }),
  });

  const handleSaveFilter = () => {
    if (!filterName.trim()) {
      toast.error("Please enter a filter name");
      return;
    }

    saveFilterMutation.mutate({
      user_email: currentUser?.email,
      filter_name: filterName,
      description: filterDescription,
      filter_criteria: currentFilters,
      is_favorite: false,
      usage_count: 0,
    });
  };

  const handleApplyFilter = (filter) => {
    updateUsageMutation.mutate(filter.id);
    onFilterSelect(filter.filter_criteria);
    toast.success(`Applied filter: ${filter.filter_name}`);
  };

  const favorites = savedFilters.filter((f) => f.is_favorite);
  const recent = savedFilters.filter((f) => !f.is_favorite).slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Saved Filters</h3>
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1">
              <Plus className="w-3 h-3" />
              Save Current
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Filter View</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Filter Name</label>
                <Input
                  placeholder="e.g., Active CHF Patients"
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Input
                  placeholder="What does this filter show?"
                  value={filterDescription}
                  onChange={(e) => setFilterDescription(e.target.value)}
                  className="mt-1"
                />
              </div>
              <Button onClick={handleSaveFilter} className="w-full">
                Save Filter
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-xs text-gray-500">Loading filters...</div>
      ) : savedFilters.length === 0 ? (
        <div className="text-xs text-gray-500">No saved filters yet</div>
      ) : (
        <div className="space-y-2">
          {/* Favorites */}
          {favorites.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600">Favorites</p>
              {favorites.map((filter) => (
                <div
                  key={filter.id}
                  className="flex items-center justify-between p-2 bg-yellow-50 border border-yellow-200 rounded-md hover:bg-yellow-100 transition-colors"
                >
                  <button
                    onClick={() => handleApplyFilter(filter)}
                    className="text-xs font-medium text-gray-700 flex-1 text-left"
                  >
                    {filter.filter_name}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        toggleFavoriteMutation.mutate({
                          filterId: filter.id,
                          isFavorite: filter.is_favorite,
                        })
                      }
                      className="p-1 hover:bg-yellow-200 rounded"
                    >
                      <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
                    </button>
                    <button
                      onClick={() => deleteFilterMutation.mutate(filter.id)}
                      className="p-1 hover:bg-red-100 text-red-600 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent */}
          {recent.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-600">Recent</p>
              {recent.map((filter) => (
                <div
                  key={filter.id}
                  className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors"
                >
                  <button
                    onClick={() => handleApplyFilter(filter)}
                    className="text-xs text-gray-700 flex-1 text-left"
                  >
                    {filter.filter_name}
                    {filter.last_used && (
                      <span className="ml-2 text-gray-500 flex items-center gap-1">
                        <Clock className="w-2 h-2" />
                        {format(new Date(filter.last_used), "MMM d")}
                      </span>
                    )}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        toggleFavoriteMutation.mutate({
                          filterId: filter.id,
                          isFavorite: filter.is_favorite,
                        })
                      }
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <Star className="w-3 h-3 text-gray-400" />
                    </button>
                    <button
                      onClick={() => deleteFilterMutation.mutate(filter.id)}
                      className="p-1 hover:bg-red-100 text-red-600 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}