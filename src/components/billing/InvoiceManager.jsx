import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Eye,
  Edit,
  Trash2,
  Send,
  Download,
  Search,
  Filter
} from "lucide-react";
import { toast } from "sonner";
import InvoiceDetailDialog from "./InvoiceDetailDialog";
import RecordPaymentDialog from "./RecordPaymentDialog";

export default function InvoiceManager({ invoices = [] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const queryClient = useQueryClient();

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list('first_name', 1000)
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: (id) => base44.entities.Invoice.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice deleted");
    }
  });

  const updateInvoiceMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Invoice.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice updated");
    }
  });

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : "Unknown";
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: "bg-gray-100 text-gray-700",
      sent: "bg-blue-100 text-blue-700",
      paid: "bg-green-100 text-green-700",
      partial: "bg-yellow-100 text-yellow-700",
      overdue: "bg-red-100 text-red-700",
      cancelled: "bg-gray-100 text-gray-500"
    };
    return colors[status] || colors.draft;
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = 
      inv.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getPatientName(inv.patient_id).toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleMarkSent = (invoice) => {
    updateInvoiceMutation.mutate({
      id: invoice.id,
      data: { status: "sent", sent_date: new Date().toISOString() }
    });
  };

  const handleViewInvoice = (invoice) => {
    setSelectedInvoice(invoice);
    setShowDetail(true);
  };

  const handleRecordPayment = (invoice) => {
    setSelectedInvoice(invoice);
    setShowPayment(true);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Invoices</CardTitle>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search invoices..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full sm:w-64"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
              >
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="partial">Partial</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredInvoices.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No invoices found
              </div>
            ) : (
              filteredInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          #{invoice.invoice_number}
                        </span>
                        <Badge className={getStatusColor(invoice.status)}>
                          {invoice.status}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {getPatientName(invoice.patient_id)}
                      </div>
                      <div className="text-sm text-gray-500">
                        Due: {new Date(invoice.due_date).toLocaleDateString()} | 
                        Amount: ${invoice.total_amount?.toFixed(2)} | 
                        Balance: ${invoice.balance_due?.toFixed(2)}
                      </div>
                    </div>
                    <div className="flex gap-2 items-start">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewInvoice(invoice)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      {invoice.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleMarkSent(invoice)}
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      )}
                      {["sent", "partial", "overdue"].includes(invoice.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRecordPayment(invoice)}
                        >
                          Record Payment
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteInvoiceMutation.mutate(invoice.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {selectedInvoice && (
        <>
          <InvoiceDetailDialog
            invoice={selectedInvoice}
            open={showDetail}
            onClose={() => setShowDetail(false)}
          />
          <RecordPaymentDialog
            invoice={selectedInvoice}
            open={showPayment}
            onClose={() => {
              setShowPayment(false);
              setSelectedInvoice(null);
            }}
          />
        </>
      )}
    </>
  );
}