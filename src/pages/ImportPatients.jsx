import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Users } from "lucide-react";
import PatientBulkUpload from "../components/patient/PatientBulkUpload";

export default function ImportPatients() {
  const queryClient = useQueryClient();
  const [importCount, setImportCount] = useState(0);

  const handleImportSuccess = () => {
    setImportCount(prev => prev + 1);
    queryClient.invalidateQueries({ queryKey: ['patients'] });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Upload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Import Patients</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Bulk import patient demographic information from a CSV or Excel file
              </p>
            </div>
          </div>
        </div>

        {/* Import Card */}
        <Card className="border-slate-200 dark:border-slate-800 mb-6">
          <CardHeader>
            <CardTitle>Upload Patient File</CardTitle>
          </CardHeader>
          <CardContent>
            <PatientBulkUpload onImportSuccess={handleImportSuccess} />
          </CardContent>
        </Card>

        {/* Info Cards */}
        <div className="grid gap-4">
          <Card className="border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-5 h-5" />
                Supported Fields
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <p><strong>Required:</strong> first_name, last_name</p>
                <p><strong>Optional:</strong> date_of_birth, email, phone, address, medical_record_number, primary_diagnosis, payor</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                  Date format: YYYY-MM-DD
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800 bg-blue-50 dark:bg-blue-950">
            <CardHeader>
              <CardTitle className="text-base">📝 File Format Tips</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-blue-900 dark:text-blue-100">
              <p>• Use the template to ensure correct column order</p>
              <p>• One patient per row</p>
              <p>• Leave empty cells for optional fields</p>
              <p>• Maximum file size: 10MB</p>
              <p>• Check data before uploading for best results</p>
            </CardContent>
          </Card>
        </div>

        {importCount > 0 && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-sm text-green-800 dark:text-green-200">
              ✓ Import successful! Patients have been added to your system.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}