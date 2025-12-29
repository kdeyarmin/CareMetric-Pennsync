import React, { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  HelpCircle,
  Search,
  ArrowRight,
  Shield,
  Clock,
  CreditCard,
  Users,
  FileText,
  Sparkles
} from "lucide-react";

export const publicPage = true;

export default function FAQ() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch {
        return null;
      }
    }
  });

  const faqs = [
    {
      category: "Getting Started",
      icon: Sparkles,
      color: "blue",
      questions: [
        {
          q: "What is CareMetric AI?",
          a: "CareMetric AI is an AI-powered clinical documentation and care management platform designed specifically for home health nurses. It transforms rough notes into Medicare-compliant documentation, provides predictive analytics, and helps improve patient outcomes."
        },
        {
          q: "How do I get started?",
          a: "Simply sign up for a free 14-day trial - no credit card required. Once registered, you can immediately start documenting visits, adding patients, and exploring all premium features. Our intuitive interface requires minimal training."
        },
        {
          q: "Is there a mobile app?",
          a: "CareMetric AI is a web-based application that works seamlessly on all devices - desktop, tablet, and mobile. We also offer offline mode so you can document visits without internet connection and sync when you're back online."
        },
        {
          q: "Do I need special training to use it?",
          a: "No special training required! The platform is designed to be intuitive for nurses. Most users are fully productive within their first day. We also provide interactive tutorials and support documentation."
        }
      ]
    },
    {
      category: "Pricing & Billing",
      icon: CreditCard,
      color: "green",
      questions: [
        {
          q: "How much does CareMetric AI cost?",
          a: "We offer flexible pricing: $39.99/month, $115/quarter (save 4%), $210/6 months (save 12%), or $350/year (save 27%). All plans include unlimited patients, visits, and full access to all features."
        },
        {
          q: "Is there a free trial?",
          a: "Yes! We offer a 14-day free trial with full access to all premium features. No credit card required to start. You can cancel anytime during the trial period with no charges."
        },
        {
          q: "Can I cancel my subscription anytime?",
          a: "Absolutely. You can cancel your subscription at any time from your account settings. You'll retain access until the end of your current billing period, and your data will be available for export."
        },
        {
          q: "What payment methods do you accept?",
          a: "We accept all major credit cards (Visa, Mastercard, American Express, Discover) through our secure Stripe payment processing. We do not store your payment information on our servers."
        },
        {
          q: "Do you offer discounts for agencies?",
          a: "Yes! Contact us for custom agency pricing for teams of 5+ nurses. We offer volume discounts and can provide agency-wide training and support."
        }
      ]
    },
    {
      category: "Features & Functionality",
      icon: FileText,
      color: "purple",
      questions: [
        {
          q: "What is the AI Smart Notes feature?",
          a: "AI Smart Notes transforms your rough notes or voice dictation into professional, Medicare-compliant documentation in seconds. It automatically checks for compliance, adds required elements, and improves clarity while maintaining your clinical observations."
        },
        {
          q: "How accurate is the AI documentation?",
          a: "Our AI achieves 95%+ compliance scores and has been trained on thousands of Medicare-compliant notes. However, you always review and approve all AI-generated content before submitting - you maintain full control."
        },
        {
          q: "Can I use voice dictation?",
          a: "Yes! You can dictate notes hands-free during or after visits. The AI transcribes your speech and transforms it into structured, compliant documentation. This saves significant time compared to manual typing."
        },
        {
          q: "Does it work with OASIS assessments?",
          a: "Yes, CareMetric AI includes OASIS tools for reviewing, analyzing, and optimizing your assessments. It helps identify documentation gaps and suggests improvements for better compliance and reimbursement."
        },
        {
          q: "What about care plans?",
          a: "The platform includes AI-powered care plan generation based on diagnosis and patient history. It automatically suggests evidence-based interventions, tracks progress, and generates follow-up tasks."
        },
        {
          q: "Can I work offline?",
          a: "Yes! Our offline mode allows you to document visits without internet connection. All data is encrypted and stored locally, then automatically synced when you're back online."
        }
      ]
    },
    {
      category: "Security & Compliance",
      icon: Shield,
      color: "red",
      questions: [
        {
          q: "Is CareMetric AI HIPAA compliant?",
          a: "Yes, we are fully HIPAA compliant. All data is encrypted in transit (TLS 1.2+) and at rest (AES-256). We maintain comprehensive audit logs, implement role-based access controls, and undergo regular security assessments."
        },
        {
          q: "How is my patient data protected?",
          a: "Patient data is protected through multiple layers: end-to-end encryption, secure authentication, encrypted database storage, regular security audits, and strict access controls. We never share or sell your data."
        },
        {
          q: "Who can access my patient records?",
          a: "Only you and administrators you authorize can access your patients. Each user has their own secure login, and all access is logged with timestamps for complete audit trails."
        },
        {
          q: "Do you sign a Business Associate Agreement (BAA)?",
          a: "Yes, we provide a HIPAA Business Associate Agreement (BAA) to all customers. This is included automatically with your subscription and outlines our responsibilities in protecting your PHI."
        },
        {
          q: "What happens to my data if I cancel?",
          a: "You can export all your data before canceling. After cancellation, your data is retained for 90 days in case you want to reactivate. After 90 days, all data is permanently deleted from our systems."
        }
      ]
    },
    {
      category: "Support & Training",
      icon: Users,
      color: "orange",
      questions: [
        {
          q: "What kind of support do you offer?",
          a: "We provide email support, comprehensive documentation, video tutorials, and an in-app AI assistant. Premium support with phone/video calls is available for agency subscriptions."
        },
        {
          q: "How quickly do you respond to support requests?",
          a: "We typically respond within 24 hours on business days. Urgent issues are prioritized. Agency customers with premium support receive same-day responses."
        },
        {
          q: "Do you provide training for new users?",
          a: "Yes! We offer self-guided interactive tutorials, video training modules, and documentation. Agency customers can schedule live training sessions for their team."
        },
        {
          q: "Can I suggest new features?",
          a: "Absolutely! We actively incorporate user feedback into our product roadmap. You can submit feature requests through the app or email us directly."
        }
      ]
    },
    {
      category: "Technical Questions",
      icon: Clock,
      color: "indigo",
      questions: [
        {
          q: "What devices and browsers are supported?",
          a: "CareMetric AI works on any device with a modern web browser: Chrome, Safari, Firefox, Edge. Optimized for both desktop and mobile devices. No app download required."
        },
        {
          q: "Do I need to install anything?",
          a: "No installation needed! CareMetric AI is a cloud-based application accessible through your web browser. This means automatic updates and access from any device."
        },
        {
          q: "What if I lose internet connection during documentation?",
          a: "Our offline mode automatically activates when you lose connection. Your work is saved locally and encrypted, then syncs automatically when connection is restored."
        },
        {
          q: "Can I integrate with my existing EHR?",
          a: "Currently, CareMetric AI operates as a standalone system. However, you can export documentation in various formats to import into your EHR. We're working on direct EHR integrations for future releases."
        },
        {
          q: "How often is the platform updated?",
          a: "We release updates regularly to add features, improve performance, and maintain compliance with latest Medicare guidelines. All updates are automatic - no action needed on your part."
        }
      ]
    }
  ];

  const filteredFaqs = faqs.map(category => ({
    ...category,
    questions: category.questions.filter(
      faq =>
        faq.q.toLowerCase().includes(searchTerm.toLowerCase()) ||
        faq.a.toLowerCase().includes(searchTerm.toLowerCase())
    )
  })).filter(category => category.questions.length > 0);

  const getCategoryColor = (color) => {
    const colors = {
      blue: "from-blue-500 to-blue-600",
      green: "from-green-500 to-green-600",
      purple: "from-purple-500 to-purple-600",
      red: "from-red-500 to-red-600",
      orange: "from-orange-500 to-orange-600",
      indigo: "from-indigo-500 to-indigo-600"
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <section className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white">
        <div className="max-w-7xl mx-auto px-4 py-16 sm:px-6 lg:px-8">
          <div className="text-center">
            <HelpCircle className="w-16 h-16 mx-auto mb-4 text-blue-200" />
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Frequently Asked Questions
            </h1>
            <p className="text-xl text-blue-100 max-w-2xl mx-auto">
              Find answers to common questions about CareMetric AI
            </p>
          </div>
        </div>
      </section>

      {/* Search Bar */}
      <div className="max-w-3xl mx-auto px-4 -mt-8 relative z-10">
        <Card className="shadow-2xl">
          <CardContent className="p-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                placeholder="Search for answers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-12 h-12 text-lg"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FAQ Categories */}
      <div className="max-w-5xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {filteredFaqs.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <HelpCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No questions found matching your search.</p>
                <Button
                  variant="outline"
                  onClick={() => setSearchTerm("")}
                  className="mt-4"
                >
                  Clear Search
                </Button>
              </CardContent>
            </Card>
          ) : (
            filteredFaqs.map((category, idx) => (
              <Card key={idx} className="overflow-hidden">
                <CardHeader className={`bg-gradient-to-r ${getCategoryColor(category.color)} text-white`}>
                  <CardTitle className="flex items-center gap-3">
                    <category.icon className="w-6 h-6" />
                    {category.category}
                    <Badge className="ml-auto bg-white/20 text-white">
                      {category.questions.length} questions
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Accordion type="single" collapsible className="w-full">
                    {category.questions.map((faq, qIdx) => (
                      <AccordionItem key={qIdx} value={`${idx}-${qIdx}`} className="border-b last:border-b-0">
                        <AccordionTrigger className="px-6 py-4 hover:bg-gray-50 text-left">
                          <span className="font-semibold text-gray-900">{faq.q}</span>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 py-4 bg-gray-50">
                          <p className="text-gray-700 leading-relaxed">{faq.a}</p>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* CTA Section */}
        <Card className="mt-12 bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-none">
          <CardContent className="p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">Still have questions?</h2>
            <p className="text-blue-100 mb-6">
              We're here to help! Contact our support team or start your free trial today.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to={createPageUrl("Support")}>
                <Button size="lg" variant="outline" className="text-blue-600 bg-white hover:bg-blue-50">
                  Contact Support
                </Button>
              </Link>
              {!currentUser && (
                <Button
                  size="lg"
                  onClick={() => base44.auth.redirectToLogin()}
                  className="bg-white text-blue-600 hover:bg-blue-50"
                >
                  Start Free Trial
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              )}
              {currentUser && (
                <Link to={createPageUrl("Dashboard")}>
                  <Button size="lg" className="bg-white text-blue-600 hover:bg-blue-50">
                    Go to Dashboard
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}