import { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import {
  excludeArchived,
  invalidateAuthorizedPatientLists,
  useScopedPatients,
} from "@/hooks/useScopedPatients";
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { usePatientDetailsRouteScope } from '@/hooks/usePatientDetailsRouteScope';
import { calculateAge, parseLocalDate, toLocalISODate } from "@/lib/dateLocal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, User, ArrowUpDown, Users, UserCheck, CalendarPlus } from "lucide-react";

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

const authorizationScopeKey = (scope) => (scope
  ? JSON.stringify([
      scope.user_id,
      scope.agency_id,
      scope.membership_id,
      scope.membership_version,
      scope.tenant_role,
    ])
  : null);

export default function Patients() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({});
  const [editingPatientId, setEditingPatientId] = useState(null);
  const [selectedPatientIds, setSelectedPatientIds] = useState([]);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [patientsToMergeIds, setPatientsToMergeIds] = useState({ patient1: null, patient2: null });
  const [sortBy, setSortBy] = useState('newest');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef(null);
  const lastAuthorizedPatientScopeKey = useRef(null);

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

  // Resolve chart navigation once for the whole roster. The hook accepts only
  // a freshly revalidated server-owned singleton membership; it never derives
  // route authority from mutable User or Patient fields.
  const { agencyId: patientDetailsAgencyId } = usePatientDetailsRouteScope();

  // Log page visit
  useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'Patients',
        page_title: 'Patient Management'
      });
    }
  }, [currentUser?.email]);

  const patientQuery = useScopedPatients({
    purpose: 'patient_management',
    sort: '-created_date',
    limit: 2000,
    select: excludeArchived,
  });
  const {
    data: patientRows = [],
    isLoading,
    isPending: patientsPending,
    isError: patientsDenied,
    isSuccess: patientsReady,
    tenantScope: patientTenantScope,
  } = patientQuery;
  const patients = useMemo(
    () => (patientsReady ? patientRows : []),
    [patientRows, patientsReady],
  );
  const patientScopeKey = authorizationScopeKey(patientTenantScope);
  const patientScopeChanged = Boolean(
    patientsReady
    && lastAuthorizedPatientScopeKey.current
    && lastAuthorizedPatientScopeKey.current !== patientScopeKey,
  );
  const patientStateCurrent = patientsReady && !patientScopeChanged;
  // Effects clear persisted UI state, but effects run after paint. Every value
  // read during a direct successful A -> B render must therefore fail closed
  // independently of that cleanup commit.
  const effectiveFilters = useMemo(
    () => (patientScopeChanged ? {} : filters),
    [filters, patientScopeChanged],
  );
  const effectiveDebouncedSearch = patientScopeChanged ? '' : debouncedSearch;

  const visitQuery = useAuthorizedVisits({
    purpose: 'activity',
    sort: '-visit_date',
    limit: 5000,
  });
  const visitScopeKey = authorizationScopeKey(visitQuery.tenantScope);
  const visitMetricsAvailable = patientsReady
    && visitQuery.isSuccess
    && visitScopeKey === patientScopeKey;
  const allVisits = useMemo(
    () => (visitMetricsAvailable ? (visitQuery.data || []) : []),
    [visitMetricsAvailable, visitQuery.data],
  );
  const visitMetricsMessage = visitQuery.isError
    ? 'Global visit metrics are unavailable for your role or current tenant scope. Visit-based filters and sorting are not being applied.'
    : visitQuery.isPending
      ? 'Global visit metrics are being reverified. Visit-based filters and sorting are temporarily paused.'
      : !visitMetricsAvailable
        ? 'Global visit metrics are unavailable until Patient and Visit tenant scopes are reverified together. Visit-based filters and sorting are not being applied.'
        : null;

  const patientById = useMemo(
    () => new Map(patients.map((patient) => [patient.id, patient])),
    [patients],
  );
  const editingPatient = patientStateCurrent && editingPatientId
    ? patientById.get(editingPatientId) || null
    : null;
  const selectedPatients = useMemo(
    () => (patientStateCurrent
      ? selectedPatientIds.map((id) => patientById.get(id)).filter(Boolean)
      : []),
    [patientById, patientStateCurrent, selectedPatientIds],
  );
  const patientsToMerge = useMemo(() => ({
    patient1: patientStateCurrent && patientsToMergeIds.patient1
      ? patientById.get(patientsToMergeIds.patient1) || null
      : null,
    patient2: patientStateCurrent && patientsToMergeIds.patient2
      ? patientById.get(patientsToMergeIds.patient2) || null
      : null,
  }), [patientById, patientStateCurrent, patientsToMergeIds]);

  // Patient objects never live in component state. A focus/reconnect recheck
  // hides hook data immediately; clear every tenant-bound id at the same
  // boundary so a later success cannot resolve an id under a different scope.
  useEffect(() => {
    const scopeChanged = Boolean(
      patientsReady
      && lastAuthorizedPatientScopeKey.current
      && lastAuthorizedPatientScopeKey.current !== patientScopeKey,
    );
    if (patientsReady) {
      lastAuthorizedPatientScopeKey.current = patientScopeKey;
    }
    if (patientsReady && !scopeChanged) return;

    setEditingPatientId(null);
    setSelectedPatientIds([]);
    setPatientsToMergeIds({ patient1: null, patient2: null });
    setMergeDialogOpen(false);
    setShowForm(false);

    if (scopeChanged) {
      // Search, MRN, phone, and diagnosis terms can themselves contain PHI.
      // Do not carry those user-entered values into another tenant scope.
      setFilters({});
      setDebouncedSearch('');
      setSortBy('newest');
    }
  }, [patientScopeKey, patientsReady]);

  // A successful refresh can also remove one chart without changing the
  // membership. Reconcile retained ids exclusively against the new authorized
  // projection before passing any object into edit, bulk, or merge controls.
  useEffect(() => {
    if (!patientsReady) return;
    setSelectedPatientIds((ids) => {
      const authorizedIds = ids.filter((id) => patientById.has(id));
      return authorizedIds.length === ids.length ? ids : authorizedIds;
    });
    if (editingPatientId && !patientById.has(editingPatientId)) {
      setEditingPatientId(null);
      setShowForm(false);
    }
    if (
      (patientsToMergeIds.patient1 && !patientById.has(patientsToMergeIds.patient1))
      || (patientsToMergeIds.patient2 && !patientById.has(patientsToMergeIds.patient2))
    ) {
      setPatientsToMergeIds({ patient1: null, patient2: null });
      setMergeDialogOpen(false);
    }
  }, [editingPatientId, patientById, patientsReady, patientsToMergeIds]);

  // A role/scope that cannot load agency-wide Visits must not retain an
  // apparently active Visit filter or sort. Those controls would otherwise
  // imply that the empty authorization fallback was real Visit data.
  useEffect(() => {
    if (visitMetricsAvailable) return;
    setSortBy((current) => (
      current === 'last-visit' || current === 'most-visits' ? 'newest' : current
    ));
    setFilters((current) => (
      current.hasVisits && current.hasVisits !== 'all'
        ? { ...current, hasVisits: 'all' }
        : current
    ));
  }, [visitMetricsAvailable]);

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
    const afterStart = effectiveFilters.createdAfter
      ? parseLocalDate(effectiveFilters.createdAfter)
      : null;
    const beforeEnd = effectiveFilters.createdBefore
      ? parseLocalDate(effectiveFilters.createdBefore)
      : null;
    if (beforeEnd) beforeEnd.setHours(23, 59, 59, 999);

    return (patients || []).filter(patient => {
    if (!patient) return false;

    // Fuzzy search across name, MRN, phone, diagnosis (debounced)
    const matchesSearch = patientMatchesSearch(patient, effectiveDebouncedSearch);

    // Status filter
    const matchesStatus = !effectiveFilters.status
      || effectiveFilters.status === 'all'
      || patient.status === effectiveFilters.status;

    // Diagnosis filter
    const matchesDiagnosis = !effectiveFilters.diagnosis
      || (patient.primary_diagnosis || '')
        .toLowerCase()
        .includes(effectiveFilters.diagnosis.toLowerCase());

    // Age filter
    const patientAge = calculateAge(patient.date_of_birth);
    const matchesAgeMin = !effectiveFilters.ageMin
      || (patientAge !== null && patientAge >= parseInt(effectiveFilters.ageMin));
    const matchesAgeMax = !effectiveFilters.ageMax
      || (patientAge !== null && patientAge <= parseInt(effectiveFilters.ageMax));

    // Visit filter — use pre-built index instead of filtering allVisits per patient
    const patientVisitCount = visitMetricsAvailable
      ? (visitCountByPatientId[patient.id] || 0)
      : null;
    const matchesVisits = !visitMetricsAvailable
      || !effectiveFilters.hasVisits || effectiveFilters.hasVisits === 'all' ||
      (effectiveFilters.hasVisits === 'yes' && patientVisitCount > 0) ||
      (effectiveFilters.hasVisits === 'no' && patientVisitCount === 0);

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
        if (!visitMetricsAvailable) return 0;
        const aDate = lastVisitDateByPatientId[a.id] || 0;
        const bDate = lastVisitDateByPatientId[b.id] || 0;
        return new Date(bDate) - new Date(aDate);
      }
      case 'most-visits': {
        if (!visitMetricsAvailable) return 0;
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
  }, [
    effectiveDebouncedSearch,
    effectiveFilters,
    lastVisitDateByPatientId,
    patients,
    sortBy,
    visitCountByPatientId,
    visitMetricsAvailable,
  ]);

  const togglePatientSelection = (patient) => {
    if (!patientsReady || !patientById.has(patient?.id)) return;
    setSelectedPatientIds(prev => {
      const isSelected = prev.includes(patient.id);
      if (isSelected) {
        return prev.filter(id => id !== patient.id);
      } else {
        return [...prev, patient.id];
      }
    });
  };

  const handleMergeSelected = () => {
    if (selectedPatientIds.length === 2) {
      setPatientsToMergeIds({
        patient1: selectedPatientIds[0],
        patient2: selectedPatientIds[1],
      });
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
          <Button
            onClick={() => { setEditingPatientId(null); setShowForm(true); }}
            disabled={!patientsReady}
            className="min-h-[46px] px-5"
          >
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
          <StatCard label="Total Patients" value={patientsReady ? rosterStats.total : '—'} icon={Users} tone="navy" />
        </button>
        <button
          type="button"
          onClick={() => setFilters(prev => ({ ...prev, status: 'active' }))}
          className="w-full text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          aria-label="Filter to active patients"
          title="Filter to active patients"
        >
          <StatCard label="Active" value={patientsReady ? rosterStats.active : '—'} icon={UserCheck} tone="emerald" />
        </button>
        <button
          type="button"
          onClick={() => setFilters(prev => ({ ...prev, createdAfter: toLocalISODate(new Date(Date.now() - 30 * 86400000)) }))}
          className="w-full text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          aria-label="Filter to patients added in the last 30 days"
          title="Filter to patients added in the last 30 days"
        >
          <StatCard label="New (30 days)" value={patientsReady ? rosterStats.recent : '—'} icon={CalendarPlus} tone="slate" />
        </button>
      </div>

      {patientStateCurrent && showForm && (
        <PatientForm
          key={`${patientScopeKey}:${editingPatientId || 'new'}`}
          patient={editingPatient}
          onSuccess={() => {
            invalidateAuthorizedPatientLists(queryClient);
            setShowForm(false);
            setEditingPatientId(null);
          }}
          onCancel={() => {
            setShowForm(false);
            setEditingPatientId(null);
          }}
        />
      )}

      {patientStateCurrent && (
        <AdvancedPatientFilters
          key={`patient-filters:${patientScopeKey}`}
          onFilterChange={(nextFilters) => setFilters({
            ...nextFilters,
            hasVisits: visitMetricsAvailable ? nextFilters.hasVisits : 'all',
          })}
          activeFilters={visitMetricsAvailable
            ? filters
            : { ...filters, hasVisits: 'all' }}
        />
      )}

      {visitMetricsMessage && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {visitMetricsMessage}
        </div>
      )}

      {/* Sort & Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {patientsReady
            ? `${filteredPatients.length} ${filteredPatients.length === 1 ? 'patient' : 'patients'}`
            : 'Patient count unavailable'}
          {patientsReady
            && effectiveFilters.search
            && ` matching "${effectiveFilters.search}"`}
        </p>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
          <Select
            value={sortBy}
            onValueChange={(nextSort) => {
              if (
                !visitMetricsAvailable
                && (nextSort === 'last-visit' || nextSort === 'most-visits')
              ) return;
              setSortBy(nextSort);
            }}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="name-asc">Name A-Z</SelectItem>
              <SelectItem value="name-desc">Name Z-A</SelectItem>
              <SelectItem value="last-visit" disabled={!visitMetricsAvailable}>Last Visit</SelectItem>
              <SelectItem value="most-visits" disabled={!visitMetricsAvailable}>Most Visits</SelectItem>
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
            onClearSelection={() => setSelectedPatientIds([])}
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
        {patientsDenied ? (
          <EmptyState
            icon={User}
            title="Patient records unavailable"
            description="Your patient access could not be reverified for the current tenant scope."
          />
        ) : isLoading || patientsPending ? (
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
                patientDetailsAgencyId={patientDetailsAgencyId}
                isSelected={patientStateCurrent && selectedPatientIds.includes(patient.id)}
                onToggleSelect={togglePatientSelection}
                onEdit={(p) => {
                  if (patientsReady && patientById.has(p?.id)) {
                    setEditingPatientId(p.id);
                    setShowForm(true);
                  }
                }}
              />
            )}
          />
        )}
      </div>

      {/* Desktop Grid View */}
      <div className="hidden lg:grid grid-cols-1 gap-3 sm:gap-4">
        {patientsDenied ? (
          <EmptyState
            className="md:col-span-2"
            icon={User}
            title="Patient records unavailable"
            description="Your patient access could not be reverified for the current tenant scope."
          />
        ) : isLoading || patientsPending ? (
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
              patientDetailsAgencyId={patientDetailsAgencyId}
              showCheckboxes={true}
              showSearch={false}
              // This page owns filtering and sorting (see the sort control above);
              // letting the list re-sort would discard that order.
              sortable={false}
              selectedPatients={patientStateCurrent ? selectedPatientIds : []}
              onSelectionChange={(ids) => {
                setSelectedPatientIds(ids.filter((id) => patientById.has(id)));
              }}
              onPatientSelect={(patientId) => {
                if (patientById.has(patientId)) {
                  setEditingPatientId(patientId);
                  setShowForm(true);
                }
              }}
            />
          </div>
        )}
      </div>



      {/* Patient Merge Dialog */}
      <PatientMergeDialog
        key={`patient-merge:${patientScopeKey || 'scope-unavailable'}`}
        open={patientStateCurrent && mergeDialogOpen}
        onOpenChange={(open) => {
          setMergeDialogOpen(open);
          if (!open) {
            setSelectedPatientIds([]);
            setPatientsToMergeIds({ patient1: null, patient2: null });
          }
        }}
        patient1={patientsToMerge.patient1}
        patient2={patientsToMerge.patient2}
      />
                </PageContainer>
              );
            }
