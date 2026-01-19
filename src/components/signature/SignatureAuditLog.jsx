import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Search, Shield, FileText, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function SignatureAuditLog() {
  const [searchTerm, setSearchTerm] = useState('');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: signatures = [], isLoading } = useQuery({
    queryKey: ['signatures'],
    queryFn: () => base44.entities.DigitalSignature.list('-created_date', 500)
  });

  const filteredSignatures = signatures.filter(sig => {
    const matchesSearch = !searchTerm || 
      sig.signer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sig.signer_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sig.document_id?.includes(searchTerm);
    
    const matchesType = documentTypeFilter === 'all' || sig.document_type === documentTypeFilter;
    
    const matchesDateRange = (!startDate || new Date(sig.created_date) >= new Date(startDate)) &&
                             (!endDate || new Date(sig.created_date) <= new Date(endDate));

    return matchesSearch && matchesType && matchesDateRange;
  });

  const exportAuditLog = async (format) => {
    setExporting(true);
    try {
      const response = await base44.functions.invoke('generateSignatureAuditLog', {
        signature_ids: filteredSignatures.map(s => s.id),
        start_date: startDate,
        end_date: endDate,
        document_type: documentTypeFilter !== 'all' ? documentTypeFilter : null,
        format
      });

      if (format === 'csv') {
        // CSV returned as text
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `signature_audit_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      } else {
        // JSON format
        const blob = new Blob([JSON.stringify(response.data.audit_report, null, 2)], { 
          type: 'application/json' 
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `signature_audit_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      }

      toast.success('Audit log exported successfully');
    } catch (error) {
      toast.error('Failed to export audit log');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Digital Signature Audit Log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search signer or document..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={documentTypeFilter} onValueChange={setDocumentTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Document Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="consent_form">Consent Form</SelectItem>
                <SelectItem value="care_plan">Care Plan</SelectItem>
                <SelectItem value="visit_note">Visit Note</SelectItem>
                <SelectItem value="telehealth_consent">Telehealth Consent</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              placeholder="Start Date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              type="date"
              placeholder="End Date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          {/* Export Buttons */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportAuditLog('json')}
              disabled={exporting || filteredSignatures.length === 0}
            >
              <Download className="w-3 h-3 mr-1" />
              Export JSON
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportAuditLog('csv')}
              disabled={exporting || filteredSignatures.length === 0}
            >
              <Download className="w-3 h-3 mr-1" />
              Export CSV
            </Button>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <p className="text-xs text-gray-600 dark:text-gray-400">Total Signatures</p>
              <p className="text-xl font-bold text-blue-600">{filteredSignatures.length}</p>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
              <p className="text-xs text-gray-600 dark:text-gray-400">With MFA</p>
              <p className="text-xl font-bold text-green-600">
                {filteredSignatures.filter(s => s.mfa_verified).length}
              </p>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
              <p className="text-xs text-gray-600 dark:text-gray-400">Patient Signed</p>
              <p className="text-xl font-bold text-purple-600">
                {filteredSignatures.filter(s => s.signed_by_role === 'patient').length}
              </p>
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-950 rounded-lg">
              <p className="text-xs text-gray-600 dark:text-gray-400">With Witness</p>
              <p className="text-xl font-bold text-amber-600">
                {filteredSignatures.filter(s => s.witness_email).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signature List */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-center text-gray-500 py-8">Loading signatures...</p>
        ) : filteredSignatures.length === 0 ? (
          <p className="text-center text-gray-500 py-8">No signatures found</p>
        ) : (
          filteredSignatures.map((sig) => (
            <Card key={sig.id} className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4 text-gray-500" />
                      <span className="font-semibold">{sig.signer_name}</span>
                      <Badge variant="outline" className="text-xs">
                        {sig.document_type.replace(/_/g, ' ')}
                      </Badge>
                      {sig.mfa_verified && (
                        <Badge className="bg-green-100 text-green-800 text-xs">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          MFA
                        </Badge>
                      )}
                      {sig.signed_by_role && (
                        <Badge className="bg-purple-100 text-purple-800 text-xs">
                          {sig.signed_by_role}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-600">
                      <div>
                        <span className="font-medium">Email:</span> {sig.signer_email}
                      </div>
                      <div>
                        <span className="font-medium">Date:</span> {new Date(sig.created_date).toLocaleString()}
                      </div>
                      <div>
                        <span className="font-medium">IP:</span> {sig.ip_address}
                      </div>
                      <div>
                        <span className="font-medium">Method:</span> {sig.signature_method}
                      </div>
                      <div>
                        <span className="font-medium">Status:</span> {sig.verification_status}
                      </div>
                      {sig.witness_email && (
                        <div>
                          <span className="font-medium">Witness:</span> {sig.witness_email}
                        </div>
                      )}
                    </div>
                  </div>
                  <img
                    src={sig.signature_data}
                    alt="Signature"
                    className="w-24 h-16 object-contain border rounded"
                  />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}