import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, MessageSquare, TrendingUp, CheckCircle2, Eye } from 'lucide-react';
import { toast } from 'sonner';

export default function TrainingFeedbackManager() {
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [filterStatus, setFilterStatus] = useState('new');
  const [filterType, setFilterType] = useState('all');
  const [adminNotes, setAdminNotes] = useState('');

  const { data: feedbackList, isLoading, refetch } = useQuery({
    queryKey: ['trainingFeedback'],
    queryFn: () => base44.entities.TrainingFeedback.list('-created_date', 100)
  });

  const filteredFeedback = feedbackList?.filter(fb => {
    const statusMatch = filterStatus === 'all' || fb.status === filterStatus;
    const typeMatch = filterType === 'all' || fb.feedback_type === filterType;
    return statusMatch && typeMatch;
  }) || [];

  const handleStatusChange = async (feedbackId, newStatus) => {
    try {
      const feedback = feedbackList.find(f => f.id === feedbackId);
      await base44.entities.TrainingFeedback.update(feedbackId, {
        status: newStatus,
        reviewed_by: (await base44.auth.me()).email,
        reviewed_at: new Date().toISOString(),
        admin_notes: adminNotes || feedback.admin_notes
      });
      toast.success('Feedback status updated');
      setAdminNotes('');
      setSelectedFeedback(null);
      refetch();
    } catch (error) {
      console.error('Error updating feedback:', error);
      toast.error('Failed to update feedback');
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'module_rating':
        return <TrendingUp size={16} />;
      case 'content_issue':
        return <AlertCircle size={16} />;
      case 'general_feedback':
        return <MessageSquare size={16} />;
      default:
        return <MessageSquare size={16} />;
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'module_rating':
        return 'Module Rating';
      case 'content_issue':
        return 'Content Issue';
      case 'general_feedback':
        return 'General Feedback';
      default:
        return type;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'new':
        return 'bg-blue-100 text-blue-800';
      case 'reviewed':
        return 'bg-yellow-100 text-yellow-800';
      case 'addressed':
        return 'bg-green-100 text-green-800';
      case 'dismissed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const stats = {
    total: feedbackList?.length || 0,
    new: feedbackList?.filter(f => f.status === 'new').length || 0,
    issues: feedbackList?.filter(f => f.feedback_type === 'content_issue').length || 0,
    avgRating: feedbackList?.length > 0
      ? (feedbackList.filter(f => f.rating).reduce((sum, f) => sum + f.rating, 0) / feedbackList.filter(f => f.rating).length).toFixed(1)
      : 0
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Total Feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">New Feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Issues Reported</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{stats.issues}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Avg Module Rating</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.avgRating}★</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and List */}
      <Card>
        <CardHeader>
          <CardTitle>Feedback Management</CardTitle>
          <CardDescription>Review and manage user feedback across the platform</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="list" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="list">Feedback List</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="space-y-4">
              <div className="flex gap-4 mb-4">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="addressed">Addressed</SelectItem>
                    <SelectItem value="dismissed">Dismissed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Filter by type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="module_rating">Module Ratings</SelectItem>
                    <SelectItem value="content_issue">Issues</SelectItem>
                    <SelectItem value="general_feedback">General Feedback</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading feedback...</div>
              ) : filteredFeedback.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No feedback found</div>
              ) : (
                <div className="space-y-3">
                  {filteredFeedback.map((feedback) => (
                    <Card
                      key={feedback.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setSelectedFeedback(feedback)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              {getTypeIcon(feedback.feedback_type)}
                              <Badge variant="outline">{getTypeLabel(feedback.feedback_type)}</Badge>
                              <Badge className={getStatusColor(feedback.status)}>
                                {feedback.status.charAt(0).toUpperCase() + feedback.status.slice(1)}
                              </Badge>
                              {feedback.rating && (
                                <span className="text-yellow-500 font-semibold">★ {feedback.rating}/5</span>
                              )}
                            </div>
                            <p className="font-semibold">{feedback.module_title || 'General Feedback'}</p>
                            <p className="text-sm text-gray-600 mt-1">
                              {feedback.feedback_text?.substring(0, 100) || 
                               feedback.issue_description?.substring(0, 100) || 
                               'No content provided'}...
                            </p>
                            <p className="text-xs text-gray-500 mt-2">
                              By {feedback.user_name} ({feedback.user_email}) • {new Date(feedback.created_date).toLocaleDateString()}
                            </p>
                          </div>
                          <Eye size={18} className="text-gray-400 flex-shrink-0 ml-4" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="details" className="space-y-4">
              {selectedFeedback ? (
                <div className="space-y-4">
                  <div className="border-b pb-4">
                    <h3 className="font-semibold text-lg mb-2">{getTypeLabel(selectedFeedback.feedback_type)}</h3>
                    {selectedFeedback.module_title && (
                      <p className="text-sm text-gray-600">Module: <strong>{selectedFeedback.module_title}</strong></p>
                    )}
                    <p className="text-sm text-gray-600 mt-1">
                      From: <strong>{selectedFeedback.user_name}</strong> ({selectedFeedback.user_email})
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(selectedFeedback.created_date).toLocaleString()}
                    </p>
                  </div>

                  {/* Ratings Display */}
                  {selectedFeedback.feedback_type === 'module_rating' && (
                    <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                      {selectedFeedback.rating && (
                        <div>
                          <p className="text-sm text-gray-600">Overall Rating</p>
                          <p className="text-xl font-bold text-yellow-500">★ {selectedFeedback.rating}/5</p>
                        </div>
                      )}
                      {selectedFeedback.effectiveness_rating && (
                        <div>
                          <p className="text-sm text-gray-600">Effectiveness</p>
                          <p className="text-xl font-bold text-yellow-500">★ {selectedFeedback.effectiveness_rating}/5</p>
                        </div>
                      )}
                      {selectedFeedback.relevance_rating && (
                        <div>
                          <p className="text-sm text-gray-600">Relevance</p>
                          <p className="text-xl font-bold text-yellow-500">★ {selectedFeedback.relevance_rating}/5</p>
                        </div>
                      )}
                      {selectedFeedback.difficulty_rating && (
                        <div>
                          <p className="text-sm text-gray-600">Difficulty</p>
                          <p className="text-sm font-semibold capitalize">{selectedFeedback.difficulty_rating.replace('_', ' ')}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Content Display */}
                  {(selectedFeedback.feedback_text || selectedFeedback.issue_description) && (
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm font-semibold mb-2">Feedback Content:</p>
                      <p className="text-sm whitespace-pre-wrap">
                        {selectedFeedback.feedback_text || selectedFeedback.issue_description}
                      </p>
                    </div>
                  )}

                  {selectedFeedback.feedback_type === 'content_issue' && selectedFeedback.issue_category && (
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm font-semibold">Issue Type: <span className="capitalize">{selectedFeedback.issue_category.replace('_', ' ')}</span></p>
                    </div>
                  )}

                  {/* Admin Notes Section */}
                  <div className="space-y-3 border-t pt-4">
                    <div>
                      <label className="text-sm font-semibold">Admin Notes</label>
                      <Textarea
                        placeholder="Add notes about this feedback..."
                        value={adminNotes || selectedFeedback.admin_notes || ''}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        className="mt-2 min-h-20"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleStatusChange(selectedFeedback.id, 'reviewed')}
                        variant="outline"
                        className="flex-1"
                      >
                        Mark as Reviewed
                      </Button>
                      <Button
                        onClick={() => handleStatusChange(selectedFeedback.id, 'addressed')}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle2 size={16} className="mr-2" />
                        Mark as Addressed
                      </Button>
                      <Button
                        onClick={() => handleStatusChange(selectedFeedback.id, 'dismissed')}
                        variant="outline"
                        className="flex-1"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <MessageSquare size={32} className="mx-auto mb-2 opacity-50" />
                  <p>Select a feedback item to view details</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}