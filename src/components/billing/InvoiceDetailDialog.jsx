import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function InvoiceDetailDialog({ invoice, open, onOpenChange }) {
  const getStatusColor = (status) => {
    const colors = {
      paid: "bg-green-100 text-green-800",
      partially_paid: "bg-blue-100 text-blue-800",
      pending: "bg-yellow-100 text-yellow-800",
      sent: "bg-indigo-100 text-indigo-800",
      overdue: "bg-red-100 text-red-800"
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{invoice.invoice_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Invoice Date</p>
              <p className="font-semibold">{invoice.invoice_date}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Due Date</p>
              <p className="font-semibold">{invoice.due_date}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Status</p>
              <Badge className={`mt-1 ${getStatusColor(invoice.status)}`}>{invoice.status}</Badge>
            </div>
            <div>
              <p className="text-sm text-gray-600">Billing Model</p>
              <p className="font-semibold capitalize">{invoice.billing_model}</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Line Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {invoice.line_items?.map((item, idx) => (
                  <div key={idx} className="flex justify-between pb-2 border-b last:border-b-0">
                    <div>
                      <p className="font-medium">{item.description}</p>
                      <p className="text-sm text-gray-600">Qty: {item.quantity} @ ${item.unit_price.toFixed(2)}</p>
                    </div>
                    <p className="font-semibold">${item.amount.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between mb-2">
              <span>Total Amount:</span>
              <span className="font-semibold">${invoice.total_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span>Amount Paid:</span>
              <span className="font-semibold text-green-600">${(invoice.paid_amount || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="font-bold">Balance Due:</span>
              <span className="font-bold text-lg">${(invoice.total_amount - (invoice.paid_amount || 0)).toFixed(2)}</span>
            </div>
          </div>

          {invoice.payment_notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Payment Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{invoice.payment_notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}