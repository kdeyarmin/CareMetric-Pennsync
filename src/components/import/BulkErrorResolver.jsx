import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Wand2, CheckCircle2, X, Loader2 } from "lucide-react";

export default function BulkErrorResolver({ 
  selectedErrors, 
  validationErrors, 
  onResolve, 
  onCancel 
}) {
  const [resolutionMode, setResolutionMode] = React.useState("skip");
  const [bulkValues, setBulkValues] = React.useState({});
  const [isProcessing, setIsProcessing] = React.useState(false);

  const selectedErrorDetails = selectedErrors.map(idx => validationErrors[idx]);

  // Analyze common fields with errors
  const commonFields = React.useMemo(() => {
    const fields = {};
    
    selectedErrorDetails.forEach(error => {
      error.errors.forEach(errorMsg => {
        // Extract field name from error message
        const fieldMatch = errorMsg.match(/^([^:]+):/);
        if (fieldMatch) {
          const field = fieldMatch[1].trim();
          if (!fields[field]) {
            fields[field] = { count: 0, examples: [] };
          }
          fields[field].count++;
          if (fields[field].examples.length < 3) {
            fields[field].examples.push(errorMsg);
          }
        }
      });
    });
    
    return fields;
  }, [selectedErrorDetails]);

  const handleApplyResolution = async () => {
    setIsProcessing(true);
    
    try {
      await onResolve({
        mode: resolutionMode,
        selectedIndices: selectedErrors,
        bulkValues: bulkValues
      });
    } catch (error) {
      console.error("Resolution error:", error);
    }
    
    setIsProcessing(false);
  };

  return (
    <Card className="border-2 border-indigo-300 bg-indigo-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-indigo-600" />
            Bulk Error Resolution ({selectedErrors.length} rows selected)
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Resolution Mode Selection */}
        <div className="bg-white rounded-lg p-4 space-y-3">
          <Label className="font-semibold">Resolution Strategy</Label>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={resolutionMode === "skip"}
                onCheckedChange={() => setResolutionMode("skip")}
              />
              <Label className="cursor-pointer">
                Skip selected rows and import remaining valid records
              </Label>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox
                checked={resolutionMode === "apply_defaults"}
                onCheckedChange={() => setResolutionMode("apply_defaults")}
              />
              <Label className="cursor-pointer">
                Apply default values to fix errors
              </Label>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox
                checked={resolutionMode === "manual_fix"}
                onCheckedChange={() => setResolutionMode("manual_fix")}
              />
              <Label className="cursor-pointer">
                Manually provide values for common fields
              </Label>
            </div>
          </div>
        </div>

        {/* Common Fields with Errors */}
        {Object.keys(commonFields).length > 0 && (
          <div className="bg-white rounded-lg p-4 space-y-3">
            <Label className="font-semibold">
              Common Fields with Errors ({Object.keys(commonFields).length})
            </Label>
            
            <div className="space-y-2">
              {Object.entries(commonFields).map(([field, data]) => (
                <div key={field} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{field}</span>
                    <Badge variant="outline">{data.count} error{data.count !== 1 ? 's' : ''}</Badge>
                  </div>
                  
                  {resolutionMode === "manual_fix" && (
                    <Input
                      placeholder={`Enter value for ${field}`}
                      value={bulkValues[field] || ""}
                      onChange={(e) => setBulkValues(prev => ({
                        ...prev,
                        [field]: e.target.value
                      }))}
                      className="mt-2"
                    />
                  )}
                  
                  <div className="mt-2 text-xs text-slate-600">
                    <p className="font-medium mb-1">Example errors:</p>
                    {data.examples.slice(0, 2).map((example, idx) => (
                      <p key={idx} className="text-xs">• {example}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected Rows Preview */}
        <div className="bg-white rounded-lg p-4">
          <Label className="font-semibold mb-2 block">Selected Rows Preview</Label>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {selectedErrorDetails.slice(0, 5).map((error, idx) => (
              <div key={idx} className="p-2 bg-red-50 border border-red-200 rounded text-sm">
                <p className="font-medium">Row {error.row}: {error.patient}</p>
                <p className="text-xs text-slate-600">{error.errors.length} error{error.errors.length !== 1 ? 's' : ''}</p>
              </div>
            ))}
            {selectedErrorDetails.length > 5 && (
              <p className="text-xs text-slate-500 text-center py-2">
                + {selectedErrorDetails.length - 5} more rows
              </p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleApplyResolution}
            disabled={isProcessing}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Apply Resolution
              </>
            )}
          </Button>
          
          <Button
            onClick={onCancel}
            variant="outline"
            disabled={isProcessing}
          >
            Cancel
          </Button>
        </div>

        <Alert className="bg-blue-50 border-blue-200">
          <AlertDescription className="text-sm text-blue-900">
            💡 <strong>Tip:</strong> After applying resolution, you can re-validate the data before importing.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}