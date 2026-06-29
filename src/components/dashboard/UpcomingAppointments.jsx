import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Plus } from "lucide-react";
import { formatEastern, todayEastern } from "../utils/timezone";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function UpcomingAppointments({ visits, _patientId }) {
  const upcomingVisits = visits
    .filter(v => v.status === 'scheduled' && v.visit_date >= todayEastern())
    .sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date))
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="w-5 h-5 text-indigo-600" />
            Upcoming Appointments
          </CardTitle>
          <Button size="sm" variant="outline" asChild>
            <Link to={createPageUrl('VisitScribe')}>
              <Plus className="w-4 h-4 mr-1" />
              Schedule
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {upcomingVisits.length === 0 ? (
          <div className="text-center py-8">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-500 text-sm">No upcoming appointments</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingVisits.map((visit) => (
              <div key={visit.id} className="p-3 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg border border-indigo-200">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                      <span className="font-semibold text-slate-900">
                        {formatEastern(visit.visit_date, 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">
                      {visit.visit_type?.replace(/_/g, ' ')}
                    </p>
                    {visit.visit_time && (
                      <p className="text-xs text-slate-600 flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {visit.visit_time}
                      </p>
                    )}
                  </div>
                  <Badge className="bg-indigo-600">Scheduled</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}