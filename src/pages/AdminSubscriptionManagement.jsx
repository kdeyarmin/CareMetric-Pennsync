import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings, DollarSign, Users, TrendingUp, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { Textarea } from "@/components/ui/textarea";

export default function AdminSubscriptionManagement() {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    monthly_price: 39.99,
    stripe_monthly_price_id: '',
    quarterly_price: 99,
    stripe_quarterly_price_id: '',
    biannual_price: 210,
    stripe_biannual_price_id: '',
    yearly_price: 350,
    stripe_yearly_price_id: '',
    trial_days: 14,
    features: []
  });
  const [newFeature, setNewFeature] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['subscriptionSettings'],
    queryFn: async () => {
      const result = await base44.entities.SubscriptionSettings.list();
      if (result.length > 0) {
        setFormData(result[0]);
        return result[0];
      }
      return null;
    }
  });

  const { data: allSubscriptions = [] } = useQuery({
    queryKey: ['allSubscriptions'],
    queryFn: () => base44.asServiceRole.entities.Subscription.list('-created_date'),
    enabled: currentUser?.role === 'admin'
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ['allPayments'],
    queryFn: () => base44.entities.Payment.list('-payment_date'),
    enabled: currentUser?.role === 'admin'
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data) => {
      if (settings?.id) {
        return base44.entities.SubscriptionSettings.update(settings.id, data);
      } else {
        return base44.entities.SubscriptionSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptionSettings'] });
      setEditMode(false);
    }
  });

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(formData);
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setFormData({
        ...formData,
        features: [...(formData.features || []), newFeature.trim()]
      });
      setNewFeature('');
    }
  };

  const removeFeature = (index) => {
    setFormData({
      ...formData,
      features: formData.features.filter((_, i) => i !== index)
    });
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Admin Access Required</h2>
            <p className="text-gray-600">This page is only accessible to administrators.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeSubscriptions = allSubscriptions.filter(s => s.status === 'active');
  const totalMRR = activeSubscriptions.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);
  const totalPayments = allPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-4 sm:mb-6 md:mb-8">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">Subscription Management</h1>
        <p className="text-xs sm:text-sm md:text-base text-gray-600">Configure pricing and manage all subscriptions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6 md:mb-8">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <Users className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{activeSubscriptions.length}</p>
            <p className="text-xs sm:text-sm text-gray-600">Active Subscribers</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
            </div>
            <p className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">${totalMRR.toFixed(2)}</p>
            <p className="text-xs sm:text-sm text-gray-600">Monthly Recurring Revenue</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <CreditCard className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">{allPayments.length}</p>
            <p className="text-xs sm:text-sm text-gray-600">Total Payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <DollarSign className="w-6 h-6 sm:w-8 sm:h-8 text-yellow-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-gray-900">${totalPayments.toFixed(2)}</p>
            <p className="text-xs sm:text-sm text-gray-600">Total Revenue</p>
          </CardContent>
        </Card>
      </div>

      {/* Subscription Settings */}
      <Card className="mb-4 sm:mb-6 md:mb-8">
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              Subscription Plans & Pricing
            </CardTitle>
            <Button
              onClick={() => editMode ? handleSaveSettings() : setEditMode(true)}
              disabled={updateSettingsMutation.isPending}
              className="min-h-[44px] w-full sm:w-auto text-sm"
            >
              {updateSettingsMutation.isPending ? 'Saving...' : editMode ? 'Save Changes' : 'Edit Settings'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6">
          <div className="space-y-4 sm:space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Monthly Plan */}
              <div className="border rounded-lg p-3 sm:p-4 space-y-2 sm:space-y-3 bg-gray-50">
                <h3 className="font-semibold text-center text-sm sm:text-base">Monthly Plan</h3>
                <div>
                  <Label className="text-xs">Price ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.monthly_price}
                    onChange={(e) => setFormData({...formData, monthly_price: parseFloat(e.target.value)})}
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <Label className="text-xs">Stripe Price ID</Label>
                  <Input
                    value={formData.stripe_monthly_price_id || ''}
                    onChange={(e) => setFormData({...formData, stripe_monthly_price_id: e.target.value})}
                    disabled={!editMode}
                    placeholder="price_xxxxx"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* 3-Month Plan */}
              <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                <h3 className="font-semibold text-center">3-Month Plan</h3>
                <div>
                  <Label className="text-xs">Price ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.quarterly_price}
                    onChange={(e) => setFormData({...formData, quarterly_price: parseFloat(e.target.value)})}
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <Label className="text-xs">Stripe Price ID</Label>
                  <Input
                    value={formData.stripe_quarterly_price_id || ''}
                    onChange={(e) => setFormData({...formData, stripe_quarterly_price_id: e.target.value})}
                    disabled={!editMode}
                    placeholder="price_xxxxx"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* 6-Month Plan */}
              <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                <h3 className="font-semibold text-center">6-Month Plan</h3>
                <div>
                  <Label className="text-xs">Price ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.biannual_price}
                    onChange={(e) => setFormData({...formData, biannual_price: parseFloat(e.target.value)})}
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <Label className="text-xs">Stripe Price ID</Label>
                  <Input
                    value={formData.stripe_biannual_price_id || ''}
                    onChange={(e) => setFormData({...formData, stripe_biannual_price_id: e.target.value})}
                    disabled={!editMode}
                    placeholder="price_xxxxx"
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Annual Plan */}
              <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
                <h3 className="font-semibold text-center">Annual Plan</h3>
                <div>
                  <Label className="text-xs">Price ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.yearly_price}
                    onChange={(e) => setFormData({...formData, yearly_price: parseFloat(e.target.value)})}
                    disabled={!editMode}
                  />
                </div>
                <div>
                  <Label className="text-xs">Stripe Price ID</Label>
                  <Input
                    value={formData.stripe_yearly_price_id || ''}
                    onChange={(e) => setFormData({...formData, stripe_yearly_price_id: e.target.value})}
                    disabled={!editMode}
                    placeholder="price_xxxxx"
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            <div>
              <Label>Trial Period (days)</Label>
              <Input
                type="number"
                value={formData.trial_days}
                onChange={(e) => setFormData({...formData, trial_days: parseInt(e.target.value)})}
                disabled={!editMode}
                className="max-w-xs"
              />
            </div>

            <div>
              <Label>Included Features (All Plans)</Label>
              {editMode && (
                <div className="flex gap-2 mb-3">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    placeholder="Add a feature..."
                    onKeyPress={(e) => e.key === 'Enter' && addFeature()}
                  />
                  <Button onClick={addFeature}>Add</Button>
                </div>
              )}
              <div className="space-y-2">
                {(formData.features || []).map((feature, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <span className="text-sm">{feature}</span>
                    {editMode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFeature(idx)}
                        className="text-red-600"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* All Subscriptions */}
      <Card className="mb-4 sm:mb-6 md:mb-8">
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">All Subscriptions ({allSubscriptions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6">
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Amount</th>
                  <th className="text-left p-3">Period End</th>
                  <th className="text-left p-3">Cancel at End</th>
                </tr>
              </thead>
              <tbody>
                {allSubscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">{sub.user_email}</td>
                    <td className="p-3">
                      <Badge className={
                        sub.status === 'active' ? 'bg-green-600' :
                        sub.status === 'past_due' ? 'bg-red-600' :
                        sub.status === 'trialing' ? 'bg-blue-600' :
                        'bg-gray-600'
                      }>
                        {sub.status}
                      </Badge>
                    </td>
                    <td className="p-3">${sub.monthly_amount || 'N/A'}/mo</td>
                    <td className="p-3">
                      {sub.current_period_end ? format(new Date(sub.current_period_end), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td className="p-3">
                      {sub.cancel_at_period_end ? (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-800">Yes</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Recent Payments</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 md:p-6">
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-left p-3">Amount</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Period</th>
                </tr>
              </thead>
              <tbody>
                {allPayments.slice(0, 20).map((payment) => (
                  <tr key={payment.id} className="border-b hover:bg-gray-50">
                    <td className="p-3">
                      {payment.payment_date ? format(new Date(payment.payment_date), 'MMM d, yyyy') : 'N/A'}
                    </td>
                    <td className="p-3">{payment.user_email}</td>
                    <td className="p-3 font-semibold">${payment.amount}</td>
                    <td className="p-3">
                      <Badge className={
                        payment.status === 'succeeded' ? 'bg-green-600' :
                        payment.status === 'failed' ? 'bg-red-600' :
                        'bg-gray-600'
                      }>
                        {payment.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-gray-600">
                      {payment.period_start && payment.period_end ? (
                        <>
                          {format(new Date(payment.period_start), 'MMM d')} - {format(new Date(payment.period_end), 'MMM d')}
                        </>
                      ) : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}