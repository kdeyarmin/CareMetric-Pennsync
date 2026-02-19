import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  DollarSign, 
  Plus,
  CheckCircle,
  Clock,
  XCircle,
  Search,
  Download,
  Loader2,
  TrendingUp
} from 'lucide-react';
import { toast } from 'sonner';

export default function BillingManagement() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: billing, isLoading } = useQuery({
    queryKey: ['billing-records'],
    queryFn: async () => {
      const records = await base44.entities.Billing.filter({});
      return records.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
  });

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.filter({})
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: async (billingId) => {
      const response = await base44.functions.invoke('generateInvoice', {
        billing_id: billingId
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['billing-records']);
      toast.success('Invoice generated');
    },
    onError: (error) => {
      toast.error('Failed to generate invoice: ' + error.message);
    }
  });

  const filteredBilling = billing?.filter(b => {
    const patient = patients?.find(p => p.id === b.patient_id);
    const matchesSearch = !searchQuery || 
      patient?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.claim_number?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || b.billing_status === statusFilter;
    
    return matchesSearch && matchesStatus;
  }) || [];

  const totalBilled = billing?.reduce((sum, b) => sum + (b.total_billed || 0), 0) || 0;
  const totalPaid = billing?.reduce((sum, b) => sum + (b.total_paid || 0), 0) || 0;
  const totalOutstanding = billing?.reduce((sum, b) => sum + (b.outstanding_balance || 0), 0) || 0;
  const collectionRate = totalBilled > 0 ? (totalPaid / totalBilled) * 100 : 0;

  const getStatusColor = (status) => {
    switch (status) {
      case 'paid': return 'bg-green-100 text-green-800';
      case 'submitted': return 'bg-blue-100 text-blue-800';
      case 'denied': return 'bg-red-100 text-red-800';
      case 'draft': return 'bg-slate-100 text-slate-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Billing Management</h1>
            <p className="text-sm text-slate-600 mt-1">Track revenue and claims</p>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" />
            New Billing Record
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">${totalBilled.toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Total Billed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">${totalPaid.toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Total Paid</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">${totalOutstanding.toLocaleString()}</p>
                  <p className="text-xs text-slate-600">Outstanding</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{collectionRate.toFixed(1)}%</p>
                  <p className="text-xs text-slate-600">Collection Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by patient name or claim number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                  <SelectItem value="appealing">Appealing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Billing Records */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : filteredBilling.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <DollarSign className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600">No billing records found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredBilling.map(record => {
              const patient = patients?.find(p => p.id === record.patient_id);
              
              return (
                <Card key={record.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-lg">{patient?.full_name || 'Unknown Patient'}</h3>
                          <Badge className={getStatusColor(record.billing_status)}>
                            {record.billing_status}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                          <div>
                            <p className="text-slate-600">Period</p>
                            <p className="font-medium">
                              {new Date(record.billing_period_start).toLocaleDateString()} - {new Date(record.billing_period_end).toLocaleDateString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-600">Total Visits</p>
                            <p className="font-medium">{record.total_visits || 0}</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Billed Amount</p>
                            <p className="font-medium">${(record.total_billed || 0).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-slate-600">Outstanding</p>
                            <p className="font-medium text-red-600">
                              ${(record.outstanding_balance || 0).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        {record.claim_number && (
                          <p className="text-xs text-slate-600">
                            Claim #: {record.claim_number}
                          </p>
                        )}

                        {record.denial_reason && (
                          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                            <p className="text-xs text-red-800">
                              <strong>Denial Reason:</strong> {record.denial_reason}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {record.billing_status === 'draft' && (
                          <Button
                            size="sm"
                            onClick={() => generateInvoiceMutation.mutate(record.id)}
                            disabled={generateInvoiceMutation.isPending}
                          >
                            Generate Invoice
                          </Button>
                        )}
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}