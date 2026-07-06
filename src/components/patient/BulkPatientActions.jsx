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
import { CheckSquare, ChevronDown, Tag, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logActivity, ActivityActions } from "../utils/activityLogger";

export default function BulkPatientActions({ selectedPatients, onClearSelection }) {
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");

  const updateStatusMutation = useMutation({
    // allSettled (not Promise.all): a single rejection with Promise.all would skip
    // onSuccess entirely, leaving the already-committed writes invisible in a stale
    // list. Settle every call, then always refresh and report partial failures.
    mutationFn: async (status) => {
      const results = await Promise.allSettled(
        selectedPatients.map(patient =>
          base44.entities.Patient.update(patient.id, { status })
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

  const deletePatientsMutation = useMutation({
    // Soft-archive rather than hard-delete: a plain Patient.delete() would leave every
    // patient_id-linked record (Visit, OASISAssessment, Document, Medication, CallLog,
    // etc. — see mergePatients.js's PATIENT_RELATED_ENTITIES) orphaned on a now-nonexistent
    // patient. Archiving mirrors mergePatientInto's soft-delete, so the clinical history
    // stays attached and recoverable (clear is_archived to restore).
    // allSettled (not Promise.all): with Promise.all one failed delete aborts
    // onSuccess, so the already-deleted patients would still show in the list.
    mutationFn: async () => {
      const results = await Promise.allSettled(
        selectedPatients.map(patient =>
          // status: 'archived' (in addition to is_archived) so the several
          // call sites across the app that filter Patient.filter({status:
          // 'active'}) without separately checking is_archived don't keep
          // surfacing an archived patient as still active.
          base44.entities.Patient.update(patient.id, { is_archived: true, status: 'archived' })
        )
      );
      return { total: results.length, failed: results.filter(r => r.status === 'rejected').length };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      logActivity(ActivityActions.DELETE, {
        entity_type: 'Patient',
        action: 'bulk_delete',
        count: total - failed,
        page: 'Patients'
      });
      setDeleteDialogOpen(false);
      onClearSelection();
      if (failed > 0) {
        toast.error(`${total - failed} deleted, ${failed} failed. Please retry the failed record(s).`);
      } else {
        toast.success(`${total} patient(s) deleted.`);
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
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Selected
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
                <SelectItem value="discharged">Discharged</SelectItem>
                <SelectItem value="hospitalized">Hospitalized</SelectItem>
              </SelectContent>
            </Select>
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedPatients.length} Patient(s)?</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600">
              Are you sure you want to delete {selectedPatients.length} patient(s)? They will be archived and removed from the roster; associated visits, care plans, and data are kept and recoverable.
            </p>
            <div className="bg-red-50 border border-red-200 rounded p-3 mt-3">
              <p className="text-sm font-medium text-red-900">⚠️ This will remove the patient(s) from active views.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => deletePatientsMutation.mutate()}
              disabled={deletePatientsMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletePatientsMutation.isPending ? "Deleting..." : "Delete Patients"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}