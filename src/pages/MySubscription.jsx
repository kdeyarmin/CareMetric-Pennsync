import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Calendar, 
  CreditCard, 
  Download, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  TrendingUp,
  XCircle,
  Clock,
  DollarSign,
  RefreshCw,
  AlertTriangle,
  History
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function MySubscription() {
  const [isManagingPortal, setIsManagingPortal] = useState(false);

  // Fetch current user
  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  // Fetch subscription
  const { data: subscription, isLoading: loadingSub, refetch: refetchSubscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const subs = await base44.entities.Subscription.filter({ 
        user_email: currentUser.email 
      });
      return subs[0];
    },
    enabled: !!currentUser?.email
  });

  // Fetch billing history
  const { data: billingData, isLoading: loadingBilling, refetch: refetchBilling } = useQuery({
    queryKey: ['billingHistory', currentUser?.email],
    queryFn: async () => {
      const response = await base44.functions.invoke('getCustomerBillingHistory');
      return response?.data || { invoices: [], paymentMethods: [] };
    },
    enabled: !!currentUser?.email && !!subscription
  });

  const handleManageSubscription = async () => {
    setIsManagingPortal(true);
    try {
      const response = await base44.functions.invoke('createStripePortal', {
        return_url: window.location.href
      });
      
      if (response?.data?.url) {
        window.location.href = response.data.url;
      } else {
        toast.error('Failed to open billing portal');
        setIsManagingPortal(false);
      }
    } catch (error) {
      toast.error(error.message || 'Failed to open billing portal');
      setIsManagingPortal(false);
    }
  };

  const handleRefresh = async () => {
    toast.promise(
      Promise.all([refetchSubscription(), refetchBilling()]),
      {
        loading: 'Refreshing...',
        success: 'Data refreshed',
        error: 'Failed to refresh'
      }
    );
  };

  const getStatusBadge = (status) => {
    const variants = {
      active: { color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle2, label: 'Active' },
      trialing: { color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Clock, label: 'Trial' },
      past_due: { color: 'bg-red-100 text-red-800 border-red-200', icon: AlertCircle, label: 'Past Due' },
      canceled: { color: 'bg-gray-100 text-gray-800 border-gray-200', icon: XCircle, label: 'Canceled' },
      unpaid: { color: 'bg-red-100 text-red-800 border-red-200', icon: AlertCircle, label: 'Unpaid' },
      paused: { color: 'bg-amber-100 text-amber-800 border-amber-200', icon: Clock, label: 'Paused' },
      lifetime_free: { color: 'bg-purple-100 text-purple-800 border-purple-200', icon: CheckCircle2, label: 'Lifetime Free' }
    };
    
    const variant = variants[status] || variants.active;
    const Icon = variant.icon;
    
    return (
      <Badge className={`${variant.color} border flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {variant.label}
      </Badge>
    );
  };

  const formatAmount = (amount, currency = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
  };

  if (userLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>Please log in to view your subscription</AlertDescription>
        </Alert>
      </div>
    );
  }

  const invoices = billingData?.invoices || [];
  const paymentMethods = billingData?.paymentMethods || [];
  const webhookEvents = subscription?.webhook_events || [];

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 mb-4 sm:mb-6 md:mb-8">
        <div>
          <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold">Subscription</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">Manage billing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {subscription && (
            <Button onClick={handleManageSubscription} disabled={isManagingPortal}>
              {isManagingPortal ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ExternalLink className="w-4 h-4 mr-2" />
              )}
              Manage Billing
            </Button>
          )}
        </div>
      </div>

      {loadingSub ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !subscription ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Active Subscription</h3>
            <p className="text-muted-foreground mb-6">
              Subscribe to CareMetric AI to unlock all features and start improving your documentation workflow.
            </p>
            <Button onClick={() => window.location.href = '/subscription-plans'}>
              View Plans
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 sm:space-y-4 md:space-y-6">
           {/* Alerts for subscription issues */}
           {subscription.status === 'past_due' && (
             <Alert className="border-red-200 bg-red-50 text-xs sm:text-sm">
              <AlertCircle className="h-5 w-5 text-red-600" />
              <AlertDescription className="text-red-800">
                Your payment is past due. Please update your payment method to avoid service interruption.
              </AlertDescription>
            </Alert>
          )}

          {subscription.cancel_at_period_end && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <AlertDescription className="text-amber-800">
                Your subscription will end on{' '}
                <strong>{format(new Date(subscription.current_period_end), 'MMMM d, yyyy')}</strong>.
                You can reactivate anytime before this date.
              </AlertDescription>
            </Alert>
          )}

          {subscription.status === 'trialing' && subscription.trial_end && (
            <Alert className="border-blue-200 bg-blue-50">
              <Clock className="h-5 w-5 text-blue-600" />
              <AlertDescription className="text-blue-800">
                Your trial ends on{' '}
                <strong>{format(new Date(subscription.trial_end), 'MMMM d, yyyy')}</strong>.
                Make sure your payment method is set up!
              </AlertDescription>
            </Alert>
          )}

          {/* Current Subscription Details */}
          <Card>
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base sm:text-lg md:text-xl lg:text-2xl">Current Subscription</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Your plan and billing</CardDescription>
                </div>
                {getStatusBadge(subscription.status)}
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
              {/* Plan Details */}
              <div className="grid md:grid-cols-2 gap-3 sm:gap-4 md:gap-6">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Plan Name</p>
                  <p className="text-xl font-semibold">{subscription.plan_name || 'CareMetric AI'}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="text-xl font-semibold flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-green-600" />
                    ${subscription.monthly_amount?.toFixed(2) || '0.00'}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Billing Period */}
              <div className="grid md:grid-cols-2 gap-6">
                {subscription.current_period_start && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Billing Period Start
                    </p>
                    <p className="font-medium">
                      {format(new Date(subscription.current_period_start), 'MMMM d, yyyy')}
                    </p>
                  </div>
                )}
                
                {subscription.current_period_end && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {subscription.cancel_at_period_end ? 'Expires On' : 'Next Renewal'}
                    </p>
                    <p className="font-medium">
                      {format(new Date(subscription.current_period_end), 'MMMM d, yyyy')}
                    </p>
                  </div>
                )}
              </div>

              {/* Trial Information */}
              {subscription.status === 'trialing' && subscription.trial_end && (
                <>
                  <Separator />
                  <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-4">
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">Trial Period</p>
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      Your trial ends on {format(new Date(subscription.trial_end), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </>
              )}

              {/* Last Payment Info */}
              {subscription.last_payment_date && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="text-sm font-medium text-green-900 dark:text-green-100">Last Payment</p>
                        <p className="text-sm text-green-700 dark:text-green-300">
                          {format(new Date(subscription.last_payment_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    <p className="font-semibold text-green-900 dark:text-green-100">
                      ${subscription.last_payment_amount?.toFixed(2)}
                    </p>
                  </div>
                </>
              )}

              {/* Failed Payment Warning */}
              {subscription.failed_payment_count > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    <div>
                      <p className="text-sm font-medium text-red-900 dark:text-red-100">
                        {subscription.failed_payment_count} Failed Payment{subscription.failed_payment_count > 1 ? 's' : ''}
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-300">
                        Last attempt: {format(new Date(subscription.last_failed_payment_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Payment Method */}
          <Card>
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg md:text-xl">
                    <CreditCard className="w-4 h-4 sm:w-5 sm:h-5" />
                    Payment Method
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Default method</CardDescription>
                </div>
                <Button onClick={handleManageSubscription} variant="outline" size="sm" disabled={isManagingPortal}>
                  {isManagingPortal ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Update
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6">
              {loadingBilling ? (
                <div className="flex justify-center p-4 sm:p-6">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : paymentMethods.length > 0 ? (
                <div className="space-y-2 sm:space-y-3">
                  {paymentMethods.map((pm) => (
                    <div 
                      key={pm.id} 
                      className="flex items-center gap-2 sm:gap-3 md:gap-4 p-2 sm:p-3 md:p-4 border rounded-lg bg-white dark:bg-slate-900 hover:shadow-md transition-shadow text-xs sm:text-sm"
                    >
                      <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg flex-shrink-0">
                        <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 dark:text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold break-words">
                          {pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1)} •••• {pm.card.last4}
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          Expires {pm.card.exp_month}/{pm.card.exp_year}
                        </p>
                      </div>
                      {paymentMethods[0].id === pm.id && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Default
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-6">
                  <CreditCard className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm mb-4">No payment method on file</p>
                  <Button onClick={handleManageSubscription} variant="outline" size="sm">
                    Add Payment Method
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Billing History */}
          <Card>
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg md:text-xl">
                <History className="w-4 h-4 sm:w-5 sm:h-5" />
                Billing History
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">Past invoices</CardDescription>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6">
              {loadingBilling ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : invoices.length > 0 ? (
                <div className="space-y-2 text-xs sm:text-sm">
                  {invoices.map((invoice) => (
                    <div 
                      key={invoice.id} 
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 md:gap-4 p-2 sm:p-3 md:p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold">
                            {format(new Date(invoice.created * 1000), 'MMMM d, yyyy')}
                          </p>
                          {invoice.status === 'paid' ? (
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          ) : invoice.status === 'open' ? (
                            <AlertCircle className="w-4 h-4 text-amber-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Invoice #{invoice.number || invoice.id.substring(0, 12)}
                        </p>
                        {invoice.description && (
                          <p className="text-sm text-muted-foreground mt-1">{invoice.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xl font-bold">
                            {formatAmount(invoice.amount_paid || invoice.total, invoice.currency)}
                          </p>
                          <Badge 
                            variant="outline"
                            className={
                              invoice.status === 'paid' 
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : invoice.status === 'open'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-red-50 text-red-700 border-red-200'
                            }
                          >
                            {invoice.status === 'paid' ? 'Paid' : invoice.status === 'open' ? 'Pending' : 'Failed'}
                          </Badge>
                        </div>
                        {invoice.invoice_pdf && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => window.open(invoice.invoice_pdf, '_blank')}
                            title="Download Invoice"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-6">
                  <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No billing history available yet</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity Log */}
          {webhookEvents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Recent Activity
                </CardTitle>
                <CardDescription>Subscription events and updates</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {webhookEvents.slice(-10).reverse().map((event, idx) => (
                    <div 
                      key={idx}
                      className="flex items-start gap-3 p-3 border rounded-lg bg-slate-50 dark:bg-slate-900"
                    >
                      <div className="p-2 bg-white dark:bg-slate-800 rounded-lg">
                        {event.event_type.includes('payment_succeeded') ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : event.event_type.includes('payment_failed') ? (
                          <XCircle className="w-4 h-4 text-red-600" />
                        ) : event.event_type.includes('deleted') || event.event_type.includes('canceled') ? (
                          <XCircle className="w-4 h-4 text-gray-600" />
                        ) : (
                          <Clock className="w-4 h-4 text-blue-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {event.event_type.replace(/\./g, ' ').replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(event.timestamp), 'MMM d, yyyy h:mm a')}
                        </p>
                        {event.details?.amount && (
                          <p className="text-sm font-semibold text-green-600 mt-1">
                            ${event.details.amount.toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <CardTitle className="text-base sm:text-lg md:text-xl">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6 space-y-2 sm:space-y-3">
              <Button 
                variant="outline" 
                className="w-full justify-start" 
                onClick={handleManageSubscription}
                disabled={isManagingPortal}
              >
                <CreditCard className="w-4 h-4 mr-2" />
                Update Payment Method
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start" 
                onClick={handleManageSubscription}
                disabled={isManagingPortal}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {subscription.cancel_at_period_end ? 'Reactivate Subscription' : 'Change Plan'}
              </Button>
              {!subscription.cancel_at_period_end && subscription.status === 'active' && (
                <Button 
                  variant="outline" 
                  className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={handleManageSubscription}
                  disabled={isManagingPortal}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Cancel Subscription
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}