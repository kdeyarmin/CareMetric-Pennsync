import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { validateFileUpload } from "@/components/utils/security";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload } from "lucide-react";

export default function TrainingAttachmentManager({ course }) {
  const queryClient = useQueryClient();
  const [selectedModuleId, setSelectedModuleId] = useState("course");
  const [files, setFiles] = useState([]);

  const { data: modules = [] } = useQuery({
    queryKey: ["training-modules-for-attachments", course?.id],
    queryFn: () => base44.entities.TrainingModule.filter({ course_id: course.id }, 'order_index', 100),
    enabled: !!course?.id,
    initialData: []
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const uploaded = await Promise.all(Array.from(files).map(async (file) => ({ name: file.name, url: (await base44.integrations.Core.UploadFile({ file })).file_url })));
      const urls = uploaded.map((item) => item.url);
      const names = uploaded.map((item) => item.name);

      if (selectedModuleId === 'course') {
        await base44.entities.TrainingCourse.update(course.id, {
          attachment_urls: [...(course.attachment_urls || []), ...urls],
          attachment_names: [...(course.attachment_names || []), ...names],
        });
      } else {
        const module = modules.find((item) => item.id === selectedModuleId);
        await base44.entities.TrainingModule.update(selectedModuleId, {
          attachment_urls: [...(module?.attachment_urls || []), ...urls],
          attachment_names: [...(module?.attachment_names || []), ...names],
        });
      }
    },
    onSuccess: () => {
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ["in-service-courses"] });
      queryClient.invalidateQueries({ queryKey: ["annual-courses"] });
      queryClient.invalidateQueries({ queryKey: ["training-modules-for-attachments", course?.id] });
      toast.success("Attachments uploaded.");
    },
    onError: () => {
      toast.error("Couldn't upload the attachments. Please try again.");
    }
  });

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Lesson attachments</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Attach to</Label>
          <Select value={selectedModuleId} onValueChange={setSelectedModuleId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="course">Course overview</SelectItem>
              {modules.map((module) => <SelectItem key={module.id} value={module.id}>{module.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Upload PDFs, regulatory docs, or images</Label>
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            // accept is only a UI hint; validate each file's type + size.
            const opts = {
              maxSize: 25 * 1024 * 1024,
              allowedTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
              allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
            };
            const bad = picked.map(f => validateFileUpload(f, opts)).find(r => !r.valid);
            if (bad) { toast.error(bad.error); e.target.value = ''; setFiles([]); return; }
            setFiles(e.target.files || []);
          }} className="block mt-2 w-full text-sm" />
        </div>
        <Button className="w-full" disabled={uploadMutation.isPending || !files.length} onClick={() => uploadMutation.mutate()}>
          <Upload className="w-4 h-4 mr-2" />
          {uploadMutation.isPending ? "Uploading..." : "Attach Files"}
        </Button>
      </CardContent>
    </Card>
  );
}