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
import {
  ChevronLeft,
  ChevronRight,
  Search
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getPatientDisplayName, getPatientInitials } from "@/components/patient/patientDisplay";

export default function PaginatedPatientList({ 
  patients = [], 
  onPatientSelect,
  showCheckboxes = false,
  selectedPatients = [],
  onSelectionChange,
  showSearch = true
}) {
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [sortBy, setSortBy] = useState("name");

  // Filter and sort patients
  const filteredAndSortedPatients = useMemo(() => {
    let filtered = patients.filter(p => {
      const searchLower = search.toLowerCase();
      const fullName = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
      const mrn = p.medical_record_number?.toLowerCase() || '';
      return fullName.includes(searchLower) || mrn.includes(searchLower);
    });

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'name') {
        return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      } else if (sortBy === 'status') {
        return (a.status || '').localeCompare(b.status || '');
      } else if (sortBy === 'created') {
        return (new Date(b.created_date).getTime() || 0) - (new Date(a.created_date).getTime() || 0);
      }
      return 0;
    });

    return filtered;
  }, [patients, search, sortBy]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedPatients.length / itemsPerPage);

  // Clamp the current page when the result set shrinks (filtering, deletion, or a
  // smaller page size). Without this, being on e.g. page 5 and narrowing results
  // to 1 page leaves startIndex past the end → an empty list with the pagination
  // controls hidden, stranding the user with no visible rows.
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const safePage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;
  const startIndex = (safePage - 1) * itemsPerPage;
  const paginatedPatients = filteredAndSortedPatients.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (newPage) => {
    setCurrentPage(Math.max(1, Math.min(newPage, totalPages)));
  };

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
          <Select value={String(itemsPerPage)} onValueChange={(v) => {
            setItemsPerPage(Number(v));
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
          {filteredAndSortedPatients.length === 0
            ? 'No patients'
            : `Showing ${startIndex + 1}-${Math.min(startIndex + itemsPerPage, filteredAndSortedPatients.length)} of ${filteredAndSortedPatients.length} patients`}
        </span>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            Clear search
          </Button>
        )}
      </div>

      {/* Patient Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {paginatedPatients.map((patient) => (
          <Card key={patient.id} className="hover:shadow-lg transition-shadow">
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

              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                <Badge variant="outline" className={getStatusColor(patient.status)}>
                  {patient.status || 'active'}
                </Badge>
                {patient.primary_diagnosis && (
                  <Badge variant="outline" className="text-xs max-w-[180px] truncate">
                    {patient.primary_diagnosis}
                  </Badge>
                )}
              </div>

              <div className="mt-4 flex justify-center gap-2 w-full">
                <Link to={createPageUrl("PatientDetails") + `?id=${patient.id}`}>
                  <Button size="sm" variant="outline" className="text-xs">
                    View Details
                  </Button>
                </Link>
                {onPatientSelect && (
                  <Button
                    size="sm"
                    onClick={() => onPatientSelect(patient.id)}
                    className="text-xs"
                  >
                    Select
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(safePage - 1)}
            disabled={safePage === 1}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Previous
          </Button>
          
          <div className="flex items-center gap-2">
            {[...Array(Math.min(5, totalPages))].map((_, idx) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = idx + 1;
              } else if (safePage <= 3) {
                pageNum = idx + 1;
              } else if (safePage >= totalPages - 2) {
                pageNum = totalPages - 4 + idx;
              } else {
                pageNum = safePage - 2 + idx;
              }
              
              return (
                <Button
                  key={pageNum}
                  variant={safePage === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePageChange(pageNum)}
                  className="w-8 h-8 p-0"
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(safePage + 1)}
            disabled={safePage === totalPages}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}