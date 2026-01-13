import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Loader2, User, Bot, History, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

export default function PatientHistoryChat({ patientId, patientData }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef(null);

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidents', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 10),
    enabled: !!patientId
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const quickQuestions = [
    "What were the last 3 visits about?",
    "Has this patient had any falls?",
    "What medications is the patient on?",
    "What are the active care plan goals?",
    "Has the patient been hospitalized recently?"
  ];

  const buildPatientContext = () => {
    return `
PATIENT INFORMATION:
- Name: ${patientData?.first_name} ${patientData?.last_name}
- DOB: ${patientData?.date_of_birth || 'Not provided'}
- Primary Diagnosis: ${patientData?.primary_diagnosis || 'Not documented'}
- Secondary Diagnoses: ${patientData?.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patientData?.allergies || 'None documented'}
- Current Medications: ${patientData?.current_medications?.map(m => `${m.name} ${m.dosage}`).join(', ') || 'Not documented'}

RECENT VISITS (Last ${visits.length}):
${visits.slice(0, 10).map((v, idx) => `
${idx + 1}. ${v.visit_date} - ${v.visit_type}
   Vitals: BP ${v.vital_signs?.blood_pressure_systolic}/${v.vital_signs?.blood_pressure_diastolic}, HR ${v.vital_signs?.heart_rate}, O2 ${v.vital_signs?.oxygen_saturation}%
   Notes: ${v.nurse_notes?.substring(0, 300)}...
`).join('\n') || 'No visits on record'}

ACTIVE CARE PLANS:
${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'No active care plans'}

INCIDENTS:
${incidents.slice(0, 5).map(inc => `- ${inc.incident_date}: ${inc.incident_type} - ${inc.details?.description || inc.report?.substring(0, 100)}`).join('\n') || 'No incidents recorded'}

FUNCTIONAL STATUS:
- Ambulation: ${patientData?.functional_status?.ambulation || 'Not assessed'}
- ADL Independence: ${patientData?.functional_status?.adl_independence || 'Not assessed'}
- Cognitive Status: ${patientData?.functional_status?.cognitive_status || 'Not assessed'}
- Fall Risk: ${patientData?.functional_status?.fall_risk || 'Not assessed'}
`;
  };

  const handleSendMessage = async (messageText = null) => {
    const text = messageText || inputMessage;
    if (!text.trim()) return;

    const userMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMessage]);
    setInputMessage("");
    setIsProcessing(true);

    try {
      const patientContext = buildPatientContext();
      
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an AI assistant helping a clinician review patient history and records.

${patientContext}

CONVERSATION HISTORY:
${messages.map(m => `${m.role === 'user' ? 'Clinician' : 'AI'}: ${m.content}`).join('\n')}

CLINICIAN'S QUESTION:
${text}

Provide a concise, clinically relevant answer based on the patient's documented history. If information is not available, say so clearly.

Be direct, accurate, and cite specific dates/visits when referencing information.`,
        response_json_schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            sources: { type: "array", items: { type: "string" } }
          }
        }
      });

      const aiMessage = { 
        role: "assistant", 
        content: result.answer,
        sources: result.sources 
      };
      setMessages(prev => [...prev, aiMessage]);
    } catch (error) {
      toast.error("Failed to get response");
      setMessages(prev => prev.slice(0, -1)); // Remove user message on error
    }

    setIsProcessing(false);
  };

  return (
    <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-cyan-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-600" />
          Ask About Patient History
        </CardTitle>
        <p className="text-xs text-gray-600">AI chat to explore previous visits and records</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick Questions */}
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-700">Quick Questions:</p>
            <div className="space-y-1.5">
              {quickQuestions.map((q, idx) => (
                <Button
                  key={idx}
                  size="sm"
                  variant="outline"
                  onClick={() => handleSendMessage(q)}
                  disabled={isProcessing}
                  className="w-full justify-start text-xs h-auto py-2 px-3 hover:bg-blue-50"
                >
                  <Sparkles className="w-3 h-3 mr-2 flex-shrink-0" />
                  <span className="text-left">{q}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Chat Messages */}
        {messages.length > 0 && (
          <div className="bg-white rounded-lg border border-blue-200 p-3 max-h-80 overflow-y-auto space-y-3">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div
                  className={`rounded-lg px-3 py-2 max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-300">
                      <p className="text-xs text-gray-600 mb-1">Sources:</p>
                      {msg.sources.map((source, i) => (
                        <p key={i} className="text-xs text-gray-600">• {source}</p>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}
            {isProcessing && (
              <div className="flex gap-2 justify-start">
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-blue-600" />
                </div>
                <div className="bg-gray-100 rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input Area */}
        <div className="flex gap-2">
          <Input
            placeholder="Ask about this patient's history..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            disabled={isProcessing}
            className="text-sm"
          />
          <Button
            onClick={() => handleSendMessage()}
            disabled={isProcessing || !inputMessage.trim()}
            size="icon"
            className="bg-blue-600 hover:bg-blue-700 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {/* Stats */}
        {messages.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <History className="w-3 h-3" />
            <span>{messages.length / 2} questions asked</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}