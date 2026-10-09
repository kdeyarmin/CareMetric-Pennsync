import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Activity, Clock, Heart, Thermometer, Wind } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { manageTelehealthSession } from "@/functions/manageTelehealthSession";
import TelecomUnavailable, {
  TELEHEALTH_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

/**
 * Reference ranges used only to colour a reading the clinician has just
 * recorded. Nothing here predicts anything: a flag says "this number is outside
 * the usual adult range", and what to do about it is the agency's protocol.
 */
export const VITAL_REFERENCE = {
  heart_rate: { label: "Heart rate", min: 60, max: 100, unit: "bpm", icon: Heart },
  blood_pressure_systolic: { label: "BP systolic", min: 90, max: 140, unit: "mmHg", icon: Activity },
  blood_pressure_diastolic: { label: "BP diastolic", min: 60, max: 90, unit: "mmHg", icon: Activity },
  temperature: { label: "Temperature", min: 97, max: 99, unit: "°F", icon: Thermometer },
  respiratory_rate: { label: "Respiratory rate", min: 12, max: 20, unit: "breaths/min", icon: Wind },
  oxygen_saturation: { label: "Oxygen saturation", min: 95, max: 100, unit: "%", icon: Wind },
  pain_level: { label: "Pain (0–10)", min: null, max: null, unit: "", icon: AlertTriangle },
};

/**
 * Physiological sanity bounds. The server (manageTelehealthSession
 * `record_vitals`) enforces the same bounds and is the authority; these only
 * let the form refuse an obvious typo before a round trip.
 */
export const VITAL_SANITY_BOUNDS = {
  heart_rate: [10, 300],
  blood_pressure_systolic: [40, 300],
  blood_pressure_diastolic: [20, 200],
  temperature: [80, 115],
  respiratory_rate: [3, 80],
  oxygen_saturation: [50, 100],
  pain_level: [0, 10],
};

export function vitalInputError(field, raw) {
  const bounds = VITAL_SANITY_BOUNDS[field];
  if (!bounds) return "Unknown vital sign";
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (String(raw ?? "").trim() === "" || !Number.isFinite(value) || value < bounds[0] || value > bounds[1]) {
    return `${VITAL_REFERENCE[field].label} must be between ${bounds[0]} and ${bounds[1]}`;
  }
  return null;
}

export function isOutsideReference(field, value) {
  const ref = VITAL_REFERENCE[field];
  if (!ref || ref.min === null || typeof value !== "number") return false;
  return value < ref.min || value > ref.max;
}

function brokerError(error, fallback) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

/**
 * Live vital capture during a telehealth visit (owner decision, 2026-10-08).
 *
 * Reads and writes go only through manageTelehealthSession: `get` re-checks the
 * caller's agency membership and that they host the visit (or hold an
 * agency-wide role); `record_vitals` additionally requires the visit to be live
 * and its chart to be open to the caller, range-checks every value, and merges
 * into the visit's vitals by compare-and-swap so a co-participant's reading is
 * never overwritten. No session row is read or written from the browser.
 */
export default function RealtimeVitalMonitor({ sessionId, agencyId }) {
  const qc = useQueryClient();
  const queryKey = ["telehealth-session-vitals", agencyId, sessionId];
  const [drafts, setDrafts] = useState({});
  const [notice, setNotice] = useState(null);

  const sessionQuery = useQuery({
    queryKey,
    queryFn: () => manageTelehealthSession({ action: "get", agency_id: agencyId, session_id: sessionId }),
    enabled: !!agencyId && !!sessionId,
    refetchInterval: 15_000,
    retry: false,
  });
  const captured = sessionQuery.data?.session?.vitals_captured;
  const vitals = captured && typeof captured === "object" && !Array.isArray(captured) ? captured : {};
  const lastUpdate = typeof vitals.recorded_at === "string" && Number.isFinite(Date.parse(vitals.recorded_at))
    ? new Date(vitals.recorded_at)
    : null;

  const record = useMutation({
    mutationFn: (reading) => manageTelehealthSession({
      action: "record_vitals",
      agency_id: agencyId,
      session_id: sessionId,
      vitals: reading,
    }),
    onMutate: () => setNotice(null),
    onSuccess: (result, reading) => {
      if (result?.session) qc.setQueryData(queryKey, { session: result.session });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const field of Object.keys(reading)) delete next[field];
        return next;
      });
      setNotice({ tone: "success", text: "Vital recorded on this visit." });
    },
    onError: (error) => setNotice({ tone: "error", text: brokerError(error, "The vital could not be recorded. Please try again.") }),
  });

  const submit = (field) => {
    const fields = field === "blood_pressure_systolic" && String(drafts.blood_pressure_diastolic ?? "").trim() !== ""
      ? ["blood_pressure_systolic", "blood_pressure_diastolic"]
      : [field];
    const reading = {};
    for (const name of fields) {
      const error = vitalInputError(name, drafts[name]);
      if (error) {
        setNotice({ tone: "error", text: error });
        return;
      }
      reading[name] = Number(String(drafts[name]).trim());
    }
    record.mutate(reading);
  };

  if (!sessionId || !agencyId) return null;

  if (sessionQuery.isError) {
    return (
      <TelecomUnavailable
        compact
        title="Live vital capture unavailable"
        message={brokerError(sessionQuery.error, TELEHEALTH_UNAVAILABLE_MESSAGE)}
      />
    );
  }

  const flagged = Object.keys(VITAL_REFERENCE).filter((field) => isOutsideReference(field, vitals[field]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Patient vitals for this visit</CardTitle>
          {lastUpdate && (
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Last recorded {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessionQuery.isLoading && <p className="text-xs text-slate-500">Loading the visit&apos;s vitals…</p>}
        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-xs ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
          >
            {notice.text}
          </p>
        )}
        {flagged.length > 0 && (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Outside the usual adult range: {flagged.map((field) => `${VITAL_REFERENCE[field].label} ${vitals[field]} ${VITAL_REFERENCE[field].unit}`.trim()).join(", ")}.
            Follow your agency&apos;s protocol.
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(VITAL_REFERENCE).map(([field, ref]) => {
            const Icon = ref.icon;
            const value = typeof vitals[field] === "number" ? vitals[field] : null;
            const inputId = `vital-${sessionId}-${field}`;
            const [min, max] = VITAL_SANITY_BOUNDS[field];
            return (
              <div key={field} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <Icon className="h-4 w-4 text-slate-600" aria-hidden="true" />
                    {ref.label}
                  </label>
                  {value !== null && (
                    <Badge variant="outline" className={isOutsideReference(field, value) ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}>
                      {value}{ref.unit ? ` ${ref.unit}` : ""}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    min={min}
                    max={max}
                    placeholder={ref.min === null ? `${min}–${max}` : `Usual ${ref.min}–${ref.max}`}
                    value={drafts[field] ?? ""}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [field]: event.target.value }))}
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={record.isPending || String(drafts[field] ?? "").trim() === ""}
                    onClick={() => submit(field)}
                  >
                    Record
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
