import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  WifiOff,
  Users,
  Search,
  FileText,
  ArrowLeft,
  CheckCircle2
} from 'lucide-react';
import OfflineVisitNoteCapture from '@/components/offline/OfflineVisitNoteCapture';
import OfflineSyncService, { useOfflineSync } from '@/components/offline/OfflineSyncService';

export default function OfflineVisitDocumentation() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const { isOnline, pendingCount } = useOfflineSync();

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patients-offline'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100),
    initialData: [],
  });

  const filteredPatients = patients.filter(p => {
    const searchLower = searchTerm.toLowerCase();
    return (
      p.first_name?.toLowerCase().includes(searchLower) ||
      p.last_name?.toLowerCase().includes(searchLower) ||
      p.primary_diagnosis?.toLowerCase().includes(searchLower)
    );
  });

  if (selectedPatient) {
    return (
      <div className="max-w-5xl mx-auto">
        <Button
          variant="outline"
          onClick={() => setSelectedPatient(null)}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Patient List
        </Button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Visit Documentation - {selectedPatient.first_name} {selectedPatient.last_name}
          </h1>
          <p className="text-slate-600">{selectedPatient.primary_diagnosis}</p>
        </div>

        <OfflineVisitNoteCapture
          patient={selectedPatient}
          onComplete={() => setSelectedPatient(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Connection & Sync Status */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Card className={`border-2 ${isOnline ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Connection Status</p>
                <p className={`text-xl font-bold ${isOnline ? 'text-green-700' : 'text-orange-700'}`}>
                  {isOnline ? 'Online' : 'Offline'}
                </p>
              </div>
              {isOnline ? (
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              ) : (
                <WifiOff className="w-8 h-8 text-orange-500" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-blue-300 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Pending Sync</p>
                <p className="text-xl font-bold text-blue-700">{pendingCount}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-navy-300 bg-navy-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-700">Total Patients</p>
                <p className="text-xl font-bold text-navy-700">{patients.length}</p>
              </div>
              <Users className="w-8 h-8 text-navy-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sync Service Widget */}
      {pendingCount > 0 && (
        <div className="mb-6">
          <OfflineSyncService />
        </div>
      )}

      {/* Patient Search & Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Patient for Visit Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search patients by name or diagnosis..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="col-span-2 text-center py-12 text-slate-500">
                Loading patients...
              </div>
            ) : filteredPatients.length === 0 ? (
              <div className="col-span-2 text-center py-12 text-slate-500">
                No patients found
              </div>
            ) : (
              filteredPatients.map((patient) => (
                <Card
                  key={patient.id}
                  className="cursor-pointer hover:shadow-lg transition-all border-l-4 border-l-blue-500"
                  onClick={() => setSelectedPatient(patient)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900 mb-1">
                          {patient.first_name} {patient.last_name}
                        </h3>
                        <p className="text-sm text-slate-600 mb-2">
                          {patient.primary_diagnosis || 'No diagnosis'}
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          {patient.care_type && (
                            <Badge variant="outline" className="text-xs">
                              {patient.care_type.replace('_', ' ')}
                            </Badge>
                          )}
                          {patient.status && (
                            <Badge
                              className={
                                patient.status === 'active'
                                  ? 'bg-green-500'
                                  : 'bg-slate-500'
                              }
                            >
                              {patient.status}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}