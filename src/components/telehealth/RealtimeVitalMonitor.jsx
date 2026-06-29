import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Heart, Thermometer, Wind, TrendingDown, TrendingUp, Clock } from "lucide-react";
import { toast } from "sonner";

const VITAL_THRESHOLDS = {
  heart_rate: { min: 60, max: 100, unit: "bpm" },
  blood_pressure_systolic: { min: 90, max: 140, unit: "mmHg" },
  blood_pressure_diastolic: { min: 60, max: 90, unit: "mmHg" },
  temperature: { min: 97, max: 99, unit: "°F" },
  respiratory_rate: { min: 12, max: 20, unit: "breaths/min" },
  oxygen_saturation: { min: 95, max: 100, unit: "%" },
};

// Absolute physiological sanity bounds (much wider than the "normal" thresholds
// above, which are only used for red/green coloring). Values outside these are
// impossible/typos — reject them so a fat-fingered "9000" or "-50" isn't persisted
// to the chart verbatim.
const VITAL_SANITY_BOUNDS = {
  heart_rate: { min: 10, max: 300 },
  blood_pressure_systolic: { min: 40, max: 300 },
  blood_pressure_diastolic: { min: 20, max: 200 },
  temperature: { min: 80, max: 115 },
  respiratory_rate: { min: 3, max: 80 },
  oxygen_saturation: { min: 50, max: 100 },
};

function vitalSanityError(field, value) {
  const b = VITAL_SANITY_BOUNDS[field];
  if (!b) return null;
  if (!Number.isFinite(value) || value < b.min || value > b.max) {
    return `${field.replace(/_/g, ' ')} must be between ${b.min} and ${b.max}`;
  }
  return null;
}

const VITAL_ICONS = {
  heart_rate: Heart,
  blood_pressure_systolic: AlertTriangle,
  blood_pressure_diastolic: AlertTriangle,
  temperature: Thermometer,
  respiratory_rate: Wind,
  oxygen_saturation: Wind,
};

export default function RealtimeVitalMonitor({ sessionId, patientId }) {
  const [vitals, setVitals] = useState({
    heart_rate: null,
    blood_pressure_systolic: null,
    blood_pressure_diastolic: null,
    temperature: null,
    respiratory_rate: null,
    oxygen_saturation: null,
  });

  const [manualInput, setManualInput] = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);

  // Fetch agency settings for custom thresholds
  const { data: _agencySettings = {} } = useQuery({
    queryKey: ['agency-settings'],
    queryFn: () => base44.entities.AgencySettings.list('-created_date', 1),
    initialData: [],
  });

  // Read the vitals captured on this telehealth session. The prior code read a
  // non-existent VitalSignsForm entity (always empty); the session's purpose-built
  // `vitals_captured` object is the real store. Polls so a co-participant's entry
  // shows up.
  const { data: sessionRow } = useQuery({
    queryKey: ['telehealth-session-vitals', sessionId, patientId],
    queryFn: () => (sessionId
      ? base44.entities.TelehealthSession.filter({ id: sessionId }).then(r => r?.[0] || null)
      : Promise.resolve(null)),
    refetchInterval: 15000,
    enabled: !!sessionId,
  });

  useEffect(() => {
    const captured = sessionRow?.vitals_captured;
    if (!captured) return;
    setVitals(prev => ({
      ...prev,
      heart_rate: captured.heart_rate ?? prev.heart_rate,
      blood_pressure_systolic: captured.blood_pressure_systolic ?? prev.blood_pressure_systolic,
      blood_pressure_diastolic: captured.blood_pressure_diastolic ?? prev.blood_pressure_diastolic,
      temperature: captured.temperature ?? prev.temperature,
      respiratory_rate: captured.respiratory_rate ?? prev.respiratory_rate,
      oxygen_saturation: captured.oxygen_saturation ?? prev.oxygen_saturation,
    }));
    if (captured.recorded_at) setLastUpdate(new Date(captured.recorded_at));
  }, [sessionRow]);

  const handleInputChange = (field, value) => {
    setManualInput(prev => ({ ...prev, [field]: parseFloat(value) || null }));
  };

  const handleRecordVital = async (field) => {
    if (manualInput[field] === null || manualInput[field] === undefined) return;

    // Reject physiologically impossible values rather than storing them verbatim.
    const err = vitalSanityError(field, manualInput[field]);
    if (err) { toast.error(err); return; }

    if (!sessionId) {
      toast.error('No active telehealth session — cannot record vitals.');
      return;
    }

    const update = { [field]: manualInput[field] };
    if (field === 'blood_pressure_systolic' && manualInput['blood_pressure_diastolic']) {
      const dErr = vitalSanityError('blood_pressure_diastolic', manualInput['blood_pressure_diastolic']);
      if (dErr) { toast.error(dErr); return; }
      update.blood_pressure_diastolic = manualInput['blood_pressure_diastolic'];
    }

    try {
      // Merge into the session's vitals_captured object (the real, schema-defined
      // store) and surface failures instead of silently swallowing them.
      const merged = {
        ...(sessionRow?.vitals_captured || {}),
        ...update,
        recorded_at: new Date().toISOString(),
      };
      await base44.entities.TelehealthSession.update(sessionId, { vitals_captured: merged });
      setVitals(prev => ({ ...prev, ...update }));
      setManualInput(prev => ({ ...prev, [field]: null }));
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error recording vital:', error);
      toast.error('Failed to record vital. Please try again.');
    }
  };

  const isOutOfRange = (field, value) => {
    if (value === null) return false;
    const threshold = VITAL_THRESHOLDS[field];
    return value < threshold.min || value > threshold.max;
  };

  const getStatusColor = (field, value) => {
    if (value === null) return 'bg-slate-100 text-slate-700';
    return isOutOfRange(field, value) ? 'bg-red-100 text-red-800 border-red-300' : 'bg-green-100 text-green-800 border-green-300';
  };

  const getAlertActions = (field, value) => {
    if (!isOutOfRange(field, value)) return null;

    const actions = {
      heart_rate: {
        high: ['Check for pain, anxiety, or fever', 'Assess hydration status', 'Review medications for stimulants'],
        low: ['Check for hypotension', 'Assess for bradycardia symptoms', 'Consider cardiac monitoring'],
      },
      blood_pressure_systolic: {
        high: ['Assess for headache/symptoms', 'Review recent activity', 'Consider medication adjustment', 'Monitor for preeclampsia risk'],
        low: ['Check for dizziness/weakness', 'Ensure adequate hydration', 'Assess orthostatic changes'],
      },
      temperature: {
        high: ['Assess for fever signs', 'Check for infection', 'Encourage fluid intake', 'Consider antipyretic'],
        low: ['Check room temperature', 'Assess for hypothermia risk', 'Ensure adequate clothing/blankets'],
      },
      oxygen_saturation: {
        low: ['Check oxygen equipment', 'Assess respiratory effort', 'Review for shortness of breath', 'Consider physician notification'],
      },
      respiratory_rate: {
        high: ['Assess respiratory distress', 'Check for pain or anxiety', 'Review for infection signs'],
        low: ['Assess alertness', 'Check for respiratory depression', 'Monitor for medication effects'],
      },
    };

    const direction = value > VITAL_THRESHOLDS[field].max ? 'high' : 'low';
    return actions[field]?.[direction] || [];
  };

  const criticalAlerts = Object.entries(vitals)
    .filter(([field, value]) => value !== null && isOutOfRange(field, value))
    .map(([field, value]) => ({ field, value }));

  return (
    <div className="space-y-4">
      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="w-5 h-5" />
              Vital Sign Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {criticalAlerts.map(({ field, value }) => (
              <div key={field} className="bg-white border border-red-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-slate-900 capitalize">
                    {field.replace(/_/g, ' ')}: {value} {VITAL_THRESHOLDS[field].unit}
                  </p>
                  <Badge className="bg-red-100 text-red-800">Out of Range</Badge>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded p-2">
                  <p className="text-xs font-semibold text-blue-900 mb-1">Suggested Actions:</p>
                  <ul className="text-xs text-blue-800 space-y-0.5">
                    {getAlertActions(field, value).map((action, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-blue-600 mt-0.5">•</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Vital Signs Grid */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Patient Vitals</CardTitle>
            {lastUpdate && (
              <span className="text-xs text-slate-600 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last update: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(VITAL_THRESHOLDS).map(([field, threshold]) => {
              const value = vitals[field];
              const Icon = VITAL_ICONS[field];

              return (
                <div key={field} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5 capitalize">
                      <Icon className="w-4 h-4 text-slate-600" />
                      {field.replace(/_/g, ' ')}
                    </label>
                    {value !== null && (
                      <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(field, value)}`}>
                        {isOutOfRange(field, value) ? (
                          <span className="flex items-center gap-1">
                            {value > threshold.max ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {value}
                          </span>
                        ) : value}
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder={`Range: ${threshold.min}-${threshold.max}`}
                      value={manualInput[field] ?? ''}
                      onChange={(e) => handleInputChange(field, e.target.value)}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleRecordVital(field)}
                      disabled={manualInput[field] === null || manualInput[field] === undefined}
                      className="whitespace-nowrap"
                    >
                      Record
                    </Button>
                  </div>

                  {value !== null && (
                    <div className="text-xs text-slate-600">
                      Normal: {threshold.min}-{threshold.max} {threshold.unit}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}