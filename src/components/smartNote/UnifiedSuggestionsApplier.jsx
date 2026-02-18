import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, CheckCircle2, Zap, BookOpen, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function UnifiedSuggestionsApplier({
  complianceIssues = [],
  qualitySuggestions = [],
  educationMaterials = [],
  medicareViolations = [],
  noteContent,
  onApplyAll,
  onApplyCategory,
  loading = false
}) {
  const [applying, setApplying] = useState(false);

  const totalIssues = complianceIssues.length + (qualitySuggestions?.length || 0) + medicareViolations.length;

  const handleApplyAll = async () => {
    setApplying(true);
    try {
      await onApplyAll?.();
    } finally {
      setApplying(false);
    }
  };

  if (totalIssues === 0) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="pt-6 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <span className="text-sm text-green-800 font-medium">No issues found - note is optimized!</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600" />
            <CardTitle className="text-base">AI Suggestions & Fixes ({totalIssues})</CardTitle>
          </div>
          <Button
            onClick={handleApplyAll}
            disabled={applying || loading}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            size="sm"
          >
            {applying ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-1" />
                Apply All
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        <Tabs defaultValue="compliance" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="compliance" className="relative">
              Compliance
              {complianceIssues.length > 0 && (
                <Badge className="ml-2 bg-red-100 text-red-800 text-xs">{complianceIssues.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="quality" className="relative">
              Quality
              {qualitySuggestions?.length > 0 && (
                <Badge className="ml-2 bg-yellow-100 text-yellow-800 text-xs">{qualitySuggestions.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="education">
              Education
              {educationMaterials?.length > 0 && (
                <Badge className="ml-2 bg-green-100 text-green-800 text-xs">{educationMaterials.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compliance" className="space-y-3 mt-4">
            {medicareViolations.length > 0 ? (
              <div className="space-y-2">
                {medicareViolations.map((v, i) => (
                  <div key={i} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-red-900">{v.violation}</p>
                        <p className="text-xs text-red-700 mt-1">{v.cop_reference}</p>
                        <p className="text-xs text-red-600 mt-2">{v.remediation}</p>
                      </div>
                      <Badge className="bg-red-200 text-red-900 text-xs flex-shrink-0">{v.severity}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No compliance issues detected.</p>
            )}

            {complianceIssues.length > 0 && (
              <div className="space-y-2 mt-4 border-t pt-4">
                <p className="text-xs font-semibold text-slate-700">Additional Issues:</p>
                {complianceIssues.map((issue, i) => (
                  <div key={i} className="p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                    <p className="font-medium text-orange-900">{issue.element}</p>
                    <p className="text-orange-700">{issue.suggestion}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="quality" className="space-y-3 mt-4">
            {qualitySuggestions?.length > 0 ? (
              <div className="space-y-2">
                {qualitySuggestions.map((s, i) => (
                  <div key={i} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-yellow-900">{s.issue}</p>
                        <p className="text-xs text-yellow-700 mt-1">{s.recommendation}</p>
                        <div className="mt-2 p-2 bg-white rounded border border-yellow-100">
                          <p className="text-xs text-slate-600 italic">"{s.excerpt}"</p>
                        </div>
                        <div className="mt-2 p-2 bg-white rounded border border-green-100">
                          <p className="text-xs text-slate-600 font-medium">Improved: "{s.improved_text}"</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No quality improvements needed.</p>
            )}
          </TabsContent>

          <TabsContent value="education" className="space-y-3 mt-4">
            {educationMaterials?.length > 0 ? (
              <div className="space-y-2">
                {educationMaterials.map((m, i) => (
                  <div key={i} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <BookOpen className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-green-900">{m.title}</p>
                        <p className="text-xs text-green-700 mt-1">{m.reason}</p>
                        <Badge className="mt-2 bg-green-200 text-green-900 text-xs">{m.category}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No education materials suggested.</p>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <p className="font-medium mb-1">💡 Tip: Click "Apply All" to automatically fix all issues at once.</p>
          <p className="text-xs text-blue-700">All improvements will be integrated into your note while maintaining clinical accuracy.</p>
        </div>
      </CardContent>
    </Card>
  );
}