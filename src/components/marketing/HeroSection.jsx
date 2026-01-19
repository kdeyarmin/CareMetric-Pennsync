import React from "react";
import { ArrowRight, Sparkles, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function HeroSection() {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-blue-400/30 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-indigo-400/30 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-gradient-to-br from-purple-400/20 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div className="flex flex-col justify-center space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-100 dark:bg-blue-900/30 w-fit border border-blue-200 dark:border-blue-800">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                AI-Powered Healthcare Documentation
              </span>
            </div>

            {/* Main Heading */}
            <div className="space-y-4">
              <h1 className="text-5xl lg:text-7xl font-bold text-gray-900 dark:text-white leading-tight">
                Transform Your
                <span className="block bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-transparent bg-clip-text">
                  Clinical Documentation
                </span>
              </h1>
              <p className="text-xl text-gray-600 dark:text-gray-300 max-w-lg leading-relaxed">
                Streamline your workflow, ensure Medicare compliance, and improve patient outcomes with intelligent AI assistance. Save 40-50% documentation time daily.
              </p>
            </div>

            {/* Feature highlights */}
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-1" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  HIPAA-compliant & enterprise-grade security
                </span>
              </div>
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-amber-500 flex-shrink-0 mt-1" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Real-time AI suggestions & compliance checks
                </span>
              </div>
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-blue-500 flex-shrink-0 mt-1" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Trusted by 1000+ healthcare providers
                </span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link to={createPageUrl("SubscriptionPlans")}>
                <Button size="lg" className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white group">
                  Get Started Free
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Button size="lg" variant="outline" className="w-full sm:w-auto border-2">
                Watch Demo
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="flex items-center gap-4 pt-4 border-t border-gray-200 dark:border-gray-800">
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">30M+</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Notes Processed</div>
              </div>
              <div className="w-px h-12 bg-gray-200 dark:bg-gray-800" />
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">99.9%</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Uptime Guaranteed</div>
              </div>
              <div className="w-px h-12 bg-gray-200 dark:bg-gray-800" />
              <div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">24/7</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Expert Support</div>
              </div>
            </div>
          </div>

          {/* Right Visual */}
          <div className="relative hidden lg:block">
            {/* Floating card effect */}
            <div className="relative">
              {/* Main card */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700 p-8 space-y-6 animate-float">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Smart Note Processing</h3>
                    <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-semibold rounded-full">
                      Active
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Patient assessment shows signs of improvement in mobility and pain management...
                  </p>
                </div>

                {/* AI Suggestions */}
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">AI Suggestions</span>
                  </div>
                  <ul className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                    <li className="flex gap-2">
                      <span className="text-green-500">✓</span>
                      <span>Consider ICD-10 code M79.3 for myalgia</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-blue-500">→</span>
                      <span>Add functional status assessment detail</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-amber-500">!</span>
                      <span>Verify homebound status documentation</span>
                    </li>
                  </ul>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div>
                    <div className="text-lg font-bold text-gray-900 dark:text-white">94%</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Compliance Score</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-gray-900 dark:text-white">3m 42s</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">Time Saved</div>
                  </div>
                </div>
              </div>

              {/* Floating background blur */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl blur-2xl -z-10" />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-20px);
          }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}