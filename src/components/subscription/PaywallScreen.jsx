import React from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Lock, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  Zap,
  Shield,
  TrendingUp,
  Brain,
  ArrowRight
} from "lucide-react";
import { motion } from "framer-motion";

export default function PaywallScreen({ 
  featureName = "Premium Feature",
  featureDescription = "This feature requires an active subscription to CareMetric AI.",
  compact = false 
}) {
  const benefits = [
    { icon: Brain, text: "AI-powered documentation", color: "text-blue-600" },
    { icon: Shield, text: "Real-time compliance monitoring", color: "text-green-600" },
    { icon: TrendingUp, text: "Predictive analytics", color: "text-purple-600" },
    { icon: Zap, text: "Unlimited patients & visits", color: "text-orange-600" }
  ];

  const plans = [
    { name: "Monthly", price: "$39.99", interval: "/month", popular: false },
    { name: "Semi-Annual", price: "$209.99", interval: "/6 months", popular: true, save: "Save 13%" },
    { name: "Annual", price: "$349.99", interval: "/year", popular: false, save: "Save 27%" }
  ];

  if (compact) {
    return (
      <Card className="border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardContent className="p-6 text-center">
          <Lock className="w-12 h-12 text-blue-600 mx-auto mb-3" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">{featureName}</h3>
          <p className="text-gray-600 mb-4">{featureDescription}</p>
          <div className="flex items-center justify-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-green-800">14-Day Free Trial Available</span>
          </div>
          <Link to={createPageUrl("Pricing")}>
            <Button className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700">
              View Pricing & Start Trial
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="max-w-5xl w-full"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-2xl"
          >
            <Lock className="w-10 h-10 text-white" />
          </motion.div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
            Unlock {featureName}
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            {featureDescription}
          </p>
        </div>

        {/* Trial Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-8"
        >
          <Card className="border-0 bg-gradient-to-r from-green-400 to-emerald-500 shadow-2xl">
            <CardContent className="p-6 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Sparkles className="w-6 h-6 text-white" />
                <span className="text-2xl font-extrabold text-white">14-Day Free Trial</span>
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <p className="text-white text-lg font-semibold">
                Full Access • No Credit Card Required • Cancel Anytime
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Benefits Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {benefits.map((benefit, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + idx * 0.1 }}
            >
              <Card className="border-2 hover:shadow-lg transition-shadow">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-gray-50`}>
                    <benefit.icon className={`w-6 h-6 ${benefit.color}`} />
                  </div>
                  <span className="font-semibold text-gray-900">{benefit.text}</span>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {plans.map((plan, idx) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + idx * 0.1 }}
            >
              <Card className={`relative ${plan.popular ? 'border-4 border-indigo-500 shadow-2xl scale-105' : 'border-2'}`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-indigo-600 text-white px-4 py-1">
                      Most Popular
                    </Badge>
                  </div>
                )}
                <CardHeader className={plan.popular ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-t-lg' : ''}>
                  <CardTitle className="text-center">
                    <div className={`text-xl font-bold mb-2 ${plan.popular ? 'text-white' : 'text-gray-900'}`}>
                      {plan.name}
                    </div>
                    <div className={`text-3xl font-bold ${plan.popular ? 'text-white' : 'text-gray-900'}`}>
                      {plan.price}
                    </div>
                    <div className={`text-sm ${plan.popular ? 'text-white/90' : 'text-gray-600'}`}>
                      {plan.interval}
                    </div>
                    {plan.save && (
                      <Badge className="mt-2 bg-yellow-400 text-yellow-900">
                        {plan.save}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link to={createPageUrl("Pricing")}>
            <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-lg px-8 py-6">
              View All Plans & Start Trial
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
          <Link to={createPageUrl("Dashboard")}>
            <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg px-8 py-6">
              Back to Dashboard
            </Button>
          </Link>
        </motion.div>

        {/* Footer Note */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Questions? Visit our <Link to={createPageUrl("FAQ")} className="text-blue-600 hover:underline">FAQ</Link> or <Link to={createPageUrl("Support")} className="text-blue-600 hover:underline">contact support</Link>
        </p>
      </motion.div>
    </div>
  );
}