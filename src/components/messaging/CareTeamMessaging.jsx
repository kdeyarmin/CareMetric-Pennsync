import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquare,
  Send,
  Users,
  Sparkles,
  AlertTriangle,
  Clock,
  FileText,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Save
} from "lucide-react";
import { format } from "date-fns";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";

export default function CareTeamMessaging({ patientId, relatedEventId, relatedEventType }) {
  const queryClient = useQueryClient();
  const [selectedThread, setSelectedThread] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [priority, setPriority] = useState("normal");
  const [showNewThread, setShowNewThread] = useState(false);
  const [threadSummary, setThreadSummary] = useState(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [expandedSuggestions, setExpandedSuggestions] = useState(false);

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: messages = [], _isLoading } = useQuery({
    queryKey: ['messages', patientId],
    queryFn: async () => {
      const filters = patientId ? { patient_id: patientId } : {};
      return base44.entities.Message.filter(filters, '-created_date', 100);
    },
    enabled: !!patientId
  });

  // Group messages by thread
  const threads = useMemo(() => {
    const grouped = {};
    messages.forEach(msg => {
      const threadId = msg.thread_id || msg.id;
      if (!grouped[threadId]) {
        grouped[threadId] = [];
      }
      grouped[threadId].push(msg);
    });
    return Object.entries(grouped).map(([threadId, msgs]) => ({
      threadId,
      messages: msgs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date)),
      subject: msgs[0].subject || 'No Subject',
      lastMessage: msgs[msgs.length - 1],
      unreadCount: msgs.filter(m => !m.read_by?.includes(user?.email)).length
    }));
  }, [messages, user?.email]);

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData) => {
      return base44.entities.Message.create(messageData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', patientId] });
      setNewMessage("");
      if (showNewThread) {
        setNewSubject("");
        setShowNewThread(false);
      }
    }
  });

  const saveToChartMutation = useMutation({
    mutationFn: async () => {
      if (!patientId || !selectedThread) return;
      const patient = await base44.entities.Patient.get(patientId);
      
      const logHeader = `\n\n--- Clinical Communication Log: ${selectedThread.subject} (${format(new Date(), 'MMM d, yyyy')}) ---\n`;
      const logBody = selectedThread.messages.map(m => `[${format(new Date(m.created_date), 'h:mm a')}] ${m.sender_name} (${m.priority}): ${m.message_text}`).join('\n');
      
      const newNotes = (patient.clinical_notes || "") + logHeader + logBody;
      
      return base44.entities.Patient.update(patientId, { clinical_notes: newNotes });
    },
    onSuccess: () => {
      toast.success("Thread saved to patient chart");
    }
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId) => {
      const msg = messages.find(m => m.id === messageId);
      if (!msg || !user?.email) return;
      const readBy = msg.read_by || [];
      if (!readBy.includes(user.email)) {
        // Spread rather than push — readBy may alias the react-query-cached
        // array, and mutating it in place corrupts cached state.
        return base44.entities.Message.update(messageId, { read_by: [...readBy, user.email] });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', patientId] });
    }
  });

  const { mutate: markAsRead } = markAsReadMutation;

  useEffect(() => {
    if (selectedThread) {
      selectedThread.messages.forEach(msg => {
        if (!msg.read_by?.includes(user?.email)) {
          markAsRead(msg.id);
        }
      });
    }
  }, [selectedThread, user?.email, markAsRead]);

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    const messageData = {
      patient_id: patientId,
      thread_id: selectedThread?.threadId || `thread-${Date.now()}`,
      subject: showNewThread ? newSubject : selectedThread?.subject,
      message_text: newMessage,
      sender_name: user?.full_name || user?.email,
      sender_email: user?.email,
      priority,
      related_event_id: relatedEventId,
      related_event_type: relatedEventType
    };

    sendMessageMutation.mutate(messageData);
  };

  const summarizeThread = async () => {
    if (!selectedThread) return;

    setIsSummarizing(true);
    try {
      const { data } = await base44.functions.invoke('summarizeMessageThread', {
        thread_id: selectedThread.threadId,
        patient_id: patientId
      });
      setThreadSummary(data);
    } catch (error) {
      console.error('Error summarizing thread:', error);
    }
    setIsSummarizing(false);
  };

  const loadSuggestions = async () => {
    if (!patientId) return;

    setIsLoadingSuggestions(true);
    try {
      const { data } = await base44.functions.invoke('generateMessageSuggestions', {
        patient_id: patientId,
        thread_id: selectedThread?.threadId,
        current_message: newMessage
      });
      setSuggestions(data);
    } catch (error) {
      console.error('Error loading suggestions:', error);
    }
    setIsLoadingSuggestions(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Thread List */}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Message Threads
            </CardTitle>
            <Button
              size="sm"
              onClick={() => {
                setShowNewThread(true);
                setSelectedThread(null);
                setThreadSummary(null);
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              New Thread
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {threads.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No messages yet</p>
          ) : (
            threads.map(thread => (
              <div
                key={thread.threadId}
                onClick={() => {
                  setSelectedThread(thread);
                  setShowNewThread(false);
                  setThreadSummary(null);
                }}
                className={`p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedThread?.threadId === thread.threadId
                    ? 'bg-blue-100 border-2 border-blue-500'
                    : 'bg-slate-50 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-slate-900 line-clamp-1">{thread.subject}</p>
                  {thread.unreadCount > 0 && (
                    <Badge className="bg-red-600 text-white text-xs">{thread.unreadCount}</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-600 line-clamp-2 mb-1">{thread.lastMessage.message_text}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="w-3 h-3" />
                  {format(new Date(thread.lastMessage.created_date), 'MMM d, h:mm a')}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Message View */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4" />
              {showNewThread ? 'New Thread' : selectedThread?.subject || 'Select a thread'}
            </CardTitle>
            {selectedThread && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveToChartMutation.mutate()}
                  disabled={saveToChartMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-1" />
                  Save to Chart
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadSuggestions}
                  disabled={isLoadingSuggestions}
                >
                  <Lightbulb className="w-4 h-4 mr-1" />
                  AI Assist
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={summarizeThread}
                  disabled={isSummarizing}
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  Summarize
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* AI Thread Summary */}
          {threadSummary && (
            <Alert className="bg-navy-50 border-navy-300">
              <Sparkles className="w-4 h-4 text-navy-600" />
              <AlertDescription>
                <p className="text-sm font-semibold text-navy-900 mb-2">AI Thread Summary</p>
                <p className="text-sm text-navy-800 mb-2">{threadSummary.summary}</p>
                
                {threadSummary.key_points?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-navy-900">Key Points:</p>
                    <ul className="text-xs text-navy-800 list-disc list-inside">
                      {threadSummary.key_points.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {threadSummary.action_items?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-navy-900">Action Items:</p>
                    <ul className="text-xs text-navy-800 list-disc list-inside">
                      {threadSummary.action_items.map((item, idx) => (
                        <li key={idx}>{item.action} {item.assigned_to && `(${item.assigned_to})`}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* AI Suggestions */}
          {suggestions && (
            <Card className="bg-blue-50 border-blue-300">
              <CardHeader className="pb-2">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedSuggestions(!expandedSuggestions)}
                >
                  <p className="text-xs font-semibold text-blue-900 flex items-center gap-1">
                    <Lightbulb className="w-3 h-3" />
                    AI Context Suggestions
                  </p>
                  {expandedSuggestions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </CardHeader>
              {expandedSuggestions && (
                <CardContent className="space-y-2">
                  {suggestions.suggested_info?.map((info, idx) => (
                    <div key={idx} className="bg-white p-2 rounded text-xs">
                      <Badge className="bg-blue-600 text-white mb-1">{info.category}</Badge>
                      <p className="text-slate-900">{info.information}</p>
                    </div>
                  ))}

                  {suggestions.safety_alerts?.length > 0 && (
                    <Alert className="bg-red-50 border-red-300">
                      <AlertTriangle className="w-3 h-3 text-red-600" />
                      <AlertDescription className="text-xs text-red-900">
                        {suggestions.safety_alerts.map((alert, idx) => (
                          <p key={idx}>• {alert}</p>
                        ))}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Messages */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {showNewThread && (
              <div className="mb-3">
                <Input
                  placeholder="Thread Subject"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  className="mb-2"
                />
              </div>
            )}

            {selectedThread?.messages.map(msg => (
              <div
                key={msg.id}
                className={`p-3 rounded-lg ${
                  msg.sender_email === user?.email
                    ? 'bg-blue-100 ml-8'
                    : 'bg-slate-100 mr-8'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-900">{msg.sender_name}</p>
                  <div className="flex items-center gap-2">
                    {msg.priority !== 'normal' && (
                      <Badge className={`text-xs ${
                        msg.priority === 'urgent' ? 'bg-red-600' : 'bg-orange-600'
                      } text-white`}>
                        {msg.priority}
                      </Badge>
                    )}
                    <p className="text-xs text-slate-500">
                      {format(new Date(msg.created_date), 'MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{msg.message_text}</p>
                
                {/* Referral Action Buttons */}
                {msg.related_event_type === 'referral' && msg.related_event_id && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.location.href = createPageUrl(`ReferralIntake`)}
                      className="text-xs"
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      View Referral
                    </Button>
                    <Button
                      size="sm"
                      className="bg-navy-600 hover:bg-navy-700 text-xs"
                      onClick={() => window.location.href = createPageUrl(`ReferralIntake?tab=admission&referral_id=${msg.related_event_id}`)}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Create Admission Note
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Compose Message */}
          {(selectedThread || showNewThread) && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex gap-2">
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={3}
                className="resize-none"
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sendMessageMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send Message
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}