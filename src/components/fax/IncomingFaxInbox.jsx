import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Inbox, AlertTriangle, Clock, Eye, FileText, User, 
  Calendar, Loader2, CheckCircle2, Send, Archive, Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const CATEGORY_LABELS = {
  lab_results: "Lab Results",
  referral: "Referral",
  consultation_note: "Consultation Note",
  prescription: "Prescription",
  insurance_authorization: "Insurance Auth",
  discharge_summary: "Discharge Summary",
  imaging_report: "Imaging Report",
  progress_note: "Progress Note",
  consent_form: "Consent Form",
  other: "Other"
};

const URGENCY_COLORS = {
  critical: { bg: "bg-red-100", text: "text-red-700", border: "border-red-300" },
  high: { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-300" },
  medium: { bg: "bg-yellow-100", text: "text-yellow-700", border: "border-yellow-300" },
  low: { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-300" }
};

export default function IncomingFaxInbox({ userEmail }) {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("unread");
  const [filterUrgency, setFilterUrgency] = useState("all");
  const [selectedFax, setSelectedFax] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: incomingFaxes = [], isLoading } = useQuery({
    queryKey: ['incomingFaxes', userEmail, filterStatus, filterUrgency],
    queryFn: async () => {
      const filters = { user_email: userEmail };
      if (filterStatus !== 'all') filters.status = filterStatus;
      if (filterUrgency !== 'all') filters.urgency_level = filterUrgency;
      return base44.entities.IncomingFax.filter(filters, '-received_at', 100);
    },
    enabled: !!userEmail,
    refetchInterval: 10000
  });

  const analyzeMutation = useMutation({
    mutationFn: (faxId) => base44.functions.invoke('analyzeIncomingFax', { fax_id: faxId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incomingFaxes'] });
      toast.success("Fax analyzed successfully");
    },
    onError: (error) => {
      toast.error("Analysis failed: " + error.message);
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, routedTo }) => 
      base44.entities.IncomingFax.update(id, { 
        status, 
        routed_to: routedTo,
        routed_at: new Date().toISOString()
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incomingFaxes'] });
      toast.success("Fax updated");
    }
  });

  const filteredFaxes = incomingFaxes.filter(fax => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      fax.sender_name?.toLowerCase().includes(search) ||
      fax.sender_fax_number?.includes(search) ||
      fax.extracted_info?.patient_name?.toLowerCase().includes(search) ||
      fax.ai_category?.toLowerCase().includes(search)
    );
  });

  const criticalCount = incomingFaxes.filter(f => f.urgency_level === 'critical').length;
  const highCount = incomingFaxes.filter(f => f.urgency_level === 'high').length;
  const unreadCount = incomingFaxes.filter(f => f.status === 'unread').length;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-red-200">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Critical</p>
                <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-200">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">High Priority</p>
                <p className="text-2xl font-bold text-orange-600">{highCount}</p>
              </div>
              <Clock className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Unread</p>
                <p className="text-2xl font-bold text-blue-600">{unreadCount}</p>
              </div>
              <Inbox className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              placeholder="Search faxes..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-9 text-sm"
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="unread">Unread</SelectItem>
                <SelectItem value="reviewing">Reviewing</SelectItem>
                <SelectItem value="routed">Routed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterUrgency} onValueChange={setFilterUrgency}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Urgency</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Fax List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto" />
          </div>
        ) : filteredFaxes.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No incoming faxes</p>
            </CardContent>
          </Card>
        ) : (
          filteredFaxes.map(fax => (
            <FaxCard
              key={fax.id}
              fax={fax}
              onView={() => setSelectedFax(fax)}
              onAnalyze={() => analyzeMutation.mutate(fax.id)}
              onUpdateStatus={(status, routedTo) => updateStatusMutation.mutate({ id: fax.id, status, routedTo })}
            />
          ))
        )}
      </div>

      {/* Detail Dialog */}
      {selectedFax && (
        <FaxDetailDialog
          fax={selectedFax}
          open={!!selectedFax}
          onClose={() => setSelectedFax(null)}
          onUpdateStatus={(status, routedTo) => {
            updateStatusMutation.mutate({ id: selectedFax.id, status, routedTo });
            setSelectedFax(null);
          }}
        />
      )}
    </div>
  );
}

function FaxCard({ fax, onView, onAnalyze, onUpdateStatus }) {
  const urgencyColors = URGENCY_COLORS[fax.urgency_level] || URGENCY_COLORS.medium;
  const isPending = fax.processing_status === 'pending' || fax.processing_status === 'processing';

  return (
    <Card className={`${urgencyColors.border} border-2 hover:shadow-md transition-shadow`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${urgencyColors.bg}`}>
            <FileText className={`w-5 h-5 ${urgencyColors.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-1">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {fax.sender_name || fax.sender_fax_number}
                </p>
                <p className="text-xs text-slate-500">
                  {format(new Date(fax.received_at), 'MMM d, h:mm a')}
                </p>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <Badge className={`${urgencyColors.bg} ${urgencyColors.text} text-[10px]`}>
                  {fax.urgency_level}
                </Badge>
                {fax.status === 'unread' && (
                  <Badge className="bg-blue-100 text-blue-700 text-[10px]">New</Badge>
                )}
              </div>
            </div>

            {fax.ai_category && (
              <Badge className="bg-slate-100 text-slate-700 text-[10px] mr-1">
                {CATEGORY_LABELS[fax.ai_category]}
              </Badge>
            )}

            {fax.ai_summary && (
              <p className="text-xs text-slate-700 mt-2 line-clamp-2">{fax.ai_summary}</p>
            )}

            {fax.extracted_info?.patient_name && (
              <div className="flex items-center gap-1 mt-2 text-xs text-slate-600">
                <User className="w-3 h-3" />
                {fax.extracted_info.patient_name}
              </div>
            )}

            {fax.urgency_reasons?.length > 0 && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                {fax.urgency_reasons[0]}
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onView}>
                <Eye className="w-3 h-3 mr-1" /> View
              </Button>
              {isPending && (
                <Button size="sm" onClick={onAnalyze} className="h-7 text-xs gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Analyze
                </Button>
              )}
              {fax.status === 'unread' && (
                <Button size="sm" onClick={() => onUpdateStatus('reviewing')} className="h-7 text-xs">
                  Mark Reviewing
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FaxDetailDialog({ fax, open, onClose, onUpdateStatus }) {
  const urgencyColors = URGENCY_COLORS[fax.urgency_level] || URGENCY_COLORS.medium;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Incoming Fax Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* AI Summary */}
          {fax.ai_summary && (
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 p-4 rounded-lg">
              <div className="flex items-start gap-2">
                <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-blue-900 mb-1">AI Summary</p>
                  <p className="text-sm text-slate-700">{fax.ai_summary}</p>
                </div>
              </div>
            </div>
          )}

          {/* Urgency Banner */}
          {(fax.urgency_level === 'critical' || fax.urgency_level === 'high') && (
            <div className={`${urgencyColors.bg} ${urgencyColors.border} border-2 p-3 rounded-lg`}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={`w-5 h-5 ${urgencyColors.text} flex-shrink-0 mt-0.5`} />
                <div>
                  <p className={`text-sm font-semibold ${urgencyColors.text}`}>
                    {fax.urgency_level === 'critical' ? 'CRITICAL' : 'HIGH PRIORITY'}
                  </p>
                  {fax.urgency_reasons?.map((reason, i) => (
                    <p key={i} className="text-xs text-slate-700 mt-1">• {reason}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Sender Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-500">From</Label>
              <p className="text-sm font-medium">{fax.sender_name || 'Unknown'}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Fax Number</Label>
              <p className="text-sm font-medium">{fax.sender_fax_number}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Received</Label>
              <p className="text-sm">{format(new Date(fax.received_at), 'MMM d, yyyy h:mm a')}</p>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Category</Label>
              <Badge className="text-xs">{CATEGORY_LABELS[fax.ai_category] || 'Unknown'}</Badge>
            </div>
          </div>

          {/* Extracted Patient Info */}
          {fax.extracted_info && (
            <div className="border rounded-lg p-3 bg-blue-50">
              <p className="text-xs font-semibold text-blue-900 mb-2">Extracted Information</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {fax.extracted_info.patient_name && (
                  <div>
                    <span className="text-slate-600">Patient:</span>
                    <span className="font-medium ml-1">{fax.extracted_info.patient_name}</span>
                  </div>
                )}
                {fax.extracted_info.patient_mrn && (
                  <div>
                    <span className="text-slate-600">MRN:</span>
                    <span className="font-medium ml-1">{fax.extracted_info.patient_mrn}</span>
                  </div>
                )}
                {fax.extracted_info.patient_dob && (
                  <div>
                    <span className="text-slate-600">DOB:</span>
                    <span className="font-medium ml-1">{fax.extracted_info.patient_dob}</span>
                  </div>
                )}
                {fax.extracted_info.provider_name && (
                  <div>
                    <span className="text-slate-600">Provider:</span>
                    <span className="font-medium ml-1">{fax.extracted_info.provider_name}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Suggested Routing */}
          {fax.suggested_routing && (
            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold mb-2">AI Suggestions</p>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-slate-600">Suggested Routing:</span>
                  <Badge className="ml-2 text-xs">{fax.suggested_routing.replace('_', ' ')}</Badge>
                </div>
                {fax.confidence_score > 0 && (
                  <div>
                    <span className="text-xs text-slate-600">Confidence:</span>
                    <span className="ml-2 text-xs font-medium">{fax.confidence_score}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Items */}
          {fax.action_items?.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2">Action Items</p>
              <ul className="space-y-1">
                {fax.action_items.map((item, i) => (
                  <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* OCR Text Preview */}
          {fax.ocr_text && (
            <div>
              <p className="text-xs font-semibold mb-2">Extracted Text</p>
              <div className="border rounded-lg p-3 bg-slate-50 max-h-48 overflow-y-auto">
                <p className="text-xs text-slate-700 whitespace-pre-wrap">{fax.ocr_text.substring(0, 500)}...</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-3 border-t">
            <Button 
              className="flex-1 gap-1" 
              onClick={() => onUpdateStatus('routed', 'nurse_review')}
            >
              <Send className="w-4 h-4" /> Route to Nurse
            </Button>
            <Button 
              variant="outline" 
              onClick={() => onUpdateStatus('archived')}
              className="gap-1"
            >
              <Archive className="w-4 h-4" /> Archive
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children, className }) {
  return <label className={className}>{children}</label>;
}