import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BookOpen, Plus, ExternalLink } from "lucide-react";
import { retrieveRelevantGuidelines } from "../smartNote/GuidelineContextRetriever";

export default function InlineGuidelineSuggester({
  selectedText,
  cursorPosition,
  diagnosis,
  visitType,
  onInsertGuideline
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [relevantGuidelines, setRelevantGuidelines] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadContextualGuidelines = useCallback(async () => {
    setIsLoading(true);
    try {
      const guidelines = await retrieveRelevantGuidelines({
        diagnosis,
        visitType,
        noteContent: selectedText,
        maxGuidelines: 3
      });
      setRelevantGuidelines(guidelines);
      if (guidelines.length > 0) {
        setIsOpen(true);
      }
    } catch (error) {
      console.error('Error loading guidelines:', error);
    }
    setIsLoading(false);
  }, [diagnosis, visitType, selectedText]);

  useEffect(() => {
    if (selectedText && selectedText.length > 10) {
      loadContextualGuidelines();
    }
  }, [selectedText, loadContextualGuidelines]);

  if (!selectedText || selectedText.length < 10) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="absolute z-10 bg-blue-100 hover:bg-blue-200 border border-blue-300 text-xs"
          style={{
            top: cursorPosition?.y || 0,
            left: cursorPosition?.x || 0
          }}
        >
          <BookOpen className="w-3 h-3 mr-1" />
          Guidelines
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700 mb-2">
            Relevant Guidelines:
          </p>
          {relevantGuidelines.map((guideline, idx) => (
            <Card key={idx} className="border-blue-200">
              <CardContent className="p-2">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-medium text-slate-900 flex-1">
                    {guideline.title}
                  </p>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {guideline.regulatory_citation}
                  </Badge>
                </div>
                <p className="text-xs text-slate-600 mb-2 line-clamp-2">
                  {guideline.summary}
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs flex-1"
                    onClick={() => {
                      onInsertGuideline?.(`\n\n[Per ${guideline.regulatory_citation}]: ${guideline.summary}`);
                      setIsOpen(false);
                    }}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Insert
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => window.open(guideline.url, '_blank')}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {relevantGuidelines.length === 0 && !isLoading && (
            <p className="text-xs text-slate-500 text-center py-2">
              No specific guidelines found for selected text
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}