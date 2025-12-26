import React, { useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, User, Phone, MapPin, FileText, X, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, isValid } from 'date-fns';
import { secureDelete, handleSecureError, logSecurityEvent } from "../components/utils/security";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import PatientForm from "../components/patient/PatientForm";
import VoiceCommandListener from "../components/voice/VoiceCommandListener";
import { getCommandsForContext } from "../components/voice/voiceCommands";
import EnhancedVoiceCommands from "../components/voice/EnhancedVoiceCommands";
import AIPatientSummaryReport from "../components/smartNote/AIPatientSummaryReport";
import DuplicatePatientManager from "../components/patient/DuplicatePatientManager";
import AdvancedPatientFilters from "../components/patient/AdvancedPatientFilters";
import BulkPatientActions from "../components/patient/BulkPatientActions";
import PatientMergeDialog from "../components/patient/PatientMergeDialog";
import PaginatedPatientList from "../components/patient/PaginatedPatientList";
import PatientFileUpdateUploader from "../components/patient/PatientFileUpdateUploader";
import FavoriteButton from "../components/navigation/FavoriteButton";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
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

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
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

  // Handle query errors gracefully
  if (patientsError) {
    console.error('Error loading patients:', patientsError);
  }

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
      await handleSecureError(error, 'patient_delete', (msg) => alert(msg));
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
      alert('Visit scheduled successfully!'); // Simple feedback
    },
    onError: (error) => {
      console.error("Failed to schedule visit:", error);
      alert('Failed to schedule visit. Please try again.');
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

  // Voice command handler
  const handleVoiceCommand = (action, spokenText) => {
    switch (action) {
      case 'add_patient':
        setEditingPatient(null);
        setShowForm(true);
        break;
      case 'schedule_visit':
        // Open first patient's detail page or show message
        if (patients.length > 0) {
          alert('Please select a patient first to schedule a visit');
        } else {
          alert('No patients available. Please add a patient first.');
        }
        break;
      case 'search_patients':
        // Extract search term from spoken text
        const searchKeywords = ['search for', 'find patient', 'look up', 'search patient', 'find'];
        let extractedSearchTerm = spokenText;
        for (const keyword of searchKeywords) {
          if (extractedSearchTerm.toLowerCase().startsWith(keyword)) {
            extractedSearchTerm = extractedSearchTerm.substring(keyword.length);
            break;
          }
        }
        extractedSearchTerm = extractedSearchTerm.trim();
        if (extractedSearchTerm) {
          setSearchTerm(extractedSearchTerm);
        }
        break;
      default:
        console.log('Unhandled voice command:', action);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 md:mb-8">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Patient Management</h1>
            <p className="text-sm md:text-base text-gray-600 mt-1">Manage your patient roster</p>
          </div>
          <FavoriteButton type="page" id="Patients" name="Patients" />
        </div>
        <Button
          onClick={() => {
            setEditingPatient(null);
            setShowForm(true);
          }}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Patient
        </Button>
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

      {/* Patient File Update Uploader */}
      <PatientFileUpdateUploader />

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
              className="mt-2 bg-purple-600 hover:bg-purple-700"
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
          <Card className="md:col-span-2 border-2 border-dashed">
            <CardContent className="p-12 text-center">
              <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No patients found</h3>
              <p className="text-gray-500 mb-6">
                {searchTerm ? 'No patients match your search.' : 'Start by adding your first patient.'}
              </p>
              {!searchTerm && (
                <Button
                  onClick={() => setShowForm(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Patient
                </Button>
              )}
            </CardContent>
          </Card>
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
      <div className="hidden grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {filteredPatients.map((patient) => {
            const isSelected = selectedPatients.some(p => p.id === patient.id);
            return (
            <Card 
              key={patient.id} 
              className={`hover:shadow-lg transition-all duration-200 border-l-4 ${
                isSelected ? 'border-l-green-500 bg-green-50' : 'border-l-blue-500'
              }`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => togglePatientSelection(patient)}
                    className="mt-1 mr-3 w-4 h-4"
                  />
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center shadow-md flex-shrink-0">
                      <User className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">
                        {patient.first_name} {patient.last_name}
                      </h3>
                      <p className="text-sm text-gray-500">MRN: {patient.medical_record_number || 'N/A'}</p>
                    </div>
                  </div>
                  <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                    Home Health
                  </Badge>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Phone className="w-4 h-4" />
                    <span>{patient.phone || 'No phone'}</span>
                  </div>
                  {patient.address && (
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <MapPin className="w-4 h-4 mt-0.5" />
                      <span>{patient.address}</span>
                    </div>
                  )}
                </div>

                {patient.primary_diagnosis && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-1">Primary Diagnosis</p>
                    <p className="text-sm text-gray-600">{patient.primary_diagnosis}</p>
                  </div>
                )}

                <div className="flex gap-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleShowSummary(patient)}
                                          className="gap-1"
                                          title="View AI Summary"
                                        >
                                          <FileText className="w-3 h-3" />
                                          Summary
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => {
                                            setEditingPatient(patient);
                                            setShowForm(true);
                                          }}
                                        >
                                          Edit
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => {
                                            setPatientToDelete(patient);
                                            setDeleteDialogOpen(true);
                                          }}
                                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                        <Link 
                                          to={`${createPageUrl("PatientDetails")}?id=${patient.id}`}
                                          className="flex-1"
                                        >
                                          <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700">
                                            View Details
                                          </Button>
                                        </Link>
                                      </div>

                {/* Visit type templates */}
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-gray-600 mb-2">Quick Schedule:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {visitTemplates.map((template) => (
                      <Button
                        key={template.type}
                        size="sm"
                        variant="outline"
                        onClick={() => createVisitFromTemplate.mutate({ 
                          patientId: patient.id, 
                          templateType: template.type 
                        })}
                        className="text-xs h-auto py-2"
                        disabled={createVisitFromTemplate.isLoading}
                      >
                        <span className="mr-1">{template.icon}</span>
                        {template.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
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

      {/* Enhanced Voice Commands */}
      <div className="fixed bottom-6 right-6 z-50">
        <EnhancedVoiceCommands
          onTranscription={(text) => setSearchTerm(text)}
          onCommand={handleVoiceCommand}
          commands={getCommandsForContext('patients')}
          mode="command"
          showSettings={true}
        />
      </div>

      {/* Patient Summary Dialog */}
                  <Dialog open={showSummaryDialog} onOpenChange={setShowSummaryDialog}>
                    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <FileText className="w-5 h-5 text-indigo-600" />
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
                </div>
              );
            }