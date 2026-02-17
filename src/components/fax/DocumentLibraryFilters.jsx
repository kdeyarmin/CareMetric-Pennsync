import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X, SlidersHorizontal } from "lucide-react";

const CATEGORY_OPTIONS = [
  "Lab Results", "Referral", "Discharge Summary", "Progress Note",
  "Medical Records", "Prescription", "Insurance", "Consent Form",
  "Imaging Report", "Operative Report"
];

export default function DocumentLibraryFilters({ filters, onFiltersChange, availableTags }) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const updateFilter = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({ search: "", category: "", tag: "", dateRange: "" });
  };

  const hasActiveFilters = filters.category || filters.tag || filters.dateRange;

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={filters.search}
            onChange={e => updateFilter("search", e.target.value)}
            placeholder="Search by patient, provider, MRN, diagnosis, tags..."
            className="pl-9 h-10 text-sm"
          />
          {filters.search && (
            <button
              onClick={() => updateFilter("search", "")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />
            </button>
          )}
        </div>
        <Button
          variant={showAdvanced ? "default" : "outline"}
          size="icon"
          className="h-10 w-10 flex-shrink-0"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
      </div>

      {/* Advanced filters */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-2 items-end p-3 bg-slate-50 rounded-lg border border-slate-200">
          <div className="w-40">
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Category</label>
            <Select value={filters.category || "all"} onValueChange={v => updateFilter("category", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Categories</SelectItem>
                {CATEGORY_OPTIONS.map(c => (
                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40">
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Tag</label>
            <Select value={filters.tag || "all"} onValueChange={v => updateFilter("tag", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Tags</SelectItem>
                {(availableTags || []).map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40">
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Date Range</label>
            <Select value={filters.dateRange || "all"} onValueChange={v => updateFilter("dateRange", v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All time" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Time</SelectItem>
                <SelectItem value="7" className="text-xs">Last 7 days</SelectItem>
                <SelectItem value="30" className="text-xs">Last 30 days</SelectItem>
                <SelectItem value="90" className="text-xs">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500" onClick={clearFilters}>
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* Active filter badges */}
      {hasActiveFilters && !showAdvanced && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-slate-400">Filters:</span>
          {filters.category && (
            <Badge className="text-[10px] px-2 py-0.5 bg-purple-100 text-purple-700 gap-1 cursor-pointer" onClick={() => updateFilter("category", "")}>
              {filters.category} <X className="w-2.5 h-2.5" />
            </Badge>
          )}
          {filters.tag && (
            <Badge className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 gap-1 cursor-pointer" onClick={() => updateFilter("tag", "")}>
              {filters.tag} <X className="w-2.5 h-2.5" />
            </Badge>
          )}
          {filters.dateRange && (
            <Badge className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 gap-1 cursor-pointer" onClick={() => updateFilter("dateRange", "")}>
              Last {filters.dateRange}d <X className="w-2.5 h-2.5" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}