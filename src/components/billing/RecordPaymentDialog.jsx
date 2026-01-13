import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function RecordPaymentDialog({ invoice, open, onClose }) {
  const [formData, setFormData] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    amount: invoice?.balance_due || 0,
    payment_method: "cash",
    reference_number: "",
    notes: ""
  });

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const createPaymentMutation = useMutation({
    mutationFn: (data) => base44.entities.PaymentRecord.create(data),
    onSuccess: async (payment) => {
      // Update invoice
      const newAmountPaid = (invoice.amount_paid || 0) + formData.amount;
      const newBalanceDue = invoice.total_amount - newAmountPaid;
      const newStatus = newBalanceDue === 0 ? 'paid' : 
                       newBalanceDue < invoice.total_amount ? 'partial' : 
                       invoice.status;

      await base44.entities.Invoice.update(invoice.id, {
        amount_paid: newAmountPaid,
        balance_due: newBalanceDue,
        status: newStatus,
        paid_date: newBalanceDue === 0 ? new Date().toISOString() : null
      });

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      toast.success("Payment recorded successfully");
      onClose();
    }
  });

  const handleSubmit = () => {
    if (!formData.amount || formData.amount <= 0) {
      toast.error("Please enter a valid payment amount");
      return;
    }

    createPaymentMutation.mutate({
      invoice_id: invoice.id,
      patient_id: invoice.patient_id,
      payment_date: formData.payment_date,
      amount: parseFloat(formData.amount),
      payment_method: formData.payment_method,
      reference_number: formData.reference_number,
      notes: formData.notes,
      processed_by: currentUser.email
    });
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg">
            <div className="text-sm">
              <p><span className="font-semibold">Invoice:</span> #{invoice.invoice_number}</p>
              <p><span className="font-semibold">Balance Due:</span> ${invoice.balance_due?.toFixed(2)}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Payment Date *</Label>
            <Input
              type="date"
              value={formData.payment_date}
              onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Amount *</Label>
            <Input
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
            />
          </div>

          <div className="space-y-2">
            <Label>Payment Method *</Label>
            <select
              value={formData.payment_method}
              onChange={(e) => setFormData({ ...formData, payment_method: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="credit_card">Credit Card</option>
              <option value="insurance">Insurance</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Reference Number</Label>
            <Input
              placeholder="Check #, Transaction ID, etc."
              value={formData.reference_number}
              onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              rows={3}
              placeholder="Payment notes..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createPaymentMutation.isPending}>
              {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}