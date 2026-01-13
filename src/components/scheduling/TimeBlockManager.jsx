import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Ban, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

export default function TimeBlockManager() {
  const [newBlock, setNewBlock] = useState({
    block_date: "",
    start_time: "",
    end_time: "",
    reason: "",
    is_all_day: false
  });

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: timeBlocks = [] } = useQuery({
    queryKey: ["timeBlocks", currentUser?.email],
    queryFn: () => base44.entities.ProviderTimeBlock.filter({ provider_email: currentUser.email }),
    enabled: !!currentUser?.email
  });

  const createBlockMutation = useMutation({
    mutationFn: (data) => base44.entities.ProviderTimeBlock.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeBlocks"] });
      toast.success("Time blocked successfully");
      setNewBlock({ block_date: "", start_time: "", end_time: "", reason: "", is_all_day: false });
    }
  });

  const deleteBlockMutation = useMutation({
    mutationFn: (id) => base44.entities.ProviderTimeBlock.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeBlocks"] });
      toast.success("Time block removed");
    }
  });

  const handleAddBlock = () => {
    if (!newBlock.block_date) {
      toast.error("Please select a date");
      return;
    }

    createBlockMutation.mutate({
      ...newBlock,
      provider_email: currentUser.email
    });
  };

  const upcomingBlocks = timeBlocks
    .filter(block => new Date(block.block_date) >= new Date())
    .sort((a, b) => new Date(a.block_date) - new Date(b.block_date));

  return (
    <div className="space-y-6">
      {/* Add New Block */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Block Time Off
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={newBlock.block_date}
                  onChange={(e) => setNewBlock({ ...newBlock, block_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={newBlock.start_time}
                  onChange={(e) => setNewBlock({ ...newBlock, start_time: e.target.value })}
                  disabled={newBlock.is_all_day}
                />
              </div>

              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={newBlock.end_time}
                  onChange={(e) => setNewBlock({ ...newBlock, end_time: e.target.value })}
                  disabled={newBlock.is_all_day}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={newBlock.is_all_day}
                onCheckedChange={(checked) => setNewBlock({ ...newBlock, is_all_day: checked })}
              />
              <Label>All Day</Label>
            </div>

            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                placeholder="e.g., Vacation, Conference, Personal"
                value={newBlock.reason}
                onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })}
              />
            </div>

            <Button onClick={handleAddBlock} disabled={createBlockMutation.isPending}>
              {createBlockMutation.isPending ? "Adding..." : "Block Time"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Existing Blocks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="w-5 h-5" />
            Blocked Time ({upcomingBlocks.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {upcomingBlocks.length === 0 ? (
              <p className="text-center py-8 text-gray-500">No blocked time</p>
            ) : (
              upcomingBlocks.map(block => (
                <div key={block.id} className="border p-4 rounded-lg flex justify-between items-start">
                  <div>
                    <div className="font-semibold">
                      {new Date(block.block_date).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {block.is_all_day ? (
                        "All Day"
                      ) : (
                        `${block.start_time} - ${block.end_time}`
                      )}
                    </div>
                    {block.reason && (
                      <div className="text-sm text-gray-500 mt-1 italic">
                        {block.reason}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteBlockMutation.mutate(block.id)}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}