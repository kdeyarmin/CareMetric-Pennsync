import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Download, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function MaterialViewer({ material, onClose, onAssign }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(material.content);
  };

  const handleDownload = () => {
    const blob = new Blob([material.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${material.title}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{material.title}</DialogTitle>
          <div className="flex gap-2 mt-2">
            <Badge>{material.category}</Badge>
            <Badge variant="outline">{material.reading_level}</Badge>
            {material.source === "ai_generated" && (
              <Badge variant="outline" className="bg-purple-50">AI Generated</Badge>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {material.tags && material.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {material.tags.map((tag, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="prose max-w-none">
            <ReactMarkdown>{material.content}</ReactMarkdown>
          </div>

          <div className="flex gap-2 border-t pt-4">
            <Button onClick={onAssign} className="bg-blue-600 hover:bg-blue-700">
              <UserPlus className="w-4 h-4 mr-2" />
              Assign to Patient
            </Button>
            <Button variant="outline" onClick={handleCopy}>
              <Copy className="w-4 h-4 mr-2" />
              Copy
            </Button>
            <Button variant="outline" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}