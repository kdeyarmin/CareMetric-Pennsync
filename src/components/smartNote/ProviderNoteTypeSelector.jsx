import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { FileText, CheckCircle, AlertCircle } from "lucide-react";
import { providerNoteTypes, getNoteTypesForProvider, getRequiredElements } from "../utils/providerNoteTypes";

export default function ProviderNoteTypeSelector({ 
  providerType, 
  onProviderTypeChange, 
  selectedNoteType,
  onNoteTypeChange,
  currentNoteContent = "",
  showChecklist = true 
}) {
  const [checklist, setChecklist] = useState([]);

  const providerData = getNoteTypesForProvider(providerType);
  const noteTypes = providerData?.noteTypes || [];

  useEffect(() => {
    if (providerType && selectedNoteType) {
      const elements = getRequiredElements(providerType, selectedNoteType);
      
      // Auto-check elements based on note content
      const checklistItems = elements.map(element => ({
        element,
        completed: currentNoteContent.toLowerCase().includes(element.toLowerCase().split(' ')[0])
      }));
      
      setChecklist(checklistItems);
    }
  }, [providerType, selectedNoteType, currentNoteContent]);

  const selectedNote = noteTypes.find(n => n.type === selectedNoteType);
  const completionPercentage = checklist.length > 0 
    ? Math.round((checklist.filter(c => c.completed).length / checklist.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4 text-blue-600" />
            Provider-Specific Documentation
          </CardTitle>
          <CardDescription>
            Select your provider type and note type for compliance-focused documentation
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Provider Type</Label>
              <Select value={providerType} onValueChange={onProviderTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(providerNoteTypes).map(key => (
                    <SelectItem key={key} value={key}>
                      {providerNoteTypes[key].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {providerType && noteTypes.length > 0 && (
              <div>
                <Label>Note Type</Label>
                <Select value={selectedNoteType} onValueChange={onNoteTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select note type" />
                  </SelectTrigger>
                  <SelectContent>
                    {noteTypes.map(noteType => (
                      <SelectItem key={noteType.type} value={noteType.type}>
                        {noteType.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {selectedNote && (
            <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <AlertCircle className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900 dark:text-blue-100">
                <strong>{selectedNote.label}:</strong> {selectedNote.description}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {showChecklist && selectedNote && checklist.length > 0 && (
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Documentation Checklist</CardTitle>
              <Badge 
                className={
                  completionPercentage === 100 
                    ? "bg-green-600 text-white" 
                    : completionPercentage >= 70 
                    ? "bg-yellow-600 text-white"
                    : "bg-slate-600 text-white"
                }
              >
                {completionPercentage}% Complete
              </Badge>
            </div>
            <CardDescription>
              Required elements for {selectedNote.label}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="space-y-2">
              {checklist.map((item, idx) => (
                <div 
                  key={idx}
                  className={`flex items-start gap-3 p-2 rounded ${
                    item.completed ? 'bg-green-50 dark:bg-green-950' : 'bg-slate-50 dark:bg-slate-900'
                  }`}
                >
                  {item.completed ? (
                    <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                  )}
                  <span className={`text-sm ${
                    item.completed 
                      ? 'text-green-900 dark:text-green-100 font-medium' 
                      : 'text-slate-700 dark:text-slate-300'
                  }`}>
                    {item.element}
                  </span>
                </div>
              ))}
            </div>

            {completionPercentage < 100 && (
              <Alert className="mt-4 bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-900 dark:text-yellow-100 text-sm">
                  Missing {checklist.filter(c => !c.completed).length} required elements. 
                  Ensure your note includes all elements for compliance.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}