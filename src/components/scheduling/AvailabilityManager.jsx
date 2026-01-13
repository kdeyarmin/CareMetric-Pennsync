import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";

const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' }
];

export default function AvailabilityManager() {
  const [newSlot, setNewSlot] = useState({
    day_of_week: 'monday',
    start_time: '09:00',
    end_time: '17:00',
    appointment_type: 'both'
  });

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: availability = [] } = useQuery({
    queryKey: ["availability", currentUser?.email],
    queryFn: () => base44.entities.ProviderAvailability.filter({ provider_email: currentUser.email }),
    enabled: !!currentUser?.email
  });

  const createAvailabilityMutation = useMutation({
    mutationFn: (data) => base44.entities.ProviderAvailability.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      toast.success("Availability added");
      setNewSlot({ day_of_week: 'monday', start_time: '09:00', end_time: '17:00', appointment_type: 'both' });
    }
  });

  const deleteAvailabilityMutation = useMutation({
    mutationFn: (id) => base44.entities.ProviderAvailability.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      toast.success("Availability removed");
    }
  });

  const toggleAvailabilityMutation = useMutation({
    mutationFn: ({ id, is_active }) => base44.entities.ProviderAvailability.update(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    }
  });

  const handleAddSlot = () => {
    createAvailabilityMutation.mutate({
      ...newSlot,
      provider_email: currentUser.email,
      is_active: true
    });
  };

  const groupedAvailability = DAYS_OF_WEEK.reduce((acc, day) => {
    acc[day.value] = availability.filter(a => a.day_of_week === day.value);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Add New Slot */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add Availability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Day</Label>
              <select
                value={newSlot.day_of_week}
                onChange={(e) => setNewSlot({ ...newSlot, day_of_week: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                {DAYS_OF_WEEK.map(day => (
                  <option key={day.value} value={day.value}>{day.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input
                type="time"
                value={newSlot.start_time}
                onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>End Time</Label>
              <Input
                type="time"
                value={newSlot.end_time}
                onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <select
                value={newSlot.appointment_type}
                onChange={(e) => setNewSlot({ ...newSlot, appointment_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="both">Both</option>
                <option value="in_person">In-Person</option>
                <option value="telehealth">Telehealth</option>
              </select>
            </div>

            <div className="flex items-end">
              <Button onClick={handleAddSlot} className="w-full">
                Add Slot
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Weekly Schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {DAYS_OF_WEEK.map(day => (
              <div key={day.value} className="border-b pb-4 last:border-b-0">
                <h4 className="font-semibold mb-2">{day.label}</h4>
                {groupedAvailability[day.value]?.length === 0 ? (
                  <p className="text-sm text-gray-500">No availability set</p>
                ) : (
                  <div className="space-y-2">
                    {groupedAvailability[day.value]?.map(slot => (
                      <div key={slot.id} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 p-3 rounded-lg">
                        <div className="flex items-center gap-4">
                          <Switch
                            checked={slot.is_active}
                            onCheckedChange={(checked) => 
                              toggleAvailabilityMutation.mutate({ id: slot.id, is_active: checked })
                            }
                          />
                          <div>
                            <div className="font-medium">
                              {slot.start_time} - {slot.end_time}
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              {slot.appointment_type === 'both' ? 'In-Person & Telehealth' : 
                               slot.appointment_type === 'in_person' ? 'In-Person Only' : 'Telehealth Only'}
                            </div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteAvailabilityMutation.mutate(slot.id)}
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}