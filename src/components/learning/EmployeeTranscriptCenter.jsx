import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, Printer, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { generateTrainingCertificate } from "@/functions/generateTrainingCertificate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import LoadingState from "@/components/ui/LoadingState";
import { HideWhenEmbedded } from "@/components/ui/embeddedPage";

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "—";

export default function EmployeeTranscriptCenter() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: certificates = [], isLoading } = useQuery({
    queryKey: ["employee-transcript-certificates", currentUser?.email],
    queryFn: () => base44.entities.TrainingCertificate.filter({ user_id: currentUser?.email }, '-issued_at', 300),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const filtered = searchQuery
    ? certificates.filter(c => c.course_title?.toLowerCase().includes(searchQuery.toLowerCase()))
    : certificates;

  const createPdfUrl = async (certificate) => {
    const response = await generateTrainingCertificate({
      moduleName: certificate.course_title,
      completionDate: certificate.completion_date || certificate.issued_at,
      score: certificate.score
    });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    return window.URL.createObjectURL(blob);
  };

  const downloadCertificate = async (certificate) => {
    const url = await createPdfUrl(certificate);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${certificate.course_title.replace(/\s+/g, '_')}_certificate.pdf`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const printCertificate = async (certificate) => {
    const url = await createPdfUrl(certificate);
    const printWindow = window.open(url, '_blank');
    setTimeout(() => printWindow?.print(), 600);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <HideWhenEmbedded>
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 to-indigo-700 text-white p-6 shadow-xl">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Employee Transcript</h1>
          <p className="text-indigo-100">Chronological certificate and completion history for assigned in-services.</p>
        </div>
      </HideWhenEmbedded>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle>Certificate History ({certificates.length})</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search certificates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <LoadingState />
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Award className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500">
                {searchQuery ? 'No certificates match your search.' : 'No certificates available yet.'}
              </p>
            </div>
          ) : (
            filtered.map((certificate) => {
              const isExpired = certificate.expiration_date && new Date(certificate.expiration_date) < new Date();
              return (
                <div key={certificate.id} className={`rounded-2xl border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white transition-all hover:shadow-sm ${
                  isExpired ? 'border-red-200 bg-red-50/30' : ''
                }`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Award className="w-5 h-5 text-amber-500 flex-shrink-0" />
                      <h2 className="font-semibold text-slate-900 truncate">{certificate.course_title}</h2>
                      {isExpired && <Badge className="bg-red-100 text-red-700">Expired</Badge>}
                    </div>
                    <p className="text-sm text-slate-500">
                      Completed {formatDate(certificate.completion_date || certificate.issued_at)}
                      {certificate.score != null && <> &middot; Score {certificate.score}%</>}
                    </p>
                    {certificate.certificate_id && (
                      <p className="text-xs text-slate-400">Certificate ID: {certificate.certificate_id}</p>
                    )}
                    {certificate.expiration_date && (
                      <p className={`text-xs ${isExpired ? 'text-red-600' : 'text-slate-400'}`}>
                        {isExpired ? 'Expired' : 'Valid until'} {formatDate(certificate.expiration_date)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button variant="outline" onClick={() => printCertificate(certificate)}><Printer className="w-4 h-4 mr-2" />Print</Button>
                    <Button onClick={() => downloadCertificate(certificate)}>Download PDF</Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
