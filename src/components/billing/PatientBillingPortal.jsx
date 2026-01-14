import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DollarSign, Calendar, FileText, AlertCircle } from "lucide-react";

export default function PatientBillingPortal() {
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: invoices } = useQuery({
    queryKey: ["patientInvoices", currentUser?.id],
    queryFn: () => currentUser ? base44.entities.Invoice.filter({ patient_id: currentUser.id }) : Promise.resolve([]),
    enabled: !!currentUser?.id,
    initialData: []
  });

  const totalOutstanding = invoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  const getStatusColor = (status) => {
    const colors = {
      pending: "bg-yellow-100 text-yellow-800",
      sent: "bg-blue-100 text-blue-800",
      paid: "bg-green-100 text-green-800",
      partially_paid: "bg-orange-100 text-orange-800",
      overdue: "bg-red-100 text-red-800",
      cancelled: "bg-gray-100 text-gray-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const isOverdue = (invoice) => {
    return new Date(invoice.due_date) < new Date() && invoice.status !== 'paid';
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Outstanding Balance</p>
                <p className="text-2xl font-bold">${totalOutstanding.toFixed(2)}</p>
              </div>
              <DollarSign className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Invoices</p>
                <p className="text-2xl font-bold">{invoices.length}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Paid Amount</p>
                <p className="text-2xl font-bold">
                  ${invoices.reduce((sum, inv) => sum + (inv.paid_amount || 0), 0).toFixed(2)}
                </p>
              </div>
              <DollarSign className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoices List */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {invoices.length === 0 ? (
              <p className="text-sm text-gray-500">No invoices yet</p>
            ) : (
              invoices.map(invoice => (
                <div
                  key={invoice.id}
                  className="border rounded-lg p-4 hover:bg-gray-50 transition cursor-pointer"
                  onClick={() => setSelectedInvoice(invoice)}
                >
                  <div className="flex justify-between items-start gap-4 mb-2">
                    <div>
                      <p className="font-semibold">{invoice.invoice_number}</p>
                      <p className="text-sm text-gray-600">Invoice Date: {new Date(invoice.invoice_date).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-lg">${invoice.total_amount.toFixed(2)}</p>
                      {invoice.paid_amount > 0 && (
                        <p className="text-xs text-gray-600">Paid: ${invoice.paid_amount.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                      <Badge className={getStatusColor(invoice.status)}>{invoice.status}</Badge>
                      {isOverdue(invoice) && (
                        <Badge className="bg-red-100 text-red-800">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Overdue
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">Due: {new Date(invoice.due_date).toLocaleDateString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Invoice Detail Dialog */}
      {selectedInvoice && (
        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedInvoice.invoice_number}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">Invoice Date</p>
                  <p className="font-semibold">{new Date(selectedInvoice.invoice_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-gray-600">Due Date</p>
                  <p className="font-semibold">{new Date(selectedInvoice.due_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-gray-600">Status</p>
                  <Badge className={getStatusColor(selectedInvoice.status)}>
                    {selectedInvoice.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-gray-600">Balance</p>
                  <p className="font-semibold">
                    ${(selectedInvoice.total_amount - (selectedInvoice.paid_amount || 0)).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Line Items */}
              {selectedInvoice.line_items && (
                <div className="border-t pt-4">
                  <h4 className="font-semibold mb-2">Line Items</h4>
                  <div className="space-y-2 text-sm">
                    {selectedInvoice.line_items.map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <div>
                          <p className="font-medium">{item.description}</p>
                          <p className="text-gray-600">{item.quantity} x ${item.unit_price.toFixed(2)}</p>
                        </div>
                        <p className="font-semibold">${item.amount.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="border-t pt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Total Amount:</span>
                  <span className="font-semibold">${selectedInvoice.total_amount.toFixed(2)}</span>
                </div>
                {selectedInvoice.paid_amount > 0 && (
                  <div className="flex justify-between">
                    <span>Paid Amount:</span>
                    <span className="font-semibold text-green-600">${selectedInvoice.paid_amount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2">
                  <span className="font-bold">Balance Due:</span>
                  <span className="font-bold text-lg">
                    ${(selectedInvoice.total_amount - (selectedInvoice.paid_amount || 0)).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Payment Button */}
              {selectedInvoice.status !== 'paid' && (
                <Button 
                  onClick={() => setPaymentDialogOpen(true)}
                  className="w-full"
                >
                  Make Payment
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}