import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Clock, AlertCircle, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatEastern } from "../utils/timezone";

export default function ApprovalQueue() {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [approverNotes, setApproverNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: myApprovals = [] } = useQuery({
    queryKey: ['myApprovals', currentUser?.email],
    queryFn: () => base44.entities.ApprovalRequest.filter({
      approver_email: currentUser.email
    }),
    enabled: !!currentUser?.email
  });

  const { data: myRequests = [] } = useQuery({
    queryKey: ['myRequests', currentUser?.email],
    queryFn: () => base44.entities.ApprovalRequest.filter({
      requester_email: currentUser.email
    }),
    enabled: !!currentUser?.email
  });

  const { data: allRequests = [] } = useQuery({
    queryKey: ['allApprovalRequests'],
    queryFn: () => base44.entities.ApprovalRequest.list('-created_date', 100),
    enabled: currentUser?.role === 'admin'
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, notes }) => base44.entities.ApprovalRequest.update(id, {
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: currentUser.email,
      approver_notes: notes
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApprovals'] });
      queryClient.invalidateQueries({ queryKey: ['allApprovalRequests'] });
      setShowDetails(false);
      setApproverNotes("");
      toast.success("Request approved");
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => base44.entities.ApprovalRequest.update(id, {
      status: 'rejected',
      approved_at: new Date().toISOString(),
      approved_by: currentUser.email,
      rejection_reason: reason
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myApprovals'] });
      queryClient.invalidateQueries({ queryKey: ['allApprovalRequests'] });
      setShowDetails(false);
      setRejectionReason("");
      toast.success("Request rejected");
    }
  });

  const handleApprove = () => {
    if (selectedRequest) {
      approveMutation.mutate({ id: selectedRequest.id, notes: approverNotes });
    }
  };

  const handleReject = () => {
    if (selectedRequest && rejectionReason.trim()) {
      rejectMutation.mutate({ id: selectedRequest.id, reason: rejectionReason });
    } else {
      toast.error("Please provide a rejection reason");
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      low: "bg-gray-100 text-gray-800",
      medium: "bg-blue-100 text-blue-800",
      high: "bg-orange-100 text-orange-800",
      urgent: "bg-red-100 text-red-800"
    };
    return colors[priority] || colors.medium;
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-green-100 text-green-800",
      rejected: "bg-red-100 text-red-800",
      escalated: "bg-purple-100 text-purple-800"
    };
    return colors[status] || colors.pending;
  };

  const RequestCard = ({ request, showActions = false }) => (
    <Card className="mb-3">
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-bold">{request.title}</h3>
              <Badge className={getPriorityColor(request.priority)}>
                {request.priority}
              </Badge>
              <Badge className={getStatusColor(request.status)}>
                {request.status}
              </Badge>
            </div>
            <p className="text-sm text-gray-600 mb-2">{request.description}</p>
            <div className="flex gap-4 text-xs text-gray-500">
              <span>From: {request.requester_name}</span>
              <span>•</span>
              <span>Created: {formatEastern(new Date(request.created_date), 'MMM d, yyyy')}</span>
              {request.due_date && (
                <>
                  <span>•</span>
                  <span>Due: {formatEastern(new Date(request.due_date), 'MMM d, yyyy')}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedRequest(request);
                setShowDetails(true);
              }}
            >
              <Eye className="w-4 h-4" />
            </Button>
            {showActions && request.status === 'pending' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-green-600"
                  onClick={() => {
                    setSelectedRequest(request);
                    setShowDetails(true);
                  }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={() => {
                    setSelectedRequest(request);
                    setShowDetails(true);
                  }}
                >
                  <XCircle className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending ({myApprovals.filter(r => r.status === 'pending').length})
          </TabsTrigger>
          <TabsTrigger value="my-requests">My Requests</TabsTrigger>
          {currentUser?.role === 'admin' && (
            <TabsTrigger value="all">All Requests</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Requests Awaiting Your Approval</h2>
            <p className="text-gray-600">Review and approve or reject pending requests</p>
          </div>
          {myApprovals.filter(r => r.status === 'pending').length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No pending approvals</p>
              </CardContent>
            </Card>
          ) : (
            myApprovals.filter(r => r.status === 'pending').map(request => (
              <RequestCard key={request.id} request={request} showActions={true} />
            ))
          )}
        </TabsContent>

        <TabsContent value="my-requests" className="mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-bold">My Approval Requests</h2>
            <p className="text-gray-600">Track the status of your submitted requests</p>
          </div>
          {myRequests.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No requests submitted</p>
              </CardContent>
            </Card>
          ) : (
            myRequests.map(request => (
              <RequestCard key={request.id} request={request} />
            ))
          )}
        </TabsContent>

        {currentUser?.role === 'admin' && (
          <TabsContent value="all" className="mt-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold">All Approval Requests</h2>
              <p className="text-gray-600">View all approval requests in the system</p>
            </div>
            {allRequests.map(request => (
              <RequestCard key={request.id} request={request} />
            ))}
          </TabsContent>
        )}
      </Tabs>

      {/* Request Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Approval Request Details</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-lg mb-2">{selectedRequest.title}</h3>
                <div className="flex gap-2 mb-3">
                  <Badge className={getPriorityColor(selectedRequest.priority)}>
                    {selectedRequest.priority}
                  </Badge>
                  <Badge className={getStatusColor(selectedRequest.status)}>
                    {selectedRequest.status}
                  </Badge>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Description</p>
                <p className="text-sm">{selectedRequest.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Requester</p>
                  <p className="text-sm">{selectedRequest.requester_name}</p>
                  <p className="text-xs text-gray-500">{selectedRequest.requester_email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Request Type</p>
                  <p className="text-sm">{selectedRequest.request_type.replace('_', ' ')}</p>
                </div>
              </div>

              {selectedRequest.request_data && (
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-1">Request Data</p>
                  <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-40">
                    {JSON.stringify(selectedRequest.request_data, null, 2)}
                  </pre>
                </div>
              )}

              {selectedRequest.status === 'pending' && selectedRequest.approver_email === currentUser?.email && (
                <div className="space-y-4 border-t pt-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Approver Notes (Optional)</label>
                    <Textarea
                      value={approverNotes}
                      onChange={(e) => setApproverNotes(e.target.value)}
                      placeholder="Add any notes or comments..."
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Rejection Reason (Required if rejecting)</label>
                    <Textarea
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Explain why this request is being rejected..."
                      rows={3}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleApprove}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      onClick={handleReject}
                      variant="outline"
                      className="flex-1 text-red-600 border-red-600 hover:bg-red-50"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                </div>
              )}

              {selectedRequest.status !== 'pending' && (
                <div className="border-t pt-4">
                  <p className="text-sm font-medium text-gray-600 mb-1">
                    {selectedRequest.status === 'approved' ? 'Approved By' : 'Rejected By'}
                  </p>
                  <p className="text-sm">{selectedRequest.approved_by}</p>
                  {selectedRequest.approver_notes && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-gray-600 mb-1">Notes</p>
                      <p className="text-sm">{selectedRequest.approver_notes}</p>
                    </div>
                  )}
                  {selectedRequest.rejection_reason && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-gray-600 mb-1">Rejection Reason</p>
                      <p className="text-sm text-red-600">{selectedRequest.rejection_reason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}