import { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, User, ArrowUpDown, Users, UserCheck, Target, CalendarPlus } from "lucide-react";
import { secureDelete, handleSecureError } from "../components/utils/security";

import PatientForm from "../components/patient/PatientForm";
import { patientMatchesSearch } from "../components/patient/AdvancedPatientFilters";
import AdvancedPatientFilters from "../components/patient/AdvancedPatientFilters";
import BulkPatientActions from "../components/patient/BulkPatientActions";
import PatientMergeDialog from "../components/patient/PatientMergeDialog";
import PaginatedPatientList from "../components/patient/PaginatedPatientList";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import StatCard from "@/components/ui/stat-card";
import EmptyState from "@/components/ui/empty-state";
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

  const { data: patients, isLoading, error: patientsError } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      const allPatients = await base44.entities.Patient.list('-created_date', 2000);
      return allPatients.filter(patient => !patient.is_archived);
    },
    initialData: [],
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 500),
    initialData: [],
    staleTime: 300000,
  });

  const { data: allCarePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list('-updated_date', 300),
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

  const calculateAge = (dob) => {
    if (!dob) return null;
    const today = new Date();
    // Parse a bare ISO date (YYYY-MM-DD) as PLAIN calendar components. `new
    // Date("YYYY-MM-DD")` parses as UTC midnight, so in a timezone behind UTC the
    // local day shifts back one (e.g. 1961-12-01 → 1961-11-30), which can flip the
    // birthday comparison and report the wrong age at the Medicare-band boundary.
    let birthYear, birthMonth, birthDay;
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(dob).trim());
    if (iso) {
      birthYear = Number(iso[1]); birthMonth = Number(iso[2]) - 1; birthDay = Number(iso[3]);
    } else {
      const birthDate = new Date(dob);
      if (Number.isNaN(birthDate.getTime())) return null;
      birthYear = birthDate.getFullYear(); birthMonth = birthDate.getMonth(); birthDay = birthDate.getDate();
    }
    let age = today.getFullYear() - birthYear;
    const m = today.getMonth() - birthMonth;
    if (m < 0 || (m === 0 && today.getDate() < birthDay)) {
      age--;
    }
    return age;
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

  const carePlanCountByPatientId = useMemo(() => {
    const map = {};
    for (const cp of allCarePlans) {
      map[cp.patient_id] = (map[cp.patient_id] || 0) + 1;
    }
    return map;
  }, [allCarePlans]);

  // Roster summary stats — memoized so the four StatCards don't re-scan the full
  // patient list on every unrelated re-render (search typing, dialog open, etc.).
  const rosterStats = useMemo(() => {
    const list = patients || [];
    const cutoff = Date.now() - 30 * 86400000;
    return {
      total: list.length,
      active: list.filter(p => p.status === 'active').length,
      withCarePlans: list.filter(p => (carePlanCountByPatientId[p.id] || 0) > 0).length,
      recent: list.filter(p => p.created_date && new Date(p.created_date).getTime() >= cutoff).length,
    };
  }, [patients, carePlanCountByPatientId]);

  const filteredPatients = useMemo(() => (patients || []).filter(patient => {
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

    // Care plan filter — use pre-built index instead of filtering allCarePlans per patient
    const patientCarePlanCount = carePlanCountByPatientId[patient.id] || 0;
    const matchesCarePlans = !filters.hasCarePlans || filters.hasCarePlans === 'all' ||
      (filters.hasCarePlans === 'yes' && patientCarePlanCount > 0) ||
      (filters.hasCarePlans === 'no' && patientCarePlanCount === 0);

    // Date range filter
    const createdDate = new Date(patient.created_date);
    const matchesAfter = !filters.createdAfter || createdDate >= new Date(filters.createdAfter);
    const matchesBefore = !filters.createdBefore || createdDate <= new Date(filters.createdBefore);

    return matchesSearch && matchesStatus && matchesDiagnosis &&
           matchesAgeMin && matchesAgeMax && matchesVisits &&
           matchesCarePlans && matchesAfter && matchesBefore;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':
        return (`${a.last_name} ${a.first_name}`).localeCompare(`${b.last_name} ${b.first_name}`);
      case 'name-desc':
        return (`${b.last_name} ${b.first_name}`).localeCompare(`${a.last_name} ${a.first_name}`);
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
      default:
        return 0;
    }
  }), [patients, filters, debouncedSearch, sortBy, visitCountByPatientId, lastVisitDateByPatientId, carePlanCountByPatientId]);

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

      {/* Roster summary — shared StatCard treatment, matching the Dashboard. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Patients" value={rosterStats.total} icon={Users} tone="navy" />
        <StatCard label="Active" value={rosterStats.active} icon={UserCheck} tone="emerald" />
        <StatCard label="With Care Plans" value={rosterStats.withCarePlans} icon={Target} tone="gold" />
        <StatCard
          label="New (30 days)"
          value={rosterStats.recent}
          icon={CalendarPlus}
          tone="slate"
        />
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

      <div className="mb-6">
        <AdvancedPatientFilters
          onFilterChange={setFilters}
          activeFilters={filters}
        />
      </div>

      {/* Sort & Results Count */}
      <div className="flex items-center justify-between mb-3">
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

      {/* Mobile Optimized List */}
      <div className="lg:hidden space-y-3 mb-20">
        {isLoading ? (
          <>
            <PatientCardSkeleton />
            <PatientCardSkeleton />
            <PatientCardSkeleton />
          </>
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
          filteredPatients.map((patient) => (
            <SwipeablePatientCard
              key={patient.id}
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
          ))
        )}
      </div>

      {/* Desktop Grid View */}
      <div className="hidden lg:grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
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