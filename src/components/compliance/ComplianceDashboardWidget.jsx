import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Calendar, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  parseISO, 
  addDays, 
  differenceInDays, 
  startOfDay
} from "date-fns";

export default function ComplianceDashboardWidget() {
  useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 500),
    initialData: [],
  });

  // Calculate urgent compliance items
  const urgentItems = React.useMemo(() => {
    const today = startOfDay(new Date());
    const urgent = [];

    patients.forEach(patient => {
      if (patient.status !== 'active') return;

      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      const admissionVisit = patientVisits.find(v => v.visit_type === 'admission');
      if (!admissionVisit) return;

      const admissionDate = parseISO(admissionVisit.visit_date);
      const recertVisits = patientVisits
        .filter(v => v.visit_type === 'recertification')
        .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
      
      const lastRecertDate = recertVisits.length > 0 
        ? parseISO(recertVisits[0].visit_date)
        : admissionDate;

      const recertDueDate = addDays(lastRecertDate, 60);
      const daysUntilRecert = differenceInDays(recertDueDate, today);

      // Only show items due in next 7 days or overdue
      if (daysUntilRecert <= 7 && daysUntilRecert >= -7) {
        urgent.push({
          patient: patient,
          type: 'Recertification',
          daysRemaining: daysUntilRecert,
          isCritical: daysUntilRecert <= 3
        });
      }
    });

    return urgent.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 5);
  }, [patients, visits]);

  if (urgentItems.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200 mb-8">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
            <div>
              <h3 className="font-semibold text-slate-900">All Clear!</h3>
              <p className="text-sm text-slate-600">No urgent compliance items</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-orange-200 mb-8">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
            Urgent Compliance Items
          </span>
          <Badge variant="destructive">{urgentItems.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {urgentItems.map((item, index) => (
            <div 
              key={index}
              className={`p-3 rounded-lg border-2 ${
                item.isCritical 
                  ? 'bg-red-50 border-red-300' 
                  : 'bg-yellow-50 border-yellow-300'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">
                    {item.patient.first_name} {item.patient.last_name}
                  </p>
                  <p className="text-sm text-slate-600">{item.type} due</p>
                </div>
                <Badge className={
                  item.daysRemaining < 0 ? 'bg-red-600' :
                  item.isCritical ? 'bg-red-500' : 'bg-yellow-500'
                }>
                  {item.daysRemaining < 0 
                    ? `${Math.abs(item.daysRemaining)}d overdue` 
                    : item.daysRemaining === 0 
                    ? 'DUE TODAY'
                    : `${item.daysRemaining}d`}
                </Badge>
              </div>
            </div>
          ))}
        </div>

        <Link to={createPageUrl("ComplianceCenter")}>
          <Button className="w-full mt-4 bg-orange-600 hover:bg-orange-700">
            <Calendar className="w-4 h-4 mr-2" />
            View All Compliance Items
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}