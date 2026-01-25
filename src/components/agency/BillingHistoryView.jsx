import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { 
  FileText, Download, Eye, DollarSign, Calendar, 
  CheckCircle, Clock, AlertCircle, XCircle 
} from "lucide-react";

export default function BillingHistoryView({ agency }) {
  const queryClient = useQueryClient();
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['agencyInvoices', agency.agency_code],
    queryFn: async () => {
      const allInvoices = await base44.asServiceRole.entities.AgencyInvoice.filter({
        agency_code: agency.agency_code
      });
      return allInvoices.sort((a, b) => 
        new Date(b.billing_period_start) - new Date(a.billing_period_start)
      );
    }
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: async (billing_date) => {
      const response = await base44.functions.invoke('generateAgencyInvoice', {
        agency_id: agency.id,
        billing_date
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['agencyInvoices']);
      toast.success('Invoice generated successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to generate invoice');
    }
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'paid':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'sent':
        return <Clock className="w-4 h-4 text-blue-600" />;
      case 'overdue':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-slate-400" />;
      default:
        return <FileText className="w-4 h-4 text-slate-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      case 'overdue':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  };

  const totalBilled = invoices.reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
  const totalPaid = invoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
  const totalOutstanding = invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'cancelled').reduce((sum, inv) => sum + (inv.total_amount || 0), 0);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Billed</p>
                <p className="text-2xl font-bold">${totalBilled.toFixed(2)}</p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Paid</p>
                <p className="text-2xl font-bold text-green-600">${totalPaid.toFixed(2)}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Outstanding</p>
                <p className="text-2xl font-bold text-orange-600">${totalOutstanding.toFixed(2)}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Invoice History</h3>
        <Button 
          onClick={() => generateInvoiceMutation.mutate()}
          disabled={generateInvoiceMutation.isPending}
        >
          Generate Current Month Invoice
        </Button>
      </div>

      {/* Invoice List */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {invoices.map((invoice) => (
              <div 
                key={invoice.id} 
                className="p-4 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => setSelectedInvoice(selectedInvoice?.id === invoice.id ? null : invoice)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <FileText className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{invoice.invoice_number}</p>
                      <div className="flex items-center gap-2 text-sm text-slate-600 mt-1">
                        <Calendar className="w-3 h-3" />
                        <span>
                          {format(new Date(invoice.billing_period_start), 'MMM d')} - {format(new Date(invoice.billing_period_end), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-lg font-bold text-slate-900">${invoice.total_amount.toFixed(2)}</p>
                      <p className="text-xs text-slate-500">{invoice.user_count} users × ${invoice.price_per_user}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(invoice.status)}
                      <Badge className={getStatusColor(invoice.status)}>
                        {invoice.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {selectedInvoice?.id === invoice.id && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-slate-600">Package</p>
                        <p className="font-medium">{invoice.package_name}</p>
                      </div>
                      <div>
                        <p className="text-slate-600">Due Date</p>
                        <p className="font-medium">
                          {invoice.due_date ? format(new Date(invoice.due_date), 'MMM d, yyyy') : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-600">Paid Date</p>
                        <p className="font-medium">
                          {invoice.paid_date ? format(new Date(invoice.paid_date), 'MMM d, yyyy') : 'Unpaid'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-600">Payment Method</p>
                        <p className="font-medium">{invoice.payment_method || 'N/A'}</p>
                      </div>
                    </div>

                    {invoice.line_items && invoice.line_items.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-slate-700 mb-2">Line Items:</p>
                        <div className="space-y-2">
                          {invoice.line_items.map((item, idx) => (
                            <div key={idx} className="flex justify-between text-sm p-2 bg-slate-50 rounded">
                              <span>{item.description}</span>
                              <span className="font-medium">
                                {item.quantity > 0 ? `${item.quantity} × $${item.unit_price} = ` : ''}
                                ${item.total.toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {invoice.notes && (
                      <div>
                        <p className="text-sm font-medium text-slate-700">Notes:</p>
                        <p className="text-sm text-slate-600 mt-1">{invoice.notes}</p>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" className="gap-2">
                        <Download className="w-4 h-4" />
                        Download PDF
                      </Button>
                      <Button size="sm" variant="outline" className="gap-2">
                        <Eye className="w-4 h-4" />
                        View Details
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {invoices.length === 0 && (
            <div className="py-12 text-center">
              <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 mb-4">No invoices yet</p>
              <Button onClick={() => generateInvoiceMutation.mutate()}>
                Generate First Invoice
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}