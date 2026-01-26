import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

export default function MaterialRatingWidget({ materialId, materialTitle, onRatingSubmitted }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmitRating = async () => {
    if (rating === 0) {
      toast.error('Please select a rating');
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await base44.auth.me();
      
      await base44.entities.MaterialInteraction.create({
        material_id: materialId,
        user_email: user.email,
        interaction_type: 'rating',
        rating,
        rating_comment: comment,
        interaction_date: new Date().toISOString(),
      });

      toast.success('Thank you for rating this material!');
      setRating(0);
      setComment('');
      setShowForm(false);
      onRatingSubmitted?.();
    } catch (error) {
      toast.error('Failed to submit rating');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {!showForm ? (
        <Button
          variant="outline"
          onClick={() => setShowForm(true)}
          className="w-full text-sm"
        >
          ⭐ Rate this material
        </Button>
      ) : (
        <div className="border rounded-lg p-4 space-y-3 bg-slate-50">
          <div>
            <p className="text-sm font-medium mb-2">How helpful was this material?</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    size={24}
                    className={`${
                      star <= (hoverRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-slate-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <Textarea
            placeholder="Share any feedback (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-20 text-sm"
          />

          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setRating(0);
                setComment('');
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitRating}
              disabled={isSubmitting || rating === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Rating'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}