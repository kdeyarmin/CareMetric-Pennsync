import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCog, Sparkles, RefreshCw, CheckCircle2, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function AIRoleSuggestions({ users, userActivity }) {
  const [suggestions, setSuggestions] = useState([]);
  const queryClient = useQueryClient();

  const generateSuggestionsMutation = useMutation({
    mutationFn: async () => {
      // Prepare user activity summary
      const activitySummary = users.slice(0, 20).map(user => {
        const activities = userActivity.filter(a => a.user_email === user.email);
        return {
          email: user.email,
          name: user.full_name,
          current_role: user.role,
          activity_count: activities.length,
          actions: activities.slice(0, 10).map(a => a.action)
        };
      });

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze user activity patterns and suggest role changes if appropriate:

${JSON.stringify(activitySummary, null, 2)}

For each user who might benefit from a role change:
- Consider their activity patterns and responsibilities
- Determine if they should be promoted to admin or remain as user
- Provide clear reasoning

Only suggest changes that make sense based on activity. Return JSON with array of suggestions.`,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  user_email: { type: "string" },
                  user_name: { type: "string" },
                  current_role: { type: "string" },
                  suggested_role: { type: "string" },
                  reason: { type: "string" },
                  confidence: { type: "string" }
                }
              }
            }
          }
        }
      });
      return response.suggestions;
    },
    onSuccess: (data) => {
      setSuggestions(data || []);
    }
  });

  const applyRoleChangeMutation = useMutation({
    mutationFn: async ({ userId, newRole, userEmail }) => {
      await base44.entities.User.update(userId, { role: newRole });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
    }
  });

  const handleApplySuggestion = (suggestion) => {
    const user = users.find(u => u.email === suggestion.user_email);
    if (user) {
      applyRoleChangeMutation.mutate({
        userId: user.id,
        newRole: suggestion.suggested_role,
        userEmail: user.email
      });
      setSuggestions(prev => prev.filter(s => s.user_email !== suggestion.user_email));
    }
  };

  const handleDismiss = (userEmail) => {
    setSuggestions(prev => prev.filter(s => s.user_email !== userEmail));
  };

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserCog className="w-5 h-5 text-indigo-600" />
            AI Role Suggestions
          </CardTitle>
          <Button
            onClick={() => generateSuggestionsMutation.mutate()}
            disabled={generateSuggestionsMutation.isPending}
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${generateSuggestionsMutation.isPending ? 'animate-spin' : ''}`} />
            {generateSuggestionsMutation.isPending ? 'Analyzing...' : 'Generate Suggestions'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {suggestions.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <Sparkles className="w-12 h-12 text-gray-300 mx-auto mb-2" />
            <p className="text-sm">AI will analyze user activity to suggest role changes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((suggestion, idx) => (
              <div key={idx} className="bg-white rounded-lg p-4 border border-indigo-200 shadow-sm">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900">{suggestion.user_name}</p>
                    <p className="text-xs text-gray-600">{suggestion.user_email}</p>
                  </div>
                  <div className="flex gap-1">
                    <Badge variant="outline">{suggestion.current_role}</Badge>
                    <span className="text-gray-400">→</span>
                    <Badge className="bg-indigo-100 text-indigo-800">{suggestion.suggested_role}</Badge>
                  </div>
                </div>
                <p className="text-sm text-gray-700 mb-2">{suggestion.reason}</p>
                <div className="flex items-center justify-between">
                  <Badge className="bg-green-100 text-green-800 text-xs">
                    Confidence: {suggestion.confidence}
                  </Badge>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDismiss(suggestion.user_email)}
                      className="h-7 text-xs"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApplySuggestion(suggestion)}
                      disabled={applyRoleChangeMutation.isPending}
                      className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}