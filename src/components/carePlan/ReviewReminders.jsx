import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Bell, AlertCircle } from "lucide-react";
import { format, addDays, isPast, differenceInDays } from "date-fns";
import { toast } from "sonner";

export default function ReviewReminders({ carePlans = [] }) {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['carePlanReviews'],
    queryFn: () => base44.entities.CarePlanReview.list('-review_date', 100)
  });

  const completeReviewMutation = useMutation({
    mutationFn: ({ carePlanId, patientId, notes }) => {
      return base44.entities.CarePlanReview.create({
        care_plan_id: carePlanId,
        patient_id: patientId,
        review_date: new Date().toISOString().split('T')[0],
        next_review_date: addDays(new Date(), 30).toISOString().split('T')[0],
        reviewed_by: currentUser?.email,
        review_status: 'completed',
        provider_notes: notes
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['carePlanReviews'] });
      base44.entities.CarePlan.update(variables.carePlanId, {
        last_reviewed_date: new Date().toISOString().split('T')[0],
        next_review_date: addDays(new Date(), 30).toISOString().split('T')[0]
      });
      toast.success("Review completed");
    }
  });

  // Calculate which plans need review
  const plansNeedingReview = carePlans.filter(plan => {
    if (plan.status !== 'active') return false;
    
    if (!plan.next_review_date) {
      // No review date set - default to 30 days after creation
      const createdDate = new Date(plan.created_date);
      const defaultReviewDate = addDays(createdDate, 30);
      return isPast(defaultReviewDate);
    }
    
    return isPast(new Date(plan.next_review_date));
  });

  const upcomingReviews = carePlans.filter(plan => {
    if (!plan.next_review_date || plan.status !== 'active') return false;
    const daysUntil = differenceInDays(new Date(plan.next_review_date), new Date());
    return daysUntil > 0 && daysUntil <= 7;
  });

  const handleQuickReview = (plan) => {
    const notes = prompt("Enter review notes:");
    if (notes) {
      completeReviewMutation.mutate({
        carePlanId: plan.id,
        patientId: plan.patient_id,
        notes
      });
    }
  };

  if (plansNeedingReview.length === 0 && upcomingReviews.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Calendar className="w-12 h-12 text-green-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600">All care plans are up to date</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-orange-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="w-5 h-5 text-orange-600" />
          Review Reminders
          {plansNeedingReview.length > 0 && (
            <Badge className="bg-red-500">{plansNeedingReview.length} Overdue</Badge>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Overdue Reviews */}
        {plansNeedingReview.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              Overdue Reviews ({plansNeedingReview.length})
            </h4>
            {plansNeedingReview.map(plan => (
              <Card key={plan.id} className="bg-red-50 dark:bg-red-950">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{plan.problem}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Due: {plan.next_review_date ? 
                          format(new Date(plan.next_review_date), 'MMM d, yyyy') : 
                          'Not scheduled'
                        }
                      </p>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={() => handleQuickReview(plan)}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Review Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Upcoming Reviews */}
        {upcomingReviews.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-orange-600">
              Upcoming Reviews (Next 7 Days)
            </h4>
            {upcomingReviews.map(plan => {
              const daysUntil = differenceInDays(new Date(plan.next_review_date), new Date());
              return (
                <Card key={plan.id} className="bg-orange-50 dark:bg-orange-950">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{plan.problem}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          In {daysUntil} day{daysUntil !== 1 ? 's' : ''} • {format(new Date(plan.next_review_date), 'MMM d')}
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => handleQuickReview(plan)}
                      >
                        Review
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}