import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen, Download, Search, MessageCircle,
  FileText, Lightbulb, Award, Sparkles, Users,
  ClipboardList, Phone, Mail, HelpCircle, Target, CheckCircle2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { generateUserManual } from "@/functions/generateUserManual";
import { toast } from 'sonner';
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function Help() {
  const [searchQuery, setSearchQuery] = useState("");
  const [downloading, setDownloading] = useState(false);

  const handleDownloadManual = async () => {
    setDownloading(true);
    try {
      const response = await generateUserManual({});
      const pdfData = response?.data ?? response;

      if (!pdfData) {
        throw new Error("No document data was returned.");
      }
      
      // Create blob and download
      const blob = new Blob([pdfData], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'PennSync_User_Manual.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error('Failed to download manual: ' + message);
    } finally {
      setDownloading(false);
    }
  };

  const quickLinks = [
    {
      title: "Smart Notes",
      description: "AI-powered clinical documentation",
      icon: Sparkles,
      topics: ["Creating notes", "Voice recording", "AI enhancement", "Best practices"]
    },
    {
      title: "Patient Management",
      description: "Adding and managing patient records",
      icon: Users,
      topics: ["Add new patient", "Search & filter", "Patient details", "Favorites"]
    },
    {
      title: "OASIS Tools",
      description: "Smart assessment with AI assistance",
      icon: ClipboardList,
      topics: ["Smart OASIS", "PDF upload", "Compliance check", "PDGM analysis"]
    },
    {
      title: "Fax Management",
      description: "Send and track faxes",
      icon: FileText,
      topics: ["Camera capture", "Document upload", "Batch send", "Templates"]
    },
    {
      title: "Visit Scribe",
      description: "Voice-to-text documentation",
      icon: Phone,
      topics: ["Audio recording", "Auto transcription", "Clinical extraction"]
    },
    {
      title: "Care Plans",
      description: "AI care plan suggestions",
      icon: Award,
      topics: ["AI suggestions", "Visual builder", "Gap analysis", "Progress tracking"]
    }
  ];

  const faqs = [
    {
      q: "How do I document a visit using voice?",
      a: "Go to Visit Scribe, click 'Start Recording', speak your observations, then stop. AI automatically transcribes and generates a Medicare-compliant note."
    },
    {
      q: "Why should I always select a patient in Smart Notes?",
      a: "Selecting a patient allows AI to personalize documentation using their specific diagnoses, medications, and history. The more visits you document for a patient, the better AI recommendations become."
    },
    {
      q: "How does AI enhance my clinical notes?",
      a: "AI expands your observations into skilled nursing language, adds medical necessity justification, includes homebound documentation, and ensures Medicare compliance - all while preserving your clinical intent."
    },
    {
      q: "What if AI generates incorrect information?",
      a: "Always review AI-generated content. You can edit directly, regenerate with different parameters, or add your own text. AI learns from your corrections over time."
    },
    {
      q: "How do I send a fax from my phone?",
      a: "Use the Camera tab in Send Fax. Capture photos of your documents, add recipient number, and send. AI generates a professional cover page automatically."
    },
    {
      q: "Can I create custom documentation templates?",
      a: "Yes! Use Clinical Library to create quick phrases that expand into full documentation. Support both generic and patient-specific templates with variables."
    },
    {
      q: "How do OASIS suggestions work?",
      a: "AI analyzes patient history, recent visit notes, and diagnosis to suggest appropriate OASIS responses. It highlights compliance risks and optimizes for PDGM case mix."
    },
    {
      q: "What happens to flagged compliance issues?",
      a: "Flagged notes appear in the Compliance Dashboard. Review them, use AI suggestions to fix issues, and re-save. System tracks improvements over time."
    }
  ];

  const filteredFAQs = faqs.filter(faq => 
    searchQuery === "" || 
    faq.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.a.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <PageContainer>
      <PageHeader
        icon={HelpCircle}
        eyebrow="Tools"
        title="Help & Resources"
        description="Everything you need to master PennSync"
        favoritePage="Help"
        actions={
          <Button
            onClick={handleDownloadManual}
            disabled={downloading}
            className="bg-gold-400 hover:bg-gold-300 text-navy-900 font-semibold shadow-lg min-h-[48px] px-6"
          >
            <Download className="w-5 h-5 mr-2" />
            {downloading ? 'Generating...' : 'Download Full Manual'}
          </Button>
        }
      />

        <Tabs defaultValue="quickstart" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-2 h-auto p-1">
            <TabsTrigger value="quickstart" className="flex items-center gap-2 py-3">
              <Lightbulb className="w-4 h-4" />
              <span className="hidden sm:inline">Quick Start</span>
              <span className="sm:hidden">Start</span>
            </TabsTrigger>
            <TabsTrigger value="features" className="flex items-center gap-2 py-3">
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Features</span>
              <span className="sm:hidden">Features</span>
            </TabsTrigger>
            <TabsTrigger value="faq" className="flex items-center gap-2 py-3">
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">FAQ</span>
              <span className="sm:hidden">FAQ</span>
            </TabsTrigger>
            <TabsTrigger value="contact" className="flex items-center gap-2 py-3">
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">Contact</span>
              <span className="sm:hidden">Contact</span>
            </TabsTrigger>
          </TabsList>

          {/* Quick Start Tab */}
          <TabsContent value="quickstart" className="space-y-6">
            <Card className="border-navy-900 border-2">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-6 h-6 text-navy-900" />
                  Welcome to PennSync
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <p className="text-slate-700 leading-relaxed">
                  PennSync was designed and built by <strong className="text-navy-900">Kevin Deyarmin</strong> specifically 
                  for the Penn Home Health team. This system combines cutting-edge AI technology with Medicare-compliant 
                  workflows to help you provide the highest quality patient care while reducing administrative burden.
                </p>
                <div className="bg-gold-400/10 border-l-4 border-gold-400 p-4 rounded">
                  <p className="text-sm text-slate-700">
                    <strong>Our Mission:</strong> Empower Penn clinicians to focus on exceptional patient care by 
                    automating documentation, ensuring compliance, and providing intelligent clinical insights.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Getting Started in 5 Minutes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-navy-900 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">1</div>
                    <div>
                      <p className="font-semibold">Check Your Dashboard</p>
                      <p className="text-slate-600">Review today's visits, alerts, and pending tasks</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-navy-900 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">2</div>
                    <div>
                      <p className="font-semibold">Add or Find Patient</p>
                      <p className="text-slate-600">Use Patients page to add new or search existing</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-navy-900 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">3</div>
                    <div>
                      <p className="font-semibold">Document a Visit</p>
                      <p className="text-slate-600">Use Smart Notes or Visit Scribe (voice recording)</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-navy-900 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">4</div>
                    <div>
                      <p className="font-semibold">Let AI Enhance</p>
                      <p className="text-slate-600">Review AI-generated compliant documentation</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-8 h-8 bg-gold-400 text-navy-900 rounded-full flex items-center justify-center font-bold flex-shrink-0">5</div>
                    <div>
                      <p className="font-semibold">Save & Complete</p>
                      <p className="text-slate-600">Save note, check compliance score, done!</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-gold-400">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-gold-500" />
                    Pro Tips
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-start gap-2">
                    <Badge className="bg-navy-900 flex-shrink-0">TIP</Badge>
                    <p className="text-slate-700">Always select your patient in Smart Notes - AI personalizes everything based on their history</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-navy-900 flex-shrink-0">TIP</Badge>
                    <p className="text-slate-700">Use voice recording in Visit Scribe to save 10-15 minutes per visit</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-navy-900 flex-shrink-0">TIP</Badge>
                    <p className="text-slate-700">Favorite frequently seen patients using the star icon for instant access</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-navy-900 flex-shrink-0">TIP</Badge>
                    <p className="text-slate-700">Create Clinical Library templates for common documentation (wound care, diabetic education)</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Badge className="bg-navy-900 flex-shrink-0">TIP</Badge>
                    <p className="text-slate-700">Check Compliance Dashboard weekly to maintain 95%+ compliance rate</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Features Guide Tab */}
          <TabsContent value="features" className="space-y-6">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {quickLinks.map((feature, idx) => (
                <Card key={idx} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3 text-base">
                      <div className="w-10 h-10 bg-navy-700 rounded-xl flex items-center justify-center">
                        <feature.icon className="w-5 h-5 text-gold-400" />
                      </div>
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-600 mb-4">{feature.description}</p>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Covered Topics:</p>
                      {feature.topics.map((topic, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <div className="w-1.5 h-1.5 bg-gold-400 rounded-full"></div>
                          <span className="text-slate-700">{topic}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="rounded-xl bg-navy-900 text-white p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-xl sm:text-2xl font-bold mb-2">Complete User Manual</h3>
                    <p className="text-navy-100 text-sm sm:text-base">
                      Download the comprehensive 35+ page training guide with step-by-step instructions,
                      screenshots, and best practices for every feature.
                    </p>
                  </div>
                  <Button
                    onClick={handleDownloadManual}
                    disabled={downloading}
                    size="lg"
                    className="bg-gold-400 hover:bg-gold-300 text-navy-900 font-bold shadow-xl min-h-[52px] px-8 w-full sm:w-auto"
                  >
                    <Download className="w-5 h-5 mr-2" />
                    {downloading ? 'Generating PDF...' : 'Download Manual'}
                  </Button>
                </div>
            </div>
          </TabsContent>

          {/* FAQ Tab */}
          <TabsContent value="faq" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Frequently Asked Questions</CardTitle>
                <div className="relative mt-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search FAQ..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {filteredFAQs.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">No FAQs match your search</p>
                ) : (
                  filteredFAQs.map((faq, idx) => (
                    <div key={idx} className="border-l-4 border-gold-400 bg-slate-50 p-4 rounded-r-lg">
                      <p className="font-semibold text-navy-900 mb-2">{faq.q}</p>
                      <p className="text-sm text-slate-700">{faq.a}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contact Tab */}
          <TabsContent value="contact" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="w-5 h-5 text-navy-900" />
                    Technical Support
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="text-slate-700 mb-4">
                    For technical issues, feature requests, or questions about PennSync:
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Users className="w-5 h-5 text-navy-900" />
                      <div>
                        <p className="font-semibold text-navy-900">Kevin Deyarmin</p>
                        <p className="text-sm text-slate-600">System Developer</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                      <Mail className="w-5 h-5 text-navy-900" />
                      <p className="text-sm text-slate-700">kdeyarmin@comcast.net</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b border-slate-100">
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-navy-900" />
                    Training Resources
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-4">
                  <Button
                    onClick={handleDownloadManual}
                    disabled={downloading}
                    variant="outline"
                    className="w-full border-navy-900 text-navy-900 hover:bg-navy-900 hover:text-white"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {downloading ? 'Generating...' : 'User Manual PDF'}
                  </Button>
                  <div className="text-sm text-slate-600 space-y-2">
                    <p className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-navy-500 flex-shrink-0" /> Comprehensive feature documentation</p>
                    <p className="flex items-center gap-2"><Target className="w-4 h-4 text-navy-500 flex-shrink-0" /> Step-by-step workflows</p>
                    <p className="flex items-center gap-2"><Lightbulb className="w-4 h-4 text-navy-500 flex-shrink-0" /> Best practices &amp; pro tips</p>
                    <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" /> Compliance guidelines</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-l-4 border-l-gold-400">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Lightbulb className="w-8 h-8 text-gold-500 flex-shrink-0" />
                  <div>
                    <h3 className="font-bold text-navy-900 mb-2">System Updates & New Features</h3>
                    <p className="text-sm text-slate-700">
                      Watch for in-app announcements on your Dashboard. New features are continuously added 
                      based on Penn team feedback. Check the Announcements widget regularly for training materials 
                      and feature highlights.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Additional Resources */}
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={handleDownloadManual}>
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 bg-navy-900 rounded-full flex items-center justify-center mx-auto mb-3">
                <Download className="w-6 h-6 text-gold-500" />
              </div>
              <h3 className="font-semibold mb-1">User Manual</h3>
              <p className="text-xs text-slate-600">Complete PDF guide</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 bg-gold-400 rounded-full flex items-center justify-center mx-auto mb-3">
                <MessageCircle className="w-6 h-6 text-navy-900" />
              </div>
              <h3 className="font-semibold mb-1">In-App Messaging</h3>
              <p className="text-xs text-slate-600">Contact team members</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 bg-navy-900 rounded-full flex items-center justify-center mx-auto mb-3">
                <Award className="w-6 h-6 text-gold-500" />
              </div>
              <h3 className="font-semibold mb-1">Best Practices</h3>
              <p className="text-xs text-slate-600">Clinical excellence tips</p>
            </CardContent>
          </Card>
        </div>
    </PageContainer>
  );
}