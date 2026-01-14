import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, DollarSign, Trash2, Eye } from "lucide-react";
import InvoiceDetailDialog from "./InvoiceDetailDialog";
import PaymentRecorder from "./PaymentRecorder";

export default function InvoiceList() {
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const { data: invoices, refetch } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => base44.entities.Invoice.list(),
    initialData: []
  });

  const getStatusColor = (status) => {
    const colors = {
      paid: "bg-green-100 text-green-800",
      partially_paid: "bg-blue-100 text-blue-800",
      pending: "bg-yellow-100 text-yellow-800",
      sent: "bg-indigo-100 text-indigo-800",
      overdue: "bg-red-100 text-red-800",
      cancelled: "bg-gray-100 text-gray-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const handleSendEmail = async (invoiceId, sendToPatient = true, sendToInsurance = false) => {
    try {
      await base44.functions.invoke('sendInvoiceEmail', {
        invoiceId,
        sendToPatient,
        sendToInsurance
      });
      alert('Email sent successfully');
      refetch();
    } catch (error) {
      alert('Error sending email: ' + error.message);
    }
  };

  return (
    <div className="space-y-4">
      {invoices.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-gray-500">
            No invoices yet. Create invoices from patient visits.
          </CardContent>
        </Card>
      ) : (
        invoices.map(invoice => (
          <Card key={invoice.id}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold">{invoice.invoice_number}</h3>
                    <Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Invoice Date: {invoice.invoice_date}</p>
                  <p className="text-sm text-gray-600">Due Date: {invoice.due_date}</p>
                  <div className="mt-3 grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Total</p>
                      <p className="text-lg font-semibold">${invoice.total_amount.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Paid</p>
                      <p className="text-lg font-semibold">${(invoice.paid_amount || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Balance</p>
                      <p className="text-lg font-semibold">${(invoice.total_amount - (invoice.paid_amount || 0)).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => setSelectedInvoice(invoice)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => handleSendEmail(invoice.id, true, false)}
                  >
                    <Mail className="w-4 h-4" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => {
                      setSelectedInvoice(invoice);
                      setPaymentDialogOpen(true);
                    }}
                  >
                    <DollarSign className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      {selectedInvoice && (
        <InvoiceDetailDialog 
          invoice={selectedInvoice} 
          open={!!selectedInvoice && !paymentDialogOpen}
          onOpenChange={(open) => !open && setSelectedInvoice(null)}
        />
      )}

      {selectedInvoice && paymentDialogOpen && (
        <PaymentRecorder 
          invoice={selectedInvoice}
          onClose={() => {
            setPaymentDialogOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}