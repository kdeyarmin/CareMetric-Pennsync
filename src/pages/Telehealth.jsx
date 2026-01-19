import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Video, Search } from 'lucide-react';
import EnhancedTelehealthModule from '../components/telehealth/EnhancedTelehealthModule';

export default function TelehealthPage() {
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: visits = [], isLoading } = useQuery({
    queryKey: ['scheduledVisits'],
    queryFn: async () => {
      const allVisits = await base44.entities.Visit.list();
      return allVisits.filter(v => v.status === 'scheduled' || v.status === 'in_progress');
    }
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown';
  };

  const filteredVisits = visits.filter(visit => {
    const patientName = getPatientName(visit.patient_id).toLowerCase();
    return patientName.includes(searchQuery.toLowerCase());
  });

  if (selectedVisit) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <EnhancedTelehealthModule
          visitId={selectedVisit.id}
          patientId={selectedVisit.patient_id}
          patientName={getPatientName(selectedVisit.patient_id)}
          onEndCall={() => setSelectedVisit(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Telehealth</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Select Visit for Telehealth Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search patients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-gray-600">Loading visits...</div>
          ) : filteredVisits.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              No scheduled visits found
            </div>
          ) : (
            <div className="space-y-3">
              {filteredVisits.map(visit => (
                <div
                  key={visit.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-semibold">{getPatientName(visit.patient_id)}</p>
                    <p className="text-sm text-gray-600">
                      {visit.visit_type} • {new Date(visit.visit_date).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    onClick={() => setSelectedVisit(visit)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Video className="w-4 h-4 mr-2" />
                    Start Call
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}