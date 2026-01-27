import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Loader2, AlertTriangle, Apple } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import SubscriptionPlanSwitcher from '../components/subscription/SubscriptionPlanSwitcher';
import CustomerPortal from '../components/subscription/CustomerPortal';
import { isApplePlatform } from '../components/utils/platformDetection';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_live_51Qr3FJGbdOIAhzqIDXCO08y02eKhABH99Fm3LR5XWrSYbD25zrJ2T3dZHcF2XOGzQOC73vHNLvgVnMnXOuVqbxAF00j7xpRkDv'); 

export default function SubscriptionPlans() {
  const [loadingPriceId, setLoadingPriceId] = useState(null);
  const [isInIframe, setIsInIframe] = useState(false);
  const [isApple, setIsApple] = useState(false);
  const [processingApple, setProcessingApple] = useState(false);

  useEffect(() => {
    // Check if running in iframe
    setIsInIframe(window.self !== window.top);
    // Check if on Apple platform
    const checkPlatform = () => {
      const apple = isApplePlatform();
      setIsApple(apple);
      console.log('Subscription page - Platform:', apple ? 'Apple (App Store)' : 'Web/Android (Stripe)');
    };
    checkPlatform();
  }, []);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  const { data: subscription } = useQuery({
    queryKey: ['userSubscription', currentUser?.email],
    queryFn: async () => {
      const subs = await base44.entities.Subscription.filter({ 
        user_email: currentUser.email 
      });
      return subs[0];
    },
    enabled: !!currentUser?.email
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['subscriptionSettings'],
    queryFn: async () => {
      const result = await base44.entities.SubscriptionSettings.list();
      return result.length > 0 ? result[0] : null;
    }
  });

  const plans = [
    { 
      name: 'Monthly', 
      price: 29.99, 
      priceId: 'price_1Qr3FJGbdOIAhzqI2X5K8L9M',
      appleProductId: 'com.caremetric.monthly',
      period: '/ month', 
      popular: false,
      savings: null
    },
    { 
      name: '3 Month', 
      price: 79.99, 
      priceId: 'price_1Qr3FJGbdOIAhzqI4Z7M0N1O',
      appleProductId: 'com.caremetric.3month',
      period: '/ 3 months', 
      popular: true,
      savings: '10% off'
    },
    { 
      name: '6 Month', 
      price: 149.99, 
      priceId: 'price_1Qr3FJGbdOIAhzqI3Y6L9M0N',
      appleProductId: 'com.caremetric.6month',
      period: '/ 6 months', 
      popular: false,
      savings: '16% off'
    },
    { 
      name: 'Yearly', 
      price: 264.99, 
      priceId: 'price_1Qr3FJGbdOIAhzqI5A8N1O2P',
      appleProductId: 'com.caremetric.yearly',
      period: '/ year', 
      popular: false,
      savings: '26% off'
    },
  ];

  const handleAppleCheckout = async (plan) => {
    if (isInIframe) {
      toast.error('Checkout is only available from the published app');
      return;
    }

    setProcessingApple(true);
    try {
      if (window.webkit?.messageHandlers?.storeKit) {
        window.webkit.messageHandlers.storeKit.postMessage({
          action: 'purchase',
          productId: plan.appleProductId
        });
        
        window.addEventListener('applePurchaseComplete', async (event) => {
          if (event.detail.success) {
            const response = await base44.functions.invoke('verifyAppleReceipt', {
              receiptData: event.detail.receipt
            });
            
            if (response?.data?.success) {
              toast.success('Subscription activated!');
            }
          }
        }, { once: true });
      } else {
        toast.info('Apple purchases require the native iOS app');
      }
    } catch (error) {
      console.error('Apple purchase error:', error);
      toast.error('Failed to process purchase');
    } finally {
      setProcessingApple(false);
    }
  };

  const handleCheckout = async (priceId) => {
    // Block checkout in iframe
    if (isInIframe) {
      toast.error('Checkout is only available from the published app, not in preview mode. Please open the full app to complete your purchase.');
      return;
    }

    if (!priceId) {
      toast.error("This plan is not configured yet. Please contact support.");
      return;
    }

    setLoadingPriceId(priceId);
    try {
      const { data } = await base44.functions.invoke('createStripeCheckout', { priceId });
      
      if (!data?.sessionId) {
        throw new Error('No session ID returned from server');
      }

      const stripe = await stripePromise;
      const { error } = await stripe.redirectToCheckout({ sessionId: data.sessionId });
      
      if (error) {
        console.error("Stripe checkout error:", error);
        toast.error(error.message || 'Failed to redirect to checkout');
        setLoadingPriceId(null);
      }
    } catch (error) {
      console.error("Failed to create checkout session:", error);
      toast.error(error.message || 'Failed to start checkout. Please try again.');
      setLoadingPriceId(null);
    }
  };

  if (settingsLoading) {
    return <div className="p-8 text-center">Loading plans...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-4 sm:p-6 md:p-8 pb-20 sm:pb-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-4 text-gray-900">Subscription Plans</h1>
        <p className="text-center text-sm sm:text-base text-gray-700 mb-6 sm:mb-8">Manage your subscription or choose a new plan</p>

      {isInIframe && (
        <Alert className="mb-6 sm:mb-8 border-amber-200 bg-amber-50">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <AlertDescription className="text-amber-800">
            You're viewing this in preview mode. To subscribe, please open the full published app.
          </AlertDescription>
        </Alert>
      )}

      {isApple && subscription?.is_apple_iap && (
        <Alert className="mb-6 sm:mb-8 border-blue-200 bg-blue-50">
          <Apple className="h-5 w-5 text-blue-600" />
          <AlertDescription className="text-blue-800">
            Your subscription is managed through Apple. To make changes, use your device's subscription settings.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue={subscription?.status === 'active' ? 'portal' : 'plans'} className="w-full">
        <TabsList className="grid w-full max-w-2xl mx-auto grid-cols-3 mb-8">
          <TabsTrigger value="plans">Available Plans</TabsTrigger>
          <TabsTrigger value="portal" disabled={!subscription}>
            My Subscription
          </TabsTrigger>
          <TabsTrigger value="switch" disabled={!subscription || subscription?.status !== 'active'}>
            Switch Plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="portal">
          <CustomerPortal currentUser={currentUser} />
        </TabsContent>

        <TabsContent value="switch">
          <SubscriptionPlanSwitcher currentUser={currentUser} />
        </TabsContent>

        <TabsContent value="plans">

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
        {plans.map((plan) => (
          <Card key={plan.name} className={`flex flex-col ${plan.popular ? 'ring-2 ring-blue-500 shadow-lg' : ''}`}>
            {plan.popular && (
              <div className="bg-blue-500 text-white text-center py-2 text-sm font-semibold">
                Most Popular
              </div>
            )}
            <CardHeader>
              <CardTitle className="text-xl sm:text-2xl">{plan.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col">
              <div className="mb-3">
                <p className="text-3xl sm:text-4xl font-bold mb-1">
                  ${plan.price}
                  <span className="text-sm sm:text-lg font-normal text-gray-500">{plan.period}</span>
                </p>
                {plan.savings && (
                  <Badge className="bg-green-100 text-green-800 text-xs">
                    {plan.savings}
                  </Badge>
                )}
              </div>
              <ul className="space-y-2 text-gray-600 my-6 flex-grow">
                {(settings?.features || [
                  'Full access to patient management',
                  'AI-powered documentation',
                  'Real-time analytics',
                  'Compliance monitoring',
                  'Email support'
                ]).map(feature => (
                   <li key={feature} className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>
              {isApple ? (
                <Button
                  onClick={() => handleAppleCheckout(plan)}
                  disabled={processingApple}
                  className={`w-full mt-auto touch-target ${plan.popular ? 'bg-black hover:bg-gray-900' : 'bg-gray-800 hover:bg-gray-900'}`}
                >
                  {processingApple ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Apple className="w-4 h-4 mr-2" />
                      Subscribe
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={() => handleCheckout(plan.priceId)}
                  disabled={!plan.priceId || loadingPriceId === plan.priceId}
                  className={`w-full mt-auto touch-target ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                >
                  {loadingPriceId === plan.priceId ? <Loader2 className="animate-spin" /> : 'Choose Plan'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}