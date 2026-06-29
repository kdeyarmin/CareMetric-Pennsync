import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, BookOpen, Users, Stethoscope, Star, Loader2, CheckCircle2, AlertTriangle, ListChecks, Lightbulb } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { toast } from 'sonner';

export default function UserGuides() {
  const [downloading, setDownloading] = useState(null);

  const handleDownloadGuide = async (guideType, guideName) => {
    setDownloading(guideType);
    try {
      const response = await base44.functions.invoke('generateUserGuidePDF', {
        guide_type: guideType
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${guideName}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Error downloading guide:', error);
      toast.error('Failed to generate guide. Please try again.');
    } finally {
      setDownloading(null);
    }
  };

  const guides = [
    {
      type: 'all_features',
      title: 'Complete User Guide - All Features',
      description: 'Comprehensive guide covering every feature of Penn Sync Healthcare platform',
      icon: BookOpen,
      color: 'purple',
      audience: 'All Users',
      topics: [
        'Dashboard & navigation',
        'Notification center',
        'My Workflow dashboard',
        'Patient management',
        'Document management & templates',
        'Visual PDF editor & field mapping',
        'E-signature workflows',
        'Documentation tools',
        'OASIS & care plans',
        'Patient alerts & monitoring',
        'Quality & compliance',
        'Communication & messaging',
        'Training & personalized learning',
        'Offline documentation mode',
        'Admin features & analytics'
      ],
      featured: true
    },
    {
      type: 'document_management',
      title: 'Document Management Guide',
      description: 'Master PDF templates, visual field editor, and document package creation',
      icon: FileText,
      color: 'blue',
      audience: 'Administrative Staff & Nurses',
      topics: [
        'Template library & categories',
        'Version control',
        'Search & filters',
        'Quick document presets',
        'Custom PDF uploads',
        'Visual field editor',
        'Conditional logic',
        'Dynamic tables',
        'Rich text formatting',
        'Document packages',
        'E-signature setup'
      ]
    },
    {
      type: 'referral_intake',
      title: 'Referral Intake Guide',
      description: 'Step-by-step instructions for uploading and processing referrals with AI assistance',
      icon: FileText,
      color: 'blue',
      audience: 'Administrative Staff',
      topics: [
        'Uploading referral documents',
        'Reviewing AI-extracted data',
        'Patient matching process',
        'Generating admission packets',
        'Using AI features'
      ]
    },
    {
      type: 'admission_documentation',
      title: 'Admission Visit Guide',
      description: 'Complete guide for nurses documenting admission visits with AI-powered tools',
      icon: Stethoscope,
      color: 'green',
      audience: 'Clinical Nurses',
      topics: [
        'Pre-visit preparation',
        'Using Smart Note Assistant',
        'SOAP documentation format',
        'AI quality review',
        'OASIS assessment completion',
        'Medicare compliance checklist'
      ]
    },
    {
      type: 'smart_notes',
      title: 'Smart Notes & Quick Note Guide',
      description: 'Master AI-powered documentation with voice dictation and real-time assistance',
      icon: FileText,
      color: 'blue',
      audience: 'Clinical Nurses',
      topics: [
        'Quick Note interface',
        'Voice dictation',
        'AI enhancement',
        'Compliance checking',
        'Clinical event extraction',
        'Offline documentation'
      ]
    },
    {
      type: 'oasis_assessment',
      title: 'OASIS Assessment Guide',
      description: 'Complete OASIS documentation with AI pre-assessment and PDGM optimization',
      icon: FileText,
      color: 'green',
      audience: 'Clinical Nurses',
      topics: [
        'OASIS overview',
        'AI pre-assessment',
        'Item completion',
        'PDGM case mix',
        'Quality validation',
        'Submission process'
      ]
    },
    {
      type: 'care_plans',
      title: 'Care Plan Management Guide',
      description: 'Create and manage comprehensive care plans with AI-generated suggestions',
      icon: FileText,
      color: 'purple',
      audience: 'Clinical Nurses',
      topics: [
        'Creating care plans',
        'AI suggestions',
        'SMART goals',
        'Progress tracking',
        'Gap analysis',
        'Interdisciplinary coordination'
      ]
    },
    {
      type: 'patient_management',
      title: 'Patient Management Guide',
      description: 'Comprehensive patient record management and Patient 360 view',
      icon: Users,
      color: 'blue',
      audience: 'All Clinical Staff',
      topics: [
        'Patient records',
        'Patient 360 view',
        'Demographics',
        'Medical history',
        'Document management',
        'Care coordination'
      ]
    },
    {
      type: 'training_hub',
      title: 'Training Hub Guide',
      description: 'Complete training modules and track professional development',
      icon: FileText,
      color: 'green',
      audience: 'All Staff',
      topics: [
        'Training modules',
        'Interactive quizzes',
        'Certifications',
        'Personalized learning',
        'Skill development',
        'Performance tracking'
      ]
    },
    {
      type: 'compliance_quality',
      title: 'Compliance & Quality Guide',
      description: 'Maintain Medicare compliance and quality standards with AI monitoring',
      icon: FileText,
      color: 'purple',
      audience: 'Clinical Nurses & Admin',
      topics: [
        'Compliance dashboard',
        'Quality scoring',
        'Medicare guidelines',
        'Regulatory updates',
        'Audit preparation',
        'Performance metrics'
      ]
    },
    {
      type: 'messages',
      title: 'Messaging & Communication Guide',
      description: 'Effective team communication and care coordination',
      icon: FileText,
      color: 'blue',
      audience: 'All Staff',
      topics: [
        'Creating messages',
        'Threading',
        'Patient-specific communication',
        'Priority messages',
        'Team coordination',
        'Care handoffs'
      ]
    },
    {
      type: 'patient_alerts',
      title: 'Patient Alerts & Monitoring Guide',
      description: 'Monitor and respond to patient risk alerts and clinical deterioration',
      icon: FileText,
      color: 'green',
      audience: 'Clinical Nurses',
      topics: [
        'Alert dashboard',
        'Alert types',
        'Severity levels',
        'Action plans',
        'Predictive analytics',
        'Alert resolution'
      ]
    },
    {
      type: 'workflow_notifications',
      title: 'Workflow & Notifications Guide',
      description: 'Master your daily workflow with notifications, tasks, and priority management',
      icon: FileText,
      color: 'blue',
      audience: 'Clinical Nurses',
      topics: [
        'My Workflow dashboard',
        'Notification center',
        'Task management',
        'Priority alerts',
        'Daily schedule',
        'Quick actions'
      ]
    },
    {
      type: 'offline_mode',
      title: 'Offline Documentation Guide',
      description: 'Document patient visits without internet and sync when back online',
      icon: FileText,
      color: 'purple',
      audience: 'Clinical Nurses',
      topics: [
        'Enabling offline mode',
        'Patient data caching',
        'Offline documentation',
        'Auto-sync process',
        'Conflict resolution',
        'Troubleshooting'
      ]
    },
    {
      type: 'personalized_training',
      title: 'AI Personalized Training Guide',
      description: 'Improve documentation quality with AI-driven personalized learning',
      icon: FileText,
      color: 'green',
      audience: 'Clinical Nurses',
      topics: [
        'Training recommendations',
        'Skill gap analysis',
        'Micro-learning modules',
        'Practice scenarios',
        'Performance tracking',
        'Certification progress'
      ]
    }
  ];

  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        eyebrow="Tools"
        title="User Guides & Training Materials"
        description="Download comprehensive PDF guides with step-by-step instructions and screenshots"
        favoritePage="UserGuides"
      />

        {/* Featured Complete Guide */}
        {guides.filter(g => g.featured).map((guide) => {
          const IconComponent = guide.icon;
          return (
            <Card key={guide.type} className="border-l-4 border-l-navy-500 mb-6">
              <CardHeader>
                <div className="flex items-start gap-4">
                  <div className="w-20 h-20 rounded-lg bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100 flex items-center justify-center flex-shrink-0">
                    <IconComponent className="w-10 h-10" />
                  </div>
                  <div className="flex-1">
                    <div className="inline-flex items-center gap-1.5 bg-navy-600 text-white text-xs font-bold px-3 py-1 rounded-full mb-2">
                      <Star className="w-3.5 h-3.5 fill-gold-400 text-gold-400" aria-hidden="true" />
                      RECOMMENDED START HERE
                    </div>
                    <CardTitle className="text-2xl mb-1">{guide.title}</CardTitle>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-slate-500" />
                      <span className="text-sm text-slate-600">{guide.audience}</span>
                    </div>
                    <p className="text-sm text-slate-700 font-medium">{guide.description}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Complete Coverage:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {guide.topics.map((topic, index) => (
                      <div key={index} className="text-sm text-slate-600 flex items-center gap-2 bg-white p-2 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-navy-600" />
                        {topic}
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={() => handleDownloadGuide(guide.type, guide.title)}
                  disabled={downloading === guide.type}
                  className="w-full h-12 text-base"
                >
                  {downloading === guide.type ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Generating PDF...
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5 mr-2" />
                      Download Complete Guide (PDF)
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}

        <div className="mb-4">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Feature-Specific Guides</h2>
          <p className="text-sm text-slate-600">Detailed guides for specific features and workflows</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {guides.filter(g => !g.featured).map((guide) => {
            const IconComponent = guide.icon;
            const iconChip = {
              blue: 'bg-navy-50 text-navy-700 ring-navy-100',
              green: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
              purple: 'bg-violet-50 text-violet-700 ring-violet-100'
            };

            return (
              <Card key={guide.type} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-start gap-4">
                    <div className={`w-16 h-16 rounded-lg ring-1 ring-inset ${iconChip[guide.color] || iconChip.blue} flex items-center justify-center flex-shrink-0`}>
                      <IconComponent className="w-8 h-8" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-xl mb-1">{guide.title}</CardTitle>
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-4 h-4 text-slate-500" />
                        <span className="text-sm text-slate-600">{guide.audience}</span>
                      </div>
                      <p className="text-sm text-slate-600">{guide.description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-slate-700 mb-2">Topics Covered:</p>
                    <ul className="space-y-1">
                      {guide.topics.map((topic, index) => (
                        <li key={index} className="text-sm text-slate-600 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-navy-600" />
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    onClick={() => handleDownloadGuide(guide.type, guide.title)}
                    disabled={downloading === guide.type}
                    className="w-full"
                  >
                    {downloading === guide.type ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Generating PDF...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Download PDF Guide
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="mt-8 border-l-4 border-l-gold-400">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <BookOpen className="w-5 h-5 text-gold-600" />
              About These Guides
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm text-slate-700">
              <li className="flex items-start gap-3">
                <BookOpen className="w-4 h-4 mt-0.5 flex-shrink-0 text-navy-600" aria-hidden="true" />
                <span><strong className="text-slate-900">Comprehensive Instructions:</strong> Each guide includes detailed step-by-step instructions with specific button names, field labels, and navigation paths.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                <span><strong className="text-slate-900">Best Practices:</strong> Learn the recommended workflows and tips for using AI features effectively while maintaining clinical accuracy.</span>
              </li>
              <li className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
                <span><strong className="text-slate-900">Common Pitfalls:</strong> Understand what to avoid and troubleshooting steps for common issues.</span>
              </li>
              <li className="flex items-start gap-3">
                <ListChecks className="w-4 h-4 mt-0.5 flex-shrink-0 text-navy-600" aria-hidden="true" />
                <span><strong className="text-slate-900">Checklists:</strong> Medicare compliance checklists and quality assurance checkpoints included for clinical documentation.</span>
              </li>
              <li className="flex items-start gap-3 mt-4 pt-3 border-t border-slate-100">
                <Lightbulb className="w-4 h-4 mt-0.5 flex-shrink-0 text-gold-600" aria-hidden="true" />
                <span><strong className="text-slate-900">Tip:</strong> Print these guides and keep them available at workstations for quick reference during daily workflows.</span>
              </li>
            </ul>
          </CardContent>
        </Card>
    </PageContainer>
  );
}