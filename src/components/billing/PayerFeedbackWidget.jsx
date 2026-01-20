import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { Star, MessageSquare, Loader2, ThumbsUp, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function PayerFeedbackWidget({ payerId, payerName }) {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    rating: 5,
    accuracy_rating: 5,
    ease_of_billing: 5,
    category: 'accuracy',
    feedback_text: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const queryClient = useQueryClient();

  const { data: feedbacks = [], isLoading } = useQuery({
    queryKey: ['payerFeedback', payerId],
    queryFn: async () => {
      return await base44.entities.PayerFeedback.filter({ payer_id: payerId }, '-created_date');
    },
    enabled: !!payerId
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const submitMutation = useMutation({
    mutationFn: (data) => base44.entities.PayerFeedback.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['payerFeedback', payerId]);
      toast.success('Feedback submitted successfully');
      setShowForm(false);
      setFormData({
        rating: 5,
        accuracy_rating: 5,
        ease_of_billing: 5,
        category: 'accuracy',
        feedback_text: ''
      });
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await submitMutation.mutateAsync({
        payer_id: payerId,
        ...formData
      });
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const averageRating = feedbacks.length > 0
    ? (feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length).toFixed(1)
    : 0;

  const averageAccuracy = feedbacks.length > 0
    ? (feedbacks.reduce((sum, f) => sum + (f.accuracy_rating || 0), 0) / feedbacks.length).toFixed(1)
    : 0;

  const averageEase = feedbacks.length > 0
    ? (feedbacks.reduce((sum, f) => sum + (f.ease_of_billing || 0), 0) / feedbacks.length).toFixed(1)
    : 0;

  const StarRating = ({ value, onChange, readonly = false }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-5 h-5 ${
            star <= value
              ? 'fill-yellow-400 text-yellow-400'
              : 'text-gray-300'
          } ${!readonly && 'cursor-pointer'}`}
          onClick={() => !readonly && onChange?.(star)}
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Rating Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Payer Ratings & Feedback
            </span>
            {!showForm && (
              <Button size="sm" onClick={() => setShowForm(true)}>
                Leave Feedback
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Overall Rating</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold">{averageRating}</span>
                <StarRating value={Math.round(parseFloat(averageRating))} readonly />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {feedbacks.length} {feedbacks.length === 1 ? 'review' : 'reviews'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Info Accuracy</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold">{averageAccuracy}</span>
                <StarRating value={Math.round(parseFloat(averageAccuracy))} readonly />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Ease of Billing</p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold">{averageEase}</span>
                <StarRating value={Math.round(parseFloat(averageEase))} readonly />
              </div>
            </div>
          </div>

          {/* Feedback Form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <div>
                <label className="text-sm font-medium mb-2 block">Overall Rating</label>
                <StarRating
                  value={formData.rating}
                  onChange={(val) => setFormData({ ...formData, rating: val })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Information Accuracy</label>
                  <StarRating
                    value={formData.accuracy_rating}
                    onChange={(val) => setFormData({ ...formData, accuracy_rating: val })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Ease of Billing</label>
                  <StarRating
                    value={formData.ease_of_billing}
                    onChange={(val) => setFormData({ ...formData, ease_of_billing: val })}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Feedback Category</label>
                <Select
                  value={formData.category}
                  onValueChange={(val) => setFormData({ ...formData, category: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accuracy">Accuracy</SelectItem>
                    <SelectItem value="missing_info">Missing Information</SelectItem>
                    <SelectItem value="outdated_info">Outdated Information</SelectItem>
                    <SelectItem value="billing_experience">Billing Experience</SelectItem>
                    <SelectItem value="reimbursement_rate">Reimbursement Rate</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Your Feedback</label>
                <Textarea
                  value={formData.feedback_text}
                  onChange={(e) => setFormData({ ...formData, feedback_text: e.target.value })}
                  placeholder="Share your experience with this payer..."
                  rows={4}
                  required
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Feedback'
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* Feedback List */}
          {feedbacks.length > 0 && (
            <div className="space-y-3 mt-6">
              <h4 className="font-semibold text-sm">Recent Feedback</h4>
              {feedbacks.slice(0, 5).map((feedback) => (
                <div key={feedback.id} className="p-3 bg-muted rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <StarRating value={feedback.rating} readonly />
                      <Badge variant="outline" className="text-xs">
                        {feedback.category.replace('_', ' ')}
                      </Badge>
                      {feedback.is_verified && (
                        <Badge variant="default" className="text-xs">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Verified
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(feedback.created_date).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm">{feedback.feedback_text}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>Accuracy: {feedback.accuracy_rating}/5</span>
                    <span>Ease: {feedback.ease_of_billing}/5</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}