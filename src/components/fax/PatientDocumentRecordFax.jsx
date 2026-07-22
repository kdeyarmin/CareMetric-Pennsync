import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Send } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import DocumentRecordFaxDialog from "@/components/fax/DocumentRecordFaxDialog";

export default function PatientDocumentRecordFax({ patient }) {
  const [selectedRecord, setSelectedRecord] = useState(null);
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["patient-document-records", patient.id],
    queryFn: () => base44.entities.DocumentRecord.filter({ patient_id: patient.id }, "-created_date", 100),
  });
  const availableRecords = records.filter((record) => record.file_url && !record.is_archived);

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Fax Document Records</CardTitle></CardHeader>
    <CardContent>
      {isLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading document records...</p> : availableRecords.length === 0 ? (
        <EmptyState icon={FileText} title="No fax-ready document records" description="Patient DocumentRecord files will appear here when available." />
      ) : <div className="divide-y rounded-lg border">
        {availableRecords.map((record) => <div key={record.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="truncate font-semibold text-slate-900 dark:text-slate-100">{record.document_name || record.file_name}</p><Badge variant="outline" className="mt-1">{(record.category || "other").replace(/_/g, " ")}</Badge></div>
          <Button size="sm" onClick={() => setSelectedRecord(record)}><Send className="mr-2 h-4 w-4" />Send Fax</Button>
        </div>)}
      </div>}
      <DocumentRecordFaxDialog record={selectedRecord} patient={patient} open={!!selectedRecord} onOpenChange={(open) => !open && setSelectedRecord(null)} />
    </CardContent>
  </Card>;
}