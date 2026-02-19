import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  AlertTriangle,
  Heart,
  Clock,
  ArrowRight
} from 'lucide-react';

export default function QuickAccessPatientCard() {
  const { data: patients } = useQuery({
    queryKey: ['recent-patients'],
    queryFn: async () => {
      const all = await base44.entities.Patient.filter({ status: 'active' });
      return all.sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date)).slice(0, 5);
    }
  });

  const { data: alerts } = useQuery({
    queryKey: ['active-alerts-summary'],
    queryFn: async () => {
      const all = await base44.entities.PatientAlert.filter({ status: 'active' });
      return all;
    }
  });

  const patientsWithAlerts = patients?.filter(p => 
    alerts?.some(a => a.patient_id === p.id)
  ) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Recent Patients
          </CardTitle>
          <Link to={createPageUrl('Patients')}>
            <Button size="sm" variant="outline">
              View All
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {patients?.map(patient => {
            const patientAlerts = alerts?.filter(a => a.patient_id === patient.id) || [];
            const highAlerts = patientAlerts.filter(a => a.severity === 'critical' || a.severity === 'high');

            return (
              <Link key={patient.id} to={createPageUrl(`Patient360View/${patient.id}`)}>
                <div className="p-3 border rounded-lg hover:shadow-md transition-shadow cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium">{patient.full_name}</p>
                        {highAlerts.length > 0 && (
                          <Badge className="bg-red-100 text-red-800">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {highAlerts.length}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-600">
                        {patient.primary_diagnosis && (
                          <span className="flex items-center gap-1">
                            <Heart className="h-3 w-3" />
                            {patient.primary_diagnosis.substring(0, 30)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Updated {new Date(patient.updated_date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}

          {(!patients || patients.length === 0) && (
            <p className="text-sm text-slate-600 text-center py-4">No recent patients</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}