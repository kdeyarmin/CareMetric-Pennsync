import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckSquare, ChevronDown, Tag } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logActivity, ActivityActions } from "../utils/activityLogger";
import { changePatientStatus } from '@/functions/updateAuthorizedPatient';

export default function BulkPatientActions({ selectedPatients, onClearSelection }) {
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");

  const updateStatusMutation = useMutation({
    // allSettled (not Promise.all): a single rejection with Promise.all would skip
    // onSuccess entirely, leaving the already-committed writes invisible in a stale
    // list. Settle every call, then always refresh and report partial failures.
    mutationFn: async (status) => {
      const results = await Promise.allSettled(
        selectedPatients.map(patient =>
          changePatientStatus({
            patientId: patient.id,
            agencyId: patient.agency_id,
            expectedUpdatedDate: patient.updated_date,
            status,
          })
        )
      );
      return { total: results.length, failed: results.filter(r => r.status === 'rejected').length };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      logActivity(ActivityActions.UPDATE, {
        entity_type: 'Patient',
        action: 'bulk_status_update',
        count: total - failed,
        page: 'Patients'
      });
      setStatusDialogOpen(false);
      onClearSelection();
      if (failed > 0) {
        toast.error(`${total - failed} updated, ${failed} failed. Please retry the failed record(s).`);
      } else {
        toast.success(`${total} patient(s) updated.`);
      }
    },
  });

  if (selectedPatients.length === 0) return null;

  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge className="bg-blue-600 text-white">
            {selectedPatients.length} Selected
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            className="text-xs"
          >
            Clear Selection
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 gap-2">
                <CheckSquare className="w-4 h-4" />
                Bulk Actions
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setStatusDialogOpen(true)}>
                <Tag className="w-4 h-4 mr-2" />
                Change Status
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Status for {selectedPatients.length} Patient(s)</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label>New Status</Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="hospitalized">Hospitalized</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-slate-500">
              Discharge is completed one patient at a time because it requires a discharge date and disposition.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateStatusMutation.mutate(newStatus)}
              disabled={!newStatus || updateStatusMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {updateStatusMutation.isPending ? "Updating..." : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
