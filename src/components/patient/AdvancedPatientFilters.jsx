import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Filter, X, Calendar } from "lucide-react";

// Fuzzy search: checks if all chars in query appear in order in target
function fuzzyMatch(target, query) {
  if (!query) return true;
  if (!target) return false;
  target = target.toLowerCase();
  query = query.toLowerCase().trim();
  // First try simple substring match (faster and more intuitive)
  if (target.includes(query)) return true;
  // Then fuzzy: every char in query must appear in order
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function patientMatchesSearch(patient, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) return true;
  const q = searchTerm.trim();
  const fullName = `${patient.first_name || ""} ${patient.last_name || ""}`.trim();
  const reverseName = `${patient.last_name || ""} ${patient.first_name || ""}`.trim();
  return (
    fuzzyMatch(fullName, q) ||
    fuzzyMatch(reverseName, q) ||
    fuzzyMatch(patient.first_name, q) ||
    fuzzyMatch(patient.last_name, q) ||
    fuzzyMatch(patient.medical_record_number, q) ||
    fuzzyMatch(patient.phone, q) ||
    fuzzyMatch(patient.primary_diagnosis, q)
  );
}

export default function AdvancedPatientFilters({ onFilterChange, activeFilters = {} }) {
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef(null);
  const [filters, setFilters] = useState({
    search: activeFilters.search || "",
    status: activeFilters.status || "all",
    diagnosis: activeFilters.diagnosis || "",
    ageMin: activeFilters.ageMin || "",
    ageMax: activeFilters.ageMax || "",
    hasVisits: activeFilters.hasVisits || "all",
    hasCarePlans: activeFilters.hasCarePlans || "all",
    createdAfter: activeFilters.createdAfter || "",
    createdBefore: activeFilters.createdBefore || "",
  });

  const handleFilterChange = (key, value) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const clearFilters = () => {
    const emptyFilters = {
      search: "",
      status: "all",
      diagnosis: "",
      ageMin: "",
      ageMax: "",
      hasVisits: "all",
      hasCarePlans: "all",
      createdAfter: "",
      createdBefore: "",
    };
    setFilters(emptyFilters);
    onFilterChange(emptyFilters);
  };

  const activeFilterCount = Object.values(filters).filter(
    (val) => val && val !== "all" && val !== ""
  ).length;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              ref={searchRef}
              placeholder="Search name, MRN, phone, diagnosis…"
              value={filters.search}
              onChange={(e) => handleFilterChange("search", e.target.value)}
              className="pl-10 h-11 sm:h-10 text-base sm:text-sm"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {filters.search && (
              <button
                onClick={() => handleFilterChange("search", "")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Filter className="w-4 h-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge className="ml-1 bg-blue-600">{activeFilterCount}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96" align="end">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Advanced Filters</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearFilters}
                    className="text-xs"
                  >
                    Clear All
                  </Button>
                </div>

                <div>
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={filters.status}
                    onValueChange={(val) => handleFilterChange("status", val)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="discharged">Discharged</SelectItem>
                      <SelectItem value="hospitalized">Hospitalized</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Diagnosis Contains</Label>
                  <Input
                    placeholder="e.g., diabetes, CHF..."
                    value={filters.diagnosis}
                    onChange={(e) => handleFilterChange("diagnosis", e.target.value)}
                    className="text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Age Min</Label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={filters.ageMin}
                      onChange={(e) => handleFilterChange("ageMin", e.target.value)}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Age Max</Label>
                    <Input
                      type="number"
                      placeholder="120"
                      value={filters.ageMax}
                      onChange={(e) => handleFilterChange("ageMax", e.target.value)}
                      className="text-sm"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Has Recent Visits</Label>
                  <Select
                    value={filters.hasVisits}
                    onValueChange={(val) => handleFilterChange("hasVisits", val)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Patients</SelectItem>
                      <SelectItem value="yes">With Visits</SelectItem>
                      <SelectItem value="no">No Visits</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Has Care Plans</Label>
                  <Select
                    value={filters.hasCarePlans}
                    onValueChange={(val) => handleFilterChange("hasCarePlans", val)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Patients</SelectItem>
                      <SelectItem value="yes">With Care Plans</SelectItem>
                      <SelectItem value="no">No Care Plans</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border-t pt-3">
                  <Label className="text-xs flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Created Date Range
                  </Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Input
                      type="date"
                      placeholder="From"
                      value={filters.createdAfter}
                      onChange={(e) => handleFilterChange("createdAfter", e.target.value)}
                      className="text-xs"
                    />
                    <Input
                      type="date"
                      placeholder="To"
                      value={filters.createdBefore}
                      onChange={(e) => handleFilterChange("createdBefore", e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {activeFilterCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearFilters}
              className="gap-1"
            >
              <X className="w-4 h-4" />
              Clear
            </Button>
          )}
        </div>

        {/* Active filter badges */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {filters.status !== "all" && (
              <Badge variant="outline" className="gap-1">
                Status: {filters.status}
                <X
                  className="w-3 h-3 cursor-pointer"
                  onClick={() => handleFilterChange("status", "all")}
                />
              </Badge>
            )}
            {filters.diagnosis && (
              <Badge variant="outline" className="gap-1">
                Diagnosis: {filters.diagnosis}
                <X
                  className="w-3 h-3 cursor-pointer"
                  onClick={() => handleFilterChange("diagnosis", "")}
                />
              </Badge>
            )}
            {filters.ageMin && (
              <Badge variant="outline" className="gap-1">
                Age Min: {filters.ageMin}
                <X
                  className="w-3 h-3 cursor-pointer"
                  onClick={() => handleFilterChange("ageMin", "")}
                />
              </Badge>
            )}
            {filters.ageMax && (
              <Badge variant="outline" className="gap-1">
                Age Max: {filters.ageMax}
                <X
                  className="w-3 h-3 cursor-pointer"
                  onClick={() => handleFilterChange("ageMax", "")}
                />
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}