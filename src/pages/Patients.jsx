import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import PremiumFeatureGate from "../components/subscription/PremiumFeatureGate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, User, Phone, MapPin, FileText, X, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import { format, isValid } from 'date-fns';
import { secureDelete, handleSecureError, logSecurityEvent } from "../components/utils/security";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import PatientForm from "../components/patient/PatientForm";
import AIPatientSummaryReport from "../components/smartNote/AIPatientSummaryReport";
import DuplicatePatientManager from "../components/patient/DuplicatePatientManager";
import AdvancedPatientFilters from "../components/patient/AdvancedPatientFilters";
import ReferralUploadProcessor from "../components/referral/ReferralUploadProcessor";
import BulkPatientActions from "../components/patient/BulkPatientActions";
import PatientMergeDialog from "../components/patient/PatientMergeDialog";
import PaginatedPatientList from "../components/patient/PaginatedPatientList";
import FavoriteButton from "../components/navigation/FavoriteButton";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import EmptyState from "../components/ui/EmptyState";
import PullToRefresh from "../components/mobile/PullToRefresh";
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

export default function Patients() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState({});
  const [editingPatient, setEditingPatient] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showSummaryDialog, setShowSummaryDialog] = useState(false);
  const [summaryPatient, setSummaryPatient] = useState(null);
  const [selectedPatients, setSelectedPatients] = useState([]);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [patientsToMerge, setPatientsToMerge] = useState({ patient1: null, patient2: null });
  const [showReferralUpload, setShowReferralUpload] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    },
  });

  // Log page visit
  React.useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'Patients',
        page_title: 'Patient Management'
      });
    }
  }, [currentUser?.email]);

  const { data: patients, isLoading, error: patientsError } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-created_date'),
    initialData: [],
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list(),
    initialData: [],
  });

  const { data: allCarePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list(),
    initialData: [],
  });

  // Fetch visits and care plans for summary dialog
  const { data: summaryVisits = [] } = useQuery({
    queryKey: ['summaryVisits', summaryPatient?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: summaryPatient.id, status: 'completed' }, '-visit_date', 10),
    enabled: !!summaryPatient?.id,
  });

  const { data: summaryCarePlans = [] } = useQuery({
    queryKey: ['summaryCarePlans', summaryPatient?.id],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: summaryPatient.id }),
    enabled: !!summaryPatient?.id,
  });

  const handleShowSummary = (patient) => {
    setSummaryPatient(patient);
    setShowSummaryDialog(true);
  };

  // Handle query errors gracefully (logged server-side)

  const createPatientMutation = useMutation({
    mutationFn: (patientData) => base44.entities.Patient.create(patientData),
    onSuccess: (newPatient) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setShowForm(false);
      setEditingPatient(null);
      
      // Log patient creation
      logActivity(ActivityActions.CREATE, {
        entity_type: 'Patient',
        entity_id: newPatient.id,
        patient_name: `${newPatient.first_name} ${newPatient.last_name}`,
        page: 'Patients'
      });
    },
  });

  const updatePatientMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Patient.update(id, data),
    onSuccess: (updatedPatient, variables) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setShowForm(false);
      setEditingPatient(null);
      
      // Log patient update
      logActivity(ActivityActions.UPDATE, {
        entity_type: 'Patient',
        entity_id: variables.id,
        page: 'Patients'
      });
    },
  });

  const deletePatientMutation = useMutation({
    mutationFn: async (patientId) => {
      await base44.entities.Patient.delete(patientId);
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

  const handleSubmit = (data) => {
    if (editingPatient) {
      updatePatientMutation.mutate({ id: editingPatient.id, data });
    } else {
      createPatientMutation.mutate(data);
    }
  };

  // Visit type template quick-add
  const createVisitFromTemplate = useMutation({
    mutationFn: async ({ patientId, templateType }) => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const visitData = {
        patient_id: patientId,
        visit_date: today,
        visit_time: '', // Could be dynamic or default to empty
        visit_type: templateType,
        status: 'scheduled'
      };
      return base44.entities.Visit.create(visitData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todayVisits'] }); // Invalidate relevant queries, e.g., for a dashboard showing today's visits
      toast.success('Visit scheduled successfully!'); // Simple feedback
    },
    onError: (error) => {
      toast.error('Failed to schedule visit. Please try again.');
    }
  });

  const visitTemplates = [
    { type: 'routine_visit', label: 'Routine Visit', icon: '📋' },
    { type: 'skilled_nursing', label: 'Skilled Nursing', icon: '💉' },
    { type: 'admission', label: 'Admission', icon: '🏥' },
    { type: 'recertification', label: 'Recertification', icon: '📝' },
  ];

  const calculateAge = (dob) => {
    if (!dob) return null;
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const filteredPatients = (patients || []).filter(patient => {
    if (!patient) return false;
    
    // Text search
    const searchLower = (filters.search || searchTerm || '').toLowerCase();
    const matchesSearch = !searchLower || 
      (patient.first_name || '').toLowerCase().includes(searchLower) ||
      (patient.last_name || '').toLowerCase().includes(searchLower) ||
      (patient.medical_record_number || '').toLowerCase().includes(searchLower) ||
      (patient.phone || '').toLowerCase().includes(searchLower) ||
      (patient.address || '').toLowerCase().includes(searchLower);

    // Status filter
    const matchesStatus = !filters.status || filters.status === 'all' || patient.status === filters.status;

    // Diagnosis filter
    const matchesDiagnosis = !filters.diagnosis || 
      (patient.primary_diagnosis || '').toLowerCase().includes(filters.diagnosis.toLowerCase());

    // Age filter
    const patientAge = calculateAge(patient.date_of_birth);
    const matchesAgeMin = !filters.ageMin || (patientAge !== null && patientAge >= parseInt(filters.ageMin));
    const matchesAgeMax = !filters.ageMax || (patientAge !== null && patientAge <= parseInt(filters.ageMax));

    // Visit filter
    const patientVisits = allVisits.filter(v => v.patient_id === patient.id);
    const matchesVisits = !filters.hasVisits || filters.hasVisits === 'all' ||
      (filters.hasVisits === 'yes' && patientVisits.length > 0) ||
      (filters.hasVisits === 'no' && patientVisits.length === 0);

    // Care plan filter
    const patientCarePlans = allCarePlans.filter(cp => cp.patient_id === patient.id);
    const matchesCarePlans = !filters.hasCarePlans || filters.hasCarePlans === 'all' ||
      (filters.hasCarePlans === 'yes' && patientCarePlans.length > 0) ||
      (filters.hasCarePlans === 'no' && patientCarePlans.length === 0);

    // Date range filter
    const createdDate = new Date(patient.created_date);
    const matchesAfter = !filters.createdAfter || createdDate >= new Date(filters.createdAfter);
    const matchesBefore = !filters.createdBefore || createdDate <= new Date(filters.createdBefore);

    return matchesSearch && matchesStatus && matchesDiagnosis && 
           matchesAgeMin && matchesAgeMax && matchesVisits && 
           matchesCarePlans && matchesAfter && matchesBefore;
  });

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
    <PremiumFeatureGate
      featureName="Patient Management"
      featureDescription="Manage your patient roster with comprehensive profiles, medical histories, and AI-powered insights. This premium feature enables better clinical decision-making and personalized care planning."
      allowTrial={true}
    >
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
    }}>
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0">
      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6 md:mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-3 sm:gap-4">
          <div className="flex items-start gap-2 flex-1">
            <div className="flex-1">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100">My Patients</h1>
              <p className="text-xs sm:text-sm md:text-base text-slate-600 dark:text-slate-400 mt-1">Your personal patient roster - detailed patient information helps AI provide better recommendations</p>
            </div>
            <FavoriteButton type="page" id="Patients" name="Patients" />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              onClick={() => setShowReferralUpload(true)}
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none"
            >
              <Download className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
              <span className="text-xs sm:text-sm">Upload</span>
            </Button>
            <Button
              onClick={() => {
                setEditingPatient(null);
                setShowForm(true);
              }}
              size="sm"
              className="flex-1 sm:flex-none bg-slate-600 hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600"
            >
              <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
              <span className="text-xs sm:text-sm">Add Patient</span>
            </Button>
          </div>
        </div>
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

      {/* Duplicate Detection Alert */}
      <DuplicatePatientManager />

      {/* Advanced Filters */}
      <div className="mb-4">
        <AdvancedPatientFilters 
          onFilterChange={setFilters}
          activeFilters={filters}
        />
      </div>

      {/* Bulk Actions Bar */}
      {selectedPatients.length > 0 && (
        <div className="mb-4">
          <BulkPatientActions
            selectedPatients={selectedPatients}
            onClearSelection={() => setSelectedPatients([])}
          />
          {selectedPatients.length === 2 && (
            <Button
              onClick={handleMergeSelected}
              className="mt-2"
            >
              Merge Selected Patients
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {isLoading ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              Loading patients...
            </CardContent>
          </Card>
        ) : filteredPatients.length === 0 ? (
          <div className="md:col-span-2">
            <EmptyState
              icon={User}
              iconColor="text-blue-300"
              title="No Patients Found"
              description={
                searchTerm || Object.keys(filters).length > 0
                  ? "Try adjusting your search or filters to find patients"
                  : "Add your first patient to begin managing their care and documentation"
              }
              actionLabel={!searchTerm && Object.keys(filters).length === 0 ? "Add Your First Patient" : null}
              onAction={!searchTerm && Object.keys(filters).length === 0 ? () => setShowForm(true) : null}
              secondaryActionLabel={searchTerm || Object.keys(filters).length > 0 ? "Clear Filters" : null}
              onSecondaryAction={searchTerm || Object.keys(filters).length > 0 ? () => { setSearchTerm(""); setFilters({}); } : null}
            />
          </div>
        ) : (
          <div className="md:col-span-2">
            <PaginatedPatientList
              patients={filteredPatients}
              showCheckboxes={true}
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

      {/* Legacy patient cards - keeping for reference if needed */}
      

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

      {/* Referral Upload Dialog */}
      <Dialog open={showReferralUpload} onOpenChange={setShowReferralUpload}>
        <DialogContent className="max-w-2xl sm:max-w-5xl max-h-[90vh] overflow-y-auto w-full mx-2">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
                 <FileText className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                 Upload Patient Referral
               </DialogTitle>
          </DialogHeader>
          <ReferralUploadProcessor
            onPatientDataExtracted={(data) => {
              // Data extracted successfully
            }}
            onCreatePatient={async (patientData) => {
              await createPatientMutation.mutateAsync(patientData);
              setShowReferralUpload(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Patient Summary Dialog */}
                  <Dialog open={showSummaryDialog} onOpenChange={setShowSummaryDialog}>
                    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                             <FileText className="w-5 h-5 text-slate-700 dark:text-slate-400" />
                          Patient Summary: {summaryPatient?.first_name} {summaryPatient?.last_name}
                        </DialogTitle>
                      </DialogHeader>
                      {summaryPatient && (
                        <AIPatientSummaryReport
                          patient={summaryPatient}
                          previousVisits={summaryVisits}
                          carePlans={summaryCarePlans}
                          compact={false}
                        />
                      )}
                    </DialogContent>
                  </Dialog>

                  {/* Delete Confirmation Dialog */}
                  <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Patient & All Data</AlertDialogTitle>
                        <AlertDialogDescription>
                          <div className="space-y-3">
                            <p>Are you sure you want to permanently delete <strong>{patientToDelete?.first_name} {patientToDelete?.last_name}</strong>?</p>
                            <div className="bg-slate-200 border border-slate-300 dark:bg-slate-800 dark:border-slate-600 rounded-lg p-3 text-sm text-slate-900 dark:text-slate-100">
                              <p className="font-semibold mb-1">⚠️ This will permanently delete:</p>
                              <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>Patient profile and medical history</li>
                                <li>All visit notes and documentation</li>
                                <li>Care plans and goals</li>
                                <li>Incident reports</li>
                                <li>All associated data</li>
                              </ul>
                              <p className="mt-2 font-semibold">This action cannot be undone.</p>
                            </div>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDeletePatient}
                          disabled={isDeleting}
                          className="bg-slate-600 hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600 text-white"
                        >
                          {isDeleting ? "Deleting..." : "Delete Patient & All Data"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
    </PullToRefresh>
    </PremiumFeatureGate>
              );
            }