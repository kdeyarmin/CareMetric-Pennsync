import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Zap, Plus } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function AIDiscussionTracker({ visitId, transcription, isActive }) {
  const [keyPoints, setKeyPoints] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isActive && transcription && transcription.length > 100) {
      analyzeDiscussion();
    }
  }, [transcription, isActive]);

  const analyzeDiscussion = async () => {
    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this telehealth call transcript and extract:
1. Key discussion points (main topics covered)
2. Action items (follow-up tasks, prescriptions, appointments)

Transcription:
${transcription}

Format as JSON with "key_points" and "action_items" arrays.`,
        response_json_schema: {
          type: 'object',
          properties: {
            key_points: {
              type: 'array',
              items: { type: 'string' }
            },
            action_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item: { type: 'string' },
                  priority: { type: 'string', enum: ['high', 'medium', 'low'] }
                }
              }
            }
          }
        }
      });

      setKeyPoints(result.key_points || []);
      setActionItems(result.action_items || []);
    } catch (error) {
      console.error('Discussion analysis error:', error);
    }
    setLoading(false);
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Key Discussion Points
            {loading && <Zap className="w-3 h-3 text-blue-600 animate-pulse" />}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {keyPoints.length > 0 ? (
              keyPoints.map((point, idx) => (
                <div key={idx} className="flex gap-2 items-start text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 flex-shrink-0" />
                  <p className="text-gray-700">{point}</p>
                </div>
              ))
            ) : (
              <p className="text-gray-400 text-sm">Analyzing conversation...</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Action Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {actionItems.length > 0 ? (
              actionItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start text-sm">
                  <Badge variant="outline" className={
                    item.priority === 'high' ? 'bg-red-100 text-red-800' :
                    item.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }>
                    {item.priority}
                  </Badge>
                  <p className="text-gray-700 flex-1">{item.item}</p>
                </div>
              ))
            ) : (
              <p className="text-gray-400 text-sm">No action items identified yet</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}