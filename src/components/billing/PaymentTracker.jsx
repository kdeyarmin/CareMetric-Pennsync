import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";

export default function PaymentTracker({ payments = [], invoices = [] }) {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list('first_name', 1000)
  });

  const getPatientName = (patientId) => {
    const patient = patients.find(p => p.id === patientId);
    return patient ? `${patient.first_name} ${patient.last_name}` : "Unknown";
  };

  const getInvoiceNumber = (invoiceId) => {
    const invoice = invoices.find(i => i.id === invoiceId);
    return invoice?.invoice_number || "Unknown";
  };

  const getPaymentMethodColor = (method) => {
    const colors = {
      cash: "bg-green-100 text-green-700",
      check: "bg-blue-100 text-blue-700",
      credit_card: "bg-purple-100 text-purple-700",
      insurance: "bg-indigo-100 text-indigo-700",
      bank_transfer: "bg-teal-100 text-teal-700",
      other: "bg-gray-100 text-gray-700"
    };
    return colors[method] || colors.other;
  };

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = 
      getInvoiceNumber(payment.invoice_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
      getPatientName(payment.patient_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle>Payment History</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search payments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {filteredPayments.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No payments found
            </div>
          ) : (
            filteredPayments.map((payment) => (
              <div
                key={payment.id}
                className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors"
              >
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {getPatientName(payment.patient_id)}
                      </span>
                      <Badge className={getPaymentMethodColor(payment.payment_method)}>
                        {payment.payment_method?.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Invoice: #{getInvoiceNumber(payment.invoice_id)}
                    </div>
                    <div className="text-sm text-gray-500">
                      Date: {new Date(payment.payment_date).toLocaleDateString()}
                      {payment.reference_number && ` | Ref: ${payment.reference_number}`}
                    </div>
                    {payment.notes && (
                      <div className="text-sm text-gray-500 italic">
                        {payment.notes}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">
                      ${payment.amount?.toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500">
                      by {payment.processed_by}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}