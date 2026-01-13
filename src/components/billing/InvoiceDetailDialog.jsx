import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";

export default function InvoiceDetailDialog({ invoice, open, onClose }) {
  const { data: patient } = useQuery({
    queryKey: ["patient", invoice?.patient_id],
    queryFn: () => base44.entities.Patient.filter({ id: invoice.patient_id }),
    enabled: !!invoice?.patient_id,
    select: (data) => data[0]
  });

  const { data: practiceInfo } = useQuery({
    queryKey: ["practiceInfo", invoice?.provider_email],
    queryFn: () => base44.entities.ProviderPracticeInfo.filter({ provider_email: invoice.provider_email }),
    enabled: !!invoice?.provider_email,
    select: (data) => data[0]
  });

  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <DialogTitle>Invoice #{invoice.invoice_number}</DialogTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-1" />
                Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 print:p-8">
          {/* Header */}
          {practiceInfo && (
            <div className="border-b pb-4">
              <h2 className="text-xl font-bold">{practiceInfo.practice_name}</h2>
              <p className="text-sm text-gray-600">{practiceInfo.provider_name}</p>
              <p className="text-sm text-gray-600">{practiceInfo.practice_address}</p>
              <p className="text-sm text-gray-600">
                Phone: {practiceInfo.practice_phone} | Fax: {practiceInfo.practice_fax}
              </p>
            </div>
          )}

          {/* Invoice Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Bill To:</h3>
              {patient && (
                <div className="text-sm">
                  <p className="font-medium">{patient.first_name} {patient.last_name}</p>
                  <p>{patient.address}</p>
                  <p>{patient.phone}</p>
                  <p>{patient.email}</p>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="space-y-1 text-sm">
                <p><span className="font-semibold">Invoice #:</span> {invoice.invoice_number}</p>
                <p><span className="font-semibold">Invoice Date:</span> {new Date(invoice.invoice_date).toLocaleDateString()}</p>
                <p><span className="font-semibold">Due Date:</span> {new Date(invoice.due_date).toLocaleDateString()}</p>
                <p><span className="font-semibold">Service Date:</span> {new Date(invoice.service_date).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div>
            <table className="w-full">
              <thead className="border-b-2">
                <tr className="text-left">
                  <th className="py-2">Description</th>
                  <th className="py-2">Code</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Unit Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items?.map((item, index) => (
                  <tr key={index} className="border-b">
                    <td className="py-3">{item.description}</td>
                    <td className="py-3">{item.service_code}</td>
                    <td className="py-3 text-center">{item.quantity}</td>
                    <td className="py-3 text-right">${item.unit_price?.toFixed(2)}</td>
                    <td className="py-3 text-right font-semibold">${item.total?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-end">
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-semibold">${invoice.subtotal?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax ({invoice.tax_rate}%):</span>
                  <span className="font-semibold">${invoice.tax_amount?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t pt-2">
                  <span>Total:</span>
                  <span>${invoice.total_amount?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>Paid:</span>
                  <span className="font-semibold">-${invoice.amount_paid?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold text-orange-600 border-t pt-2">
                  <span>Balance Due:</span>
                  <span>${invoice.balance_due?.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="border-t pt-4">
              <h3 className="font-semibold mb-2">Notes:</h3>
              <p className="text-sm text-gray-600">{invoice.notes}</p>
            </div>
          )}

          {/* Payment Terms */}
          <div className="border-t pt-4 text-sm text-gray-600">
            <p>Payment Terms: {invoice.payment_terms}</p>
            <p className="mt-2">
              Thank you for your business. Please make payment by the due date.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}