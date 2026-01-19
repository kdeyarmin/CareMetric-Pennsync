import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Video, Search, FileText, Calendar, Plus } from 'lucide-react';
import SimpleTelehealthRoom from '../components/telehealth/SimpleTelehealthRoom';
import TelehealthScheduler from '../components/telehealth/TelehealthScheduler';
import AITelehealthSummaryGenerator from '../components/telehealth/AITelehealthSummaryGenerator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function TelehealthPage() {
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showScheduler, setShowScheduler] = useState(false);
  const [selectedPatientForScheduling, setSelectedPatientForScheduling] = useState('');

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
      <div className="p-4 lg:p-6 max-w-7xl mx-auto">
        <Button
          onClick={() => setSelectedVisit(null)}
          variant="outline"
          className="mb-4"
        >
          ← Back to Sessions
        </Button>
        <SimpleTelehealthRoom
          visitId={selectedVisit.id}
          patientId={selectedVisit.patient_id}
          patientName={getPatientName(selectedVisit.patient_id)}
          currentUser={user}
          onEndCall={() => setSelectedVisit(null)}
        />
      </div>
    );
  }

  if (showScheduler) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto">
        <Button
          onClick={() => {
            setShowScheduler(false);
            setSelectedPatientForScheduling('');
          }}
          variant="outline"
          className="mb-4"
        >
          ← Back to Sessions
        </Button>
        <TelehealthScheduler
          patientId={selectedPatientForScheduling}
          onScheduled={(visit) => {
            setShowScheduler(false);
            setSelectedPatientForScheduling('');
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold">Telehealth</h1>
        <Button
          onClick={() => setShowScheduler(true)}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Plus className="w-4 h-4 mr-2" />
          Schedule Visit
        </Button>
      </div>

      <Tabs defaultValue="sessions" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="sessions">
            <Video className="w-4 h-4 mr-2" />
            Sessions
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Calendar className="w-4 h-4 mr-2" />
            Schedule New
          </TabsTrigger>
          <TabsTrigger value="analysis">
            <FileText className="w-4 h-4 mr-2" />
            Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Scheduled Sessions</CardTitle>
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
        </TabsContent>

        <TabsContent value="schedule">
          <div className="grid gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Select Patient</label>
              <Select 
                value={selectedPatientForScheduling} 
                onValueChange={setSelectedPatientForScheduling}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose patient..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPatientForScheduling && (
              <TelehealthScheduler
                patientId={selectedPatientForScheduling}
                onScheduled={(visit) => {
                  setSelectedPatientForScheduling('');
                  toast.success('Visit scheduled successfully');
                }}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="analysis">
          <AITelehealthSummaryGenerator
            onAnalysisComplete={(analysis) => {
              console.log('Analysis complete:', analysis);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}