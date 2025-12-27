import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, FileText, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export default function PatientDataExporter() {
  const [format, setFormat] = useState("csv");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedPatients, setSelectedPatients] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState(null);

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 500),
    initialData: [],
  });

  const handleExport = async () => {
    setIsExporting(true);
    setExportMessage(null);

    try {
      const response = await base44.functions.invoke('exportPatientData', {
        format,
        start_date: startDate || null,
        end_date: endDate || null,
        patient_ids: selectedPatients.length > 0 ? selectedPatients : null
      });

      // Create blob and download
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/pdf'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `patient_export_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      setExportMessage({
        type: 'success',
        text: `Successfully exported ${selectedPatients.length > 0 ? selectedPatients.length : patients.length} patient(s) to ${format.toUpperCase()}`
      });
    } catch (error) {
      console.error('Export error:', error);
      setExportMessage({
        type: 'error',
        text: error.message || 'Failed to export data'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const togglePatientSelection = (patientId) => {
    setSelectedPatients(prev =>
      prev.includes(patientId)
        ? prev.filter(id => id !== patientId)
        : [...prev, patientId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedPatients.length === patients.length) {
      setSelectedPatients([]);
    } else {
      setSelectedPatients(patients.map(p => p.id));
    }
  };

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5 text-blue-600" />
          Export Patient Data
        </CardTitle>
        <p className="text-sm text-gray-600">
          Export patient demographics, visit history, and compliance audit summaries
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Export Format */}
        <div className="space-y-2">
          <Label>Export Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4" />
                  CSV (Spreadsheet)
                </div>
              </SelectItem>
              <SelectItem value="pdf">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  PDF (Report)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        {/* Patient Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Select Patients (optional)</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
            >
              {selectedPatients.length === patients.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
          
          <div className="border rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
            {patients.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No patients available</p>
            ) : (
              patients.map(patient => (
                <div key={patient.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedPatients.includes(patient.id)}
                    onCheckedChange={() => togglePatientSelection(patient.id)}
                  />
                  <label className="text-sm flex-1 cursor-pointer">
                    {patient.first_name} {patient.last_name}
                    <span className="text-gray-500 ml-2">
                      ({patient.status || 'active'})
                    </span>
                  </label>
                </div>
              ))
            )}
          </div>
          
          <p className="text-xs text-gray-500">
            {selectedPatients.length > 0 
              ? `${selectedPatients.length} patient(s) selected` 
              : 'All patients will be exported'}
          </p>
        </div>

        {/* Export Message */}
        {exportMessage && (
          <Alert variant={exportMessage.type === 'error' ? 'destructive' : 'default'}
            className={exportMessage.type === 'success' ? 'border-green-200 bg-green-50' : ''}>
            {exportMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
            <AlertDescription className={exportMessage.type === 'success' ? 'text-green-800' : ''}>
              {exportMessage.text}
            </AlertDescription>
          </Alert>
        )}

        {/* Export Button */}
        <Button
          onClick={handleExport}
          disabled={isExporting || patients.length === 0}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Export {format.toUpperCase()}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}