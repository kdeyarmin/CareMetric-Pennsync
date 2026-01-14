import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Trash2, Loader2, CheckCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function DataResetPanel() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deletionResult, setDeletionResult] = useState(null);

  const handleDeleteAll = async () => {
    if (confirmText !== "DELETE ALL DATA") {
      toast.error('Please type "DELETE ALL DATA" to confirm');
      return;
    }

    setIsDeleting(true);
    try {
      const response = await base44.functions.invoke('deleteAllData', {});
      
      setDeletionResult(response.data);
      toast.success('All data has been deleted successfully');
      setShowConfirm(false);
      setConfirmText("");
      
      // Refresh the page after 2 seconds
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Error deleting data:', error);
      toast.error('Failed to delete data: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="border-red-200">
      <CardHeader className="bg-red-50">
        <CardTitle className="text-red-900 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" />
          Danger Zone - Reset All Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-900 text-sm">
            <strong>Warning:</strong> This will permanently delete ALL non-sample data including:
            patients, visits, care plans, tasks, invoices, and all other records. This action
            cannot be undone.
          </AlertDescription>
        </Alert>

        {!showConfirm ? (
          <Button
            variant="outline"
            className="w-full border-red-300 text-red-700 hover:bg-red-50"
            onClick={() => setShowConfirm(true)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete All Data
          </Button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Type "DELETE ALL DATA" to confirm:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE ALL DATA"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={isDeleting}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText("");
                }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                onClick={handleDeleteAll}
                disabled={isDeleting || confirmText !== "DELETE ALL DATA"}
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Confirm Delete
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {deletionResult && (
          <Alert className="border-green-200 bg-green-50 mt-4">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 text-sm">
              <strong>Success!</strong> All data has been deleted.
              <div className="mt-2 text-xs">
                {Object.entries(deletionResult.deletionSummary || {}).map(([entity, count]) => (
                  <div key={entity}>
                    {entity}: {count} records deleted
                  </div>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-gray-500">
          Sample data (marked with is_sample: true) will be preserved. Only your actual data
          will be deleted.
        </p>
      </CardContent>
    </Card>
  );
}