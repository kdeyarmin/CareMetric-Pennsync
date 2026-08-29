import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { getPatientDisplayName, getPatientInitials, getPatientDisplayParts } from "@/components/patient/patientDisplay";
import { clampPageSize, paginateRows } from "@/lib/pagination";
import ListPaginationControls from "@/components/ui/ListPaginationControls";

// Sort on the normalized name the rows render (getPatientDisplayName), not the
// raw fields: `${first_name} ${last_name}` put the literal "undefined" in the key
// for a chart missing either half, so it sorted under "u" instead of with its
// neighbours — and the visible order disagreed with the visible names.
const nameSortKey = (patient) => {
  const { first, last } = getPatientDisplayParts(patient);
  return `${first} ${last}`.trim().toLowerCase();
};

export default function PaginatedPatientList({ 
  patients = [], 
  onPatientSelect,
  showCheckboxes = false,
  selectedPatients = [],
  onSelectionChange,
  showSearch = true,
  // When the caller owns ordering (it has its own sort control), this list must
  // NOT re-sort: it used to always apply its own "name" sort to the prop, which
  // silently discarded the caller's order — a page-level "Newest"/"Most visits"
  // choice was reordered back to name and the control looked dead.
  sortable = true
}) {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [sortBy, setSortBy] = useState("name");

  // Filter and sort patients (search/sort stay local; page window uses pure helper).
  const filteredAndSortedPatients = useMemo(() => {
    let filtered = patients.filter(p => {
      const searchLower = search.toLowerCase();
      const fullName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
      const mrn = p.medical_record_number?.toLowerCase() || '';
      return fullName.includes(searchLower) || mrn.includes(searchLower);
    });

    if (sortable) {
      filtered.sort((a, b) => {
        if (sortBy === 'name') {
          return nameSortKey(a).localeCompare(nameSortKey(b));
        } else if (sortBy === 'status') {
          return (a.status || '').localeCompare(b.status || '');
        } else if (sortBy === 'created') {
          return (new Date(b.created_date).getTime() || 0) - (new Date(a.created_date).getTime() || 0);
        }
        return 0;
      });
    }

    return filtered;
  }, [patients, search, sortBy, sortable]);

  const pageSize = clampPageSize(itemsPerPage, { max: 100, fallback: 20 });

  const pageWindow = useMemo(
    () => paginateRows(filteredAndSortedPatients, { page: currentPage, pageSize, maxPageSize: 100 }),
    [filteredAndSortedPatients, currentPage, pageSize],
  );

  // Keep page in range when filters shrink the result set (same contract as paginateRows).
  useEffect(() => {
    if (currentPage !== pageWindow.page) {
      setCurrentPage(pageWindow.page);
    }
  }, [currentPage, pageWindow.page]);

  const paginatedPatients = pageWindow.items;

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'discharged': return 'bg-slate-100 text-slate-800';
      case 'hospitalized': return 'bg-red-100 text-red-800';
      default: return 'bg-blue-100 text-blue-800';
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Controls */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        {showSearch ? (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search patients by name or MRN..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
            />
          </div>
        ) : <div className="flex-1" />}
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          {sortable && (
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name (A-Z)</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="created">Recently Added</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={String(pageSize)} onValueChange={(v) => {
            setItemsPerPage(clampPageSize(v, { max: 100, fallback: 20 }));
            setCurrentPage(1);
          }}>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 per page</SelectItem>
              <SelectItem value="20">20 per page</SelectItem>
              <SelectItem value="50">50 per page</SelectItem>
              <SelectItem value="100">100 per page</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          {pageWindow.totalItems === 0
            ? 'No patients'
            : `Showing ${pageWindow.startIndex + 1}-${pageWindow.endIndex + 1} of ${pageWindow.totalItems} patients`}
        </span>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            Clear search
          </Button>
        )}
      </div>

      {/* Patient Cards */}
      <div className="flex flex-wrap justify-center gap-4">
        {paginatedPatients.map((patient) => (
          <Card key={patient.id} className="w-full md:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.75rem)] hover:shadow-lg transition-shadow">
            <CardContent className="relative p-5 flex flex-col items-center text-center">
              {showCheckboxes && (
                <input
                  type="checkbox"
                  checked={selectedPatients.includes(patient.id)}
                  onChange={(e) => {
                    const newSelection = e.target.checked
                      ? [...selectedPatients, patient.id]
                      : selectedPatients.filter(id => id !== patient.id);
                    onSelectionChange?.(newSelection);
                  }}
                  className="absolute top-3 right-3 h-4 w-4"
                />
              )}

              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                {getPatientInitials(patient)}
              </div>

              <h3 className="mt-3 font-semibold text-slate-900 truncate max-w-full">
                {getPatientDisplayName(patient)}
              </h3>
              {patient.medical_record_number && (
                <p className="mt-0.5 text-xs text-slate-500">MRN: {patient.medical_record_number}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                <Badge variant="outline" className={getStatusColor(patient.status)}>
                  {patient.status || 'active'}
                </Badge>
                {patient.primary_diagnosis && (
                  <Badge variant="outline" className="text-xs max-w-[180px] truncate">
                    {patient.primary_diagnosis}
                  </Badge>
                )}
              </div>

              <div className="mt-4 flex items-center justify-center gap-2 w-full">
                <Link to={createPageUrl("PatientDetails") + `?id=${patient.id}`}>
                  <Button size="sm" variant="outline" className="text-xs h-9">
                    View Details
                  </Button>
                </Link>
                {onPatientSelect && (
                  <Button
                    size="sm"
                    onClick={() => onPatientSelect(patient.id)}
                    className="text-xs h-9"
                  >
                    Select
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ListPaginationControls
        page={pageWindow.page}
        totalPages={pageWindow.totalPages}
        totalItems={pageWindow.totalItems}
        startIndex={pageWindow.startIndex}
        endIndex={pageWindow.endIndex}
        hasPreviousPage={pageWindow.hasPreviousPage}
        hasNextPage={pageWindow.hasNextPage}
        onPageChange={setCurrentPage}
        itemLabel="patients"
      />
    </div>
  );
}
