import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Star, ThumbsUp, AlertCircle, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

export default function TrainingFeedbackForm({ moduleId, moduleTitle, feedbackType = 'module_rating', onSuccess }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    feedback_type: feedbackType,
    training_module_id: moduleId,
    module_title: moduleTitle,
    rating: 0,
    effectiveness_rating: 0,
    relevance_rating: 0,
    difficulty_rating: 'just_right',
    issue_category: 'other',
    issue_description: '',
    feedback_text: '',
    would_recommend: false
  });

  const [currentUser, setCurrentUser] = useState(null);

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await base44.auth.me();
        setCurrentUser(user);
      } catch (error) {
        console.error('Error fetching user:', error);
      }
    };
    fetchUser();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!currentUser) {
      toast.error('Please log in to submit feedback');
      return;
    }

    setIsSubmitting(true);
    try {
      await base44.entities.TrainingFeedback.create({
        ...formData,
        user_email: currentUser.email,
        user_name: currentUser.full_name
      });
      
      toast.success('Thank you! Your feedback has been submitted.');
      setIsOpen(false);
      setFormData({
        feedback_type: feedbackType,
        training_module_id: moduleId,
        module_title: moduleTitle,
        rating: 0,
        effectiveness_rating: 0,
        relevance_rating: 0,
        difficulty_rating: 'just_right',
        issue_category: 'other',
        issue_description: '',
        feedback_text: '',
        would_recommend: false
      });
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStars = (value, onChange) => (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          className="transition-transform hover:scale-110"
        >
          <Star
            size={24}
            className={value >= star ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}
          />
        </button>
      ))}
    </div>
  );

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <MessageSquare size={16} />
        Share Feedback
      </Button>
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Share Your Feedback</CardTitle>
        <CardDescription>Help us improve by sharing your thoughts</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Feedback Type Selection */}
          <div>
            <Label className="text-base font-semibold mb-3 block">What type of feedback?</Label>
            <RadioGroup value={formData.feedback_type} onValueChange={(value) => setFormData({ ...formData, feedback_type: value })}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="module_rating" id="rating" />
                <Label htmlFor="rating" className="cursor-pointer">Rate Training Module</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="content_issue" id="issue" />
                <Label htmlFor="issue" className="cursor-pointer">Report Content Issue</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="general_feedback" id="general" />
                <Label htmlFor="general" className="cursor-pointer">General Platform Feedback</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Module Rating Section */}
          {formData.feedback_type === 'module_rating' && (
            <div className="space-y-4">
              {moduleTitle && (
                <p className="text-sm text-gray-600">Module: <strong>{moduleTitle}</strong></p>
              )}
              
              <div>
                <Label className="text-sm font-semibold block mb-2">Overall Rating</Label>
                {renderStars(formData.rating, (value) => setFormData({ ...formData, rating: value }))}
              </div>

              <div>
                <Label className="text-sm font-semibold block mb-2">Effectiveness</Label>
                {renderStars(formData.effectiveness_rating, (value) => setFormData({ ...formData, effectiveness_rating: value }))}
              </div>

              <div>
                <Label className="text-sm font-semibold block mb-2">Relevance to Your Work</Label>
                {renderStars(formData.relevance_rating, (value) => setFormData({ ...formData, relevance_rating: value }))}
              </div>

              <div>
                <Label htmlFor="difficulty" className="text-sm font-semibold block mb-2">Difficulty Level</Label>
                <Select value={formData.difficulty_rating} onValueChange={(value) => setFormData({ ...formData, difficulty_rating: value })}>
                  <SelectTrigger id="difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="too_easy">Too Easy</SelectItem>
                    <SelectItem value="just_right">Just Right</SelectItem>
                    <SelectItem value="too_hard">Too Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="recommend"
                  checked={formData.would_recommend}
                  onChange={(e) => setFormData({ ...formData, would_recommend: e.target.checked })}
                  className="h-4 w-4"
                />
                <Label htmlFor="recommend" className="cursor-pointer">I would recommend this module to others</Label>
              </div>

              <Textarea
                placeholder="Additional comments about the module..."
                value={formData.feedback_text}
                onChange={(e) => setFormData({ ...formData, feedback_text: e.target.value })}
                className="min-h-24"
              />
            </div>
          )}

          {/* Content Issue Section */}
          {formData.feedback_type === 'content_issue' && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="category" className="text-sm font-semibold block mb-2">Issue Type</Label>
                <Select value={formData.issue_category} onValueChange={(value) => setFormData({ ...formData, issue_category: value })}>
                  <SelectTrigger id="category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technical">Technical Issue</SelectItem>
                    <SelectItem value="content_accuracy">Content Accuracy</SelectItem>
                    <SelectItem value="clarity">Clarity/Understanding</SelectItem>
                    <SelectItem value="outdated">Outdated Content</SelectItem>
                    <SelectItem value="broken_link">Broken Link</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                placeholder="Please describe the issue in detail..."
                value={formData.issue_description}
                onChange={(e) => setFormData({ ...formData, issue_description: e.target.value })}
                className="min-h-32"
                required
              />
            </div>
          )}

          {/* General Feedback Section */}
          {formData.feedback_type === 'general_feedback' && (
            <Textarea
              placeholder="Share your thoughts about the platform, features you'd like to see, or anything else you'd like us to know..."
              value={formData.feedback_text}
              onChange={(e) => setFormData({ ...formData, feedback_text: e.target.value })}
              className="min-h-32"
              required
            />
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}