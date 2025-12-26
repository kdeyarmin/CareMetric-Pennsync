import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Download,
  User,
  Activity,
  Pill,
  ClipboardList,
  Phone,
  Calendar
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ReferralUploadProcessor({ 
  onPatientDataExtracted,
  onCreatePatient 
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [referralData, setReferralData] = useState(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState(null);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file');
      return;
    }

    setIsUploading(true);
    setIsProcessing(true);

    try {
      // Upload PDF
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadedFileUrl(file_url);

      // Extract and analyze referral data using AI
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical data extraction specialist. Analyze this home health referral document and extract ALL relevant clinical information for starting care.

Extract comprehensive details in the following categories:

**PATIENT DEMOGRAPHICS**
- Full name, DOB, age, gender, address, phone, email
- Emergency contacts (name, relationship, phone)
- Insurance information (primary, secondary, policy numbers)

**REFERRAL INFORMATION**
- Referring physician name, specialty, phone, fax
- Referral date, start of care date
- Care type (home health, hospice, skilled nursing)
- Primary diagnosis (ICD-10 code if listed)
- Secondary diagnoses

**MEDICAL HISTORY**
- Past medical history (all conditions)
- Past surgical history
- Hospitalizations (recent and relevant)
- Allergies (medications, foods, environmental)

**CURRENT MEDICATIONS**
- All medications with dosage, frequency, route
- PRN medications
- Recent medication changes

**FUNCTIONAL STATUS**
- Ambulation status (independent, walker, wheelchair, bedbound)
- ADL independence level
- Cognitive status
- Fall risk
- Wound/pressure injury information

**CURRENT CLINICAL STATUS**
- Recent vital signs (if documented)
- Chief complaints/symptoms
- Recent labs/diagnostics (dates and key values)
- Current treatments/therapies
- DME needs (oxygen, walker, hospital bed, etc.)

**ORDERS & TREATMENTS**
- Physician orders for home health
- Skilled nursing needs
- PT/OT/ST orders if applicable
- Frequency of visits ordered
- Treatment goals

**CARE PLAN NEEDS**
- Goals of care
- Patient/family concerns
- Special instructions
- Barriers to care (transportation, language, etc.)

**HOMEBOUND STATUS JUSTIFICATION**
- Reason patient qualifies as homebound
- Mobility limitations
- Medical contraindications to leaving home

Return ONLY information explicitly stated in the document. If information is not present, use null. Be thorough and precise.`,
        file_urls: [file_url],
        response_json_schema: {
          type: "object",
          properties: {
            patient_demographics: {
              type: "object",
              properties: {
                first_name: { type: "string" },
                last_name: { type: "string" },
                date_of_birth: { type: "string" },
                age: { type: "number" },
                gender: { type: "string" },
                address: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                emergency_contact_name: { type: "string" },
                emergency_contact_phone: { type: "string" },
                emergency_contact_relationship: { type: "string" }
              }
            },
            insurance: {
              type: "object",
              properties: {
                primary_payor: { type: "string" },
                policy_number: { type: "string" },
                group_number: { type: "string" }
              }
            },
            referral_info: {
              type: "object",
              properties: {
                physician_name: { type: "string" },
                physician_specialty: { type: "string" },
                physician_phone: { type: "string" },
                referral_date: { type: "string" },
                start_of_care_date: { type: "string" },
                care_type: { type: "string" }
              }
            },
            diagnoses: {
              type: "object",
              properties: {
                primary_diagnosis: { type: "string" },
                primary_icd10: { type: "string" },
                secondary_diagnoses: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            medical_history: {
              type: "object",
              properties: {
                past_medical_history: {
                  type: "array",
                  items: { type: "string" }
                },
                past_surgical_history: {
                  type: "array",
                  items: { type: "string" }
                },
                recent_hospitalizations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string" },
                      reason: { type: "string" },
                      hospital: { type: "string" }
                    }
                  }
                },
                allergies: { type: "string" }
              }
            },
            current_medications: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  dosage: { type: "string" },
                  frequency: { type: "string" },
                  route: { type: "string" }
                }
              }
            },
            functional_status: {
              type: "object",
              properties: {
                ambulation: { type: "string" },
                adl_level: { type: "string" },
                cognitive_status: { type: "string" },
                fall_risk: { type: "string" },
                wounds: { type: "string" }
              }
            },
            clinical_status: {
              type: "object",
              properties: {
                chief_complaints: {
                  type: "array",
                  items: { type: "string" }
                },
                recent_vitals: { type: "string" },
                recent_labs: { type: "string" },
                dme_needs: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            orders: {
              type: "object",
              properties: {
                skilled_nursing_orders: {
                  type: "array",
                  items: { type: "string" }
                },
                visit_frequency: { type: "string" },
                therapy_orders: {
                  type: "array",
                  items: { type: "string" }
                },
                treatment_goals: {
                  type: "array",
                  items: { type: "string" }
                }
              }
            },
            homebound_justification: { type: "string" },
            special_instructions: { type: "string" },
            nurse_summary: {
              type: "string",
              description: "A 3-4 sentence clinical summary for the nurse"
            }
          }
        }
      });

      setReferralData(result);
      if (onPatientDataExtracted) {
        onPatientDataExtracted(result);
      }

    } catch (error) {
      console.error('Error processing referral:', error);
      alert('Error processing referral. Please try again.');
    }

    setIsUploading(false);
    setIsProcessing(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  const createPatientFromReferral = async () => {
    if (!referralData || !onCreatePatient) return;

    const patientData = {
      first_name: referralData.patient_demographics?.first_name,
      last_name: referralData.patient_demographics?.last_name,
      date_of_birth: referralData.patient_demographics?.date_of_birth,
      address: referralData.patient_demographics?.address,
      phone: referralData.patient_demographics?.phone,
      email: referralData.patient_demographics?.email,
      emergency_contact_name: referralData.patient_demographics?.emergency_contact_name,
      emergency_contact_phone: referralData.patient_demographics?.emergency_contact_phone,
      emergency_contact_relationship: referralData.patient_demographics?.emergency_contact_relationship,
      physician_name: referralData.referral_info?.physician_name,
      physician_phone: referralData.referral_info?.physician_phone,
      primary_diagnosis: referralData.diagnoses?.primary_diagnosis,
      secondary_diagnoses: referralData.diagnoses?.secondary_diagnoses || [],
      payor: referralData.insurance?.primary_payor,
      current_medications: referralData.current_medications || [],
      past_medical_history: referralData.medical_history?.past_medical_history || [],
      allergies: referralData.medical_history?.allergies,
      admission_date: referralData.referral_info?.start_of_care_date,
      care_type: referralData.referral_info?.care_type === 'hospice' ? 'hospice' : 'home_health',
      functional_status: {
        ambulation: referralData.functional_status?.ambulation,
        adl_independence: referralData.functional_status?.adl_level,
        cognitive_status: referralData.functional_status?.cognitive_status,
        fall_risk: referralData.functional_status?.fall_risk
      }
    };

    await onCreatePatient(patientData);
  };

  return (
    <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="w-5 h-5 text-blue-600" />
          Referral Document Processor
          <Badge className="bg-blue-600 text-white">AI-Powered</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!referralData ? (
          <div className="space-y-4">
            <Alert className="bg-white border-blue-200">
              <Upload className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-gray-700">
                Upload a patient referral PDF to automatically extract medical history, diagnoses, medications, and start of care information.
              </AlertDescription>
            </Alert>

            <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-white">
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
                id="referral-upload"
                disabled={isUploading}
              />
              <label
                htmlFor="referral-upload"
                className="cursor-pointer flex flex-col items-center gap-3"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                    <p className="text-sm font-medium text-gray-900">Processing referral...</p>
                    <p className="text-xs text-gray-500">Extracting clinical data with AI</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-blue-600" />
                    <p className="text-sm font-medium text-gray-900">Click to upload referral PDF</p>
                    <p className="text-xs text-gray-500">PDF files only</p>
                  </>
                )}
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                <strong>Referral processed successfully!</strong> Review the extracted information below.
              </AlertDescription>
            </Alert>

            {/* Clinical Summary */}
            <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-purple-900 mb-2">Clinical Summary</p>
                <p className="text-sm text-gray-700">{referralData.nurse_summary}</p>
              </CardContent>
            </Card>

            <Tabs defaultValue="demographics" className="w-full">
              <TabsList className="grid grid-cols-3 lg:grid-cols-6 gap-1">
                <TabsTrigger value="demographics" className="text-xs">Demographics</TabsTrigger>
                <TabsTrigger value="diagnoses" className="text-xs">Diagnoses</TabsTrigger>
                <TabsTrigger value="medications" className="text-xs">Medications</TabsTrigger>
                <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                <TabsTrigger value="functional" className="text-xs">Functional</TabsTrigger>
                <TabsTrigger value="orders" className="text-xs">Orders</TabsTrigger>
              </TabsList>

              <TabsContent value="demographics" className="space-y-3">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Patient Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <InfoRow label="Name" value={`${referralData.patient_demographics?.first_name || ''} ${referralData.patient_demographics?.last_name || ''}`} />
                    <InfoRow label="DOB" value={referralData.patient_demographics?.date_of_birth} />
                    <InfoRow label="Age" value={referralData.patient_demographics?.age} />
                    <InfoRow label="Gender" value={referralData.patient_demographics?.gender} />
                    <InfoRow label="Address" value={referralData.patient_demographics?.address} />
                    <InfoRow label="Phone" value={referralData.patient_demographics?.phone} />
                    <InfoRow label="Emergency Contact" value={`${referralData.patient_demographics?.emergency_contact_name || ''} (${referralData.patient_demographics?.emergency_contact_relationship || ''}) - ${referralData.patient_demographics?.emergency_contact_phone || ''}`} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Referring Physician
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <InfoRow label="Name" value={referralData.referral_info?.physician_name} />
                    <InfoRow label="Specialty" value={referralData.referral_info?.physician_specialty} />
                    <InfoRow label="Phone" value={referralData.referral_info?.physician_phone} />
                    <InfoRow label="Referral Date" value={referralData.referral_info?.referral_date} />
                    <InfoRow label="Start of Care" value={referralData.referral_info?.start_of_care_date} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="diagnoses" className="space-y-3">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Diagnoses
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-1">Primary Diagnosis</p>
                      <Badge className="bg-red-100 text-red-800 border-red-300">
                        {referralData.diagnoses?.primary_diagnosis}
                        {referralData.diagnoses?.primary_icd10 && ` (${referralData.diagnoses.primary_icd10})`}
                      </Badge>
                    </div>
                    {referralData.diagnoses?.secondary_diagnoses?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-1">Secondary Diagnoses</p>
                        <div className="flex flex-wrap gap-2">
                          {referralData.diagnoses.secondary_diagnoses.map((dx, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">{dx}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {referralData.homebound_justification && (
                  <Card className="bg-yellow-50 border-yellow-300">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-yellow-900">Homebound Justification</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-gray-700">{referralData.homebound_justification}</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="medications" className="space-y-3">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Pill className="w-4 h-4" />
                      Current Medications
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {referralData.current_medications?.length > 0 ? (
                      <div className="space-y-2">
                        {referralData.current_medications.map((med, idx) => (
                          <div key={idx} className="p-2 bg-gray-50 rounded border">
                            <p className="font-medium text-sm text-gray-900">{med.name}</p>
                            <p className="text-xs text-gray-600">
                              {med.dosage} {med.route && `• ${med.route}`} {med.frequency && `• ${med.frequency}`}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No medications documented</p>
                    )}
                  </CardContent>
                </Card>

                {referralData.medical_history?.allergies && (
                  <Card className="bg-red-50 border-red-300">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-red-900 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Allergies
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-red-800">{referralData.medical_history.allergies}</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="history" className="space-y-3">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Past Medical History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {referralData.medical_history?.past_medical_history?.length > 0 ? (
                      <ul className="space-y-1">
                        {referralData.medical_history.past_medical_history.map((item, idx) => (
                          <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                            <span className="text-blue-600">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-500">No history documented</p>
                    )}
                  </CardContent>
                </Card>

                {referralData.medical_history?.past_surgical_history?.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Past Surgical History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {referralData.medical_history.past_surgical_history.map((item, idx) => (
                          <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                            <span className="text-blue-600">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {referralData.medical_history?.recent_hospitalizations?.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Recent Hospitalizations</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {referralData.medical_history.recent_hospitalizations.map((hosp, idx) => (
                        <div key={idx} className="p-2 bg-gray-50 rounded border">
                          <p className="text-sm font-medium text-gray-900">{hosp.reason}</p>
                          <p className="text-xs text-gray-600">{hosp.date} • {hosp.hospital}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="functional" className="space-y-3">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Functional Status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <InfoRow label="Ambulation" value={referralData.functional_status?.ambulation} />
                    <InfoRow label="ADL Level" value={referralData.functional_status?.adl_level} />
                    <InfoRow label="Cognitive Status" value={referralData.functional_status?.cognitive_status} />
                    <InfoRow label="Fall Risk" value={referralData.functional_status?.fall_risk} />
                    {referralData.functional_status?.wounds && (
                      <InfoRow label="Wounds" value={referralData.functional_status.wounds} />
                    )}
                  </CardContent>
                </Card>

                {referralData.clinical_status?.dme_needs?.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">DME Needs</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {referralData.clinical_status.dme_needs.map((item, idx) => (
                          <Badge key={idx} variant="outline">{item}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="orders" className="space-y-3">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ClipboardList className="w-4 h-4" />
                      Physician Orders
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {referralData.orders?.visit_frequency && (
                      <InfoRow label="Visit Frequency" value={referralData.orders.visit_frequency} />
                    )}
                    
                    {referralData.orders?.skilled_nursing_orders?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-1">Skilled Nursing Orders</p>
                        <ul className="space-y-1">
                          {referralData.orders.skilled_nursing_orders.map((order, idx) => (
                            <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                              <span className="text-blue-600">•</span>
                              {order}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {referralData.orders?.treatment_goals?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-1">Treatment Goals</p>
                        <ul className="space-y-1">
                          {referralData.orders.treatment_goals.map((goal, idx) => (
                            <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                              <span className="text-green-600">✓</span>
                              {goal}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={createPatientFromReferral}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                <User className="w-4 h-4 mr-2" />
                Create Patient from Referral
              </Button>
              {uploadedFileUrl && (
                <Button
                  onClick={() => window.open(uploadedFileUrl, '_blank')}
                  variant="outline"
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  View Original PDF
                </Button>
              )}
              <Button
                onClick={() => {
                  setReferralData(null);
                  setUploadedFileUrl(null);
                }}
                variant="outline"
              >
                Upload Another
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-start gap-2 py-1 border-b border-gray-100 last:border-0">
      <span className="text-gray-600 font-medium">{label}:</span>
      <span className="text-gray-900 text-right flex-1">{value}</span>
    </div>
  );
}