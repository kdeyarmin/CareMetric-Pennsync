import { AlertTriangle } from "lucide-react";

/**
 * Native camera and file-picker surfaces are intentionally withheld here.
 * Once the browser hands control to an OS picker/camera, that surface can
 * outlive the active tenant realm and cannot be synchronously revoked on an
 * account or tenant transition.
 */
export default function IncidentPhotoCapture() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">Incident photo capture is temporarily unavailable</p>
        <p className="mt-1 text-xs">
          Submit the incident without photos while revocable, tenant-bound media handling is completed.
        </p>
      </div>
    </div>
  );
}
