import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ExternalLink, UserPlus } from "lucide-react";

const CONFIDENCE_STYLES = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-blue-100 text-blue-800",
};

/**
 * Warns when a patient being entered looks like one that already exists, and
 * routes the user to the existing chart instead of creating a duplicate.
 *
 * The matches come straight from the shared scoring engine
 * (findDuplicatesForCandidate), so what we warn about here is exactly what the
 * admin duplicate scanner would later flag.
 *
 * @param {boolean}  open
 * @param {(open: boolean) => void} onOpenChange
 * @param {Array}    matches            results from findDuplicatesForCandidate
 * @param {() => void} onProceedAnyway  create the patient despite the warning
 */
export default function PotentialDuplicateDialog({ open, onOpenChange, matches = [], onProceedAnyway }) {
  const navigate = useNavigate();

  const openChart = (patientId) => {
    onOpenChange(false);
    navigate(`${createPageUrl("PatientDetails")}?id=${patientId}`);
  };

  const formatDob = (dob) => {
    if (!dob) return "N/A";
    const d = new Date(dob);
    return Number.isNaN(d.getTime()) ? dob : d.toLocaleDateString();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Possible duplicate patient
          </DialogTitle>
          <DialogDescription>
            {matches.length === 1
              ? "A patient already in the system looks like the one you're adding."
              : `${matches.length} patients already in the system look like the one you're adding.`}{" "}
            Open the existing chart instead of creating a duplicate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto">
          {matches.map(({ patient, confidenceLevel, confidencePercent, matches: reasons }) => (
            <div
              key={patient.id}
              className="border rounded-lg p-3 bg-amber-50 border-amber-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">
                    {patient.first_name} {patient.last_name}
                  </p>
                  <div className="text-xs text-slate-600 mt-0.5 space-y-0.5">
                    <p>DOB: {formatDob(patient.date_of_birth)}</p>
                    <p>MRN: {patient.medical_record_number || "N/A"}</p>
                    {patient.status && <p>Status: {patient.status}</p>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <Badge className={CONFIDENCE_STYLES[confidenceLevel] || CONFIDENCE_STYLES.low}>
                    {confidencePercent}% match
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => openChart(patient.id)}
                  >
                    <ExternalLink className="w-3 h-3 mr-1" />
                    Open chart
                  </Button>
                </div>
              </div>
              {reasons?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {reasons.slice(0, 5).map((reason, idx) => (
                    <Badge key={idx} variant="outline" className="text-[10px] bg-white">
                      {reason}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <Alert className="bg-slate-50 border-slate-200">
          <AlertDescription className="text-xs text-slate-600">
            Only add a new record if you're sure this is a different person.
          </AlertDescription>
        </Alert>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back to form
          </Button>
          <Button
            variant="outline"
            className="text-amber-700 border-amber-300 hover:bg-amber-50"
            onClick={() => {
              onOpenChange(false);
              onProceedAnyway?.();
            }}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Add as new anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
