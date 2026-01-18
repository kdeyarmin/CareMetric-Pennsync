import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, FileText, Pill, AlertTriangle, Beaker, User, FileCheck } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ExtractedDataReview from "./ExtractedDataReview";

export default function AnalysisResultsViewer({ analysis, patientId, onApplied }) {
  const [activeTab, setActiveTab] = useState("overview");

  if (!analysis) return null;

  const data = analysis.extracted_data;
  const confidence = data.confidence_level || "medium";

  const getConfidenceColor = (level) => {
    switch (level) {
      case "high": return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "medium": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "low": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const countExtracted = (category) => {
    if (Array.isArray(data[category])) return data[category].length;
    if (data[category] && typeof data[category] === "object") {
      return Object.values(data[category]).filter(v => v !== null && v !== undefined).length;
    }
    return data[category] ? 1 : 0;
  };

  return (
    <Card className="border-2 border-green-200 dark:border-green-800">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
        <div className="flex items-start justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-green-600" />
            Analysis Results
          </CardTitle>
          <Badge className={getConfidenceColor(confidence)}>
            {confidence.charAt(0).toUpperCase() + confidence.slice(1)} Confidence
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {data.extraction_notes && (
          <Alert className="mb-4">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{data.extraction_notes}</AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
            <TabsTrigger value="details" className="text-xs sm:text-sm">Details</TabsTrigger>
            <TabsTrigger value="raw" className="text-xs sm:text-sm">Raw Data</TabsTrigger>
            <TabsTrigger value="apply" className="text-xs sm:text-sm">Apply</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Diagnoses", count: countExtracted("diagnoses"), icon: AlertTriangle },
                { label: "Medications", count: countExtracted("medications"), icon: Pill },
                { label: "Lab Results", count: countExtracted("lab_results"), icon: Beaker },
                { label: "Vitals", count: countExtracted("vital_signs"), icon: FileText }
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4 text-slate-600" />
                      <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{item.label}</p>
                    </div>
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{item.count}</p>
                  </div>
                );
              })}
            </div>

            {data.demographics && Object.keys(data.demographics).some(k => data.demographics[k]) && (
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Demographics
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {Object.entries(data.demographics)
                      .filter(([_, value]) => value)
                      .map(([key, value]) => (
                        <div key={key}>
                          <p className="text-slate-600 dark:text-slate-400 text-xs">{key.replace(/_/g, " ")}</p>
                          <p className="text-slate-900 dark:text-slate-100 font-medium">{value}</p>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {data.clinical_summary && (
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-semibold mb-2">Clinical Summary</h4>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {data.clinical_summary}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-4 mt-4">
            <ScrollArea className="h-[500px]">
              <div className="pr-4 space-y-4">
                {data.diagnoses && data.diagnoses.length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Diagnoses ({data.diagnoses.length})
                      </h4>
                      <div className="space-y-2">
                        {data.diagnoses.map((dx, idx) => (
                          <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-900 rounded text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-medium">{dx.diagnosis}</span>
                              {dx.is_new && <Badge variant="outline">NEW</Badge>}
                            </div>
                            {dx.icd10_code && (
                              <p className="text-xs text-slate-500 mt-1">ICD-10: {dx.icd10_code}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {data.medications && data.medications.length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <Pill className="w-4 h-4" />
                        Medications ({data.medications.length})
                      </h4>
                      <div className="space-y-2">
                        {data.medications.map((med, idx) => (
                          <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-900 rounded text-sm">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-medium">{med.name}</span>
                              {med.is_new && <Badge variant="outline">NEW</Badge>}
                            </div>
                            <p className="text-xs text-slate-600">
                              {med.dosage} • {med.frequency}
                            </p>
                            {med.prescriber && (
                              <p className="text-xs text-slate-500 mt-1">Prescriber: {med.prescriber}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {data.lab_results && data.lab_results.length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <Beaker className="w-4 h-4" />
                        Lab Results ({data.lab_results.length})
                      </h4>
                      <div className="space-y-2">
                        {data.lab_results.map((lab, idx) => (
                          <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-900 rounded text-sm">
                            <p className="font-medium">{lab.test_name}</p>
                            <p className="text-slate-600 dark:text-slate-400">
                              {lab.value} {lab.unit}
                            </p>
                            {lab.normal_range && (
                              <p className="text-xs text-slate-500">Range: {lab.normal_range}</p>
                            )}
                            {lab.test_date && (
                              <p className="text-xs text-slate-500 mt-1">Date: {lab.test_date}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {data.vital_signs && Object.keys(data.vital_signs).length > 0 && (
                  <Card>
                    <CardContent className="p-4">
                      <h4 className="font-semibold mb-3">Vital Signs</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(data.vital_signs)
                          .filter(([_, value]) => value !== null && value !== undefined)
                          .map(([key, value]) => (
                            <div key={key} className="p-2 bg-slate-50 dark:bg-slate-900 rounded">
                              <p className="text-slate-600 dark:text-slate-400 text-xs">{key.replace(/_/g, " ")}</p>
                              <p className="font-medium">{value}</p>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Raw Data Tab */}
          <TabsContent value="raw" className="mt-4">
            <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-4 rounded-lg overflow-auto max-h-[500px] text-xs">
              {JSON.stringify(data, null, 2)}
            </pre>
          </TabsContent>

          {/* Apply Tab */}
          <TabsContent value="apply" className="mt-4">
            <div className="space-y-4">
              <Alert>
                <CheckCircle2 className="w-4 h-4" />
                <AlertDescription>
                  Review the extracted data above, then apply selected items to the patient record.
                </AlertDescription>
              </Alert>
              <ExtractedDataReview
                extractedData={data}
                patientId={patientId}
                onApplied={() => {
                  onApplied?.();
                }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}