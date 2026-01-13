import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Loader, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function PaymentRecorder({ invoiceId = null, onPaymentRecorded = null }) {
  const [formData, setFormData] = useState({
    invoice_id: invoiceId || '',
    patient_id: '',
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'check',
    transaction_id: '',
    payor: '',
    notes: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: invoice } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const results = await base44.entities.Invoice.filter({ id: invoiceId });
      return results[0] || null;
    },
    enabled: !!invoiceId
  });

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.invoice_id || !formData.patient_id || !formData.amount || !formData.payment_date) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    try {
      const paymentAmount = parseFloat(formData.amount);

      // Create payment record
      const payment = await base44.entities.Payment.create({
        invoice_id: formData.invoice_id,
        patient_id: formData.patient_id,
        amount: paymentAmount,
        payment_date: formData.payment_date,
        payment_method: formData.payment_method,
        transaction_id: formData.transaction_id,
        payor: formData.payor,
        notes: formData.notes,
        recorded_by: currentUser?.email,
        status: 'received',
      });

      // Update invoice
      if (invoice) {
        const newAmountPaid = (invoice.amount_paid || 0) + paymentAmount;
        const newBalance = invoice.amount - newAmountPaid;
        const newStatus = newBalance <= 0 ? 'paid' : 'sent';

        await base44.entities.Invoice.update(formData.invoice_id, {
          amount_paid: newAmountPaid,
          remaining_balance: Math.max(0, newBalance),
          status: newStatus,
          paid_date: newBalance <= 0 ? formData.payment_date : invoice.paid_date,
        });
      }

      toast.success('Payment recorded successfully');
      onPaymentRecorded?.(payment);
      queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] });

      // Reset form
      setFormData({
        invoice_id: invoiceId || '',
        patient_id: '',
        amount: '',
        payment_date: new Date().toISOString().split('T')[0],
        payment_method: 'check',
        transaction_id: '',
        payor: '',
        notes: '',
      });
    } catch (error) {
      toast.error(error.message || 'Failed to record payment');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-green-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          Record Payment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {invoice && (
            <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
              <p className="text-sm text-gray-700">
                <strong>Invoice:</strong> {invoice.invoice_number} - ${invoice.amount.toFixed(2)}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                <strong>Balance:</strong> ${(invoice.remaining_balance || invoice.amount).toFixed(2)}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Invoice ID *
              </label>
              <Input
                value={formData.invoice_id}
                onChange={(e) => setFormData({ ...formData, invoice_id: e.target.value })}
                placeholder="Select invoice"
                disabled={!!invoiceId}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Patient ID *
              </label>
              <Input
                value={formData.patient_id}
                onChange={(e) => setFormData({ ...formData, patient_id: e.target.value })}
                placeholder="Patient ID"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Payment Amount * {invoice && `(Remaining: $${(invoice.remaining_balance || 0).toFixed(2)})`}
              </label>
              <Input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Payment Date *
              </label>
              <Input
                type="date"
                value={formData.payment_date}
                onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Payment Method
              </label>
              <Select value={formData.payment_method} onValueChange={(value) => setFormData({ ...formData, payment_method: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                  <SelectItem value="eft">Electronic Transfer</SelectItem>
                  <SelectItem value="insurance">Insurance</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Transaction/Check Number
              </label>
              <Input
                value={formData.transaction_id}
                onChange={(e) => setFormData({ ...formData, transaction_id: e.target.value })}
                placeholder="e.g., CHK-1234 or TXN-ID"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Payor Name
              </label>
              <Input
                value={formData.payor}
                onChange={(e) => setFormData({ ...formData, payor: e.target.value })}
                placeholder="e.g., Insurance Co., Patient"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Notes
              </label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any additional notes"
              />
            </div>
          </div>

          <Button type="submit" disabled={isLoading} className="w-full bg-green-600 hover:bg-green-700">
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Recording Payment...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Record Payment
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}