import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, GitBranch, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function ConditionalWorkflowBuilder({ workflow, onChange }) {
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [newBranch, setNewBranch] = useState({
    branch_id: "",
    branch_name: "",
    condition: {
      field: "",
      operator: "equals",
      value: "",
    },
    template_id_override: "",
    extract_metadata: false,
  });

  const handleAddBranch = () => {
    if (!newBranch.branch_id || !newBranch.branch_name || !newBranch.condition.field) {
      toast.error("Please fill in all required fields");
      return;
    }

    const updatedBranches = [...(workflow.conditional_branches || [])];
    updatedBranches.push(newBranch);

    onChange({
      ...workflow,
      conditional_branches: updatedBranches,
    });

    setNewBranch({
      branch_id: "",
      branch_name: "",
      condition: {
        field: "",
        operator: "equals",
        value: "",
      },
      template_id_override: "",
      extract_metadata: false,
    });
    setShowBranchForm(false);
    toast.success("Branch added");
  };

  const handleDeleteBranch = (branchId) => {
    const updatedBranches = (workflow.conditional_branches || []).filter(
      (b) => b.branch_id !== branchId
    );
    onChange({
      ...workflow,
      conditional_branches: updatedBranches,
    });
    toast.success("Branch deleted");
  };

  const toggleAIEnrichment = () => {
    onChange({
      ...workflow,
      ai_enrichment: {
        ...workflow.ai_enrichment,
        enabled: !workflow.ai_enrichment?.enabled,
      },
    });
  };

  const handleAISettingChange = (setting, value) => {
    onChange({
      ...workflow,
      ai_enrichment: {
        ...workflow.ai_enrichment,
        [setting]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Conditional Branches Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Conditional Branches
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Define branching paths that execute based on data conditions
          </p>

          {!showBranchForm ? (
            <Button
              onClick={() => setShowBranchForm(true)}
              variant="outline"
              className="w-full gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Branch
            </Button>
          ) : (
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Branch ID *
                </label>
                <Input
                  value={newBranch.branch_id}
                  onChange={(e) =>
                    setNewBranch({ ...newBranch, branch_id: e.target.value })
                  }
                  placeholder="e.g., high_risk_branch"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Branch Name *
                </label>
                <Input
                  value={newBranch.branch_name}
                  onChange={(e) =>
                    setNewBranch({ ...newBranch, branch_name: e.target.value })
                  }
                  placeholder="e.g., High Risk Patients"
                />
              </div>

              <div className="space-y-3 p-3 bg-white rounded border">
                <p className="text-sm font-medium">Condition *</p>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Field to evaluate
                  </label>
                  <Input
                    value={newBranch.condition.field}
                    onChange={(e) =>
                      setNewBranch({
                        ...newBranch,
                        condition: {
                          ...newBranch.condition,
                          field: e.target.value,
                        },
                      })
                    }
                    placeholder="e.g., patient.risk_score"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Operator
                  </label>
                  <Select
                    value={newBranch.condition.operator}
                    onValueChange={(value) =>
                      setNewBranch({
                        ...newBranch,
                        condition: {
                          ...newBranch.condition,
                          operator: value,
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="not_equals">Not Equals</SelectItem>
                      <SelectItem value="greater_than">Greater Than</SelectItem>
                      <SelectItem value="less_than">Less Than</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="matches_regex">Matches Regex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Value
                  </label>
                  <Input
                    value={newBranch.condition.value}
                    onChange={(e) =>
                      setNewBranch({
                        ...newBranch,
                        condition: {
                          ...newBranch.condition,
                          value: e.target.value,
                        },
                      })
                    }
                    placeholder="e.g., high"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={newBranch.extract_metadata}
                  onChange={(e) =>
                    setNewBranch({
                      ...newBranch,
                      extract_metadata: e.target.checked,
                    })
                  }
                />
                <span className="text-sm">Extract AI metadata for this branch</span>
              </label>

              <div className="flex gap-2">
                <Button
                  onClick={handleAddBranch}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  Add Branch
                </Button>
                <Button
                  onClick={() => setShowBranchForm(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Branches List */}
          {workflow.conditional_branches && workflow.conditional_branches.length > 0 && (
            <div className="space-y-2">
              {workflow.conditional_branches.map((branch) => (
                <div
                  key={branch.branch_id}
                  className="p-3 bg-gray-50 rounded border flex items-start justify-between"
                >
                  <div className="flex-1">
                    <p className="font-medium text-sm">{branch.branch_name}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      If <code className="bg-white px-1 rounded">{branch.condition.field}</code>{" "}
                      <code className="bg-white px-1 rounded">{branch.condition.operator}</code>{" "}
                      <code className="bg-white px-1 rounded">{branch.condition.value}</code>
                    </p>
                    {branch.extract_metadata && (
                      <Badge className="mt-2 bg-purple-100 text-purple-800">
                        AI Metadata
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteBranch(branch.branch_id)}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Enrichment Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            AI Document Enrichment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={workflow.ai_enrichment?.enabled || false}
              onChange={toggleAIEnrichment}
              className="w-4 h-4"
            />
            <div>
              <p className="font-medium text-sm">Enable AI Enrichment</p>
              <p className="text-xs text-gray-600">
                Automatically summarize documents and extract keywords
              </p>
            </div>
          </label>

          {workflow.ai_enrichment?.enabled && (
            <div className="space-y-3 p-4 bg-gray-50 rounded">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={workflow.ai_enrichment?.extract_summary || false}
                  onChange={(e) =>
                    handleAISettingChange("extract_summary", e.target.checked)
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm">Generate document summary</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={workflow.ai_enrichment?.extract_keywords || false}
                  onChange={(e) =>
                    handleAISettingChange("extract_keywords", e.target.checked)
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm">Extract keywords</span>
              </label>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Max Summary Length (characters)
                </label>
                <Input
                  type="number"
                  min="100"
                  max="1000"
                  value={workflow.ai_enrichment?.max_summary_length || 300}
                  onChange={(e) =>
                    handleAISettingChange("max_summary_length", parseInt(e.target.value))
                  }
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}