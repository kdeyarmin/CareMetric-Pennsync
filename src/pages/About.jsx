import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Shield, Zap, BarChart3, FileText, Users, ArrowRight, CheckCircle2, Globe } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function About() {
  const features = [
    {
      icon: Brain,
      title: "AI-Powered Documentation",
      description: "Smart Notes Assistant uses AI to enhance clinical documentation, ensuring Medicare compliance while saving time."
    },
    {
      icon: Shield,
      title: "Compliance & Security",
      description: "HIPAA-compliant platform with real-time compliance auditing, security logging, and regulatory monitoring."
    },
    {
      icon: Zap,
      title: "Efficient Workflows",
      description: "Streamlined visit scheduling, patient management, and care coordination designed for home health and hospice agencies."
    },
    {
      icon: BarChart3,
      title: "Analytics & Insights",
      description: "Real-time dashboards track clinical outcomes, staff performance, and PDGM reimbursement optimization."
    },
    {
      icon: FileText,
      title: "Document Management",
      description: "Centralized repository for patient documents, signatures, referrals, and clinical records with secure sharing."
    },
    {
      icon: Users,
      title: "Team Collaboration",
      description: "Messaging, task assignment, and interdisciplinary coordination tools for seamless care team communication."
    }
  ];

  const benefits = [
    "Reduce documentation time by 40%+",
    "Improve Medicare compliance scores",
    "Enhance clinical decision-making with AI insights",
    "Increase staff productivity and satisfaction",
    "Streamline referral-to-discharge workflows",
    "Better patient outcomes through real-time monitoring"
  ];

  return (
    <PageContainer>
      <PageHeader
        icon={Globe}
        eyebrow="PennSync"
        title="About"
        description="The intelligent home health and hospice management platform that combines AI-powered documentation with comprehensive clinical operations."
        favoritePage="About"
      />

      {/* Overview Section */}
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-slate-900 mb-6">What is Penn Sync?</h2>
        <Card className="border-blue-200">
          <CardContent className="p-6 md:p-8">
            <p className="text-slate-700 text-lg mb-4 leading-relaxed">
              Penn Sync is a comprehensive, cloud-based platform designed specifically for home health and hospice agencies. 
              It transforms clinical documentation, improves operational efficiency, and enhances patient outcomes through intelligent 
              automation, real-time analytics, and seamless team collaboration.
            </p>
            <p className="text-slate-700 text-lg leading-relaxed">
              Built on cutting-edge AI technology and designed with clinician workflows in mind, Penn Sync helps agencies meet 
              regulatory requirements, reduce administrative burden, and focus more on patient care.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Key Features */}
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-slate-900 mb-6">Core Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 mb-2">{feature.title}</h3>
                      <p className="text-sm text-slate-600">{feature.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Key Benefits */}
      <div className="mb-12">
        <h2 className="text-3xl font-bold text-slate-900 mb-6">Why Choose Penn Sync?</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {benefits.map((benefit, index) => (
            <div key={index} className="flex items-start gap-3 bg-emerald-50 p-4 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <span className="text-slate-800 font-medium">{benefit}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div className="mb-12">
        <div className="rounded-xl border border-navy-100 bg-navy-50 p-8 text-center">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">Ready to Transform Your Agency?</h2>
            <p className="text-slate-600 mb-6 max-w-2xl mx-auto">
              Join home health and hospice organizations using Penn Sync to streamline operations, improve compliance, and deliver better patient care.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to={createPageUrl("Dashboard")}>
                <Button className="gap-2">
                  Get Started <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link to={createPageUrl("Help")}>
                <Button variant="outline">Learn More</Button>
              </Link>
            </div>
        </div>
      </div>
    </PageContainer>
  );
}