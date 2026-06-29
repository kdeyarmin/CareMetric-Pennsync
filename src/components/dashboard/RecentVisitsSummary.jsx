import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Activity, ChevronRight } from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function RecentVisitsSummary({ visits, _patient, showAll = false }) {
  const completedVisits = visits.filter(v => v.status === 'completed');
  const displayVisits = showAll ? completedVisits : completedVisits.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="w-5 h-5 text-green-600" />
          Recent Visit Summaries
          <Badge variant="outline">{completedVisits.length} total</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {displayVisits.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No completed visits yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayVisits.map((visit) => (
              <div key={visit.id} className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900">
                        {formatEastern(visit.visit_date, 'MMM d, yyyy')}
                      </span>
                      <Badge className="bg-green-600">
                        {visit.visit_type?.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {visit.created_by && (
                      <p className="text-xs text-slate-600">By: {visit.created_by}</p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </div>

                {/* Vital Signs */}
                {visit.vital_signs && Object.keys(visit.vital_signs).length > 0 && (
                  <div className="mb-3 p-2 bg-white rounded border border-green-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-green-600" />
                      <p className="text-xs font-semibold text-slate-700">Vital Signs</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {visit.vital_signs.blood_pressure_systolic && (
                        <div>
                          <span className="text-slate-500">BP:</span>
                          <span className="ml-1 font-medium">
                            {visit.vital_signs.blood_pressure_systolic}/{visit.vital_signs.blood_pressure_diastolic}
                          </span>
                        </div>
                      )}
                      {visit.vital_signs.heart_rate && (
                        <div>
                          <span className="text-slate-500">HR:</span>
                          <span className="ml-1 font-medium">{visit.vital_signs.heart_rate}</span>
                        </div>
                      )}
                      {visit.vital_signs.oxygen_saturation && (
                        <div>
                          <span className="text-slate-500">O2:</span>
                          <span className="ml-1 font-medium">{visit.vital_signs.oxygen_saturation}%</span>
                        </div>
                      )}
                      {visit.vital_signs.temperature && (
                        <div>
                          <span className="text-slate-500">Temp:</span>
                          <span className="ml-1 font-medium">{visit.vital_signs.temperature}°F</span>
                        </div>
                      )}
                      {visit.vital_signs.weight && (
                        <div>
                          <span className="text-slate-500">Weight:</span>
                          <span className="ml-1 font-medium">{visit.vital_signs.weight} lbs</span>
                        </div>
                      )}
                      {visit.vital_signs.pain_level !== null && visit.vital_signs.pain_level !== undefined && (
                        <div>
                          <span className="text-slate-500">Pain:</span>
                          <span className="ml-1 font-medium">{visit.vital_signs.pain_level}/10</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Notes Preview */}
                {visit.nurse_notes && (
                  <div className="bg-white p-2 rounded border border-green-200">
                    <p className="text-xs text-slate-700 line-clamp-3">
                      {visit.nurse_notes}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}