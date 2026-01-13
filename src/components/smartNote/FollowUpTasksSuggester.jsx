import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ListTodo } from "lucide-react";
import { toast } from "sonner";

export default function FollowUpTasksSuggester({ analysisResults, extractedData }) {
  const [tasks, setTasks] = useState(null);
  const [generating, setGenerating] = useState(false);

  const generateTasks = async () => {
    if (!analysisResults) {
      toast.error("Run analysis tools first");
      return;
    }

    setGenerating(true);
    try {
      const result = await base44.functions.invoke('generateFollowUpTasks', {
        analysisResults,
        diagnoses: extractedData?.diagnoses,
        vitals: extractedData?.vitals,
      });

      setTasks(result.tasks);
      toast.success("Follow-up tasks generated");
    } catch (error) {
      toast.error("Failed to generate tasks");
      console.error(error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className="border-green-200 bg-green-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="w-5 h-5 text-green-600" />
          Follow-Up Tasks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={generateTasks}
          disabled={generating || !analysisResults}
          className="w-full bg-green-600 hover:bg-green-700"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Tasks...
            </>
          ) : (
            "Generate Follow-Up Tasks"
          )}
        </Button>

        {tasks && (
          <div className="bg-white p-4 rounded border text-sm whitespace-pre-wrap">
            {tasks}
          </div>
        )}
      </CardContent>
    </Card>
  );
}