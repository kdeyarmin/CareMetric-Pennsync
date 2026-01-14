import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle } from "lucide-react";

export default function PatientOutstandingBalance({ patientId }) {
  const { data: invoices } = useQuery({
    queryKey: ["patientInvoices", patientId],
    queryFn: () => base44.entities.Invoice.filter({ patient_id: patientId }),
    initialData: []
  });

  const totalOutstanding = invoices
    .filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled')
    .reduce((sum, inv) => sum + (inv.total_amount - (inv.paid_amount || 0)), 0);

  const overdueInvoices = invoices.filter(inv => {
    const dueDate = new Date(inv.due_date);
    return dueDate < new Date() && inv.status !== 'paid' && inv.status !== 'cancelled';
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm text-gray-600">Outstanding Balance</p>
              <p className="text-2xl font-bold">${totalOutstanding.toFixed(2)}</p>
            </div>
            {overdueInvoices.length > 0 ? (
              <Badge className="bg-red-100 text-red-800">
                <AlertCircle className="w-3 h-3 mr-1" />
                {overdueInvoices.length} overdue
              </Badge>
            ) : (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle className="w-3 h-3 mr-1" />
                Up to date
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {invoices.filter(inv => inv.status === 'paid').length} of {invoices.length} invoices paid
          </p>
        </div>
      </CardContent>
    </Card>
  );
}