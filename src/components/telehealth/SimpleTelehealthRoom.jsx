import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, 
  FileText, Share2, Send, Copy, CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function SimpleTelehealthRoom({ visitId, patientId, patientName, onEndCall, currentUser }) {
  const [isCallActive, setIsCallActive] = useState(false);
  const [duration, setDuration] = useState(0);
  const [notes, setNotes] = useState('');
  const [sharedMaterials, setSharedMaterials] = useState([]);
  const [materialToShare, setMaterialToShare] = useState('');
  const [callSummary, setCallSummary] = useState('');
  const startTimeRef = useRef(null);

  useEffect(() => {
    let interval;
    if (isCallActive && startTimeRef.current) {
      interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isCallActive]);

  const startCall = () => {
    setIsCallActive(true);
    startTimeRef.current = Date.now();
    toast.success('Call started - documenting session');
  };

  const shareNote = () => {
    if (!materialToShare.trim()) {
      toast.error('Please enter content to share');
      return;
    }

    const material = {
      type: 'note',
      content: materialToShare,
      timestamp: new Date().toISOString(),
      sharedBy: currentUser?.full_name || currentUser?.email
    };

    setSharedMaterials(prev => [...prev, material]);
    setMaterialToShare('');
    toast.success('Material shared with patient');
  };

  const endCall = async () => {
    setIsCallActive(false);
    
    const loadingToast = toast.loading('Saving session and generating summary...');

    try {
      // Auto-generate call summary
      const summaryResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a concise clinical summary for this telehealth visit:

Patient: ${patientName}
Duration: ${formatDuration(duration)}
Provider Notes: ${notes}
Materials Shared: ${sharedMaterials.map(m => m.content).join('; ')}

Provide a professional summary including:
1. Visit purpose and patient concerns
2. Clinical observations
3. Education/materials provided
4. Follow-up plan`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            key_points: { type: "array", items: { type: "string" } },
            follow_up_needed: { type: "boolean" },
            follow_up_timeframe: { type: "string" }
          }
        }
      });

      // Update visit record with telehealth data
      await base44.entities.Visit.update(visitId, {
        telehealth_call_duration: duration,
        telehealth_summary: summaryResponse.summary,
        telehealth_shared_files: sharedMaterials,
        status: 'completed',
        nurse_notes: notes + '\n\nTELEHEALTH SUMMARY:\n' + summaryResponse.summary
      });

      // Create billing record
      await base44.entities.Invoice.create({
        patient_id: patientId,
        visit_id: visitId,
        service_type: 'Telehealth Consultation',
        service_code: '99441', // Telehealth CPT code
        amount: 75.00,
        description: `Telehealth visit - ${formatDuration(duration)}`,
        status: 'pending',
        billed_by: currentUser?.email
      });

      setCallSummary(summaryResponse.summary);
      toast.dismiss(loadingToast);
      toast.success('Session logged and billing record created');
    } catch (error) {
      console.error('Failed to save session:', error);
      toast.dismiss(loadingToast);
      toast.error('Failed to save session data');
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Telehealth Session - {patientName}</CardTitle>
            {isCallActive && (
              <Badge className="bg-green-600 text-white">
                <span className="animate-pulse mr-1">●</span>
                {formatDuration(duration)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!isCallActive && !callSummary ? (
            <div className="text-center py-12">
              <Video className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 mb-6">
                Ready to start telehealth consultation with {patientName}
              </p>
              <Button
                onClick={startCall}
                className="bg-green-600 hover:bg-green-700"
                size="lg"
              >
                <Video className="w-5 h-5 mr-2" />
                Start Video Call
              </Button>
            </div>
          ) : callSummary ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <p className="font-semibold text-green-900 dark:text-green-100">
                    Session Completed & Logged
                  </p>
                </div>
                <div className="text-sm space-y-2">
                  <p><strong>Duration:</strong> {formatDuration(duration)}</p>
                  <p><strong>Materials Shared:</strong> {sharedMaterials.length} item(s)</p>
                </div>
              </div>

              <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
                <p className="font-semibold mb-2">Clinical Summary:</p>
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {callSummary}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(callSummary);
                    toast.success('Summary copied');
                  }}
                  variant="outline"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Summary
                </Button>
                <Button
                  onClick={() => {
                    setIsCallActive(false);
                    setCallSummary('');
                    setNotes('');
                    setSharedMaterials([]);
                    setDuration(0);
                    if (onEndCall) onEndCall();
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="call" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="call">Call</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="share">Share Materials</TabsTrigger>
              </TabsList>

              <TabsContent value="call" className="space-y-4">
                <div className="bg-gray-900 rounded-lg aspect-video flex items-center justify-center">
                  <div className="text-center text-white">
                    <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-sm">Video call in progress</p>
                    <p className="text-xs text-gray-400 mt-2">
                      Simulated telehealth session
                    </p>
                  </div>
                </div>

                <div className="flex justify-center gap-4">
                  <Button
                    variant="destructive"
                    onClick={endCall}
                    className="rounded-full w-14 h-14"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="space-y-4">
                <div>
                  <Label>Session Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Document clinical observations, patient responses, concerns discussed..."
                    className="min-h-40"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    These notes will be automatically added to the visit record
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="share" className="space-y-4">
                <div>
                  <Label>Share Educational Material or Notes</Label>
                  <Textarea
                    value={materialToShare}
                    onChange={(e) => setMaterialToShare(e.target.value)}
                    placeholder="Enter educational content, discharge instructions, or care plan details to share with patient..."
                    className="min-h-32"
                  />
                  <Button
                    onClick={shareNote}
                    className="mt-2 w-full"
                    variant="outline"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share with Patient
                  </Button>
                </div>

                {sharedMaterials.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Shared Materials ({sharedMaterials.length}):</p>
                    {sharedMaterials.map((material, idx) => (
                      <div key={idx} className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border">
                        <div className="flex items-start justify-between mb-1">
                          <Badge className="bg-blue-600">
                            {new Date(material.timestamp).toLocaleTimeString()}
                          </Badge>
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {material.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}