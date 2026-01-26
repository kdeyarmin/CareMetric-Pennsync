import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Bell, Mail, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function NotificationPreferences({ currentUser }) {
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery({
    queryKey: ['notificationPreferences', currentUser?.email],
    queryFn: async () => {
      const prefs = await base44.entities.NotificationPreferences.filter({
        user_email: currentUser.email
      });
      
      // Return existing preferences or defaults
      return prefs.length > 0 ? prefs[0] : {
        user_email: currentUser.email,
        onboarding_emails: true,
        feature_announcements: true,
        subscription_reminders: true,
        abandoned_cart_recovery: true,
        marketing_emails: true,
        product_updates: true,
        weekly_digest: false,
        email_frequency: 'immediate'
      };
    },
    enabled: !!currentUser?.email
  });

  const saveMutation = useMutation({
    mutationFn: async (updatedPrefs) => {
      if (preferences?.id) {
        return await base44.entities.NotificationPreferences.update(preferences.id, updatedPrefs);
      } else {
        return await base44.entities.NotificationPreferences.create(updatedPrefs);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['notificationPreferences']);
      toast.success("Notification preferences saved!");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to save preferences");
    }
  });

  const handleToggle = (field) => {
    const updatedPrefs = { ...preferences, [field]: !preferences[field] };
    saveMutation.mutate(updatedPrefs);
  };

  const handleFrequencyChange = (value) => {
    const updatedPrefs = { ...preferences, email_frequency: value };
    saveMutation.mutate(updatedPrefs);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center items-center p-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const notificationOptions = [
    {
      id: 'onboarding_emails',
      label: 'Onboarding Emails',
      description: 'Receive helpful emails when you first join to get started',
      icon: Mail
    },
    {
      id: 'feature_announcements',
      label: 'Feature Announcements',
      description: 'Get notified about new features and improvements',
      icon: Bell
    },
    {
      id: 'subscription_reminders',
      label: 'Subscription Reminders',
      description: 'Receive reminders about subscription renewals and payments',
      icon: CheckCircle2
    },
    {
      id: 'abandoned_cart_recovery',
      label: 'Purchase Reminders',
      description: 'Get reminders if you leave items in your cart',
      icon: Mail
    },
    {
      id: 'marketing_emails',
      label: 'Marketing & Promotions',
      description: 'Receive special offers, discounts, and marketing content',
      icon: Mail
    },
    {
      id: 'product_updates',
      label: 'Product Updates',
      description: 'Stay informed about product changes and tips',
      icon: Bell
    },
    {
      id: 'weekly_digest',
      label: 'Weekly Digest',
      description: 'Get a weekly summary of your activity and insights',
      icon: Mail
    }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Email Notifications
          </CardTitle>
          <CardDescription>
            Manage your email notification preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email Frequency */}
          <div className="pb-4 border-b">
            <Label htmlFor="frequency" className="text-base font-medium">
              Email Frequency
            </Label>
            <p className="text-sm text-muted-foreground mb-3">
              How often should we send non-urgent emails?
            </p>
            <Select 
              value={preferences?.email_frequency || 'immediate'}
              onValueChange={handleFrequencyChange}
              disabled={saveMutation.isPending}
            >
              <SelectTrigger id="frequency" className="w-full md:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediately</SelectItem>
                <SelectItem value="daily">Daily Digest</SelectItem>
                <SelectItem value="weekly">Weekly Summary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notification Toggles */}
          <div className="space-y-4">
            {notificationOptions.map((option) => {
              const Icon = option.icon;
              return (
                <div 
                  key={option.id}
                  className="flex items-start justify-between gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <Icon className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <Label 
                        htmlFor={option.id}
                        className="font-medium cursor-pointer"
                      >
                        {option.label}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {option.description}
                      </p>
                    </div>
                  </div>
                  <Switch
                    id={option.id}
                    checked={preferences?.[option.id] || false}
                    onCheckedChange={() => handleToggle(option.id)}
                    disabled={saveMutation.isPending}
                  />
                </div>
              );
            })}
          </div>

          {saveMutation.isPending && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving preferences...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}