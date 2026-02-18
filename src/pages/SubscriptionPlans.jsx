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
      const response = await base44.functions.invoke('getMySubscription', {});
      return response?.data?.subscription || response?.subscription;
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

  // Fetch actual Stripe products and prices dynamically
  const { data: stripePlans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['stripeSubscriptionPlans'],
    queryFn: async () => {
      try {
        // Fetch all products
        const productsResponse = await base44.functions.invoke('stripeListProducts', {});
        const products = productsResponse?.data?.products || [];

        // Fetch all prices
        const allPlans = [];
        for (const product of products) {
          if (!product.active) continue; // Skip inactive products

          const pricesResponse = await base44.functions.invoke('stripeListPrices', { 
            product_id: product.id 
          });
          const prices = pricesResponse?.data?.prices || [];

          // Get active prices
          const activePrices = prices.filter(p => p.active);
          
          if (activePrices.length > 0) {
            // Use the first active price
            const price = activePrices[0];
            allPlans.push({
              name: product.name,
              price: price.unit_amount / 100,
              priceId: price.id,
              appleProductId: `com.caremetric.${product.name.toLowerCase().replace(/\s+/g, '')}`,
              period: `/ ${price.recurring?.interval_count > 1 ? price.recurring.interval_count + ' ' : ''}${price.recurring?.interval}${price.recurring?.interval_count > 1 ? 's' : ''}`,
              popular: product.name.includes('3 Month') || product.name.includes('Monthly'), // Mark monthly as popular
              savings: null,
              description: product.description
            });
          }
        }

        // Sort by price
        return allPlans.sort((a, b) => a.price - b.price);
      } catch (error) {
        console.error('Error fetching plans:', error);
        return [];
      }
    },
    staleTime: 60000 // Cache for 1 minute
  });

  const plans = stripePlans;

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

  if (settingsLoading || plansLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading subscription plans...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 p-4 sm:p-6 md:p-8 pb-20 sm:pb-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-4 text-gray-900">Subscription Plans</h1>
        <p className="text-center text-sm sm:text-base text-gray-700 mb-6 sm:mb-8">AI-powered documentation for home health & hospice nurses</p>

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
          {plans.length === 0 ? (
            <Card className="p-8">
              <CardContent className="text-center">
                <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Plans Available</h3>
                <p className="text-gray-600">
                  No subscription plans are currently configured. Please contact support or check back later.
                </p>
              </CardContent>
            </Card>
          ) : (
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
                  'AI-powered home health & hospice notes',
                  'Voice-to-documentation scribe',
                  'OASIS & Medicare compliance tools',
                  'Care plan generation',
                  'Patient management & alerts'
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
                  className={`w-full mt-auto touch-target ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'} text-white`}
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
                  className={`w-full mt-auto touch-target ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'} text-white`}
                >
                  {loadingPriceId === plan.priceId ? <Loader2 className="animate-spin" /> : 'Choose Plan'}
                </Button>
              )}
            </CardContent>
              </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}