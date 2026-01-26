import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Send, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function EmailCampaignManager() {
  const [formData, setFormData] = useState({
    feature_title: '',
    feature_description: '',
    feature_link: '',
    target_audience: 'all'
  });

  const sendAnnouncementMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('sendFeatureAnnouncement', data);
      return response?.data;
    },
    onSuccess: (data) => {
      toast.success(`Feature announcement sent to ${data?.sent_count || 0} users!`);
      setFormData({
        feature_title: '',
        feature_description: '',
        feature_link: '',
        target_audience: 'all'
      });
    },
    onError: (error) => {
      toast.error(error.message || "Failed to send announcement");
    }
  });

  const handleSendAnnouncement = () => {
    if (!formData.feature_title || !formData.feature_description) {
      toast.error("Title and description are required");
      return;
    }

    if (!confirm(`Send feature announcement to ${formData.target_audience === 'all' ? 'all' : 'active subscriber'} users?`)) {
      return;
    }

    sendAnnouncementMutation.mutate(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Email Campaign Manager
        </CardTitle>
        <CardDescription>
          Send feature announcements and marketing emails to users
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="title">Feature Title</Label>
          <Input
            id="title"
            placeholder="e.g., New AI-Powered Care Plans"
            value={formData.feature_title}
            onChange={(e) => setFormData({ ...formData, feature_title: e.target.value })}
            className="mt-2"
          />
        </div>

        <div>
          <Label htmlFor="description">Feature Description</Label>
          <Textarea
            id="description"
            placeholder="Describe the new feature and its benefits..."
            value={formData.feature_description}
            onChange={(e) => setFormData({ ...formData, feature_description: e.target.value })}
            rows={4}
            className="mt-2"
          />
        </div>

        <div>
          <Label htmlFor="link">Feature Link (Optional)</Label>
          <Input
            id="link"
            type="url"
            placeholder="https://app.caremetricai.com/NewFeature"
            value={formData.feature_link}
            onChange={(e) => setFormData({ ...formData, feature_link: e.target.value })}
            className="mt-2"
          />
        </div>

        <div>
          <Label htmlFor="audience">Target Audience</Label>
          <Select
            value={formData.target_audience}
            onValueChange={(value) => setFormData({ ...formData, target_audience: value })}
          >
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="active_subscribers">Active Subscribers Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleSendAnnouncement}
          disabled={sendAnnouncementMutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {sendAnnouncementMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Send Announcement
            </>
          )}
        </Button>

        {sendAnnouncementMutation.isSuccess && (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Campaign sent successfully!
          </div>
        )}
      </CardContent>
    </Card>
  );
}