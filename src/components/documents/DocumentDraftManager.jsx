import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Save, 
  Copy, 
  Download, 
  History, 
  CheckCircle2,
  Edit2,
  Eye,
  Clock
} from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function DocumentDraftManager({ 
  generatedContent, 
  documentType, 
  patientName,
  onContentChange 
}) {
  const [versions, setVersions] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(generatedContent);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveVersion = useCallback((content, label = "Manual Edit") => {
    const newVersion = {
      content,
      label,
      timestamp: new Date().toISOString(),
      version: versions.length + 1
    };
    setVersions(prev => [...prev, newVersion]);
    setCurrentVersion(versions.length);
  }, [versions.length]);

  // Initialize first version
  useEffect(() => {
    if (generatedContent && versions.length === 0) {
      saveVersion(generatedContent, "Initial AI Generation");
    }
  }, [generatedContent, versions.length, saveVersion]);

  // Update edited content when generatedContent changes
  useEffect(() => {
    setEditedContent(generatedContent);
  }, [generatedContent]);

  const handleSaveEdit = () => {
    if (editedContent !== getCurrentContent()) {
      saveVersion(editedContent, "Manual Edit");
      onContentChange?.(editedContent);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedContent(getCurrentContent());
    setIsEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCurrentContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([getCurrentContent()], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${documentType}_${patientName}_${formatEastern(new Date(), 'yyyy-MM-dd')}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const handleRestoreVersion = (index) => {
    setCurrentVersion(index);
    setEditedContent(versions[index].content);
    onContentChange?.(versions[index].content);
    setIsEditing(false);
  };

  const getCurrentContent = () => {
    return versions[currentVersion]?.content || generatedContent;
  };

  if (!generatedContent) return null;

  return (
    <div className="space-y-4">
      {/* Version History Bar */}
      {versions.length > 1 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <History className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-900">
                Version History ({versions.length} versions)
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {versions.map((version, index) => (
                <Button
                  key={index}
                  size="sm"
                  variant={currentVersion === index ? "default" : "outline"}
                  onClick={() => handleRestoreVersion(index)}
                  className={`flex-shrink-0 gap-2 ${currentVersion === index ? 'bg-blue-600' : ''}`}
                >
                  <Clock className="w-3 h-3" />
                  <div className="text-left">
                    <div className="text-xs font-medium">v{version.version}</div>
                    <div className="text-[10px] opacity-70">{version.label}</div>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Draft/Edit Mode */}
      <Card className="border-2 border-green-300">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              {isEditing ? (
                <><Edit2 className="w-5 h-5 text-green-600" /> Editing Draft</>
              ) : (
                <><Eye className="w-5 h-5 text-green-600" /> Document Preview</>
              )}
              {currentVersion < versions.length - 1 && (
                <Badge variant="outline" className="text-xs">
                  Viewing v{versions[currentVersion]?.version}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              {!isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                  >
                    <Edit2 className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <><CheckCircle2 className="w-4 h-4 mr-1" /> Copied</>
                    ) : (
                      <><Copy className="w-4 h-4 mr-1" /> Copy</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleDownload}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {saved ? (
                      <><CheckCircle2 className="w-4 h-4 mr-1" /> Saved</>
                    ) : (
                      <><Save className="w-4 h-4 mr-1" /> Save Draft</>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <div className="space-y-3">
              <Alert className="bg-yellow-50 border-yellow-200">
                <Edit2 className="w-4 h-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800 text-sm">
                  Make your edits below. Changes will be saved as a new version.
                </AlertDescription>
              </Alert>
              <Textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
              />
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{editedContent.length} characters</span>
                <span>Use Ctrl+Z for undo</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 p-4 rounded-lg border">
              <pre className="whitespace-pre-wrap text-sm text-slate-800 font-sans">
                {getCurrentContent()}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Finalization Checklist */}
      {!isEditing && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800 text-sm">
            <strong>Ready to finalize?</strong>
            <ul className="mt-2 space-y-1 text-xs">
              <li>✓ Review content for accuracy</li>
              <li>✓ Verify patient information</li>
              <li>✓ Check for any required edits</li>
              <li>✓ Copy or download when ready</li>
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}