import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ArrowRight, ArrowLeft, Upload, Loader2, CheckCircle2, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

export default function PatientOnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    // Demographics
    first_name: "",
    middle_name: "",
    last_name: "",
    date_of_birth: "",
    phone: "",
    email: "",
    address: "",
    
    // Insurance
    payor: "",
    insurance_primary: {
      provider: "",
      policy_number: "",
      group_number: "",
      effective_date: ""
    },
    
    // Primary Care
    physician_name: "",
    physician_phone: "",
    physician_email: "",
    
    // Emergency Contact
    emergency_contact_name: "",
    emergency_contact_phone: "",
    emergency_contact_relationship: "",
    
    // Clinical
    primary_diagnosis: "",
    allergies: "",
    current_medications: []
  });
  
  const [insuranceCardFile, setInsuranceCardFile] = useState(null);
  const [uploadingCard, setUploadingCard] = useState(false);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  
  const queryClient = useQueryClient();

  const totalSteps = 4;
  const progress = (step / totalSteps) * 100;

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateNestedField = (parent, field, value) => {
    setFormData(prev => ({
      ...prev,
      [parent]: { ...prev[parent], [field]: value }
    }));
  };

  const handleInsuranceCardUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingCard(true);
    try {
      // Upload the file
      const uploadResponse = await base44.integrations.Core.UploadFile({ file });
      setInsuranceCardFile(uploadResponse.file_url);

      // Extract data from insurance card using AI
      const extractResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `Extract insurance information from this insurance card image. Provide accurate data extraction.`,
        file_urls: [uploadResponse.file_url],
        response_json_schema: {
          type: "object",
          properties: {
            provider: { type: "string" },
            policy_number: { type: "string" },
            group_number: { type: "string" },
            member_name: { type: "string" },
            effective_date: { type: "string" }
          }
        }
      });

      // Auto-populate insurance fields
      if (extractResponse.provider) {
        setFormData(prev => ({
          ...prev,
          insurance_primary: {
            provider: extractResponse.provider || "",
            policy_number: extractResponse.policy_number || "",
            group_number: extractResponse.group_number || "",
            effective_date: extractResponse.effective_date || ""
          }
        }));
        setExtractedData(extractResponse);
        toast.success("Insurance data extracted successfully");
      }
    } catch (error) {
      toast.error("Failed to process insurance card");
      console.error(error);
    } finally {
      setUploadingCard(false);
    }
  };

  const generateAISuggestions = async () => {
    setAiSuggesting(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Based on this partial patient data, suggest likely additional information to help complete the profile:

Current Data:
- Name: ${formData.first_name} ${formData.last_name}
- Age: ${formData.date_of_birth ? Math.floor((Date.now() - new Date(formData.date_of_birth)) / 31557600000) : 'Unknown'}
- Primary Diagnosis: ${formData.primary_diagnosis || 'Not provided'}
- Insurance: ${formData.payor || 'Not provided'}

Provide smart suggestions for:
1. Common medications for their condition
2. Typical specialists they might need
3. Care setting recommendations
4. Common allergies to screen for`,
        response_json_schema: {
          type: "object",
          properties: {
            suggested_medications: { type: "array", items: { type: "string" } },
            recommended_specialists: { type: "array", items: { type: "string" } },
            care_recommendations: { type: "string" },
            common_allergies_to_check: { type: "array", items: { type: "string" } }
          }
        }
      });

      toast.success("AI suggestions generated");
      return response;
    } catch (error) {
      toast.error("Failed to generate suggestions");
      console.error(error);
    } finally {
      setAiSuggesting(false);
    }
  };

  const createPatientMutation = useMutation({
    mutationFn: async (data) => {
      const patient = await base44.entities.Patient.create(data);
      
      // Log onboarding completion
      await base44.entities.UserActivity.create({
        user_email: (await base44.auth.me()).email,
        action: 'patient_onboarded',
        entity_type: 'Patient',
        entity_id: patient.id,
        details: { onboarding_completed: true }
      });
      
      return patient;
    },
    onSuccess: (patient) => {
      queryClient.invalidateQueries(['allPatients']);
      queryClient.invalidateQueries(['patients']);
      toast.success("Patient onboarded successfully!");
      if (onComplete) onComplete(patient);
    },
    onError: () => {
      toast.error("Failed to create patient");
    }
  });

  const handleNext = () => {
    if (step === 1 && (!formData.first_name || !formData.last_name)) {
      toast.error("First and last name are required");
      return;
    }
    if (step < totalSteps) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = () => {
    createPatientMutation.mutate(formData);
  };

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between mb-4">
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            Patient Onboarding
          </CardTitle>
          <span className="text-sm text-gray-600">Step {step} of {totalSteps}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Step 1: Demographics */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Patient Demographics</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={formData.first_name}
                  onChange={(e) => updateField('first_name', e.target.value)}
                  placeholder="John"
                />
              </div>
              <div>
                <Label>Middle Name</Label>
                <Input
                  value={formData.middle_name}
                  onChange={(e) => updateField('middle_name', e.target.value)}
                  placeholder="M."
                />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input
                  value={formData.last_name}
                  onChange={(e) => updateField('last_name', e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Date of Birth</Label>
                <Input
                  type="date"
                  value={formData.date_of_birth}
                  onChange={(e) => updateField('date_of_birth', e.target.value)}
                />
              </div>
              <div>
                <Label>Phone Number</Label>
                <Input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="john.doe@email.com"
              />
            </div>

            <div>
              <Label>Address</Label>
              <Textarea
                value={formData.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder="123 Main Street, City, State, ZIP"
                rows={2}
              />
            </div>
          </div>
        )}

        {/* Step 2: Insurance */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Insurance Information</h3>
              <Button
                onClick={generateAISuggestions}
                disabled={aiSuggesting}
                variant="outline"
                size="sm"
              >
                {aiSuggesting ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 mr-1" />
                    AI Assist
                  </>
                )}
              </Button>
            </div>

            <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border-2 border-dashed border-blue-200">
              <Label className="block mb-2">Upload Insurance Card</Label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleInsuranceCardUpload}
                className="hidden"
                id="insurance-card-upload"
              />
              <label htmlFor="insurance-card-upload">
                <Button
                  asChild
                  variant="outline"
                  disabled={uploadingCard}
                  className="w-full cursor-pointer"
                >
                  <div>
                    {uploadingCard ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Insurance Card (Auto-fills fields)
                      </>
                    )}
                  </div>
                </Button>
              </label>
              {insuranceCardFile && (
                <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Card uploaded and processed
                </p>
              )}
            </div>

            <div>
              <Label>Primary Payor</Label>
              <Select value={formData.payor} onValueChange={(v) => updateField('payor', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payor..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Medicare">Medicare</SelectItem>
                  <SelectItem value="Medicaid">Medicaid</SelectItem>
                  <SelectItem value="Private Insurance">Private Insurance</SelectItem>
                  <SelectItem value="Self-Pay">Self-Pay</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Insurance Provider</Label>
                <Input
                  value={formData.insurance_primary.provider}
                  onChange={(e) => updateNestedField('insurance_primary', 'provider', e.target.value)}
                  placeholder="Blue Cross Blue Shield"
                />
              </div>
              <div>
                <Label>Policy Number</Label>
                <Input
                  value={formData.insurance_primary.policy_number}
                  onChange={(e) => updateNestedField('insurance_primary', 'policy_number', e.target.value)}
                  placeholder="ABC123456789"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Group Number</Label>
                <Input
                  value={formData.insurance_primary.group_number}
                  onChange={(e) => updateNestedField('insurance_primary', 'group_number', e.target.value)}
                  placeholder="GRP12345"
                />
              </div>
              <div>
                <Label>Effective Date</Label>
                <Input
                  type="date"
                  value={formData.insurance_primary.effective_date}
                  onChange={(e) => updateNestedField('insurance_primary', 'effective_date', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Primary Care Provider */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Primary Care Physician</h3>

            <div>
              <Label>Physician Name</Label>
              <Input
                value={formData.physician_name}
                onChange={(e) => updateField('physician_name', e.target.value)}
                placeholder="Dr. Jane Smith"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Physician Phone</Label>
                <Input
                  type="tel"
                  value={formData.physician_phone}
                  onChange={(e) => updateField('physician_phone', e.target.value)}
                  placeholder="(555) 987-6543"
                />
              </div>
              <div>
                <Label>Physician Email</Label>
                <Input
                  type="email"
                  value={formData.physician_email}
                  onChange={(e) => updateField('physician_email', e.target.value)}
                  placeholder="dr.smith@clinic.com"
                />
              </div>
            </div>

            <h3 className="font-semibold text-lg mt-6">Emergency Contact</h3>

            <div>
              <Label>Contact Name</Label>
              <Input
                value={formData.emergency_contact_name}
                onChange={(e) => updateField('emergency_contact_name', e.target.value)}
                placeholder="Jane Doe"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Contact Phone</Label>
                <Input
                  type="tel"
                  value={formData.emergency_contact_phone}
                  onChange={(e) => updateField('emergency_contact_phone', e.target.value)}
                  placeholder="(555) 111-2222"
                />
              </div>
              <div>
                <Label>Relationship</Label>
                <Input
                  value={formData.emergency_contact_relationship}
                  onChange={(e) => updateField('emergency_contact_relationship', e.target.value)}
                  placeholder="Spouse, Daughter, etc."
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Clinical Information */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-lg">Clinical Information</h3>

            <div>
              <Label>Primary Diagnosis</Label>
              <Input
                value={formData.primary_diagnosis}
                onChange={(e) => updateField('primary_diagnosis', e.target.value)}
                placeholder="e.g., Congestive Heart Failure"
              />
            </div>

            <div>
              <Label>Known Allergies</Label>
              <Textarea
                value={formData.allergies}
                onChange={(e) => updateField('allergies', e.target.value)}
                placeholder="List any known allergies (medications, foods, environmental)..."
                rows={3}
              />
            </div>

            <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <p className="font-semibold text-green-900 dark:text-green-100">
                  Ready to Create Patient Profile
                </p>
              </div>
              <p className="text-sm text-green-700 dark:text-green-300">
                Review the information and click "Complete Onboarding" to create the patient record.
                You can add more details later from the patient profile.
              </p>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex justify-between pt-6 border-t">
          <Button
            onClick={handleBack}
            disabled={step === 1}
            variant="outline"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          {step < totalSteps ? (
            <Button
              onClick={handleNext}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createPatientMutation.isPending}
              className="bg-green-600 hover:bg-green-700"
            >
              {createPatientMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Complete Onboarding
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}