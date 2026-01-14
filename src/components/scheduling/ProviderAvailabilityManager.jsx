import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ProviderAvailabilityManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState("1");
  const [formData, setFormData] = useState({
    start_time: "09:00",
    end_time: "17:00",
    slot_duration_minutes: 30
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: availability, refetch } = useQuery({
    queryKey: ["availability", currentUser?.email],
    queryFn: () => currentUser ? base44.entities.ProviderAvailability.filter({ provider_email: currentUser.email }) : Promise.resolve([]),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const handleAddAvailability = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.ProviderAvailability.create({
        provider_email: currentUser.email,
        day_of_week: parseInt(selectedDay),
        start_time: formData.start_time,
        end_time: formData.end_time,
        slot_duration_minutes: formData.slot_duration_minutes,
        is_active: true
      });
      setDialogOpen(false);
      setFormData({ start_time: "09:00", end_time: "17:00", slot_duration_minutes: 30 });
      refetch();
    } catch (error) {
      alert('Error adding availability: ' + error.message);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this availability?')) {
      try {
        await base44.entities.ProviderAvailability.delete(id);
        refetch();
      } catch (error) {
        alert('Error deleting availability: ' + error.message);
      }
    }
  };

  const availabilityByDay = {};
  availability.forEach(a => {
    if (!availabilityByDay[a.day_of_week]) {
      availabilityByDay[a.day_of_week] = [];
    }
    availabilityByDay[a.day_of_week].push(a);
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">My Availability</h2>
        <Button onClick={() => setDialogOpen(true)}>Add Availability</Button>
      </div>

      <div className="grid gap-4">
        {DAYS.map((day, idx) => (
          <Card key={idx}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-semibold">{day}</p>
                  {availabilityByDay[idx]?.length > 0 ? (
                    <div className="space-y-1 mt-2">
                      {availabilityByDay[idx].map(slot => (
                        <p key={slot.id} className="text-sm text-gray-600">
                          {slot.start_time} - {slot.end_time} ({slot.slot_duration_minutes}min slots)
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">Not available</p>
                  )}
                </div>
                {availabilityByDay[idx]?.length > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(availabilityByDay[idx][0].id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Availability</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddAvailability} className="space-y-4">
            <div>
              <Label>Day of Week</Label>
              <Select value={selectedDay} onValueChange={setSelectedDay}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((day, idx) => (
                    <SelectItem key={idx} value={idx.toString()}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                />
              </div>
              <div>
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Slot Duration (minutes)</Label>
              <Select 
                value={formData.slot_duration_minutes.toString()} 
                onValueChange={(val) => setFormData({ ...formData, slot_duration_minutes: parseInt(val) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="45">45 minutes</SelectItem>
                  <SelectItem value="60">60 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}