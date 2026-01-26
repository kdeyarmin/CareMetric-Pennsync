import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, History } from 'lucide-react';
import TemplateSelectionFlow from '../components/documents/TemplateSelectionFlow';
import DocumentDataForm from '../components/documents/DocumentDataForm';
import DocumentPreview from '../components/documents/DocumentPreview';
import ContextualTemplatesSuggester from '../components/documents/ContextualTemplatesSuggester';
import QuickPhraseInsert from '../components/documents/QuickPhraseInsert';
import EmptyState from '../components/ui/EmptyState';
import PullToRefresh from '../components/mobile/PullToRefresh';

export default function DocumentGenerator() {
  const [step, setStep] = useState('select'); // select, form, preview
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedPatientForDoc, setSelectedPatientForDoc] = useState(null);
  const [generatedDocument, setGeneratedDocument] = useState(null);
  const [selectedHistoryDoc, setSelectedHistoryDoc] = useState(null);
  const [preFilledData, setPreFilledData] = useState({});
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['documentTemplates'],
    queryFn: () => base44.entities.DocumentTemplate.list('-created_date', 100)
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100)
  });

  const { data: generatedDocuments = [] } = useQuery({
    queryKey: ['generatedDocuments', currentUser?.email],
    queryFn: () => base44.entities.GeneratedDocument.filter({ created_by: currentUser?.email }, '-created_date'),
    enabled: !!currentUser?.email
  });

  const generateDocMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('generateDocument', {
        template: selectedTemplate,
        generation_data: data.generation_data,
        custom_text: data.custom_text
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setGeneratedDocument(data.document);
      setStep('preview');
      queryClient.invalidateQueries({ queryKey: ['generatedDocuments'] });
    }
  });

  const updateDocMutation = useMutation({
    mutationFn: (doc) => base44.entities.GeneratedDocument.update(doc.id, {
      generated_content: doc.generated_content,
      status: 'final'
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generatedDocuments'] });
    }
  });

  const sendDocMutation = useMutation({
    mutationFn: async (doc) => {
      await base44.integrations.Core.SendEmail({
        to: doc.patient_email,
        subject: `Patient Document: ${doc.document_name}`,
        body: `Dear Patient,\n\nPlease find your ${doc.template_type.replace('_', ' ')} document attached.\n\nIf you have any questions, please contact your healthcare provider.\n\nBest regards,\nYour Healthcare Team`
      });

      return base44.entities.GeneratedDocument.update(doc.id, {
        status: 'sent',
        sent_date: new Date().toISOString(),
        sent_via: 'email'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generatedDocuments'] });
    }
  });

  const patient = patients.find(p => p.id === generatedDocument?.patient_id);

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries({ queryKey: ['documentTemplates', 'generatedDocuments'] });
    }}>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <Tabs value={step === 'preview' && selectedHistoryDoc ? 'history' : (step === 'select' ? 'templates' : 'templates')} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="templates">
              <FileText className="w-4 h-4 mr-2" />
              Create Document
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="w-4 h-4 mr-2" />
              My Documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-6 mt-6">
            {step === 'select' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">Create Document</h2>
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    Select a patient to see AI-recommended templates tailored to their clinical profile.
                  </p>
                </div>

                {!selectedPatientForDoc ? (
                  <Card>
                    <CardContent className="p-6">
                      <Label className="text-base font-semibold mb-3 block">Select Patient</Label>
                      <Select value={selectedPatientForDoc || ''} onValueChange={setSelectedPatientForDoc}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a patient..." />
                        </SelectTrigger>
                        <SelectContent>
                          {patients.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.first_name} {p.last_name} {p.date_of_birth && `(DOB: ${p.date_of_birth})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </CardContent>
                  </Card>
                ) : (
                   <>
                     <Button
                       variant="outline"
                       onClick={() => setSelectedPatientForDoc(null)}
                       className="mb-4"
                     >
                       Change Patient
                     </Button>
                     {/* Contextual Suggestions */}
                     {patients.find(p => p.id === selectedPatientForDoc) && (
                       <div className="space-y-4">
                         <ContextualTemplatesSuggester
                           patientDiagnosis={patients.find(p => p.id === selectedPatientForDoc)?.primary_diagnosis}
                           visitType={null}
                           availableTemplates={templates}
                           onTemplateSelect={(template) => {
                             setSelectedTemplate(template);
                             setStep('form');
                           }}
                         />
                         <QuickPhraseInsert
                           patientDiagnosis={patients.find(p => p.id === selectedPatientForDoc)?.primary_diagnosis}
                           visitType={null}
                         />
                       </div>
                     )}
                     <TemplateSelectionFlow
                       patient={patients.find(p => p.id === selectedPatientForDoc)}
                       templates={templates}
                       onSelect={(template, prefilled) => {
                         setSelectedTemplate(template);
                         setPreFilledData(prefilled);
                         setStep('form');
                       }}
                       loading={templatesLoading}
                     />
                   </>
                 )}
              </div>
            )}

            {step === 'form' && selectedTemplate && (
              <DocumentDataForm
                template={selectedTemplate}
                patients={patients}
                onGenerate={(data) => {
                  // Merge pre-filled data with form data
                  const mergedData = {
                    ...data,
                    generation_data: {
                      ...preFilledData,
                      ...data.generation_data
                    }
                  };
                  generateDocMutation.mutate(mergedData);
                }}
                onBack={() => {
                  setStep('select');
                  setSelectedPatientForDoc(null);
                  setPreFilledData({});
                }}
                generating={generateDocMutation.isPending}
              />
            )}

            {step === 'preview' && generatedDocument && (
              <DocumentPreview
                document={generatedDocument}
                patient={patient}
                onClose={() => {
                  setStep('select');
                  setGeneratedDocument(null);
                  setSelectedTemplate(null);
                }}
                onSave={(doc) => updateDocMutation.mutate(doc)}
                onSend={(doc) => sendDocMutation.mutate(doc)}
                saving={updateDocMutation.isPending || sendDocMutation.isPending}
              />
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">My Generated Documents</h2>
              <p className="text-slate-600 dark:text-slate-400">View, edit, and resend previously generated documents.</p>
            </div>

            {generatedDocuments.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No Documents Yet"
                description="Create your first patient document to get started."
              />
            ) : (
              <div className="grid gap-4">
                {generatedDocuments.map((doc) => (
                  <Card
                    key={doc.id}
                    className="cursor-pointer hover:shadow-lg transition-shadow"
                    onClick={() => {
                      setSelectedHistoryDoc(doc);
                      setGeneratedDocument(doc);
                      setStep('preview');
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                            {doc.document_name}
                          </h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Patient: {doc.patient_name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                            Created: {new Date(doc.created_date).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`inline-block px-3 py-1 rounded text-sm font-medium ${
                            doc.status === 'sent' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                            doc.status === 'final' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                            'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                          }`}>
                            {doc.status.charAt(0).toUpperCase() + doc.status.slice(1)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PullToRefresh>
  );
}