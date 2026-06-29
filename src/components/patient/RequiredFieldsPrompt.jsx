import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function RequiredFieldsPrompt({ missingFields, onComplete }) {
  if (!missingFields || missingFields.length === 0) return null;

  return (
    <Alert className="border-amber-300 bg-amber-50 mb-4">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold mb-1">Required Information Missing</p>
            <p className="text-sm">Please complete: {missingFields.join(', ')}</p>
          </div>
          <Button size="sm" onClick={onComplete} className="bg-amber-600 hover:bg-amber-700">
            Complete Now
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}