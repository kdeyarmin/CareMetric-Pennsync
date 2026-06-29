import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, AlertTriangle } from "lucide-react";

// Plausible entry ranges, deliberately wide. The goal is to catch data-entry and
// unit mistakes (e.g. a Celsius temperature, a transposed BP) — not to second-guess
// genuinely abnormal-but-real readings. Out-of-range values are flagged for the nurse
// to confirm; entry is never blocked, so a true critical value can still be recorded.
const VITAL_FIELDS = [
  { key: "temperature", label: "Temperature (°F)", step: "0.1", placeholder: "98.6", min: 90, max: 110, unit: "°F" },
  { key: "blood_pressure_systolic", label: "BP Systolic", placeholder: "120", min: 60, max: 260, unit: "mmHg" },
  { key: "blood_pressure_diastolic", label: "BP Diastolic", placeholder: "80", min: 30, max: 180, unit: "mmHg" },
  { key: "heart_rate", label: "Heart Rate", placeholder: "72", min: 30, max: 220, unit: "bpm" },
  { key: "respiratory_rate", label: "Respiratory Rate", placeholder: "16", min: 4, max: 50, unit: "/min" },
  { key: "oxygen_saturation", label: "O2 Saturation (%)", placeholder: "98", min: 50, max: 100, unit: "%" },
  { key: "pain_level", label: "Pain Level (0-10)", placeholder: "0", min: 0, max: 10, unit: "" },
];

function rangeWarning(field, value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(value)) return null;
  if (value > field.max) return `Above the expected range (max ${field.max}${field.unit}) — please confirm.`;
  if (value < field.min) return `Below the expected range (min ${field.min}${field.unit}) — please confirm.`;
  return null;
}

export default function VitalSignsForm({ vitalSigns, onChange }) {
  const handleChange = (field, value) => {
    onChange({
      ...vitalSigns,
      [field]: value ? parseFloat(value) : null
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Vital Signs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {VITAL_FIELDS.map((field) => {
            const value = vitalSigns[field.key];
            const warning = rangeWarning(field, value);
            return (
              <div key={field.key}>
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type="number"
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  placeholder={field.placeholder}
                  aria-invalid={!!warning}
                  className={warning ? "border-amber-500 focus-visible:ring-amber-500" : undefined}
                  value={value || value === 0 ? value : ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                />
                {warning && (
                  <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{warning}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
