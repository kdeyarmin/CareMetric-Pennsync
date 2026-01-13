import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export default function SmartNoteAssistant() {
  const queryClient = useQueryClient();
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [roughNote, setRoughNote] = useState("");
  const [enhancedNote, setEnhancedNote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    },
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Smart Note Assistant</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Patient</CardTitle>
        </CardHeader>
        <CardContent>
          <select 
            value={selectedPatientId} 
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="">Select a patient...</option>
            {patients.map(p => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Your Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={roughNote}
            onChange={(e) => setRoughNote(e.target.value)}
            placeholder="Enter your clinical notes..."
            className="w-full h-32 p-2 border rounded font-mono text-sm"
          />
          <p className="text-sm text-gray-600 mt-2">{roughNote.length} characters</p>
        </CardContent>
      </Card>

      {!enhancedNote && roughNote.length >= 20 && (
        <Card className="mb-6 bg-purple-50 border-purple-200">
          <CardContent className="pt-6">
            <Button
              onClick={() => setIsProcessing(true)}
              disabled={isProcessing}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {isProcessing ? 'Processing...' : <><Sparkles className="w-4 h-4 mr-2" /> Enhance with AI</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {enhancedNote && (
        <Card className="bg-green-50 border-green-200">
          <CardHeader>
            <CardTitle>Enhanced Note</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-white p-4 rounded border min-h-32 whitespace-pre-wrap text-sm">
              {enhancedNote}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}