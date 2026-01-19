import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Trash2,
  Archive,
  Eye,
  CheckCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

export default function DocumentList({
  patientId,
  onSelectForSignature,
  showSignatureOption = true,
}) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: documents = [] } = useQuery({
    queryKey: ["documents", patientId],
    queryFn: () =>
      base44.entities.DocumentRecord.list("-created_date", 100).then((docs) =>
        patientId ? docs.filter((d) => d.patient_id === patientId) : docs
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DocumentRecord.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document deleted");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id) =>
      base44.entities.DocumentRecord.update(id, { is_archived: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document archived");
    },
  });

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      !searchTerm ||
      doc.document_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || doc.category === categoryFilter;
    return matchesSearch && matchesCategory && !doc.is_archived;
  });

  const getSignatureStatusIcon = (status) => {
    switch (status) {
      case "signed":
      case "fully_signed":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "pending":
        return <Clock className="w-4 h-4 text-yellow-600" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          placeholder="Search documents..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="consent_form">Consent Form</SelectItem>
            <SelectItem value="agreement">Agreement</SelectItem>
            <SelectItem value="medical_record">Medical Record</SelectItem>
            <SelectItem value="care_plan">Care Plan</SelectItem>
            <SelectItem value="report">Report</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Documents Grid */}
      <div className="grid gap-3">
        {filteredDocuments.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-gray-500">No documents found</p>
            </CardContent>
          </Card>
        ) : (
          filteredDocuments.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <h3 className="font-semibold">{doc.document_name}</h3>
                      <Badge variant="outline" className="text-xs">
                        v{doc.version_number}
                      </Badge>
                      {doc.signature_status !== "unsigned" && (
                        <div className="flex items-center gap-1">
                          {getSignatureStatusIcon(doc.signature_status)}
                          <Badge className="text-xs" variant="outline">
                            {doc.signature_status}
                          </Badge>
                        </div>
                      )}
                    </div>
                    {doc.description && (
                      <p className="text-sm text-gray-600 mb-2">
                        {doc.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 mb-2">
                      {doc.tags?.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">
                      {doc.file_type} • {(doc.file_size / 1024).toFixed(1)} KB •{" "}
                      {new Date(doc.created_date).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(doc.file_url, "_blank")}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    {showSignatureOption && (
                      <Button
                        size="sm"
                        onClick={() => onSelectForSignature?.(doc)}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        Sign
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => archiveMutation.mutate(doc.id)}
                      disabled={archiveMutation.isPending}
                    >
                      <Archive className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        window.confirm("Delete this document?") &&
                        deleteMutation.mutate(doc.id)
                      }
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}