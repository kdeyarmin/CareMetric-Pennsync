import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Target, Users, ArrowRight, Loader2, User } from "lucide-react";
import { format } from "date-fns";

export default function TeamCarePlanOverview({ agencyId, teamMembers }) {
  const { data: carePlans = [], isLoading } = useQuery({
    queryKey: ["allCarePlans"],
    queryFn: () => base44.entities.CarePlan.list("-created_date", 200),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["allPatients"],
    queryFn: () => base44.entities.Patient.list(),
  });

  const patientMap = useMemo(() => {
    const map = {};
    patients.forEach(p => { map[p.id] = p; });
    return map;
  }, [patients]);

  const activePlans = carePlans.filter(p => p.status === "active");

  // Group by patient
  const grouped = useMemo(() => {
    const map = {};
    activePlans.forEach(plan => {
      if (!map[plan.patient_id]) map[plan.patient_id] = [];
      map[plan.patient_id].push(plan);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [activePlans]);

  const STATUS_COLORS = {
    active: "bg-green-100 text-green-700",
    met: "bg-blue-100 text-blue-700",
    not_met: "bg-red-100 text-red-700",
    revised: "bg-amber-100 text-amber-700",
  };

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-green-700">{activePlans.length}</p>
            <p className="text-[10px] text-green-600">Active Plans</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-blue-700">{carePlans.filter(p => p.status === "met").length}</p>
            <p className="text-[10px] text-blue-600">Goals Met</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-purple-700">{grouped.length}</p>
            <p className="text-[10px] text-purple-600">Patients</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Link to={createPageUrl("CarePlanManagement")}>
          <Button variant="outline" size="sm" className="text-xs gap-1">
            Open Care Plan Manager <ArrowRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>

      {/* Patient list */}
      {grouped.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-400 text-sm">No active care plans</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {grouped.map(([patientId, plans]) => {
            const patient = patientMap[patientId];
            if (!patient) return null;
            return (
              <Card key={patientId}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-slate-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{patient.first_name} {patient.last_name}</p>
                          <p className="text-[10px] text-slate-500">{patient.primary_diagnosis}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {plans.map(plan => (
                          <Badge key={plan.id} className={`${STATUS_COLORS[plan.status]} text-[10px]`}>
                            {plan.problem?.substring(0, 30)}{plan.problem?.length > 30 ? "…" : ""}
                          </Badge>
                        ))}
                      </div>
                      {plans[0]?.collaborators?.length > 0 && (
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-500">
                          <Users className="w-3 h-3" /> {plans[0].collaborators.length} collaborator{plans[0].collaborators.length > 1 ? "s" : ""}
                        </div>
                      )}
                    </div>
                    <Link to={`${createPageUrl("PatientDetails")}?id=${patientId}`}>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">View</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}