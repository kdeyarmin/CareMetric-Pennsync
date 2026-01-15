import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Save, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function SubscriptionPricingManager() {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    monthly_price: 39.99,
    quarterly_price: 99,
    biannual_price: 210,
    yearly_price: 350,
    trial_days: 14
  });

  const { data: settings, isLoading, refetch } = useQuery({
    queryKey: ['subscriptionSettings'],
    queryFn: async () => {
      const result = await base44.entities.SubscriptionSettings.list();
      return result?.[0] || null;
    }
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        monthly_price: settings.monthly_price || 39.99,
        quarterly_price: settings.quarterly_price || 99,
        biannual_price: settings.biannual_price || 210,
        yearly_price: settings.yearly_price || 350,
        trial_days: settings.trial_days || 14
      });
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (settings?.id) {
        await base44.entities.SubscriptionSettings.update(settings.id, formData);
        toast.success('Subscription pricing updated successfully');
      } else {
        await base44.entities.SubscriptionSettings.create(formData);
        toast.success('Subscription pricing created successfully');
      }
      setIsEditing(false);
      refetch();
    } catch (error) {
      console.error('Error saving pricing:', error);
      toast.error('Failed to save pricing');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading subscription settings...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Subscription Pricing Manager
          </CardTitle>
          <CardDescription>Manage subscription plan prices and trial period</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-900">Note:</p>
              <p className="text-sm text-blue-800">Price changes apply to new subscriptions. Existing subscriptions maintain their current pricing until renewal.</p>
            </div>
          </div>

          {!isEditing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Monthly Plan</p>
                  <p className="text-3xl font-bold text-gray-900">${formData.monthly_price.toFixed(2)}</p>
                  <p className="text-xs text-gray-500 mt-2">per month</p>
                </div>

                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Quarterly Plan</p>
                  <p className="text-3xl font-bold text-gray-900">${formData.quarterly_price.toFixed(2)}</p>
                  <p className="text-xs text-gray-500 mt-2">per 3 months</p>
                </div>

                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Biannual Plan</p>
                  <p className="text-3xl font-bold text-gray-900">${formData.biannual_price.toFixed(2)}</p>
                  <p className="text-xs text-gray-500 mt-2">per 6 months</p>
                </div>

                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">Yearly Plan</p>
                  <p className="text-3xl font-bold text-gray-900">${formData.yearly_price.toFixed(2)}</p>
                  <p className="text-xs text-gray-500 mt-2">per year</p>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Trial Period</p>
                <p className="text-2xl font-bold text-gray-900">{formData.trial_days} days</p>
              </div>

              <Button
                onClick={() => setIsEditing(true)}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                Edit Pricing
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="monthly" className="text-sm font-semibold mb-2 block">
                    Monthly Price ($)
                  </Label>
                  <Input
                    id="monthly"
                    type="number"
                    step="0.01"
                    value={formData.monthly_price}
                    onChange={(e) => setFormData({ ...formData, monthly_price: parseFloat(e.target.value) || 0 })}
                    className="text-lg"
                  />
                </div>

                <div>
                  <Label htmlFor="quarterly" className="text-sm font-semibold mb-2 block">
                    Quarterly Price ($)
                  </Label>
                  <Input
                    id="quarterly"
                    type="number"
                    step="0.01"
                    value={formData.quarterly_price}
                    onChange={(e) => setFormData({ ...formData, quarterly_price: parseFloat(e.target.value) || 0 })}
                    className="text-lg"
                  />
                </div>

                <div>
                  <Label htmlFor="biannual" className="text-sm font-semibold mb-2 block">
                    Biannual Price ($)
                  </Label>
                  <Input
                    id="biannual"
                    type="number"
                    step="0.01"
                    value={formData.biannual_price}
                    onChange={(e) => setFormData({ ...formData, biannual_price: parseFloat(e.target.value) || 0 })}
                    className="text-lg"
                  />
                </div>

                <div>
                  <Label htmlFor="yearly" className="text-sm font-semibold mb-2 block">
                    Yearly Price ($)
                  </Label>
                  <Input
                    id="yearly"
                    type="number"
                    step="0.01"
                    value={formData.yearly_price}
                    onChange={(e) => setFormData({ ...formData, yearly_price: parseFloat(e.target.value) || 0 })}
                    className="text-lg"
                  />
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="trial" className="text-sm font-semibold mb-2 block">
                    Trial Period (days)
                  </Label>
                  <Input
                    id="trial"
                    type="number"
                    min="0"
                    value={formData.trial_days}
                    onChange={(e) => setFormData({ ...formData, trial_days: parseInt(e.target.value) || 0 })}
                    className="text-lg"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                >
                  <Save size={16} />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button
                  onClick={() => setIsEditing(false)}
                  disabled={isSaving}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}