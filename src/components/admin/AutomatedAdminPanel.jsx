import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { 
  Upload, 
  FileText, 
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Loader2,
  Download,
  Copy,
  Sparkles,
  TrendingUp
} from "lucide-react";
import { toast } from "sonner";

export default function AutomatedAdminPanel() {
  const [activeTab, setActiveTab] = useState('auto_populate');
  const [selectedPatient, setSelectedPatient] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [reportType, setReportType] = useState('progress_note');

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: recentVisits } = useQuery({
    queryKey: ['recentVisits', selectedPatient],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatient }, '-visit_date', 10),
    enabled: !!selectedPatient,
    initialData: []
  });

  const handleFileUpload = async (files) => {
    const fileList = Array.from(files);
    const pdfFiles = fileList.filter(f => f.type === 'application/pdf');
    
    if (pdfFiles.length === 0) {
      toast.error('Only PDF files are supported');
      return;
    }

    setProcessing(true);
    try {
      const uploadedUrls = [];
      for (const file of pdfFiles) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploadedUrls.push(file_url);
      }
      setUploadedFiles(uploadedUrls);
      toast.success(`${pdfFiles.length} file(s) uploaded`);
    } catch (error) {
      toast.error('Upload failed: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleAutoPopulate = async () => {
    if (uploadedFiles.length === 0) {
      toast.error('Please upload documents first');
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('autoPopulatePatientData', {
        file_urls: uploadedFiles,
        patient_id: selectedPatient || undefined
      });

      if (response?.data?.extracted_data) {
        setResult(response.data);
        toast.success('Data extracted successfully');
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      toast.error('Auto-population failed: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!selectedPatient) {
      toast.error('Please select a patient');
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('generateProgressReport', {
        patient_id: selectedPatient,
        report_type: reportType,
        date_range_days: 30
      });

      if (response?.data?.report) {
        setResult(response.data);
        toast.success('Report generated successfully');
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      toast.error('Report generation failed: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleBillingAnalysis = async (visitId) => {
    if (!visitId) {
      toast.error('Please select a visit');
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('detectBillingDiscrepancies', {
        visit_id: visitId
      });

      if (response?.data?.analysis) {
        setResult(response.data);
        toast.success('Billing analysis complete');
      } else {
        throw new Error('Invalid response');
      }
    } catch (error) {
      toast.error('Billing analysis failed: ' + error.message);
    } finally {
      setProcessing(false);
    }
  };

  const applyExtractedData = async () => {
    if (!result?.extracted_data || !selectedPatient) {
      toast.error('No data to apply or patient not selected');
      return;
    }

    try {
      const data = result.extracted_data;
      const updateData = {};

      // Map extracted data to patient fields
      if (data.demographics) {
        Object.assign(updateData, {
          first_name: data.demographics.first_name || undefined,
          middle_name: data.demographics.middle_name || undefined,
          last_name: data.demographics.last_name || undefined,
          date_of_birth: data.demographics.date_of_birth || undefined,
          medical_record_number: data.demographics.medical_record_number || undefined,
          phone: data.demographics.phone || undefined,
          email: data.demographics.email || undefined,
          address: data.demographics.address || undefined
        });
      }

      if (data.insurance_primary) {
        updateData.insurance_primary = data.insurance_primary;
      }

      if (data.insurance_secondary) {
        updateData.insurance_secondary = data.insurance_secondary;
      }

      if (data.emergency_contact) {
        Object.assign(updateData, {
          emergency_contact_name: data.emergency_contact.name,
          emergency_contact_phone: data.emergency_contact.phone,
          emergency_contact_relationship: data.emergency_contact.relationship
        });
      }

      if (data.care_team?.primary_care_physician) {
        Object.assign(updateData, {
          physician_name: data.care_team.primary_care_physician,
          physician_phone: data.care_team.pcp_phone
        });
      }

      if (data.clinical_summary) {
        Object.assign(updateData, {
          primary_diagnosis: data.clinical_summary.primary_diagnosis || undefined,
          secondary_diagnoses: data.clinical_summary.secondary_diagnoses?.map(d => d.diagnosis) || undefined,
          allergies: data.clinical_summary.allergies || undefined
        });
      }

      if (data.referral_information) {
        updateData.payor = data.referral_information.referral_source;
      }

      await base44.entities.Patient.update(selectedPatient, updateData);
      toast.success('Patient data updated successfully');
      setResult(null);
      setUploadedFiles([]);
    } catch (error) {
      toast.error('Failed to apply data: ' + error.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeTab === 'auto_populate' ? 'default' : 'outline'}
          onClick={() => setActiveTab('auto_populate')}
          size="sm"
        >
          <Upload className="w-4 h-4 mr-2" />
          Auto-Populate
        </Button>
        <Button
          variant={activeTab === 'reports' ? 'default' : 'outline'}
          onClick={() => setActiveTab('reports')}
          size="sm"
        >
          <FileText className="w-4 h-4 mr-2" />
          Generate Reports
        </Button>
        <Button
          variant={activeTab === 'billing' ? 'default' : 'outline'}
          onClick={() => setActiveTab('billing')}
          size="sm"
        >
          <DollarSign className="w-4 h-4 mr-2" />
          Billing Analysis
        </Button>
      </div>

      {/* Auto-Populate Tab */}
      {activeTab === 'auto_populate' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Auto-Populate Patient Data</CardTitle>
              <CardDescription>
                Upload referral or insurance documents to automatically extract and populate patient information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Select Patient (Optional)</label>
                <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                  <SelectTrigger>
                    <SelectValue placeholder="New patient or select existing..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>New Patient</SelectItem>
                    {patients.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Upload Documents</label>
                <input
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {uploadedFiles.length > 0 && (
                  <p className="text-sm text-green-600 mt-2">
                    {uploadedFiles.length} file(s) uploaded
                  </p>
                )}
              </div>

              <Button
                onClick={handleAutoPopulate}
                disabled={processing || uploadedFiles.length === 0}
                className="w-full"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Extracting Data...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Extract & Review Data
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {result?.extracted_data && (
            <Card className="border-2 border-green-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Extracted Data Ready
                </CardTitle>
                <div className="flex items-center gap-2 mt-2">
                  <Badge>{result.extracted_data.fields_extracted?.length || 0} fields extracted</Badge>
                  <Badge variant="outline">{result.extracted_data.extraction_confidence} confidence</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {result.extracted_data.demographics && (
                  <div>
                    <h4 className="font-semibold mb-2">Demographics</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(result.extracted_data.demographics).map(([key, value]) => 
                        value && (
                          <div key={key}>
                            <span className="text-slate-600">{key.replace(/_/g, ' ')}:</span>
                            <span className="ml-2 font-medium">{value}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {result.extracted_data.insurance_primary && (
                  <div>
                    <h4 className="font-semibold mb-2">Insurance (Primary)</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm bg-blue-50 dark:bg-blue-950 p-3 rounded-lg">
                      {Object.entries(result.extracted_data.insurance_primary).map(([key, value]) => 
                        value && (
                          <div key={key}>
                            <span className="text-slate-600">{key.replace(/_/g, ' ')}:</span>
                            <span className="ml-2 font-medium">{String(value)}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button onClick={applyExtractedData} className="flex-1 bg-green-600 hover:bg-green-700">
                    Apply to Patient Record
                  </Button>
                  <Button variant="outline" onClick={() => setResult(null)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Generate Progress Reports</CardTitle>
              <CardDescription>
                AI-generated reports based on recent visits and clinical data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Select Patient</label>
                <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose patient..." />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Report Type</label>
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progress_note">Progress Note</SelectItem>
                    <SelectItem value="discharge_summary">Discharge Summary</SelectItem>
                    <SelectItem value="recertification">Recertification Summary</SelectItem>
                    <SelectItem value="insurance_appeal">Insurance Appeal Letter</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleGenerateReport}
                disabled={processing || !selectedPatient}
                className="w-full"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Report...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Report
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {result?.report && (
            <Card>
              <CardHeader>
                <CardTitle>{result.report.report_title}</CardTitle>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(result.report.full_narrative)}>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </Button>
                  <Button size="sm" variant="outline">
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="prose max-w-none">
                  <div className="whitespace-pre-wrap text-sm bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                    {result.report.full_narrative}
                  </div>
                </div>

                {result.report.key_findings?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">Key Findings</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {result.report.key_findings.map((finding, idx) => (
                        <li key={idx} className="text-sm">{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Billing Analysis Tab */}
      {activeTab === 'billing' && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Billing Compliance Analysis</CardTitle>
              <CardDescription>
                AI-powered detection of billing discrepancies and coding errors
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Select Patient</label>
                <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose patient..." />
                  </SelectTrigger>
                  <SelectContent>
                    {patients.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPatient && recentVisits.length > 0 && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Select Visit to Analyze</label>
                  <div className="space-y-2">
                    {recentVisits.map(visit => (
                      <Button
                        key={visit.id}
                        variant="outline"
                        className="w-full justify-between"
                        onClick={() => handleBillingAnalysis(visit.id)}
                        disabled={processing}
                      >
                        <span>{visit.visit_type} - {visit.visit_date}</span>
                        <Badge variant="secondary">{visit.status}</Badge>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {result?.analysis && (
            <Card className={`border-2 ${
              result.analysis.risk_level === 'critical' ? 'border-red-500' :
              result.analysis.risk_level === 'high' ? 'border-orange-500' :
              result.analysis.risk_level === 'medium' ? 'border-amber-500' :
              'border-green-500'
            }`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Billing Analysis Results</CardTitle>
                  <Badge className={
                    result.analysis.risk_level === 'critical' ? 'bg-red-100 text-red-800' :
                    result.analysis.risk_level === 'high' ? 'bg-orange-100 text-orange-800' :
                    result.analysis.risk_level === 'medium' ? 'bg-amber-100 text-amber-800' :
                    'bg-green-100 text-green-800'
                  }>
                    {result.analysis.risk_level} risk
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-600">Compliance Score:</span>
                    <span className="text-2xl font-bold">{result.analysis.overall_compliance_score}%</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">{result.analysis.summary}</p>

                {result.analysis.discrepancies?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">Identified Issues ({result.analysis.discrepancies.length})</h4>
                    <div className="space-y-3">
                      {result.analysis.discrepancies.map((disc, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border-l-4"
                          style={{
                            borderColor: 
                              disc.severity === 'critical' ? '#ef4444' :
                              disc.severity === 'high' ? '#f97316' :
                              disc.severity === 'medium' ? '#f59e0b' : '#84cc16'
                          }}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <Badge variant="outline">{disc.category}</Badge>
                            <Badge className={
                              disc.severity === 'critical' ? 'bg-red-100 text-red-800' :
                              disc.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                              disc.severity === 'medium' ? 'bg-amber-100 text-amber-800' :
                              'bg-green-100 text-green-800'
                            }>
                              {disc.severity}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium mb-1">{disc.issue}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">{disc.impact}</p>
                          <div className="text-xs bg-white dark:bg-slate-900 p-2 rounded">
                            <strong>Recommendation:</strong> {disc.recommendation}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.analysis.optimization_opportunities?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-green-600" />
                      Revenue Optimization
                    </h4>
                    <div className="space-y-2">
                      {result.analysis.optimization_opportunities.map((opp, idx) => (
                        <div key={idx} className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                          <p className="text-sm font-medium">{opp.opportunity}</p>
                          <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                            {opp.potential_additional_revenue}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}