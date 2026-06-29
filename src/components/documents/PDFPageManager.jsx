import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import * as pdfjsLib from "pdfjs-dist";
import {
  Trash2,
  ArrowUp, 
  ArrowDown,
  Save,
  Loader2,
  FileText
} from "lucide-react";
import { toast } from "sonner";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

// Use unpkg CDN to reliably load the worker without Vite import issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export default function PDFPageManager({ pdfUrl, onSave }) {
  const [pages, setPages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [totalPages, setTotalPages] = useState(0);

  const loadPDFPages = useCallback(async () => {
    setIsLoading(true);
    try {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      const numPages = pdf.numPages;
      setTotalPages(numPages);
      
      const pageArray = Array.from({ length: numPages }, (_, i) => ({
        id: `page-${i + 1}`,
        number: i + 1,
        deleted: false
      }));
      
      setPages(pageArray);
      setIsLoading(false);
    } catch (error) {
      console.error("Error loading PDF:", error);
      toast.error("Failed to load PDF");
      setIsLoading(false);
    }
  }, [pdfUrl]);

  useEffect(() => {
    loadPDFPages();
  }, [loadPDFPages]);

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(pages);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setPages(items);
  };

  const toggleDeletePage = (pageId) => {
    setPages(pages.map(p => 
      p.id === pageId ? { ...p, deleted: !p.deleted } : p
    ));
  };

  const movePage = (index, direction) => {
    const newPages = [...pages];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (newIndex >= 0 && newIndex < pages.length) {
      [newPages[index], newPages[newIndex]] = [newPages[newIndex], newPages[index]];
      setPages(newPages);
    }
  };

  const handleSave = async () => {
    const pagesToKeep = pages
      .filter(p => !p.deleted)
      .map(p => p.number);

    if (pagesToKeep.length === 0) {
      toast.error("Cannot delete all pages");
      return;
    }

    setIsSaving(true);
    try {
      const response = await base44.functions.invoke('reorderDeletePDFPages', {
        pdf_url: pdfUrl,
        page_order: pagesToKeep
      });

      toast.success("PDF updated successfully!");
      if (onSave) {
        onSave(response.data.modified_pdf_url);
      }
    } catch (error) {
      console.error("Save error:", error);
      toast.error(`Failed to update PDF: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-slate-600">Loading PDF pages...</p>
        </CardContent>
      </Card>
    );
  }

  const activePages = pages.filter(p => !p.deleted).length;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Manage PDF Pages</span>
          <span className="text-sm font-normal text-slate-600">
            {activePages} of {totalPages} pages
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-slate-600">
          Reorder or delete pages from your PDF document
        </p>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="pages">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-2"
              >
                {pages.map((page, index) => (
                  <Draggable key={page.id} draggableId={page.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                          page.deleted 
                            ? 'bg-red-50 border-red-300 opacity-50' 
                            : snapshot.isDragging
                            ? 'bg-blue-50 border-blue-400 shadow-lg'
                            : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <FileText className={`w-5 h-5 shrink-0 ${page.deleted ? 'text-red-400' : 'text-blue-600'}`} />
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${page.deleted ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                            Page {page.number}
                          </p>
                          <p className="text-xs text-slate-500">
                            {page.deleted ? 'Marked for deletion' : 'Active'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => movePage(index, 'up')}
                            disabled={index === 0 || page.deleted}
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => movePage(index, 'down')}
                            disabled={index === pages.length - 1 || page.deleted}
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleDeletePage(page.id)}
                          >
                            <Trash2 className={`w-4 h-4 ${page.deleted ? 'text-blue-600' : 'text-red-600'}`} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        <Button
          onClick={handleSave}
          disabled={isSaving || activePages === totalPages && pages.every((p, i) => p.number === i + 1)}
          className="w-full"
          size="lg"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Saving Changes...
            </>
          ) : (
            <>
              <Save className="w-5 h-5 mr-2" />
              Save PDF
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}