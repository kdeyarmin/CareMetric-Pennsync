import { useEffect, useMemo } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function IncidentPhotoCapture({ files, onFilesChange }) {
  const previews = useMemo(() => files.map(file => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => {
    return () => previews.forEach(preview => URL.revokeObjectURL(preview.url));
  }, [previews]);

  const appendFiles = (incomingFiles) => {
    const nextFiles = Array.from(incomingFiles || []);
    if (!nextFiles.length) return;
    onFilesChange([...files, ...nextFiles].slice(0, 6));
  };

  const removeFile = (index) => {
    onFilesChange(files.filter((_, fileIndex) => fileIndex !== index));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              appendFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="rounded-xl border-2 border-dashed border-red-200 bg-red-50 p-4 text-center min-h-[92px] flex flex-col items-center justify-center">
            <Camera className="w-6 h-6 text-red-600 mb-2" />
            <p className="text-sm font-medium text-red-900">Take photo</p>
            <p className="text-xs text-red-700">Use phone camera for wounds or safety scenes</p>
          </div>
        </label>

        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              appendFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 p-4 text-center min-h-[92px] flex flex-col items-center justify-center">
            <ImagePlus className="w-6 h-6 text-blue-600 mb-2" />
            <p className="text-sm font-medium text-blue-900">Upload from phone</p>
            <p className="text-xs text-blue-700">Add existing photos if already captured</p>
          </div>
        </label>
      </div>

      {previews.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {previews.map((preview, index) => (
            <div key={`${preview.file.name}-${index}`} className="relative rounded-xl overflow-hidden border bg-white">
              <img src={preview.url} alt={preview.file.name} className="h-28 w-full object-cover" />
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="absolute top-2 right-2 h-7 w-7"
                onClick={() => removeFile(index)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}