import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { logOASISAction, AuditActions } from "../utils/auditLogger";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  XCircle,
  Edit3,
  ArrowLeft,
  AlertTriangle,
  FileText,
  Save
} from "lucide-react";

export default function OASISComparisonView({ 
  patient, 
  oasisRecord, 
  aiSuggestions = [],
  onClose,
  onUpdate
}) {
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const updateMutation = useMutation({
    mutationFn: async ({ itemNumber, action, value, notes }) => {
      const updatedData = { ...oasisRecord.extracted_data };
      const currentUser = await base44.auth.me();
      const oldValue = updatedData[itemNumber]?.value;
      
      if (action === 'approve') {
        updatedData[itemNumber] = {
          ...updatedData[itemNumber],
          reviewed: true,
          approved: true,
          reviewed_by: currentUser.email,
          reviewed_at: new Date().toISOString(),
          review_notes: notes
        };
        
        // Log audit trail
        await logOASISAction({
          action: AuditActions.OASIS_SUGGESTION_APPROVED,
          patientId: patient.id,
          oasisId: oasisRecord.id,
          itemNumber,
          oldValue,
          newValue: updatedData[itemNumber].value,
          confidence: updatedData[itemNumber].confidence,
          notes,
          reviewedBy: currentUser.email,
        });
      } else if (action === 'reject') {
        updatedData[itemNumber] = {
          ...updatedData[itemNumber],
          reviewed: true,
          rejected: true,
          reviewed_by: currentUser.email,
          reviewed_at: new Date().toISOString(),
          rejection_reason: notes
        };
        
        // Log audit trail
        await logOASISAction({
          action: AuditActions.OASIS_SUGGESTION_REJECTED,
          patientId: patient.id,
          oasisId: oasisRecord.id,
          itemNumber,
          oldValue,
          newValue: null,
          notes,
          reviewedBy: currentUser.email,
        });
      } else if (action === 'edit') {
        updatedData[itemNumber] = {
          ...updatedData[itemNumber],
          value,
          reviewed: true,
          manually_edited: true,
          reviewed_by: currentUser.email,
          reviewed_at: new Date().toISOString(),
          edit_notes: notes
        };
        
        // Log audit trail
        await logOASISAction({
          action: AuditActions.OASIS_SUGGESTION_EDITED,
          patientId: patient.id,
          oasisId: oasisRecord.id,
          itemNumber,
          oldValue,
          newValue: value,
          notes,
          reviewedBy: currentUser.email,
        });
      }

      return base44.entities.OASISUpload.update(oasisRecord.id, {
        extracted_data: updatedData
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisRecords'] });
      onUpdate?.();
    },
  });

  const handleApprove = (itemNumber, notes = "") => {
    updateMutation.mutate({ itemNumber, action: 'approve', notes });
  };

  const handleReject = (itemNumber, notes = "") => {
    if (!notes) {
      const reason = prompt("Please provide a reason for rejection:");
      if (!reason) return;
      notes = reason;
    }
    updateMutation.mutate({ itemNumber, action: 'reject', notes });
  };

  const handleEdit = (itemNumber) => {
    const current = aiSuggestions.find(([k]) => k === itemNumber);
    if (current) {
      setEditingItem(itemNumber);
      setEditValue(current[1].value || "");
      setEditNotes("");
    }
  };

  const handleSaveEdit = () => {
    if (!editValue) return;
    updateMutation.mutate({ 
      itemNumber: editingItem, 
      action: 'edit', 
      value: editValue,
      notes: editNotes 
    });
    setEditingItem(null);
  };

  const pendingSuggestions = aiSuggestions.filter(([_k, data]) => !data.reviewed);
  const reviewedSuggestions = aiSuggestions.filter(([_k, data]) => data.reviewed);

  return (
    <div className="space-y-4">
      <Card className="border-2 border-navy-200">
        <CardHeader className="py-4 bg-gradient-to-r from-navy-50 to-blue-50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                OASIS Review: {patient?.first_name} {patient?.last_name}
              </CardTitle>
              <p className="text-sm text-slate-600 mt-1">
                {pendingSuggestions.length} pending • {reviewedSuggestions.length} reviewed
              </p>
            </div>
            <Button variant="outline" onClick={onClose}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to List
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Pending Suggestions */}
      {pendingSuggestions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Pending Review ({pendingSuggestions.length})
          </h3>
          {pendingSuggestions.map(([itemNumber, data]) => (
            <Card key={itemNumber} className="border-2 border-orange-200 bg-orange-50">
              <CardContent className="p-4">
                {editingItem === itemNumber ? (
                  <div className="space-y-3">
                    <div>
                      <p className="font-semibold text-sm mb-2">{itemNumber}</p>
                      <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="Enter corrected value..."
                        className="mb-2"
                      />
                      <Textarea
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder="Add notes about this edit..."
                        className="h-20"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleSaveEdit} className="bg-green-600 hover:bg-green-700">
                        <Save className="w-4 h-4 mr-1" />
                        Save Changes
                      </Button>
                      <Button variant="outline" onClick={() => setEditingItem(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline">{itemNumber}</Badge>
                          <Badge className={`${
                            data.confidence >= 80 ? 'bg-green-100 text-green-800' :
                            data.confidence >= 50 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {data.confidence}% confidence
                          </Badge>
                        </div>
                        <p className="text-sm font-semibold text-slate-800">AI Suggested Value:</p>
                        <p className="text-lg font-bold text-slate-900">{data.value}</p>
                        {data.label && (
                          <p className="text-sm text-slate-600 italic">{data.label}</p>
                        )}
                      </div>
                    </div>

                    {/* Supporting Evidence */}
                    {data.supporting_text && (
                      <div className="bg-white p-3 rounded border border-slate-200">
                        <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Supporting Evidence:
                        </p>
                        <p className="text-xs text-slate-700 italic">"{data.supporting_text}"</p>
                      </div>
                    )}

                    {/* Clinical Rationale */}
                    {data.clinical_rationale && (
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-xs font-semibold text-blue-800 mb-1">Clinical Rationale:</p>
                        <p className="text-xs text-blue-700">{data.clinical_rationale}</p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2 border-t">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(itemNumber)}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        disabled={updateMutation.isPending}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleEdit(itemNumber)}
                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                        disabled={updateMutation.isPending}
                      >
                        <Edit3 className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(itemNumber)}
                        className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                        disabled={updateMutation.isPending}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Reviewed Suggestions */}
      {reviewedSuggestions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            Reviewed ({reviewedSuggestions.length})
          </h3>
          {reviewedSuggestions.map(([itemNumber, data]) => (
            <Card key={itemNumber} className={`border-2 ${
              data.approved ? 'border-green-200 bg-green-50' :
              data.rejected ? 'border-red-200 bg-red-50' :
              'border-blue-200 bg-blue-50'
            }`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline">{itemNumber}</Badge>
                      {data.approved && (
                        <Badge className="bg-green-600 text-white">Approved</Badge>
                      )}
                      {data.rejected && (
                        <Badge className="bg-red-600 text-white">Rejected</Badge>
                      )}
                      {data.manually_edited && (
                        <Badge className="bg-blue-600 text-white">Edited</Badge>
                      )}
                    </div>
                    <p className="text-sm font-semibold">Value: {data.value}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Reviewed by {data.reviewed_by} on {new Date(data.reviewed_at).toLocaleDateString()}
                    </p>
                    {(data.review_notes || data.rejection_reason || data.edit_notes) && (
                      <p className="text-xs text-slate-700 mt-2 italic">
                        Note: {data.review_notes || data.rejection_reason || data.edit_notes}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}