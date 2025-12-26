import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Repeat, Calendar, Plus, X } from "lucide-react";
import { format, addDays, addWeeks, addMonths } from "date-fns";

export default function RecurringTaskManager({ task, onSave, onCancel }) {
  const [recurringSettings, setRecurringSettings] = useState({
    is_recurring: task?.is_recurring || false,
    recurrence_type: task?.recurrence_type || 'daily',
    recurrence_interval: task?.recurrence_interval || 1,
    recurrence_days: task?.recurrence_days || [],
    recurrence_end_date: task?.recurrence_end_date || '',
    notification_preferences: {
      enabled: true,
      notify_before_hours: 24,
      notify_on_overdue: true,
      ...(task?.notification_preferences || {})
    }
  });

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const handleDayToggle = (day) => {
    setRecurringSettings(prev => ({
      ...prev,
      recurrence_days: prev.recurrence_days.includes(day)
        ? prev.recurrence_days.filter(d => d !== day)
        : [...prev.recurrence_days, day]
    }));
  };

  const handleSave = () => {
    onSave(recurringSettings);
  };

  const getNextOccurrences = () => {
    if (!task?.due_date) return [];
    
    const startDate = new Date(task.due_date);
    const occurrences = [];
    
    for (let i = 1; i <= 3; i++) {
      let nextDate;
      if (recurringSettings.recurrence_type === 'daily') {
        nextDate = addDays(startDate, i * recurringSettings.recurrence_interval);
      } else if (recurringSettings.recurrence_type === 'weekly') {
        nextDate = addWeeks(startDate, i * recurringSettings.recurrence_interval);
      } else if (recurringSettings.recurrence_type === 'monthly') {
        nextDate = addMonths(startDate, i * recurringSettings.recurrence_interval);
      }
      
      if (nextDate) {
        occurrences.push(format(nextDate, 'MMM d, yyyy'));
      }
    }
    
    return occurrences;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="w-5 h-5" />
          Recurring Task Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable Recurring */}
        <div className="flex items-center gap-2">
          <Checkbox
            checked={recurringSettings.is_recurring}
            onCheckedChange={(checked) => 
              setRecurringSettings(prev => ({ ...prev, is_recurring: checked }))
            }
          />
          <Label>Make this a recurring task</Label>
        </div>

        {recurringSettings.is_recurring && (
          <>
            {/* Recurrence Type */}
            <div className="space-y-2">
              <Label>Repeat Frequency</Label>
              <Select
                value={recurringSettings.recurrence_type}
                onValueChange={(value) => 
                  setRecurringSettings(prev => ({ ...prev, recurrence_type: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Interval */}
            <div className="space-y-2">
              <Label>
                Repeat every {recurringSettings.recurrence_type === 'daily' ? 'day(s)' : 
                recurringSettings.recurrence_type === 'weekly' ? 'week(s)' : 'month(s)'}
              </Label>
              <Input
                type="number"
                min="1"
                value={recurringSettings.recurrence_interval}
                onChange={(e) => 
                  setRecurringSettings(prev => ({ 
                    ...prev, 
                    recurrence_interval: parseInt(e.target.value) || 1 
                  }))
                }
              />
            </div>

            {/* Days of Week (for weekly) */}
            {recurringSettings.recurrence_type === 'weekly' && (
              <div className="space-y-2">
                <Label>Repeat on</Label>
                <div className="flex flex-wrap gap-2">
                  {daysOfWeek.map(day => (
                    <Badge
                      key={day}
                      variant={recurringSettings.recurrence_days.includes(day) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => handleDayToggle(day)}
                    >
                      {day.substring(0, 3)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* End Date */}
            <div className="space-y-2">
              <Label>End Date (optional)</Label>
              <Input
                type="date"
                value={recurringSettings.recurrence_end_date}
                onChange={(e) => 
                  setRecurringSettings(prev => ({ ...prev, recurrence_end_date: e.target.value }))
                }
              />
            </div>

            {/* Preview Next Occurrences */}
            {task?.due_date && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-blue-600" />
                  <p className="text-sm font-semibold text-blue-900">Next 3 Occurrences</p>
                </div>
                <div className="space-y-1">
                  {getNextOccurrences().map((date, idx) => (
                    <p key={idx} className="text-sm text-gray-700">• {date}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Notification Preferences */}
            <div className="space-y-3 pt-4 border-t">
              <Label className="text-base font-semibold">Notification Settings</Label>
              
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={recurringSettings.notification_preferences.enabled}
                  onCheckedChange={(checked) => 
                    setRecurringSettings(prev => ({ 
                      ...prev, 
                      notification_preferences: { ...prev.notification_preferences, enabled: checked }
                    }))
                  }
                />
                <Label>Enable task notifications</Label>
              </div>

              {recurringSettings.notification_preferences.enabled && (
                <>
                  <div className="space-y-2">
                    <Label>Notify me before (hours)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={recurringSettings.notification_preferences.notify_before_hours}
                      onChange={(e) => 
                        setRecurringSettings(prev => ({ 
                          ...prev, 
                          notification_preferences: { 
                            ...prev.notification_preferences, 
                            notify_before_hours: parseInt(e.target.value) || 24 
                          }
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={recurringSettings.notification_preferences.notify_on_overdue}
                      onCheckedChange={(checked) => 
                        setRecurringSettings(prev => ({ 
                          ...prev, 
                          notification_preferences: { 
                            ...prev.notification_preferences, 
                            notify_on_overdue: checked 
                          }
                        }))
                      }
                    />
                    <Label>Notify me when task is overdue</Label>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700">
            Save Settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}