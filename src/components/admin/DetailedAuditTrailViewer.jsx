import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Filter, Eye, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function DetailedAuditTrailViewer({ auditLogs }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [filterSuspicious, setFilterSuspicious] = useState("all");
  const [selectedLog, setSelectedLog] = useState(null);

  // Filter logs
  const filteredLogs = auditLogs.filter(log => {
    const matchesSearch = 
      log.action_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.target_identifier?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = filterAction === "all" || log.action_type === filterAction;
    const matchesSuspicious = 
      filterSuspicious === "all" ||
      (filterSuspicious === "flagged" && log.flagged_suspicious) ||
      (filterSuspicious === "reviewed" && log.reviewed) ||
      (filterSuspicious === "unreviewed" && !log.reviewed && log.flagged_suspicious);
    
    return matchesSearch && matchesAction && matchesSuspicious;
  });

  const getActionColor = (actionType) => {
    const colors = {
      PASSWORD_RESET: "bg-red-100 text-red-800",
      ROLE_CHANGE: "bg-orange-100 text-orange-800",
      PATIENT_DELETE: "bg-red-100 text-red-800",
      PATIENT_UPDATE: "bg-blue-100 text-blue-800",
      PATIENT_CREATE: "bg-green-100 text-green-800",
      USER_INVITE: "bg-green-100 text-green-800",
      USER_DELETE: "bg-red-100 text-red-800",
      BULK_OPERATION: "bg-purple-100 text-purple-800"
    };
    return colors[actionType] || "bg-gray-100 text-gray-800";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Detailed Audit Trail</span>
          <Badge variant="outline">{filteredLogs.length} entries</Badge>
        </CardTitle>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="PASSWORD_RESET">Password Reset</SelectItem>
              <SelectItem value="ROLE_CHANGE">Role Change</SelectItem>
              <SelectItem value="PATIENT_UPDATE">Patient Update</SelectItem>
              <SelectItem value="PATIENT_DELETE">Patient Delete</SelectItem>
              <SelectItem value="BULK_OPERATION">Bulk Operation</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterSuspicious} onValueChange={setFilterSuspicious}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="unreviewed">Needs Review</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((log) => (
                <TableRow key={log.id} className={log.flagged_suspicious ? 'bg-red-50' : ''}>
                  <TableCell className="text-sm">
                    {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>
                      <p className="font-medium">{log.user_email}</p>
                      <Badge variant="outline" className="text-xs mt-1">
                        {log.user_role}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getActionColor(log.action_type)}>
                      {log.action_type.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.target_identifier || 'N/A'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {log.flagged_suspicious && (
                        <Badge className="bg-red-100 text-red-800 text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Suspicious
                        </Badge>
                      )}
                      {log.reviewed && (
                        <Badge className="bg-green-100 text-green-800 text-xs">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Reviewed
                        </Badge>
                      )}
                      {log.risk_score && (
                        <span className="text-xs text-gray-600">
                          Risk: {log.risk_score}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedLog(log)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">Timestamp</p>
                  <p className="text-sm">{format(new Date(selectedLog.timestamp), 'PPpp')}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">User</p>
                  <p className="text-sm">{selectedLog.user_email} ({selectedLog.user_role})</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Action Type</p>
                  <Badge className={getActionColor(selectedLog.action_type)}>
                    {selectedLog.action_type.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">IP Address</p>
                  <p className="text-sm font-mono">{selectedLog.ip_address || 'N/A'}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">Description</p>
                <p className="text-sm">{selectedLog.action_description}</p>
              </div>

              {selectedLog.change_details && (
                <div>
                  <p className="text-sm font-medium text-gray-600 mb-2">Changes Made</p>
                  <pre className="bg-gray-50 rounded p-3 text-xs overflow-auto max-h-60">
                    {JSON.stringify(selectedLog.change_details, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.flagged_suspicious && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-sm font-medium text-red-900 mb-1">Flagged as Suspicious</p>
                  <p className="text-sm text-red-800">{selectedLog.flagged_reason}</p>
                  {selectedLog.risk_score && (
                    <p className="text-sm text-red-700 mt-2">Risk Score: {selectedLog.risk_score}/100</p>
                  )}
                </div>
              )}

              {selectedLog.reviewed && (
                <div className="bg-green-50 border border-green-200 rounded p-3">
                  <p className="text-sm font-medium text-green-900 mb-1">Reviewed</p>
                  <p className="text-sm text-green-800">
                    By: {selectedLog.reviewed_by} on {format(new Date(selectedLog.reviewed_at), 'PPpp')}
                  </p>
                  {selectedLog.review_notes && (
                    <p className="text-sm text-green-700 mt-2">Notes: {selectedLog.review_notes}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}