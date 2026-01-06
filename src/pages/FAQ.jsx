import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  ChevronDown,
  ChevronUp,
  Search,
  HelpCircle,
  Shield,
  CreditCard,
  Users,
  Smartphone,
  Zap,
  Clock,
  CheckCircle2,
  ArrowRight
} from "lucide-react";

export const publicPage = true;

export default function FAQ() {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [expandedQuestion, setExpandedQuestion] = useState(null);

  const faqCategories = [
    {
      category: "Getting Started",
      icon: Zap,
      color: "blue",
      questions: [
        {
          q: "How do I get started with CareMetric AI?",
          a: "Getting started is easy! Simply sign up for a free 14-day trial (no credit card required), complete your profile, and start using the Smart Note Assistant to enhance your first clinical note. We recommend watching our quick tutorial videos in the Training Hub to familiarize yourself with key features."
        },
        {
          q: "Do I need special training to use CareMetric AI?",
          a: "No special training is required! CareMetric AI is designed to be intuitive for home health nurses. Most users are fully proficient within their first day of use. We provide in-app guidance, tutorial videos, and our AI Chat Assistant is available 24/7 to help answer questions."
        },
        {
          q: "Can I try it before committing?",
          a: "Absolutely! We offer a 14-day free trial with full access to all premium features. No credit card is required to start your trial. This gives you plenty of time to see how CareMetric AI fits into your workflow and saves you time."
        },
        {
          q: "What if I need help during setup?",
          a: "We're here to help! Use our in-app AI Chat Assistant for instant answers, email support@caremetricai.com, or visit our Support page for detailed guides. Most setup questions are answered in under 5 minutes."
        }
      ]
    },
    {
      category: "Features & Functionality",
      icon: Smartphone,
      color: "green",
      questions: [
        {
          q: "What is the Smart Note Assistant?",
          a: "The Smart Note Assistant is our flagship AI tool that transforms your rough notes into Medicare-compliant clinical narratives in seconds. Simply enter your observations, vital signs, and interventions, then click 'Enhance with AI' to get a professionally written note that meets all regulatory requirements."
        },
        {
          q: "Does it work with voice dictation?",
          a: "Yes! You can dictate your notes hands-free using our voice recognition feature. It understands medical terminology and even supports voice commands like 'enhance note' and 'save note'. This is perfect for documenting in the field."
        },
        {
          q: "Can I use it offline?",
          a: "Yes! Our Offline Mode allows you to document visits without an internet connection. All data is saved locally on your device and automatically syncs to the cloud when you're back online. Perfect for areas with poor cell coverage."
        },
        {
          q: "How does AI Care Plan generation work?",
          a: "Our AI analyzes patient diagnoses, visit notes, and clinical history to automatically suggest evidence-based care plans with appropriate problems, goals, and interventions. You can review, customize, and create these plans with just a few clicks."
        },
        {
          q: "What about patient alerts and risk detection?",
          a: "CareMetric AI continuously monitors patient data to identify early warning signs of deterioration, fall risk, medication issues, and readmission risk. You'll receive proactive alerts with specific recommendations for intervention before problems escalate."
        },
        {
          q: "Is there a mobile app?",
          a: "CareMetric AI is a web-based platform that works seamlessly on any device with a modern browser - phones, tablets, and computers. You don't need to download anything, and your data syncs across all devices automatically."
        }
      ]
    },
    {
      category: "Compliance & Security",
      icon: Shield,
      color: "purple",
      questions: [
        {
          q: "Is CareMetric AI HIPAA compliant?",
          a: "Yes! CareMetric AI is fully HIPAA compliant. We implement comprehensive administrative, physical, and technical safeguards to protect Protected Health Information (PHI). We execute a Business Associate Agreement (BAA) with all users handling PHI, and all data is encrypted both in transit and at rest."
        },
        {
          q: "How do you ensure Medicare compliance?",
          a: "Our AI is trained on current Medicare Conditions of Participation (42 CFR 484) and updates automatically when regulations change. Every note is checked in real-time against Medicare requirements, and we provide specific guidance on missing elements to ensure audit-ready documentation."
        },
        {
          q: "What happens to my patient data?",
          a: "Your patient data is encrypted and stored securely in HIPAA-compliant cloud infrastructure. We never sell or share your data with third parties. You maintain complete ownership and control, and you can export or delete your data at any time."
        },
        {
          q: "Can I trust AI-generated content?",
          a: "CareMetric AI is designed to assist, not replace, your clinical judgment. All AI-generated content should be reviewed and approved by you before use. Our AI is a tool to improve efficiency and compliance, but you remain responsible for all clinical decisions and documentation."
        },
        {
          q: "What if there's a data breach?",
          a: "We implement industry-leading security measures and regular security audits to prevent breaches. In the unlikely event of a breach involving PHI, we follow HIPAA breach notification requirements and will notify you and affected parties promptly."
        }
      ]
    },
    {
      category: "Pricing & Billing",
      icon: CreditCard,
      color: "orange",
      questions: [
        {
          q: "How much does CareMetric AI cost?",
          a: "We offer simple, transparent pricing starting at $29/month for individual nurses. Visit our Pricing page for detailed plan options. All plans include full access to AI features, unlimited notes, and priority support."
        },
        {
          q: "What's included in the free trial?",
          a: "Your 14-day free trial includes complete access to all premium features - Smart Notes, AI Care Plans, Patient Alerts, Training Hub, Compliance Checking, and more. No credit card required, and you can cancel anytime without obligation."
        },
        {
          q: "Can I cancel anytime?",
          a: "Yes! There are no long-term contracts or cancellation fees. You can cancel your subscription at any time from your Billing page, and you'll retain access through the end of your current billing period."
        },
        {
          q: "Do you offer team or agency pricing?",
          a: "Yes! We offer special pricing for agencies with multiple nurses. Contact us at support@caremetricai.com for custom team pricing and features like centralized billing, user management, and agency-wide analytics."
        },
        {
          q: "What payment methods do you accept?",
          a: "We accept all major credit cards (Visa, Mastercard, American Express, Discover) processed securely through Stripe. For agency subscriptions, we can also arrange invoicing."
        },
        {
          q: "How does the referral program work?",
          a: "Share CareMetric AI with colleagues using your unique referral code, and earn $5.00 credit for each friend who subscribes. Your credits automatically apply to your renewal, making your subscription more affordable!"
        }
      ]
    },
    {
      category: "Technical Support",
      icon: Users,
      color: "red",
      questions: [
        {
          q: "What if I encounter a technical issue?",
          a: "First, try using our AI Chat Assistant for instant troubleshooting. For more complex issues, email support@caremetricai.com with details and screenshots. We typically respond within 24 hours on business days, often much faster."
        },
        {
          q: "What browsers are supported?",
          a: "CareMetric AI works best on modern browsers: Chrome, Safari, Firefox, and Edge (latest versions). We recommend Chrome or Safari for the best experience, especially for voice dictation features."
        },
        {
          q: "Can I use it on my tablet or phone?",
          a: "Absolutely! CareMetric AI is fully responsive and optimized for mobile devices. Many nurses prefer using it on tablets during home visits. The interface adapts perfectly to any screen size."
        },
        {
          q: "What internet speed do I need?",
          a: "CareMetric AI works well on most internet connections, including 4G mobile data. For optimal performance with voice dictation, we recommend at least 3 Mbps. Remember, you can also use Offline Mode when connectivity is poor."
        },
        {
          q: "How do I report a bug or request a feature?",
          a: "We love hearing from users! Email support@caremetricai.com with bug reports or feature requests. We actively prioritize development based on user feedback and announce new features regularly in your dashboard."
        }
      ]
    },
    {
      category: "Time Savings & Results",
      icon: Clock,
      color: "indigo",
      questions: [
        {
          q: "How much time will I actually save?",
          a: "Most nurses save 2-3 hours daily on documentation. If you typically spend 30-45 minutes per note, AI reduces that to 5-10 minutes. Over a week, that's 10-15 hours back in your schedule for patient care or personal time!"
        },
        {
          q: "Will my documentation quality improve?",
          a: "Yes! Users typically see 15-25% improvement in compliance scores and quality metrics. AI ensures all Medicare elements are included, clinical reasoning is clearly documented, and terminology is precise and professional."
        },
        {
          q: "How quickly will I see results?",
          a: "Most nurses see immediate time savings on their first enhanced note. Within a week of regular use, you'll notice improved documentation habits, better compliance scores, and significantly reduced charting stress."
        },
        {
          q: "What do other nurses say about CareMetric AI?",
          a: "Nurses consistently report: 'I got my evenings back', 'My compliance scores improved dramatically', 'I feel more confident in my documentation', and 'I can focus more on patient care instead of paperwork'. Check our Home page for testimonials!"
        }
      ]
    }
  ];

  const filteredCategories = searchTerm
    ? faqCategories
        .map(cat => ({
          ...cat,
          questions: cat.questions.filter(
            q =>
              q.q.toLowerCase().includes(searchTerm.toLowerCase()) ||
              q.a.toLowerCase().includes(searchTerm.toLowerCase())
          )
        }))
        .filter(cat => cat.questions.length > 0)
    : faqCategories;

  const toggleCategory = (category) => {
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const toggleQuestion = (categoryIndex, questionIndex) => {
    const key = `${categoryIndex}-${questionIndex}`;
    setExpandedQuestion(expandedQuestion === key ? null : key);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
              <HelpCircle className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900">
            Frequently Asked Questions
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Everything you need to know about CareMetric AI. Can't find what you're looking for? 
            Contact us at <a href="mailto:support@caremetricai.com" className="text-blue-600 hover:underline">support@caremetricai.com</a>
          </p>
        </div>

        {/* Search */}
        <Card className="shadow-lg">
          <CardContent className="p-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                placeholder="Search questions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-12 text-base"
              />
            </div>
            {searchTerm && (
              <p className="text-sm text-gray-600 mt-3">
                Found {filteredCategories.reduce((acc, cat) => acc + cat.questions.length, 0)} result(s)
              </p>
            )}
          </CardContent>
        </Card>

        {/* FAQ Categories */}
        <div className="space-y-4">
          {filteredCategories.map((category, catIdx) => (
            <Card key={catIdx} className="shadow-lg overflow-hidden">
              <CardHeader
                className={`cursor-pointer bg-gradient-to-r from-${category.color}-50 to-${category.color}-100 hover:from-${category.color}-100 hover:to-${category.color}-200 transition-colors p-6`}
                onClick={() => toggleCategory(category.category)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 bg-white rounded-lg shadow`}>
                      <category.icon className={`w-6 h-6 text-${category.color}-600`} />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{category.category}</CardTitle>
                      <p className="text-sm text-gray-600 mt-1">
                        {category.questions.length} question{category.questions.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  {expandedCategory === category.category ? (
                    <ChevronUp className="w-6 h-6 text-gray-600" />
                  ) : (
                    <ChevronDown className="w-6 h-6 text-gray-600" />
                  )}
                </div>
              </CardHeader>

              {(expandedCategory === category.category || searchTerm) && (
                <CardContent className="p-6 space-y-4 bg-white">
                  {category.questions.map((item, qIdx) => (
                    <div key={qIdx} className="border-b last:border-b-0 pb-4 last:pb-0">
                      <button
                        onClick={() => toggleQuestion(catIdx, qIdx)}
                        className="w-full text-left flex items-start justify-between gap-3 group"
                      >
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                            {item.q}
                          </h4>
                        </div>
                        {expandedQuestion === `${catIdx}-${qIdx}` ? (
                          <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0 mt-1" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0 mt-1" />
                        )}
                      </button>
                      
                      {expandedQuestion === `${catIdx}-${qIdx}` && (
                        <div className="mt-3 pl-4 border-l-2 border-blue-200">
                          <p className="text-gray-700 leading-relaxed">{item.a}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {/* Still Have Questions CTA */}
        <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-xl">
          <CardContent className="p-8 text-center space-y-4">
            <h2 className="text-2xl md:text-3xl font-bold">Still Have Questions?</h2>
            <p className="text-lg text-blue-100">
              Our team is here to help! Get in touch and we'll respond quickly.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Link to={createPageUrl("Support")}>
                <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                  Contact Support
                </Button>
              </Link>
              <Link to={createPageUrl("Home")}>
                <Button size="lg" variant="outline" className="w-full sm:w-auto bg-white/10 hover:bg-white/20 text-white border-white">
                  Back to Home
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link to={createPageUrl("Pricing")}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardContent className="p-6 text-center">
                <CreditCard className="w-8 h-8 text-blue-600 mx-auto mb-3" />
                <h3 className="font-semibold text-gray-900 mb-2">View Pricing</h3>
                <p className="text-sm text-gray-600">See our transparent pricing plans</p>
              </CardContent>
            </Card>
          </Link>
          
          <Link to={createPageUrl("Features")}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardContent className="p-6 text-center">
                <Zap className="w-8 h-8 text-purple-600 mx-auto mb-3" />
                <h3 className="font-semibold text-gray-900 mb-2">Explore Features</h3>
                <p className="text-sm text-gray-600">Learn about all our capabilities</p>
              </CardContent>
            </Card>
          </Link>
          
          <Link to={createPageUrl("About")}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardContent className="p-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-3" />
                <h3 className="font-semibold text-gray-900 mb-2">About Us</h3>
                <p className="text-sm text-gray-600">Learn more about CareMetric AI</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}