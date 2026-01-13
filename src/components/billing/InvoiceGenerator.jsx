import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Loader, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

const VISIT_TYPE_AMOUNTS = {
  skilled_nursing: 150,
  admission: 200,
  routine_visit: 125,
  recertification: 175,
  discharge: 225,
  prn: 100,
};

const BILLING_CODES = {
  skilled_nursing: '99214',
  admission: '99203',
  routine_visit: '99213',
  recertification: '99215',
  discharge: '99217',
  prn: '99212',
};

export default function InvoiceGenerator({ visitId = null, patientId = null, visitType = null, diagnosis = null, onInvoiceCreated = null }) {
  const [formData, setFormData] = useState({
    visit_id: visitId || '',
    patient_id: patientId || '',
    visit_type: visitType || '',
    diagnosis: diagnosis || '',
    service_date: new Date().toISOString().split('T')[0],
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    payor: 'Medicare',
  });
  const [isLoading, setIsLoading] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const calculateAmount = () => {
    return VISIT_TYPE_AMOUNTS[formData.visit_type] || 0;
  };

  const getBillingCode = () => {
    return BILLING_CODES[formData.visit_type] || '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.patient_id || !formData.visit_type || !formData.service_date) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsLoading(true);
    try {
      const invoiceNumber = `INV-${Date.now()}`;
      const amount = calculateAmount();

      const invoice = await base44.entities.Invoice.create({
        visit_id: formData.visit_id || null,
        patient_id: formData.patient_id,
        invoice_number: invoiceNumber,
        visit_type: formData.visit_type,
        diagnosis: formData.diagnosis,
        service_date: formData.service_date,
        invoice_date: formData.invoice_date,
        due_date: formData.due_date,
        amount: amount,
        billing_code: getBillingCode(),
        description: `${formData.visit_type.replace(/_/g, ' ')} - ${formData.diagnosis}`,
        status: 'draft',
        payor: formData.payor,
        remaining_balance: amount,
        amount_paid: 0,
      });

      toast.success(`Invoice ${invoiceNumber} created successfully`);
      onInvoiceCreated?.(invoice);

      // Reset form
      setFormData({
        visit_id: visitId || '',
        patient_id: patientId || '',
        visit_type: visitType || '',
        diagnosis: diagnosis || '',
        service_date: new Date().toISOString().split('T')[0],
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        payor: 'Medicare',
      });
    } catch (error) {
      toast.error(error.message || 'Failed to create invoice');
    } finally {
      setIsLoading(false);
    }
  };

  const amount = calculateAmount();

  return (
    <Card className="border-blue-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Generate Invoice
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Patient ID *
              </label>
              <Input
                value={formData.patient_id}
                onChange={(e) => setFormData({ ...formData, patient_id: e.target.value })}
                placeholder="Select patient"
                disabled={!!patientId}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Visit Type *
              </label>
              <Select value={formData.visit_type} onValueChange={(value) => setFormData({ ...formData, visit_type: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select visit type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                  <SelectItem value="admission">Admission</SelectItem>
                  <SelectItem value="routine_visit">Routine Visit</SelectItem>
                  <SelectItem value="recertification">Recertification</SelectItem>
                  <SelectItem value="discharge">Discharge</SelectItem>
                  <SelectItem value="prn">PRN</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Diagnosis
              </label>
              <Input
                value={formData.diagnosis}
                onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                placeholder="e.g., CHF, COPD"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Service Date *
              </label>
              <Input
                type="date"
                value={formData.service_date}
                onChange={(e) => setFormData({ ...formData, service_date: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Invoice Date
              </label>
              <Input
                type="date"
                value={formData.invoice_date}
                onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Due Date
              </label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Payor
              </label>
              <Select value={formData.payor} onValueChange={(value) => setFormData({ ...formData, payor: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Medicare">Medicare</SelectItem>
                  <SelectItem value="Medicaid">Medicaid</SelectItem>
                  <SelectItem value="Commercial">Commercial Insurance</SelectItem>
                  <SelectItem value="Self-Pay">Self-Pay</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {amount > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Estimated Amount:</span>
                <span className="text-lg font-bold text-blue-600">${amount.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Code: {getBillingCode()}
              </p>
            </div>
          )}

          <Button type="submit" disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700">
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 mr-2 animate-spin" />
                Creating Invoice...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Generate Invoice
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}