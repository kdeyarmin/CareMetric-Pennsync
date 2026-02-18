import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Repeat, Plus, Trash2, Pause, Play, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format, addDays, addWeeks, addMonths } from "date-fns";

export default function RecurringFaxManager({ userEmail }) {
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    recipient_name: "",
    recipient_fax_number: "",
    recurrence_pattern: "weekly",
    recurrence_day_of_week: 1,
    send_time: "09:00",
    start_date: new Date().toISOString().split('T')[0]
  });

  const { data: recurringFaxes = [] } = useQuery({
    queryKey: ['recurringFaxes', userEmail],
    queryFn: () => base44.entities.RecurringFax.filter({ user_email: userEmail }, '-created_date'),
    enabled: !!userEmail
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['faxCoverTemplates', userEmail],
    queryFn: () => base44.entities.FaxCoverTemplate.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.RecurringFax.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringFaxes'] });
      resetForm();
      toast.success("Recurring fax created");
    }
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => 
      base44.entities.RecurringFax.update(id, { is_active: !isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringFaxes'] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.RecurringFax.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurringFaxes'] });
      toast.success("Recurring fax deleted");
    }
  });

  const resetForm = () => {
    setShowCreateDialog(false);
    setFormData({
      name: "",
      recipient_name: "",
      recipient_fax_number: "",
      recurrence_pattern: "weekly",
      recurrence_day_of_week: 1,
      send_time: "09:00",
      start_date: new Date().toISOString().split('T')[0]
    });
  };

  const handleCreate = () => {
    if (!formData.name.trim() || !formData.recipient_fax_number.trim()) {
      toast.error("Name and recipient fax number are required");
      return;
    }

    // Calculate next send date
    const now = new Date();
    let nextSend = new Date(formData.start_date);
    
    if (formData.recurrence_pattern === 'weekly') {
      while (nextSend.getDay() !== formData.recurrence_day_of_week) {
        nextSend = addDays(nextSend, 1);
      }
    } else if (formData.recurrence_pattern === 'monthly' && formData.recurrence_day_of_month) {
      nextSend.setDate(formData.recurrence_day_of_month);
      if (nextSend < now) {
        nextSend = addMonths(nextSend, 1);
      }
    }

    createMutation.mutate({
      ...formData,
      user_email: userEmail,
      next_send_date: nextSend.toISOString(),
      is_active: true,
      times_sent: 0
    });
  };

  const getRecurrenceLabel = (fax) => {
    if (fax.recurrence_pattern === 'weekly') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `Every ${days[fax.recurrence_day_of_week]} at ${fax.send_time}`;
    }
    if (fax.recurrence_pattern === 'monthly') {
      return `Monthly on day ${fax.recurrence_day_of_month} at ${fax.send_time}`;
    }
    return `${fax.recurrence_pattern} at ${fax.send_time}`;
  };

  return (
    <Card>
      <CardHeader className="pb-3 p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Repeat className="w-4 h-4" />
            Recurring Faxes
          </CardTitle>
          <Button size="sm" onClick={() => setShowCreateDialog(true)} className="h-7 text-xs gap-1">
            <Plus className="w-3 h-3" /> New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 pt-0">
        {recurringFaxes.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-4">No recurring faxes. Create one for automated scheduled sending.</p>
        ) : (
          <div className="space-y-2">
            {recurringFaxes.map(fax => (
              <div key={fax.id} className="flex items-center gap-2 p-2 rounded-lg border bg-white">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => toggleActiveMutation.mutate({ id: fax.id, isActive: fax.is_active })}
                >
                  {fax.is_active ? 
                    <Pause className="w-3.5 h-3.5 text-blue-600" /> : 
                    <Play className="w-3.5 h-3.5 text-slate-400" />
                  }
                </Button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{fax.name}</p>
                  <p className="text-xs text-slate-500 truncate">{fax.recipient_name} • {fax.recipient_fax_number}</p>
                  <p className="text-xs text-slate-400">{getRecurrenceLabel(fax)}</p>
                  {fax.next_send_date && (
                    <p className="text-xs text-blue-600">
                      Next: {format(new Date(fax.next_send_date), 'MMM d, yyyy h:mm a')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className={fax.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"} className="text-[10px]">
                    {fax.is_active ? "Active" : "Paused"}
                  </Badge>
                  <span className="text-xs text-slate-400">{fax.times_sent} sent</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-500 hover:text-red-700"
                  onClick={() => {
                    if (confirm(`Delete recurring fax "${fax.name}"?`)) {
                      deleteMutation.mutate(fax.id);
                    }
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Recurring Fax</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Schedule Name *</Label>
              <Input
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                placeholder="e.g. Weekly Lab Results to Dr. Smith"
                className="h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Recipient Name</Label>
                <Input
                  value={formData.recipient_name}
                  onChange={e => setFormData({...formData, recipient_name: e.target.value})}
                  placeholder="Dr. Smith"
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Fax Number *</Label>
                <Input
                  value={formData.recipient_fax_number}
                  onChange={e => setFormData({...formData, recipient_fax_number: e.target.value})}
                  placeholder="(555) 123-4567"
                  className="h-9 text-sm"
                  type="tel"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Recurrence Pattern</Label>
              <Select value={formData.recurrence_pattern} onValueChange={v => setFormData({...formData, recurrence_pattern: v})}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly (Every 2 weeks)</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly (Every 3 months)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.recurrence_pattern === 'weekly' && (
              <div>
                <Label className="text-xs">Day of Week</Label>
                <Select 
                  value={formData.recurrence_day_of_week?.toString()} 
                  onValueChange={v => setFormData({...formData, recurrence_day_of_week: parseInt(v)})}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Sunday</SelectItem>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="2">Tuesday</SelectItem>
                    <SelectItem value="3">Wednesday</SelectItem>
                    <SelectItem value="4">Thursday</SelectItem>
                    <SelectItem value="5">Friday</SelectItem>
                    <SelectItem value="6">Saturday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {formData.recurrence_pattern === 'monthly' && (
              <div>
                <Label className="text-xs">Day of Month (1-31)</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={formData.recurrence_day_of_month || ""}
                  onChange={e => setFormData({...formData, recurrence_day_of_month: parseInt(e.target.value)})}
                  placeholder="15"
                  className="h-9 text-sm"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={e => setFormData({...formData, start_date: e.target.value})}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Send Time</Label>
                <Input
                  type="time"
                  value={formData.send_time}
                  onChange={e => setFormData({...formData, send_time: e.target.value})}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            {templates.length > 0 && (
              <div>
                <Label className="text-xs">Cover Sheet Template (optional)</Label>
                <Select 
                  value={formData.template_id || ""} 
                  onValueChange={v => setFormData({...formData, template_id: v || null})}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select template..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>No template</SelectItem>
                    {templates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={resetForm} size="sm">Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} size="sm">
              {createMutation.isPending ? "Creating..." : "Create Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}