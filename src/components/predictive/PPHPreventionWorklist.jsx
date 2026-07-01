import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, Clock, ListChecks, ShieldAlert } from "lucide-react";
import { buildPphWorklist, DTC_PAC_WINDOW_DAYS } from "./pphWorklistEngine";

// Agency-wide ranked worklist for the highest-weighted HHVBP measure (~26%):
// Within-Stay Potentially Preventable Hospitalization, plus the DTC-PAC 31-day
// window. Drives front-loaded visits / MD contact / med review. The ranking +
// intervention logic is the unit-tested pure engine (pphWorklistEngine.js).
const PRIORITY_STYLE = {
  urgent: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  moderate: "bg-yellow-500 text-white",
  watch: "bg-slate-400 text-white",
};

export default function PPHPreventionWorklist({ patients = [], oasisData = [], visits = [], limit = 25 }) {
  const worklist = useMemo(() => {
    // Pre-index by patient_id once so building items is O(patients + oasis +
    // visits) rather than O(patients × (oasis + visits)) per render.
    const groupByPatient = (rows) => {
      const map = new Map();
      for (const r of rows || []) {
        if (!map.has(r.patient_id)) map.set(r.patient_id, []);
        map.get(r.patient_id).push(r);
      }
      return map;
    };
    const oasisByPatient = groupByPatient(oasisData);
    const visitsByPatient = groupByPatient(visits);
    const items = patients.map((p) => ({
      patient: p,
      oasis: oasisByPatient.get(p.id) || [],
      visits: visitsByPatient.get(p.id) || [],
    }));
    return buildPphWorklist(items, { limit });
  }, [patients, oasisData, visits, limit]);

  const urgent = worklist.filter((e) => e.priority === "urgent").length;
  const inWindow = worklist.filter((e) => e.within_dtc_pac_window).length;

  return (
    <Card className="border-2 border-red-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="w-5 h-5 text-red-600" />
          PPH Prevention Worklist
          <Badge className="bg-red-100 text-red-800 text-xs">HHVBP ~26% · Within-Stay PPH</Badge>
        </CardTitle>
        <p className="text-xs text-slate-500">
          Ranked by preventable-hospitalization risk and the DTC-PAC {DTC_PAC_WINDOW_DAYS}-day window —
          front-load visits, contact the MD, and review medications for the top of the list.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge className="bg-red-600">{urgent} urgent</Badge>
          <Badge className="bg-slate-600">{worklist.length} on worklist</Badge>
          <Badge className="bg-indigo-600 flex items-center gap-1"><Clock className="w-3 h-3" />{inWindow} in {DTC_PAC_WINDOW_DAYS}-day window</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {worklist.length === 0 && <p className="text-sm text-slate-500">No active patients to rank.</p>}
        {worklist.map((entry, idx) => (
          <div key={entry.patient_id || idx} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-400">#{idx + 1}</span>
                  <span className="text-sm font-semibold text-slate-800">{entry.patient_name}</span>
                  <Badge className={`text-xs ${PRIORITY_STYLE[entry.priority]}`}>{entry.priority}</Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <Activity className="w-3 h-3" /> risk {entry.risk_score}
                  </span>
                  {entry.within_dtc_pac_window && (
                    <span className="inline-flex items-center gap-1 text-xs text-indigo-600">
                      <Clock className="w-3 h-3" /> day {entry.days_in_episode} · in window
                    </span>
                  )}
                </div>
                {entry.factors.length > 0 && (
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 flex-wrap">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {entry.factors.slice(0, 3).map((f) => f.factor).join(" · ")}
                  </p>
                )}
              </div>
            </div>
            {entry.interventions.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <ListChecks className="w-3 h-3" /> Recommended interventions
                </p>
                <ul className="text-xs text-slate-600 list-disc pl-5 mt-0.5 space-y-0.5">
                  {entry.interventions.map((iv, i) => (
                    <li key={i}>{iv}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
