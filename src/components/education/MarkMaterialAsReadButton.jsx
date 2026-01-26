import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function MarkMaterialAsReadButton({
  materialId,
  assignmentId,
  onMarkRead,
}) {
  const [isMarking, setIsMarking] = useState(false);
  const queryClient = useQueryClient();

  const { data: isRead } = useQuery({
    queryKey: ['materialRead', materialId],
    queryFn: async () => {
      const user = await base44.auth.me();
      const interactions = await base44.entities.MaterialInteraction.filter({
        material_id: materialId,
        user_email: user.email,
        interaction_type: 'read',
      });
      return interactions.length > 0;
    },
  });

  const handleMarkAsRead = async () => {
    setIsMarking(true);
    try {
      const user = await base44.auth.me();

      // Record the read interaction
      await base44.entities.MaterialInteraction.create({
        material_id: materialId,
        user_email: user.email,
        interaction_type: 'read',
        interaction_date: new Date().toISOString(),
      });

      // Update assignment status if applicable
      if (assignmentId) {
        await base44.entities.PatientEducationAssignment.update(assignmentId, {
          status: 'completed',
          completion_date: new Date().toISOString(),
        });
      }

      toast.success('Material marked as read');
      queryClient.invalidateQueries({ queryKey: ['materialRead', materialId] });
      onMarkRead?.();
    } catch (error) {
      toast.error('Failed to mark as read');
    } finally {
      setIsMarking(false);
    }
  };

  return (
    <Button
      onClick={handleMarkAsRead}
      disabled={isMarking || isRead}
      variant={isRead ? 'default' : 'outline'}
      className="w-full gap-2"
    >
      {isRead ? (
        <>
          <CheckCircle2 className="w-4 h-4" />
          Read
        </>
      ) : (
        <>
          <Circle className="w-4 h-4" />
          Mark as Read
        </>
      )}
    </Button>
  );
}