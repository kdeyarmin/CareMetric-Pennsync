import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

export default function CreateInvoiceDialog() {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    patient_id: "",
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: "",
    service_date: new Date().toISOString().split('T')[0],
    payment_terms: "Net 30",
    tax_rate: 0,
    notes: ""
  });
  const [lineItems, setLineItems] = useState([
    { description: "", service_code: "", quantity: 1, unit_price: 0, total: 0 }
  ]);

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list('first_name', 1000)
  });

  const createInvoiceMutation = useMutation({
    mutationFn: (data) => base44.entities.Invoice.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice created successfully");
      setOpen(false);
      resetForm();
    }
  });

  const resetForm = () => {
    setFormData({
      patient_id: "",
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: "",
      service_date: new Date().toISOString().split('T')[0],
      payment_terms: "Net 30",
      tax_rate: 0,
      notes: ""
    });
    setLineItems([{ description: "", service_code: "", quantity: 1, unit_price: 0, total: 0 }]);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", service_code: "", quantity: 1, unit_price: 0, total: 0 }]);
  };

  const removeLineItem = (index) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const updateLineItem = (index, field, value) => {
    const updated = [...lineItems];
    updated[index][field] = value;
    
    if (field === 'quantity' || field === 'unit_price') {
      updated[index].total = updated[index].quantity * updated[index].unit_price;
    }
    
    setLineItems(updated);
  };

  const calculateTotals = () => {
    const subtotal = lineItems.reduce((sum, item) => sum + (item.total || 0), 0);
    const tax_amount = subtotal * (formData.tax_rate / 100);
    const total_amount = subtotal + tax_amount;
    return { subtotal, tax_amount, total_amount };
  };

  const handleSubmit = () => {
    if (!formData.patient_id || !formData.due_date) {
      toast.error("Please fill in all required fields");
      return;
    }

    const { subtotal, tax_amount, total_amount } = calculateTotals();
    
    // Generate invoice number
    const invoice_number = `INV-${Date.now()}`;

    createInvoiceMutation.mutate({
      ...formData,
      invoice_number,
      provider_email: currentUser.email,
      line_items: lineItems,
      subtotal,
      tax_amount,
      total_amount,
      balance_due: total_amount,
      status: "draft"
    });
  };

  const { subtotal, tax_amount, total_amount } = calculateTotals();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Create Invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Patient & Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Patient *</Label>
              <select
                value={formData.patient_id}
                onChange={(e) => setFormData({ ...formData, patient_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">Select patient...</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Invoice Date</Label>
              <Input
                type="date"
                value={formData.invoice_date}
                onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Service Date</Label>
              <Input
                type="date"
                value={formData.service_date}
                onChange={(e) => setFormData({ ...formData, service_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Due Date *</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Line Items</Label>
              <Button size="sm" variant="outline" onClick={addLineItem}>
                <Plus className="w-4 h-4 mr-1" />
                Add Item
              </Button>
            </div>
            
            <div className="space-y-2">
              {lineItems.map((item, index) => (
                <div key={index} className="border p-3 rounded-lg space-y-2">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-5">
                      <Input
                        placeholder="Description"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        placeholder="Code"
                        value={item.service_code}
                        onChange={(e) => updateLineItem(index, 'service_code', e.target.value)}
                      />
                    </div>
                    <div className="col-span-1">
                      <Input
                        type="number"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number"
                        placeholder="Price"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="col-span-1 flex items-center">
                      <span className="font-semibold">${item.total.toFixed(2)}</span>
                    </div>
                    <div className="col-span-1 flex items-center">
                      {lineItems.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeLineItem(index)}
                        >
                          <X className="w-4 h-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="border-t pt-4 space-y-2">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-semibold">${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Tax Rate (%):</span>
              <Input
                type="number"
                value={formData.tax_rate}
                onChange={(e) => setFormData({ ...formData, tax_rate: parseFloat(e.target.value) || 0 })}
                className="w-24"
              />
            </div>
            <div className="flex justify-between">
              <span>Tax Amount:</span>
              <span className="font-semibold">${tax_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total:</span>
              <span>${total_amount.toFixed(2)}</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes</Label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              rows={3}
              placeholder="Invoice notes or payment terms..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={createInvoiceMutation.isPending}>
              {createInvoiceMutation.isPending ? "Creating..." : "Create Invoice"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}