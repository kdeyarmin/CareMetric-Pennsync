import { useState } from "react";
// useAICall is the standard hook wrapper for component AI calls: it applies the
// shared timeout/retry policy AND manages loading/error state + a stale-response
// guard. Prefer it over a raw invokeLLM at component call sites (see the hook's
// docs); use invokeLLM only in loops/utilities where a hook can't run.
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Route,
  Clock,
  MapPin,
  Navigation,
  RefreshCw,
  AlertTriangle,
  Car,
  Zap,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { toast } from 'sonner';

export default function SmartRouteOptimizer({ 
  visits = [], 
  patients = [],
  nurseLocation = null,
  onOptimizedSchedule 
}) {
  const ai = useAICall({ timeoutMs: 45000 });
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [savings, setSavings] = useState(null);

  const getPatient = (patientId) => patients.find(p => p.id === patientId);

  const optimizeRoute = async () => {
    if (visits.length < 2) {
      toast.error("Need at least 2 visits to optimize route");
      return;
    }

    try {
      // Prepare visit data with patient addresses
      const visitData = (visits || []).map(v => {
        const patient = getPatient(v.patient_id);
        return {
          visit_id: v.id,
          patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
          address: patient?.address || 'Unknown address',
          visit_type: v.visit_type,
          scheduled_time: v.visit_time,
          estimated_duration: getEstimatedDuration(v.visit_type),
          priority: getVisitPriority(v, patient)
        };
      });

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a healthcare route optimization AI. Optimize this nurse's daily visit schedule for maximum efficiency while respecting clinical priorities.

VISITS TO SCHEDULE:
${JSON.stringify(visitData, null, 2)}

NURSE STARTING LOCATION: ${nurseLocation || 'Office/Home base'}

OPTIMIZATION CRITERIA:
1. HIGH PRIORITY visits (admissions, PRN, high-acuity) should be scheduled earlier
2. Minimize total driving time by clustering geographically close visits
3. Consider estimated visit duration for realistic scheduling
4. Allow 15-minute buffer between visits for travel and documentation
5. Respect any pre-scheduled appointment times

Return JSON:
{
  "optimized_order": [
    {
      "visit_id": "id",
      "patient_name": "name",
      "address": "address",
      "suggested_time": "HH:MM",
      "visit_type": "type",
      "priority": "high/medium/low",
      "estimated_duration_minutes": number,
      "travel_time_from_previous": number,
      "optimization_reason": "why this position"
    }
  ],
  "total_estimated_drive_time_minutes": number,
  "original_estimated_drive_time_minutes": number,
  "time_saved_minutes": number,
  "total_miles_saved": number,
  "route_summary": "brief description of optimized route",
  "warnings": ["any scheduling conflicts or concerns"],
  "tips": ["efficiency tips for the day"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            optimized_order: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  visit_id: { type: "string" },
                  patient_name: { type: "string" },
                  address: { type: "string" },
                  suggested_time: { type: "string" },
                  visit_type: { type: "string" },
                  priority: { type: "string" },
                  estimated_duration_minutes: { type: "number" },
                  travel_time_from_previous: { type: "number" },
                  optimization_reason: { type: "string" }
                }
              }
            },
            total_estimated_drive_time_minutes: { type: "number" },
            original_estimated_drive_time_minutes: { type: "number" },
            time_saved_minutes: { type: "number" },
            total_miles_saved: { type: "number" },
            route_summary: { type: "string" },
            warnings: { type: "array", items: { type: "string" } },
            tips: { type: "array", items: { type: "string" } }
          }
        }
      });

      // Guard against a malformed LLM response (no/blank order) before rendering
      // or handing it upstream — the render maps over optimized_order.
      if (!result || !Array.isArray(result.optimized_order) || result.optimized_order.length === 0) {
        toast.error("The optimizer returned an unusable result — please try again.");
        return;
      }

      setOptimizedRoute(result);
      setSavings({
        time: result.time_saved_minutes,
        miles: result.total_miles_saved
      });

      onOptimizedSchedule && onOptimizedSchedule(result.optimized_order);

    } catch (error) {
      console.error("Error optimizing route:", error);
      toast.error("Couldn't optimize the route. Please try again.");
    }
  };

  const getEstimatedDuration = (visitType) => {
    const durations = {
      admission: 90,
      recertification: 75,
      discharge: 60,
      skilled_nursing: 45,
      routine_visit: 45,
      prn: 45
    };
    return durations[visitType] || 45;
  };

  const getVisitPriority = (visit, _patient) => {
    if (visit.visit_type === 'admission' || visit.visit_type === 'prn') return 'high';
    if (visit.visit_type === 'recertification' || visit.visit_type === 'discharge') return 'medium';
    return 'low';
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  if (visits.length === 0) {
    return null;
  }

  return (
    <Card className="border-blue-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-blue-50 to-navy-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Route className="w-4 h-4 text-blue-600" />
            Smart Route Optimizer
          </CardTitle>
          <div className="flex items-center gap-2">
            {savings && (
              <Badge className="bg-green-500 text-white">
                Save {savings.time} min
              </Badge>
            )}
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-4">
          {!optimizedRoute ? (
            <div className="text-center py-4">
              <Navigation className="w-12 h-12 mx-auto mb-3 text-blue-300" />
              <p className="text-sm text-slate-600 mb-3">
                Optimize your {visits.length} visits for the most efficient route
              </p>
              <Button
                onClick={optimizeRoute}
                disabled={ai.loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {ai.loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Optimizing Route...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Optimize My Day
                  </>
                )}
              </Button>
              {ai.error && (
                <Alert className="mt-3 bg-red-50 border-red-200 text-left">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription className="text-red-900 text-sm">
                    Route optimization is unavailable right now. Please try again later.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <>
              {/* Savings Summary */}
              <Alert className="bg-green-50 border-green-200">
                <Zap className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <p className="font-semibold">Route Optimized!</p>
                  <p className="text-sm">
                    Save ~{optimizedRoute.time_saved_minutes} minutes and ~{optimizedRoute.total_miles_saved} miles today
                  </p>
                </AlertDescription>
              </Alert>

              {/* Route Summary */}
              <p className="text-sm text-slate-700 bg-blue-50 p-2 rounded">
                📍 {optimizedRoute.route_summary}
              </p>

              {/* Optimized Visit Order */}
              <div className="space-y-2">
                {optimizedRoute.optimized_order?.map((visit, idx) => (
                  <div 
                    key={visit.visit_id}
                    className="flex items-start gap-3 p-3 bg-white rounded-lg border hover:shadow-sm transition-shadow"
                  >
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                        {idx + 1}
                      </div>
                      {idx < optimizedRoute.optimized_order.length - 1 && (
                        <div className="w-0.5 h-8 bg-blue-200 mt-1" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-slate-900">{visit.patient_name}</p>
                        <Badge className={getPriorityColor(visit.priority)}>
                          {visit.priority}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
                        <Clock className="w-3 h-3" />
                        <span>{visit.suggested_time}</span>
                        <span>•</span>
                        <span>{visit.estimated_duration_minutes} min</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                        <MapPin className="w-3 h-3" />
                        <span className="truncate">{visit.address}</span>
                      </div>
                      {visit.travel_time_from_previous > 0 && (
                        <div className="flex items-center gap-1 text-xs text-blue-600 mt-1">
                          <Car className="w-3 h-3" />
                          <span>{visit.travel_time_from_previous} min drive</span>
                        </div>
                      )}
                      <p className="text-xs text-slate-500 italic mt-1">
                        {visit.optimization_reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Warnings */}
              {optimizedRoute.warnings?.length > 0 && (
                <div className="space-y-1">
                  {optimizedRoute.warnings.map((warning, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-orange-700 bg-orange-50 p-2 rounded">
                      <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tips */}
              {optimizedRoute.tips?.length > 0 && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-blue-900 mb-1">💡 Tips for Today:</p>
                  <ul className="text-xs text-blue-800 space-y-1">
                    {optimizedRoute.tips.map((tip, idx) => (
                      <li key={idx}>• {tip}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Re-optimize Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={optimizeRoute}
                disabled={ai.loading}
                className="w-full"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${ai.loading ? 'animate-spin' : ''}`} />
                Re-optimize Route
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}