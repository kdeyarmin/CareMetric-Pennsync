import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Stethoscope, FileText, Info, Copy } from "lucide-react";
import { SPECIALTY_TEMPLATES, getSpecialtyTemplates } from "./SpecialtyTemplateLibrary";
import { toast } from "sonner";

export default function SpecialtyTemplateSelector({ 
  selectedSpecialty,
  onSpecialtyChange,
  selectedTemplate,
  onTemplateSelect,
  onApplyTemplate,
  compact = false
}) {
  const [showDetails, setShowDetails] = useState(false);

  const specialties = Object.keys(SPECIALTY_TEMPLATES);
  const templates = selectedSpecialty ? getSpecialtyTemplates(selectedSpecialty) : {};
  const currentTemplate = selectedTemplate && templates[selectedTemplate] 
    ? templates[selectedTemplate] 
    : null;

  const handleApply = () => {
    if (currentTemplate) {
      onApplyTemplate?.(currentTemplate);
      toast.success("Template applied");
    }
  };

  const copyCommonCodes = (type) => {
    if (currentTemplate?.commonCodes?.[type]) {
      const codes = currentTemplate.commonCodes[type].join(", ");
      navigator.clipboard.writeText(codes);
      toast.success(`${type.toUpperCase()} codes copied`);
    }
  };

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label>Specialty</Label>
          <Select value={selectedSpecialty || ""} onValueChange={onSpecialtyChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select specialty" />
            </SelectTrigger>
            <SelectContent>
              {specialties.map((specialty) => (
                <SelectItem key={specialty} value={specialty}>
                  {SPECIALTY_TEMPLATES[specialty].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedSpecialty && Object.keys(templates).length > 0 && (
          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={selectedTemplate || ""} onValueChange={onTemplateSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(templates).map((templateName) => (
                  <SelectItem key={templateName} value={templateName}>
                    {templateName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {currentTemplate && onApplyTemplate && (
          <Button onClick={handleApply} className="w-full" size="sm">
            Apply Template
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="w-4 h-4" />
          Specialty Templates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Select Specialty</Label>
          <Select value={selectedSpecialty || ""} onValueChange={onSpecialtyChange}>
            <SelectTrigger>
              <SelectValue placeholder="Choose your specialty" />
            </SelectTrigger>
            <SelectContent>
              {specialties.map((specialty) => (
                <SelectItem key={specialty} value={specialty}>
                  <div className="flex items-center gap-2">
                    <Stethoscope className="w-3 h-3" />
                    {SPECIALTY_TEMPLATES[specialty].name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedSpecialty && Object.keys(templates).length > 0 && (
          <div className="space-y-2">
            <Label>Select Template</Label>
            <Select value={selectedTemplate || ""} onValueChange={onTemplateSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(templates).map((templateName) => (
                  <SelectItem key={templateName} value={templateName}>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3 h-3" />
                      {templateName}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {currentTemplate && (
          <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Template Details
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? "Hide" : "Show"}
              </Button>
            </div>

            {showDetails && (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">Sections:</p>
                  <div className="flex flex-wrap gap-1">
                    {currentTemplate.sections.map((section) => (
                      <Badge key={section} variant="outline" className="text-xs">
                        {section}
                      </Badge>
                    ))}
                  </div>
                </div>

                {currentTemplate.commonCodes && (
                  <div className="space-y-2">
                    {currentTemplate.commonCodes.icd10 && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-blue-900 dark:text-blue-100">
                            Common ICD-10:
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyCommonCodes("icd10")}
                            className="h-6 text-xs"
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {currentTemplate.commonCodes.icd10.map((code) => (
                            <Badge key={code} className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              {code}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentTemplate.commonCodes.cpt && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-medium text-blue-900 dark:text-blue-100">
                            Common CPT:
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyCommonCodes("cpt")}
                            className="h-6 text-xs"
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {currentTemplate.commonCodes.cpt.map((code) => (
                            <Badge key={code} className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                              {code}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900 p-2 rounded">
                  <p className="font-medium mb-1">AI Focus:</p>
                  <p>{currentTemplate.aiPrompt}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {currentTemplate && onApplyTemplate && (
          <Button onClick={handleApply} className="w-full">
            <FileText className="w-4 h-4 mr-2" />
            Apply Template
          </Button>
        )}
      </CardContent>
    </Card>
  );
}