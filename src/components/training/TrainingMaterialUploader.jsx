import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileText, Video, Loader2, Plus, X } from "lucide-react";

export default function TrainingMaterialUploader({ onComplete }) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [module, setModule] = useState({
    title: "",
    description: "",
    category: "clinical",
    module_type: "ongoing",
    content_type: "document",
    duration_minutes: 30,
    is_required: false,
    passing_score: 80,
    quiz_questions: []
  });
  const [newQuestion, setNewQuestion] = useState({
    question: "",
    options: ["", "", "", ""],
    correct_answer: 0,
    explanation: ""
  });

  const createModuleMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.TrainingModule.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trainingModules'] });
      toast.success('Training module created');
      onComplete && onComplete();
    }
  });

  const handleFileUpload = async (file, type) => {
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      if (type === 'video') {
        setModule({ ...module, content: { ...module.content, video_url: file_url } });
      } else {
        setModule({ ...module, content: { ...module.content, document_url: file_url } });
      }
      toast.success('File uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const addQuestion = () => {
    if (!newQuestion.question) return;
    
    setModule({
      ...module,
      quiz_questions: [...(module.quiz_questions || []), newQuestion]
    });
    setNewQuestion({
      question: "",
      options: ["", "", "", ""],
      correct_answer: 0,
      explanation: ""
    });
  };

  const removeQuestion = (index) => {
    setModule({
      ...module,
      quiz_questions: module.quiz_questions.filter((_, i) => i !== index)
    });
  };

  const handleSubmit = () => {
    if (!module.title) {
      toast.error('Please enter a title');
      return;
    }
    
    createModuleMutation.mutate({
      ...module,
      content: {
        ...module.content,
        quiz_questions: module.quiz_questions
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Training Module</CardTitle>
          <CardDescription>Upload training materials and create quizzes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={module.title}
                onChange={(e) => setModule({ ...module, title: e.target.value })}
                placeholder="HIPAA Compliance Training"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={module.category} onValueChange={(v) => setModule({ ...module, category: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinical">Clinical</SelectItem>
                  <SelectItem value="documentation">Documentation</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="technology">Technology</SelectItem>
                  <SelectItem value="specialty">Specialty</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Description</Label>
            <Textarea
              value={module.description}
              onChange={(e) => setModule({ ...module, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Content Type</Label>
              <Select value={module.content_type} onValueChange={(v) => setModule({ ...module, content_type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="quiz">Quiz Only</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                value={module.duration_minutes}
                onChange={(e) => setModule({ ...module, duration_minutes: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label>Passing Score (%)</Label>
              <Input
                type="number"
                value={module.passing_score}
                onChange={(e) => setModule({ ...module, passing_score: parseInt(e.target.value) })}
              />
            </div>
          </div>

          {/* File Uploads */}
          {(module.content_type === 'video' || module.content_type === 'mixed') && (
            <div>
              <Label>Upload Video</Label>
              <Input
                type="file"
                accept="video/*"
                onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0], 'video')}
                disabled={uploading}
              />
            </div>
          )}

          {(module.content_type === 'document' || module.content_type === 'mixed') && (
            <div>
              <Label>Upload Document</Label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx"
                onChange={(e) => e.target.files[0] && handleFileUpload(e.target.files[0], 'document')}
                disabled={uploading}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quiz Builder */}
      <Card>
        <CardHeader>
          <CardTitle>Quiz Questions</CardTitle>
          <CardDescription>Add quiz questions to assess understanding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {module.quiz_questions?.map((q, idx) => (
            <div key={idx} className="p-3 bg-slate-50 rounded border">
              <div className="flex justify-between items-start mb-2">
                <p className="font-medium text-sm">{idx + 1}. {q.question}</p>
                <Button size="sm" variant="ghost" onClick={() => removeQuestion(idx)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                {q.options.map((opt, i) => (
                  <div key={i} className={i === q.correct_answer ? "text-green-700 font-medium" : ""}>
                    {String.fromCharCode(65 + i)}. {opt}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="space-y-3 p-4 border-2 border-dashed rounded">
            <div>
              <Label>Question</Label>
              <Input
                value={newQuestion.question}
                onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                placeholder="What is the primary purpose of HIPAA?"
              />
            </div>
            {newQuestion.options.map((opt, idx) => (
              <div key={idx}>
                <Label>Option {String.fromCharCode(65 + idx)}</Label>
                <Input
                  value={opt}
                  onChange={(e) => {
                    const newOpts = [...newQuestion.options];
                    newOpts[idx] = e.target.value;
                    setNewQuestion({ ...newQuestion, options: newOpts });
                  }}
                />
              </div>
            ))}
            <div>
              <Label>Correct Answer</Label>
              <Select 
                value={newQuestion.correct_answer.toString()} 
                onValueChange={(v) => setNewQuestion({ ...newQuestion, correct_answer: parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">A</SelectItem>
                  <SelectItem value="1">B</SelectItem>
                  <SelectItem value="2">C</SelectItem>
                  <SelectItem value="3">D</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={addQuestion} size="sm" variant="outline" className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Question
            </Button>
          </div>

          <Button 
            onClick={handleSubmit} 
            disabled={createModuleMutation.isPending || uploading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {createModuleMutation.isPending || uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {uploading ? 'Uploading...' : 'Creating...'}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Create Training Module
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}