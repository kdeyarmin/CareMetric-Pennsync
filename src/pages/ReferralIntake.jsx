import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { 
  Upload, 
  FileText, 
  UserPlus,
  CheckCircle,
  XCircle,
  Loader2,
  Sparkles,
  Users,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';
import PremiumFeatureGate from '../components/subscription/PremiumFeatureGate';

export default function ReferralIntake() {
  const [extractedData, setExtractedData] = useState(null);
  const [selectedReferral, setSelectedReferral] = useState(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);
  const queryClient = useQueryClient();

  const { data: referrals, isLoading } = useQuery({
    queryKey: ['referrals'],
    queryFn: async () => {
      const refs = await base44.entities.Referral.filter({});
      return refs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
  });

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.filter({})
  });

  const uploadFileMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
    onSuccess: (fileUrl) => {
      setUploadedFileUrl(fileUrl);
      toast.success('File uploaded successfully');
    },
    onError: (error) => {
      toast.error('Upload failed: ' + error.message);
    }
  });

  const extractDataMutation = useMutation({
    mutationFn: async (fileUrl) => {
      const response = await base44.functions.invoke('processReferralDocument', {
        file_url: fileUrl
      });
      return response.data;
    },
    onSuccess: (data) => {
      setExtractedData(data);
      toast.success('Data extracted successfully');
    },
    onError: (error) => {
      toast.error('Extraction failed: ' + error.message);
    }
  });

  const createReferralMutation = useMutation({
    mutationFn: async (referralData) => {
      return await base44.entities.Referral.create(referralData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['referrals']);
      setExtractedData(null);
      setUploadedFileUrl(null);
      toast.success('Referral created successfully');
    },
    onError: (error) => {
      toast.error('Failed to create referral: ' + error.message);
    }
  });

  const acceptReferralMutation = useMutation({
    mutationFn: async ({ referralId, patientData }) => {
      // Create patient from referral
      const patient = await base44.entities.Patient.create(patientData);
      
      // Update referral status
      await base44.entities.Referral.update(referralId, {
        status: 'accepted',
        patient_id: patient.id
      });
      
      return patient;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['referrals']);
      queryClient.invalidateQueries(['patients']);
      toast.success('Referral accepted and patient created');
    },
    onError: (error) => {
      toast.error('Failed to accept referral: ' + error.message);
    }
  });

  const rejectReferralMutation = useMutation({
    mutationFn: async ({ referralId, reason }) => {
      return await base44.entities.Referral.update(referralId, {
        status: 'rejected',
        rejection_reason: reason
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['referrals']);
      toast.success('Referral rejected');
    }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileUrl = await uploadFileMutation.mutateAsync(file);
    extractDataMutation.mutate(fileUrl);
  };

  const handleCreateReferral = () => {
    if (!extractedData) return;

    createReferralMutation.mutate({
      referral_source: extractedData.referral_source || 'Unknown',
      referral_date: extractedData.referral_date || new Date().toISOString().split('T')[0],
      patient_name: extractedData.patient_name,
      patient_dob: extractedData.date_of_birth,
      patient_phone: extractedData.phone_number,
      patient_address: extractedData.address,
      primary_diagnosis: extractedData.primary_diagnosis,
      secondary_diagnoses: extractedData.secondary_diagnoses || [],
      referring_physician: extractedData.referring_physician,
      insurance_info: extractedData.insurance_info || {},
      clinical_notes: extractedData.clinical_notes,
      status: 'pending',
      document_url: uploadedFileUrl
    });
  };

  const pendingReferrals = referrals?.filter(r => r.status === 'pending') || [];
  const acceptedReferrals = referrals?.filter(r => r.status === 'accepted') || [];
  const rejectedReferrals = referrals?.filter(r => r.status === 'rejected') || [];

  return (
    <PremiumFeatureGate featureName="Referral Intake" featureDescription="Manage and process new patient referrals with AI-powered data extraction." allowTrial={true}>
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Referral Intake</h1>
            <p className="text-sm text-slate-600 mt-1">Process new patient referrals with AI</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{referrals?.length || 0}</p>
                  <p className="text-xs text-slate-600">Total Referrals</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pendingReferrals.length}</p>
                  <p className="text-xs text-slate-600">Pending Review</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{acceptedReferrals.length}</p>
                  <p className="text-xs text-slate-600">Accepted</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-100 rounded-lg">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{rejectedReferrals.length}</p>
                  <p className="text-xs text-slate-600">Rejected</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Referral Document
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  id="referral-upload"
                  disabled={uploadFileMutation.isPending || extractDataMutation.isPending}
                />
                <label htmlFor="referral-upload" className="cursor-pointer">
                  {uploadFileMutation.isPending || extractDataMutation.isPending ? (
                    <Loader2 className="h-12 w-12 text-blue-600 mx-auto mb-4 animate-spin" />
                  ) : (
                    <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                  )}
                  <p className="text-sm text-slate-600 mb-2">
                    {uploadFileMutation.isPending ? 'Uploading...' : 
                     extractDataMutation.isPending ? 'Extracting data...' :
                     'Click to upload referral document'}
                  </p>
                  <p className="text-xs text-slate-500">
                    PDF, DOC, DOCX, JPG, or PNG (max 10MB)
                  </p>
                </label>
              </div>

              {/* Extracted Data */}
              {extractedData && (
                <Card className="border-2 border-blue-300 bg-blue-50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Sparkles className="h-5 w-5 text-blue-600" />
                      Extracted Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-slate-600 mb-1">Patient Name</p>
                        <p className="font-medium">{extractedData.patient_name || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600 mb-1">Date of Birth</p>
                        <p className="font-medium">{extractedData.date_of_birth || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600 mb-1">Phone</p>
                        <p className="font-medium">{extractedData.phone_number || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600 mb-1">Referral Source</p>
                        <p className="font-medium">{extractedData.referral_source || 'N/A'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs text-slate-600 mb-1">Primary Diagnosis</p>
                        <p className="font-medium">{extractedData.primary_diagnosis || 'N/A'}</p>
                      </div>
                    </div>
                    <Button
                      onClick={handleCreateReferral}
                      disabled={createReferralMutation.isPending}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {createReferralMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4 mr-2" />
                          Create Referral
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pending Referrals */}
        <Card>
          <CardHeader>
            <CardTitle>Pending Referrals ({pendingReferrals.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : pendingReferrals.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-600">No pending referrals</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pendingReferrals.map(referral => (
                  <Card key={referral.id} className="border-2">
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-bold text-lg">{referral.patient_name}</h3>
                          <p className="text-sm text-slate-600">
                            DOB: {referral.patient_dob} • Phone: {referral.patient_phone}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Referred by: {referral.referring_physician || 'Unknown'}
                          </p>
                        </div>
                        <Badge>Pending</Badge>
                      </div>

                      <div className="space-y-2 mb-4">
                        <div>
                          <p className="text-xs text-slate-600">Primary Diagnosis</p>
                          <p className="text-sm font-medium">{referral.primary_diagnosis}</p>
                        </div>
                        {referral.clinical_notes && (
                          <div>
                            <p className="text-xs text-slate-600">Clinical Notes</p>
                            <p className="text-sm">{referral.clinical_notes}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={() => acceptReferralMutation.mutate({
                            referralId: referral.id,
                            patientData: {
                              full_name: referral.patient_name,
                              date_of_birth: referral.patient_dob,
                              phone: referral.patient_phone,
                              address: referral.patient_address,
                              primary_diagnosis: referral.primary_diagnosis,
                              secondary_diagnoses: referral.secondary_diagnoses,
                              status: 'active',
                              admission_date: new Date().toISOString().split('T')[0]
                            }
                          })}
                          disabled={acceptReferralMutation.isPending}
                          className="flex-1 bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Accept & Create Patient
                        </Button>
                        <Button
                          onClick={() => rejectReferralMutation.mutate({
                            referralId: referral.id,
                            reason: 'Not specified'
                          })}
                          disabled={rejectReferralMutation.isPending}
                          variant="outline"
                          className="flex-1"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
    </PremiumFeatureGate>
  );
}