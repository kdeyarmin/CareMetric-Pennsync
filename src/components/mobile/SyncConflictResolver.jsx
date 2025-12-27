import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, FileText, Clock } from "lucide-react";

export default function SyncConflictResolver({ conflicts = [], onResolve }) {
  const [selectedConflict, setSelectedConflict] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleResolve = (conflictId, resolution) => {
    onResolve(conflictId, resolution);
    setDialogOpen(false);
    setSelectedConflict(null);
  };

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-2 border-yellow-300 bg-yellow-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            Sync Conflicts Detected
            <Badge className="ml-auto bg-yellow-600">{conflicts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="bg-white border-yellow-300">
            <AlertDescription className="text-sm text-gray-700">
              Some offline changes conflict with server data. Review and resolve each conflict below.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            {conflicts.map((conflict) => (
              <div
                key={conflict.id}
                className="p-3 bg-white border border-yellow-200 rounded-lg cursor-pointer hover:bg-yellow-50"
                onClick={() => {
                  setSelectedConflict(conflict);
                  setDialogOpen(true);
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{conflict.patient_name}</p>
                    <p className="text-xs text-gray-600">
                      {conflict.type} - {conflict.visit_date}
                    </p>
                  </div>
                  <Badge variant="outline" className="bg-yellow-100">
                    Conflict
                  </Badge>
                </div>
                <p className="text-xs text-gray-500">
                  Local version differs from server version
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Conflict Resolution Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          {selectedConflict && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  Resolve Sync Conflict
                </DialogTitle>
                <DialogDescription>
                  Choose which version to keep or merge the changes
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Patient Info */}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <p className="font-semibold text-sm">{selectedConflict.patient_name}</p>
                  <p className="text-xs text-gray-600">
                    Visit Date: {selectedConflict.visit_date} • Type: {selectedConflict.type}
                  </p>
                </div>

                {/* Conflict Details */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Local Version */}
                  <Card className="border-2 border-blue-300">
                    <CardHeader className="bg-blue-50 pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        Your Offline Version
                      </CardTitle>
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <Clock className="w-3 h-3" />
                        Modified: {new Date(selectedConflict.local_timestamp).toLocaleString()}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3">
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="text-xs font-medium text-gray-600">Notes:</p>
                          <p className="text-gray-800 bg-white p-2 rounded border text-xs">
                            {selectedConflict.local_data?.notes || "No notes"}
                          </p>
                        </div>
                        {selectedConflict.local_data?.vital_signs && (
                          <div>
                            <p className="text-xs font-medium text-gray-600">Vitals:</p>
                            <div className="text-xs bg-white p-2 rounded border">
                              <p>BP: {selectedConflict.local_data.vital_signs.blood_pressure_systolic}/{selectedConflict.local_data.vital_signs.blood_pressure_diastolic}</p>
                              <p>HR: {selectedConflict.local_data.vital_signs.heart_rate}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Server Version */}
                  <Card className="border-2 border-purple-300">
                    <CardHeader className="bg-purple-50 pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <FileText className="w-4 h-4 text-purple-600" />
                        Server Version
                      </CardTitle>
                      <div className="flex items-center gap-1 text-xs text-gray-600">
                        <Clock className="w-3 h-3" />
                        Modified: {new Date(selectedConflict.server_timestamp).toLocaleString()}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3">
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="text-xs font-medium text-gray-600">Notes:</p>
                          <p className="text-gray-800 bg-white p-2 rounded border text-xs">
                            {selectedConflict.server_data?.notes || "No notes"}
                          </p>
                        </div>
                        {selectedConflict.server_data?.vital_signs && (
                          <div>
                            <p className="text-xs font-medium text-gray-600">Vitals:</p>
                            <div className="text-xs bg-white p-2 rounded border">
                              <p>BP: {selectedConflict.server_data.vital_signs.blood_pressure_systolic}/{selectedConflict.server_data.vital_signs.blood_pressure_diastolic}</p>
                              <p>HR: {selectedConflict.server_data.vital_signs.heart_rate}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Resolution Options */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-900">Choose Resolution:</p>
                  
                  <Button
                    onClick={() => handleResolve(selectedConflict.id, 'use_local')}
                    className="w-full bg-blue-600 hover:bg-blue-700 justify-start"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Keep My Offline Version (Overwrite Server)
                  </Button>

                  <Button
                    onClick={() => handleResolve(selectedConflict.id, 'use_server')}
                    className="w-full bg-purple-600 hover:bg-purple-700 justify-start"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Keep Server Version (Discard Mine)
                  </Button>

                  <Button
                    onClick={() => handleResolve(selectedConflict.id, 'merge')}
                    variant="outline"
                    className="w-full justify-start border-2 border-green-300 hover:bg-green-50"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                    Merge Both (Combine Data)
                  </Button>
                </div>

                <Alert>
                  <AlertDescription className="text-xs text-gray-600">
                    <strong>Tip:</strong> Merging will combine notes and keep the most recent vital signs. 
                    Choose carefully as this action cannot be undone.
                  </AlertDescription>
                </Alert>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}