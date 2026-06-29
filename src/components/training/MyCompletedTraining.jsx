import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Award, Search, Calendar } from "lucide-react";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";
import CertificateDownloadButton from "@/components/training/CertificateDownloadButton";

// Lists the learner's earned certificates from the live TrainingCertificate
// records (replaces the retired TrainingCompletion-based view). Download reuses
// the canonical CertificateDownloadButton (generateTrainingCertificatePDF).
export default function MyCompletedTraining({ nurseEmail }) {
  const [searchTerm, setSearchTerm] = useState("");
  const { certificates } = useMyTrainingCompletions(nurseEmail);

  const issued = certificates.filter((c) => !c.revoked);
  const filtered = issued.filter((c) =>
    (c.course_title || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Award className="w-6 h-6 text-yellow-500" />
          My Certificates
        </h2>
        <Badge className="bg-green-600">{issued.length} Completed</Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search completed training..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Award className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">
                {searchTerm ? "No matching certificates found" : "No completed training yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((cert) => (
            <Card key={cert.id} className="border-2 hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-1">{cert.course_title}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      {cert.training_category && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {String(cert.training_category).replace(/_/g, " ")}
                        </Badge>
                      )}
                      {cert.score != null && (
                        <Badge className="bg-green-600 text-xs">Score: {cert.score}%</Badge>
                      )}
                      {cert.hours ? (
                        <Badge variant="outline" className="text-xs">{cert.hours} CEU</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Award className="w-6 h-6 text-white" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(cert.completion_date || cert.issued_at).toLocaleDateString()}</span>
                  </div>
                  {cert.expiration_date && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Calendar className="w-4 h-4" />
                      <span>Expires {new Date(cert.expiration_date).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
                <CertificateDownloadButton certificate={cert} variant="outline" />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
