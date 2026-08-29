import { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients, excludeArchived } from "@/hooks/useScopedPatients";
import { calculateAge, parseLocalDate, toLocalISODate } from "@/lib/dateLocal";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, User, ArrowUpDown, Users, UserCheck, CalendarPlus } from "lucide-react";
import { secureDelete, handleSecureError } from "../components/utils/security";

import PatientForm from "../components/patient/PatientForm";
import { getPatientDisplayParts } from "../components/patient/patientDisplay";
import { patientMatchesSearch } from "../components/patient/AdvancedPatientFilters";
import AdvancedPatientFilters from "../components/patient/AdvancedPatientFilters";
import BulkPatientActions from "../components/patient/BulkPatientActions";
import PatientMergeDialog from "../components/patient/PatientMergeDialog";
import PaginatedPatientList from "../components/patient/PaginatedPatientList";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import StatCard from "@/components/ui/stat-card";
import EmptyState from "@/components/ui/empty-state";
import VirtualList from "@/components/ui/VirtualList";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import PatientCardSkeleton from "../components/loading/PatientCardSkeleton";
import SwipeablePatientCard from "../components/mobile/SwipeablePatientCard";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Sort on the SAME name the roster renders. Interpolating the raw fields put the
// literal string "undefined" in the key whenever one was missing (so a
// partially-entered chart sorted under "u"), and it ignored the comma-form and
// payer-noise normalization getPatientDisplayParts applies to the visible name —
// so the order could disagree with what the user was reading. Module scope keeps
// it out of the roster memo's dependency list.
const patientSortKey = (patient) => {
  const { first, last } = getPatientDisplayParts(patient);
  return `${last} ${first}`.trim().toLowerCase();
};

export default function Patients() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({});
  const [editingPatient, setEditingPatient] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedPatients, setSelectedPatients] = useState([]);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [patientsToMerge, setPatientsToMerge] = useState({ patient1: null, patient2: null });
  const [sortBy, setSortBy] = useState('newest');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef(null);

  // Debounce search input by 300ms to avoid filtering on every keystroke
  useEffect(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(filters.search || '');
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [filters.search]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Log page visit
  useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'Patients',
        page_title: 'Patient Management'
      });
    }
  }, [currentUser?.email]);

  const { data: patients, isLoading, error: patientsError } = useScopedPatients({
    sort: '-created_date',
    limit: 2000,
    select: excludeArchived,
  });

  const { data: allVisits = [] } = useAgencyScopedQuery({
    queryKey: ['allVisits'],
    fetch: () => base44.entities.Visit.list('-visit_date', 5000),
    initialData: [],
    staleTime: 300000,
  });

  // Handle query errors gracefully
  if (patientsError) {
    console.error('Error loading patients:', patientsError);
  }

  const deletePatientMutation = useMutation({
    mutationFn: async (patientId) => {
      await secureDelete(base44.entities.Patient, patientId, 'Patient');
    },
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setDeleteDialogOpen(false);
      setPatientToDelete(null);
      setIsDeleting(false);
      
      // Log patient deletion
      logActivity(ActivityActions.DELETE, {
        entity_type: 'Patient',
        entity_id: deletedId,
        page: 'Patients'
      });
    },
    onError: async (error) => {
      setIsDeleting(false);
      await handleSecureError(error, 'patient_delete', (msg) => toast.error(msg));
    }
  });

  const handleDeletePatient = () => {
    if (!patientToDelete) return;
    setIsDeleting(true);
    deletePatientMutation.mutate(patientToDelete.id);
  };

  const lastVisitDateByPatientId = useMemo(() => {
    const map = {};
    for (const v of allVisits) {
      const existing = map[v.patient_id];
      if (!existing || new Date(v.visit_date) > new Date(existing)) {
        map[v.patient_id] = v.visit_date;
      }
    }
    return map;
  }, [allVisits]);

  const visitCountByPatientId = useMemo(() => {
    const map = {};
    for (const v of allVisits) {
      map[v.patient_id] = (map[v.patient_id] || 0) + 1;
    }
    return map;
  }, [allVisits]);

  // Roster summary stats — memoized so the StatCards don't re-scan the full
  // patient list on every unrelated re-render (search typing, dialog open, etc.).
  const rosterStats = useMemo(() => {
    const list = patients || [];
    const cutoff = Date.now() - 30 * 86400000;
    return {
      total: list.length,
      active: list.filter(p => p.status === 'active').length,
      recent: list.filter(p => p.created_date && new Date(p.created_date).getTime() >= cutoff).length,
    };
  }, [patients]);

  const filteredPatients = useMemo(() => {
    // Date-range bounds, hoisted out of the per-patient loop. The pickers emit
    // date-only strings ("2026-07-01"); `new Date(...)` parsed them as UTC
    // midnight, so comparing against full created_date timestamps (a) excluded
    // every patient added ON the "To" day and (b) shifted both bounds by the
    // local UTC offset. Parse as local calendar days and make "To" inclusive
    // through end of day.
    const afterStart = filters.createdAfter ? parseLocalDate(filters.createdAfter) : null;
    const beforeEnd = filters.createdBefore ? parseLocalDate(filters.createdBefore) : null;
    if (beforeEnd) beforeEnd.setHours(23, 59, 59, 999);

    return (patients || []).filter(patient => {
    if (!patient) return false;

    // Fuzzy search across name, MRN, phone, diagnosis (debounced)
    const matchesSearch = patientMatchesSearch(patient, debouncedSearch);

    // Status filter
    const matchesStatus = !filters.status || filters.status === 'all' || patient.status === filters.status;

    // Diagnosis filter
    const matchesDiagnosis = !filters.diagnosis ||
      (patient.primary_diagnosis || '').toLowerCase().includes(filters.diagnosis.toLowerCase());

    // Age filter
    const patientAge = calculateAge(patient.date_of_birth);
    const matchesAgeMin = !filters.ageMin || (patientAge !== null && patientAge >= parseInt(filters.ageMin));
    const matchesAgeMax = !filters.ageMax || (patientAge !== null && patientAge <= parseInt(filters.ageMax));

    // Visit filter — use pre-built index instead of filtering allVisits per patient
    const patientVisitCount = visitCountByPatientId[patient.id] || 0;
    const matchesVisits = !filters.hasVisits || filters.hasVisits === 'all' ||
      (filters.hasVisits === 'yes' && patientVisitCount > 0) ||
      (filters.hasVisits === 'no' && patientVisitCount === 0);

    // Date range filter (bounds computed above; inclusive of both boundary days)
    const createdDate = new Date(patient.created_date);
    const matchesAfter = !afterStart || createdDate >= afterStart;
    const matchesBefore = !beforeEnd || createdDate <= beforeEnd;

    return matchesSearch && matchesStatus && matchesDiagnosis &&
           matchesAgeMin && matchesAgeMax && matchesVisits &&
           matchesAfter && matchesBefore;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return patientSortKey(a).localeCompare(patientSortKey(b));
      case 'name-desc':
        return patientSortKey(b).localeCompare(patientSortKey(a));
      case 'newest':
        return new Date(b.created_date || 0) - new Date(a.created_date || 0);
      case 'oldest':
        return new Date(a.created_date || 0) - new Date(b.created_date || 0);
      case 'last-visit': {
        const aDate = lastVisitDateByPatientId[a.id] || 0;
        const bDate = lastVisitDateByPatientId[b.id] || 0;
        return new Date(bDate) - new Date(aDate);
      }
      case 'most-visits': {
        const aCount = visitCountByPatientId[a.id] || 0;
        const bCount = visitCountByPatientId[b.id] || 0;
        return bCount - aCount;
      }
      // Carried over from PaginatedPatientList's own sort control, which this
      // page now suppresses (it owns the ordering); same comparison as before.
      case 'status':
        return (a.status || '').localeCompare(b.status || '');
      default:
        return 0;
    }
  });
  }, [patients, filters, debouncedSearch, sortBy, visitCountByPatientId, lastVisitDateByPatientId]);

  const togglePatientSelection = (patient) => {
    setSelectedPatients(prev => {
      const isSelected = prev.some(p => p.id === patient.id);
      if (isSelected) {
        return prev.filter(p => p.id !== patient.id);
      } else {
        return [...prev, patient];
      }
    });
  };

  const handleMergeSelected = () => {
    if (selectedPatients.length === 2) {
      setPatientsToMerge({ patient1: selectedPatients[0], patient2: selectedPatients[1] });
      setMergeDialogOpen(true);
    }
  };



  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        eyebrow="Patient Care"
        title="Patient Management"
        description="Search, filter, and manage the active patient roster."
        favoritePage="Patients"
        actions={
          <Button onClick={() => { setEditingPatient(null); setShowForm(true); }} className="min-h-[46px] px-5">
            <Plus className="w-4 h-4 mr-2" />
            Add Patient
          </Button>
        }
      />

      {/* Roster summary — shared StatCard treatment, matching the Dashboard.
          Each card is a one-tap filter: tapping the number a user is already
          looking at narrows the roster instead of hunting through the popover. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setFilters(prev => ({ ...prev, status: 'all' }))}
          className="w-full text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          aria-label="Show all patients"
          title="Show all patients"
        >
          <StatCard label="Total Patients" value={rosterStats.total} icon={Users} tone="navy" />
        </button>
        <button
          type="button"
          onClick={() => setFilters(prev => ({ ...prev, status: 'active' }))}
          className="w-full text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          aria-label="Filter to active patients"
          title="Filter to active patients"
        >
          <StatCard label="Active" value={rosterStats.active} icon={UserCheck} tone="emerald" />
        </button>
        <button
          type="button"
          onClick={() => setFilters(prev => ({ ...prev, createdAfter: toLocalISODate(new Date(Date.now() - 30 * 86400000)) }))}
          className="w-full text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          aria-label="Filter to patients added in the last 30 days"
          title="Filter to patients added in the last 30 days"
        >
          <StatCard label="New (30 days)" value={rosterStats.recent} icon={CalendarPlus} tone="slate" />
        </button>
      </div>

      {showForm && (
        <PatientForm
          patient={editingPatient}
          onSuccess={() => {
            setShowForm(false);
            setEditingPatient(null);
          }}
          onCancel={() => {
            setShowForm(false);
            setEditingPatient(null);
          }}
        />
      )}

      <AdvancedPatientFilters
        onFilterChange={setFilters}
        activeFilters={filters}
      />

      {/* Sort & Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {filteredPatients.length} {filteredPatients.length === 1 ? 'patient' : 'patients'}
          {filters.search && ` matching "${filters.search}"`}
        </p>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="name-asc">Name A-Z</SelectItem>
              <SelectItem value="name-desc">Name Z-A</SelectItem>
              <SelectItem value="last-visit">Last Visit</SelectItem>
              <SelectItem value="most-visits">Most Visits</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedPatients.length > 0 && (
        <div className="mb-3 sm:mb-4">
          <BulkPatientActions
            selectedPatients={selectedPatients}
            onClearSelection={() => setSelectedPatients([])}
          />
          {selectedPatients.length === 2 && (
            <Button
              onClick={handleMergeSelected}
              className="mt-2 bg-navy-600 hover:bg-navy-700 w-full sm:w-auto min-h-[44px]"
            >
              Merge Selected Patients
            </Button>
          )}
        </div>
      )}

      {/* Mobile Optimized List — virtualized when the filtered roster is large */}
      <div className="lg:hidden mb-20">
        {isLoading ? (
          <div className="space-y-3">
            <PatientCardSkeleton />
            <PatientCardSkeleton />
            <PatientCardSkeleton />
          </div>
        ) : filteredPatients.length === 0 ? (
          <EmptyState
            icon={User}
            title="No patients found"
            description={filters.search ? 'No patients match your search.' : 'Start by adding your first patient.'}
            action={!filters.search && (
              <Button onClick={() => setShowForm(true)} className="min-h-[44px]">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Patient
              </Button>
            )}
          />
        ) : (
          <VirtualList
            items={filteredPatients}
            estimateSize={132}
            height="min(70vh, 640px)"
            className="space-y-0"
            itemClassName="pb-3"
            getItemKey={(patient) => patient.id}
            renderItem={(patient) => (
              <SwipeablePatientCard
                patient={patient}
                isSelected={selectedPatients.some(p => p.id === patient.id)}
                onToggleSelect={togglePatientSelection}
                onEdit={(p) => {
                  setEditingPatient(p);
                  setShowForm(true);
                }}
                onDelete={(p) => {
                  setPatientToDelete(p);
                  setDeleteDialogOpen(true);
                }}
              />
            )}
          />
        )}
      </div>

      {/* Desktop Grid View */}
      <div className="hidden lg:grid grid-cols-1 gap-3 sm:gap-4">
        {isLoading ? (
          <>
            <PatientCardSkeleton />
            <PatientCardSkeleton />
            <PatientCardSkeleton />
            <PatientCardSkeleton />
          </>
        ) : filteredPatients.length === 0 ? (
          <EmptyState
            className="md:col-span-2"
            icon={User}
            title="No patients found"
            description={filters.search ? 'No patients match your search.' : 'Start by adding your first patient.'}
            action={!filters.search && (
              <Button onClick={() => setShowForm(true)} className="min-h-[44px]">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Patient
              </Button>
            )}
          />
        ) : (
          <div className="md:col-span-2">
            <PaginatedPatientList
              patients={filteredPatients}
              showCheckboxes={true}
              showSearch={false}
              // This page owns filtering and sorting (see the sort control above);
              // letting the list re-sort would discard that order.
              sortable={false}
              selectedPatients={selectedPatients.map(p => p.id)}
              onSelectionChange={(ids) => {
                const selected = filteredPatients.filter(p => ids.includes(p.id));
                setSelectedPatients(selected);
              }}
              onPatientSelect={(patientId) => {
                const patient = patients.find(p => p.id === patientId);
                if (patient) {
                  setEditingPatient(patient);
                  setShowForm(true);
                }
              }}
            />
          </div>
        )}
      </div>



      {/* Patient Merge Dialog */}
      <PatientMergeDialog
        open={mergeDialogOpen}
        onOpenChange={(open) => {
          setMergeDialogOpen(open);
          if (!open) {
            setSelectedPatients([]);
          }
        }}
        patient1={patientsToMerge.patient1}
        patient2={patientsToMerge.patient2}
      />



                  {/* Delete Confirmation Dialog */}
                  <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Patient</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete {patientToDelete?.first_name} {patientToDelete?.last_name}? 
                          This action cannot be undone and will remove all associated data.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeletePatient}
                          disabled={isDeleting}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </PageContainer>
              );
            }
