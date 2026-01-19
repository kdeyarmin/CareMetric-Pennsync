import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, Brain } from 'lucide-react';
import ClinicalDecisionSupportTool from '../components/clinical/ClinicalDecisionSupportTool';

export default function ClinicalDecisionSupportPage() {
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  const filteredPatients = patients.filter(patient => {
    const fullName = `${patient.first_name} ${patient.last_name}`.toLowerCase();
    const mrn = patient.medical_record_number?.toLowerCase() || '';
    const query = searchQuery.toLowerCase();
    return fullName.includes(query) || mrn.includes(query);
  });

  if (selectedPatient) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => setSelectedPatient(null)}
            className="text-blue-600 hover:underline mb-2"
          >
            ← Back to patient selection
          </button>
          <h1 className="text-3xl font-bold">Clinical Decision Support</h1>
          <p className="text-gray-600">
            {selectedPatient.first_name} {selectedPatient.last_name}
            {selectedPatient.medical_record_number && ` - MRN: ${selectedPatient.medical_record_number}`}
          </p>
        </div>

        <ClinicalDecisionSupportTool
          patientId={selectedPatient.id}
          patientName={`${selectedPatient.first_name} ${selectedPatient.last_name}`}
        />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Brain className="w-8 h-8" />
          Clinical Decision Support
        </h1>
        <p className="text-gray-600">
          AI-powered diagnostic suggestions, treatment protocols, and clinical recommendations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Patient</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name or MRN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-gray-600">Loading patients...</div>
          ) : filteredPatients.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              No patients found
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredPatients.map(patient => (
                <button
                  key={patient.id}
                  onClick={() => setSelectedPatient(patient)}
                  className="w-full p-4 border rounded-lg hover:bg-gray-50 text-left transition-colors"
                >
                  <p className="font-semibold">
                    {patient.first_name} {patient.last_name}
                  </p>
                  <div className="text-sm text-gray-600 mt-1">
                    {patient.medical_record_number && (
                      <span className="mr-3">MRN: {patient.medical_record_number}</span>
                    )}
                    {patient.date_of_birth && (
                      <span className="mr-3">
                        DOB: {new Date(patient.date_of_birth).toLocaleDateString()}
                      </span>
                    )}
                    {patient.primary_diagnosis && (
                      <span className="text-blue-600">{patient.primary_diagnosis}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}