import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function PatientSearchBar({ searchQuery, onSearchChange, filters, onFiltersChange, resultCount }) {
  const hasActiveFilters = filters.status !== "all" || filters.careType !== "all" || filters.diagnosis || filters.dateRange !== "all";

  const clearFilters = () => {
    onFiltersChange({
      status: "all",
      careType: "all",
      diagnosis: "",
      dateRange: "all"
    });
    onSearchChange("");
  };

  return (
    <div className="space-y-4">
      {/* Main Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
        <Input
          placeholder="Search by name, MRN, phone, or diagnosis..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-11 pr-4 h-12 md:h-14 text-base"
        />
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs mb-2 block">Status</Label>
          <Select value={filters.status} onValueChange={(value) => onFiltersChange({ ...filters, status: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="discharged">Discharged</SelectItem>
              <SelectItem value="hospitalized">Hospitalized</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs mb-2 block">Care Type</Label>
          <Select value={filters.careType} onValueChange={(value) => onFiltersChange({ ...filters, careType: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="home_health">Home Health</SelectItem>
              <SelectItem value="hospice">Hospice</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs mb-2 block">Diagnosis</Label>
          <Input
            placeholder="Filter by diagnosis..."
            value={filters.diagnosis}
            onChange={(e) => onFiltersChange({ ...filters, diagnosis: e.target.value })}
          />
        </div>

        <div>
          <Label className="text-xs mb-2 block">Admission Date</Label>
          <Select value={filters.dateRange} onValueChange={(value) => onFiltersChange({ ...filters, dateRange: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last Month</SelectItem>
              <SelectItem value="3months">Last 3 Months</SelectItem>
              <SelectItem value="6months">Last 6 Months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-blue-50 text-blue-700">
            {resultCount} result{resultCount !== 1 ? 's' : ''}
          </Badge>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 text-xs"
            >
              <X className="w-3 h-3 mr-1" />
              Clear Filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}