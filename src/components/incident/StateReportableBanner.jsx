import { AlertTriangle } from "lucide-react";

// Red alert shown when the selected incident/event is state-reportable. Tells the
// nurse to notify their supervisor and explains what happens automatically on
// submit (PDF retained, admins emailed + alerted in-app).
export default function StateReportableBanner({ category }) {
  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="font-bold text-red-800">
          This appears to be a State Reportable Event — notify your supervisor now.
        </p>
        <p className="text-sm text-red-700">
          {category ? <><span className="font-semibold">Category:</span> {category}. </> : null}
          State reportable events must be documented and reported to the Department of Health within
          24 hours. On submit, a PDF copy is retained and emailed to agency administrators, and an
          in-app alert is created for immediate follow-up.
        </p>
      </div>
    </div>
  );
}