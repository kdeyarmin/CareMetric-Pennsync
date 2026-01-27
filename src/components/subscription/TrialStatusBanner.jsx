import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TrialStatusBanner({ subscription }) {
  if (!subscription || subscription.status !== 'trialing') {
    return null;
  }

  const trialEndDate = subscription.trial_end.includes('T') 
    ? new Date(subscription.trial_end) 
    : new Date(subscription.trial_end * 1000);
  const daysRemaining = differenceInDays(trialEndDate, new Date());
  const isEndingSoon = daysRemaining <= 3;

  return (
    <Card className={`border-2 ${isEndingSoon ? 'border-orange-300 bg-orange-50' : 'border-blue-300 bg-blue-50'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isEndingSoon ? 'bg-orange-100' : 'bg-blue-100'}`}>
            {isEndingSoon ? (
              <AlertCircle className="w-6 h-6 text-orange-600" />
            ) : (
              <Clock className="w-6 h-6 text-blue-600" />
            )}
          </div>
          
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900">
                {isEndingSoon ? '⚠️ Trial Ending Soon' : '✨ Free Trial Active'}
              </h3>
              <Badge variant={isEndingSoon ? "destructive" : "default"}>
                {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
              </Badge>
            </div>
            
            <p className="text-sm text-gray-700 mb-2">
              Your 14-day free trial ends on <strong>{format(trialEndDate, 'MMMM d, yyyy')}</strong>.
              {isEndingSoon ? (
                <span className="text-orange-700 font-medium"> You'll be charged soon unless you cancel.</span>
              ) : (
                <span> After that, you'll be automatically charged for your selected plan.</span>
              )}
            </p>
            
            <div className="flex gap-2 flex-wrap">
              <Link to={createPageUrl("Billing")}>
                <Button size="sm" variant={isEndingSoon ? "default" : "outline"}>
                  Manage Subscription
                </Button>
              </Link>
              
              {isEndingSoon && (
                <p className="text-xs text-gray-600 flex items-center">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Cancel anytime before {format(trialEndDate, 'MMM d')} to avoid charges
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}