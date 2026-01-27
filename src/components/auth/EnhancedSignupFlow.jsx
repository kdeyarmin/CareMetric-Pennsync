import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Apple, CreditCard, CheckCircle2, Loader2, 
  Sparkles, Shield, Zap, ArrowRight 
} from 'lucide-react';
import { toast } from 'sonner';
import { isApplePlatform } from '@/components/utils/platformDetection';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 
  'pk_live_51Qr3FJGbdOIAhzqIDXCO08y02eKhABH99Fm3LR5XWrSYbD25zrJ2T3dZHcF2XOGzQOC73vHNLvgVnMnXOuVqbxAF00j7xpRkDv'
);

const PLANS = [
  { 
    id: 'monthly', 
    name: 'Monthly', 
    price: 29.99, 
    priceId: 'price_1Qr3FJGbdOIAhzqI2X5K8L9M',
    appleProductId: 'com.caremetric.monthly',
    period: 'month',
    savings: null
  },
  { 
    id: '3month', 
    name: '3 Month', 
    price: 79.99, 
    priceId: 'price_1Qr3FJGbdOIAhzqI4Z7M0N1O',
    appleProductId: 'com.caremetric.3month',
    period: '3 months',
    savings: '10%',
    popular: true
  },
  { 
    id: '6month', 
    name: '6 Month', 
    price: 149.99, 
    priceId: 'price_1Qr3FJGbdOIAhzqI3Y6L9M0N',
    appleProductId: 'com.caremetric.6month',
    period: '6 months',
    savings: '16%'
  },
  { 
    id: 'yearly', 
    name: 'Yearly', 
    price: 264.99, 
    priceId: 'price_1Qr3FJGbdOIAhzqI5A8N1O2P',
    appleProductId: 'com.caremetric.yearly',
    period: 'year',
    savings: '26%'
  }
];

const FEATURES = [
  'AI-powered clinical documentation',
  'Real-time compliance monitoring',
  'Smart patient management',
  'Advanced analytics & insights',
  'OASIS automation tools',
  'Telehealth integration',
  'Unlimited patient records',
  'Priority email support'
];

export default function EnhancedSignupFlow({ onComplete }) {
  const [step, setStep] = useState(1); // 1: info, 2: plan, 3: payment
  const [userData, setUserData] = useState({
    full_name: '',
    email: '',
    credential_type: ''
  });
  const [selectedPlan, setSelectedPlan] = useState(PLANS[1]); // Default to 3-month
  const [isApple, setIsApple] = useState(false);
  const [processingApple, setProcessingApple] = useState(false);

  useEffect(() => {
    const checkPlatform = () => {
      const apple = isApplePlatform();
      setIsApple(apple);
      console.log('Platform detected:', apple ? 'Apple (iOS/iPadOS)' : 'Web/Android (Stripe)');
    };
    checkPlatform();
  }, []);

  const updateUserMutation = useMutation({
    mutationFn: async (data) => {
      await base44.auth.updateMe(data);
    },
    onSuccess: () => {
      setStep(2);
    },
    onError: (error) => {
      toast.error('Failed to save information. Please try again.');
      console.error(error);
    }
  });

  const handleBasicInfoSubmit = (e) => {
    e.preventDefault();
    if (!userData.full_name || !userData.email || !userData.credential_type) {
      toast.error('Please fill in all fields');
      return;
    }
    updateUserMutation.mutate(userData);
  };

  const handleAppleSubscription = async () => {
    setProcessingApple(true);
    try {
      // Check if running in native iOS app
      if (window.webkit?.messageHandlers?.storeKit) {
        // Send message to native iOS app to initiate purchase
        window.webkit.messageHandlers.storeKit.postMessage({
          action: 'purchase',
          productId: selectedPlan.appleProductId
        });
        
        // Listen for purchase result
        window.addEventListener('applePurchaseComplete', async (event) => {
          if (event.detail.success) {
            // Verify receipt on backend
            const response = await base44.functions.invoke('verifyAppleReceipt', {
              receiptData: event.detail.receipt
            });
            
            if (response?.data?.success) {
              toast.success('Subscription activated!');
              if (onComplete) onComplete();
            }
          }
        }, { once: true });
      } else {
        toast.info('Apple purchases require the native iOS app');
      }
    } catch (error) {
      console.error('Apple purchase error:', error);
      toast.error('Failed to process Apple subscription');
    } finally {
      setProcessingApple(false);
    }
  };

  const handleStripeCheckout = async () => {
    try {
      const { data } = await base44.functions.invoke('createStripeCheckout', { 
        priceId: selectedPlan.priceId 
      });
      
      if (!data?.sessionId) {
        throw new Error('No session ID returned');
      }

      const stripe = await stripePromise;
      const { error } = await stripe.redirectToCheckout({ sessionId: data.sessionId });
      
      if (error) {
        toast.error(error.message || 'Failed to redirect to checkout');
      }
    } catch (error) {
      console.error('Stripe checkout error:', error);
      toast.error('Failed to start checkout. Please try again.');
    }
  };

  // Step 1: Basic Information
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-2xl">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl">Welcome to CareMetric AI</CardTitle>
            <p className="text-sm text-gray-600 mt-2">
              Let's get you started with your account
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleBasicInfoSubmit} className="space-y-4">
              <div>
                <Label>Full Name *</Label>
                <Input
                  value={userData.full_name}
                  onChange={(e) => setUserData({ ...userData, full_name: e.target.value })}
                  placeholder="Dr. Jane Smith"
                  required
                  className="h-11"
                />
              </div>

              <div>
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={userData.email}
                  onChange={(e) => setUserData({ ...userData, email: e.target.value })}
                  placeholder="you@example.com"
                  required
                  className="h-11"
                />
              </div>

              <div>
                <Label>Your Role *</Label>
                <select
                  value={userData.credential_type}
                  onChange={(e) => setUserData({ ...userData, credential_type: e.target.value })}
                  className="w-full h-11 px-3 border rounded-md"
                  required
                >
                  <option value="">Select your credential</option>
                  <option value="RN">Registered Nurse (RN)</option>
                  <option value="LPN">Licensed Practical Nurse (LPN)</option>
                  <option value="NP">Nurse Practitioner (NP)</option>
                  <option value="PHYSICIAN">Physician</option>
                  <option value="THERAPIST">Therapist (PT/OT/ST)</option>
                  <option value="MSW">Medical Social Worker</option>
                  <option value="Chiropractor">Chiropractor</option>
                </select>
              </div>

              <Button
                type="submit"
                disabled={updateUserMutation.isPending}
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {updateUserMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Continue <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Plan Selection
  if (step === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4 overflow-y-auto">
        <div className="max-w-5xl mx-auto py-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">Choose Your Plan</h1>
            <p className="text-gray-600">Start your 14-day free trial, cancel anytime</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {PLANS.map((plan) => (
              <Card
                key={plan.id}
                onClick={() => setSelectedPlan(plan)}
                className={`cursor-pointer transition-all ${
                  selectedPlan.id === plan.id
                    ? 'ring-2 ring-blue-600 shadow-lg scale-105'
                    : 'hover:shadow-md'
                } ${plan.popular ? 'border-blue-600' : ''}`}
              >
                {plan.popular && (
                  <div className="bg-blue-600 text-white text-center py-1 text-xs font-semibold">
                    MOST POPULAR
                  </div>
                )}
                <CardContent className="p-4">
                  <div className="text-center">
                    <h3 className="font-bold text-lg">{plan.name}</h3>
                    <div className="my-3">
                      <span className="text-3xl font-bold">${plan.price}</span>
                      <span className="text-sm text-gray-600">/{plan.period}</span>
                    </div>
                    {plan.savings && (
                      <Badge className="bg-green-100 text-green-800">
                        Save {plan.savings}
                      </Badge>
                    )}
                  </div>
                  {selectedPlan.id === plan.id && (
                    <CheckCircle2 className="w-6 h-6 text-blue-600 mx-auto mt-3" />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Features List */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                Everything Included
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-3">
                {FEATURES.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Payment Options */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-gray-600" />
              <span className="text-sm text-gray-600">
                {isApple ? 'Pay securely with Apple' : 'Secure payment powered by Stripe'}
              </span>
            </div>

            {isApple ? (
              <Button
                onClick={handleAppleSubscription}
                disabled={processingApple}
                className="w-full h-14 bg-black hover:bg-gray-900 text-white text-lg"
              >
                {processingApple ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Apple className="w-6 h-6 mr-2" />
                    Subscribe with Apple
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleStripeCheckout}
                className="w-full h-14 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-lg"
              >
                <CreditCard className="w-5 h-5 mr-2" />
                Subscribe with Card
              </Button>
            )}

          <p className="text-xs text-gray-500 text-center mt-6">
            Start your 14-day free trial. You won't be charged until the trial ends.
            Cancel anytime before the trial ends to avoid charges.
          </p>
        </div>
      </div>
    );
  }

  return null;
}