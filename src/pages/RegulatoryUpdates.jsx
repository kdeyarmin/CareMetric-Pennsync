import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  FileText, 
  Calendar, 
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  RefreshCw,
  Search,
  Download
} from 'lucide-react';
import { toast } from 'sonner';

export default function RegulatoryUpdates() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const queryClient = useQueryClient();

  const { data: updates, isLoading } = useQuery({
    queryKey: ['regulatory-updates'],
    queryFn: async () => {
      const updates = await base44.entities.RegulatoryUpdate.filter({});
      return updates.sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    }
  });

  const { data: complianceRules } = useQuery({
    queryKey: ['medicare-compliance-rules'],
    queryFn: () => base44.entities.MedicareComplianceRule.filter({})
  });

  const syncUpdatesMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('fetchRegulatoryUpdates', {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['regulatory-updates']);
      toast.success('Regulatory updates synced successfully');
    },
    onError: (error) => {
      toast.error('Failed to sync updates: ' + error.message);
    }
  });

  const acknowledgeUpdateMutation = useMutation({
    mutationFn: async (updateId) => {
      return await base44.entities.RegulatoryUpdate.update(updateId, {
        status: 'acknowledged'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['regulatory-updates']);
      toast.success('Update acknowledged');
    }
  });

  const filteredUpdates = updates?.filter(update => {
    const matchesSearch = !searchQuery || 
      update.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      update.summary?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || update.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  }) || [];

  const categoryCounts = updates?.reduce((acc, update) => {
    acc[update.category] = (acc[update.category] || 0) + 1;
    return acc;
  }, {}) || {};

  const getStatusColor = (status) => {
    switch (status) {
      case 'new': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'acknowledged': return 'bg-green-100 text-green-800 border-green-300';
      case 'action_required': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Regulatory Updates</h1>
            <p className="text-sm text-slate-600 mt-1">CMS & Medicare regulation changes</p>
          </div>
          <Button
            onClick={() => syncUpdatesMutation.mutate()}
            disabled={syncUpdatesMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {syncUpdatesMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Sync Updates
              </>
            )}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{updates?.length || 0}</p>
                  <p className="text-xs text-slate-600">Total Updates</p>
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
                  <p className="text-2xl font-bold">
                    {updates?.filter(u => u.status === 'new').length || 0}
                  </p>
                  <p className="text-xs text-slate-600">New Updates</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {updates?.filter(u => u.status === 'action_required').length || 0}
                  </p>
                  <p className="text-xs text-slate-600">Action Required</p>
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
                  <p className="text-2xl font-bold">
                    {complianceRules?.length || 0}
                  </p>
                  <p className="text-xs text-slate-600">Active Rules</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search updates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant={selectedCategory === 'all' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory('all')}
                  size="sm"
                >
                  All
                </Button>
                <Button
                  variant={selectedCategory === 'oasis' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory('oasis')}
                  size="sm"
                >
                  OASIS ({categoryCounts.oasis || 0})
                </Button>
                <Button
                  variant={selectedCategory === 'pdgm' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory('pdgm')}
                  size="sm"
                >
                  PDGM ({categoryCounts.pdgm || 0})
                </Button>
                <Button
                  variant={selectedCategory === 'cop' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory('cop')}
                  size="sm"
                >
                  CoPs ({categoryCounts.cop || 0})
                </Button>
                <Button
                  variant={selectedCategory === 'billing' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory('billing')}
                  size="sm"
                >
                  Billing ({categoryCounts.billing || 0})
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Updates List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : filteredUpdates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600 mb-4">No regulatory updates found</p>
              <Button onClick={() => syncUpdatesMutation.mutate()}>
                Sync Updates Now
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredUpdates.map(update => (
              <Card key={update.id} className="border-l-4 border-l-blue-600">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{update.title}</CardTitle>
                        <Badge className={getStatusColor(update.status)}>
                          {update.status.replace('_', ' ')}
                        </Badge>
                        {update.priority && (
                          <Badge className={getPriorityColor(update.priority)}>
                            {update.priority}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Effective: {new Date(update.effective_date).toLocaleDateString()}
                        </span>
                        <span className="uppercase">{update.category}</span>
                        {update.reference_number && (
                          <span>Ref: {update.reference_number}</span>
                        )}
                      </div>
                    </div>
                    {update.status === 'new' && (
                      <Button
                        size="sm"
                        onClick={() => acknowledgeUpdateMutation.mutate(update.id)}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Acknowledge
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-700 mb-4">{update.summary}</p>
                  
                  {update.key_changes && update.key_changes.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-semibold mb-2">Key Changes:</p>
                      <ul className="list-disc list-inside space-y-1">
                        {update.key_changes.map((change, idx) => (
                          <li key={idx} className="text-sm text-slate-600">{change}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {update.action_items && update.action_items.length > 0 && (
                    <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        Action Items:
                      </p>
                      <ul className="list-disc list-inside space-y-1">
                        {update.action_items.map((item, idx) => (
                          <li key={idx} className="text-sm text-yellow-800">{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {update.source_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(update.source_url, '_blank')}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      View Full Document
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}