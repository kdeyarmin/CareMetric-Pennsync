import React, { useEffect, useState, Suspense, lazy } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Download,
  Mail,
  Heart,
  Activity,
  Droplet,
  Brain,
  Bandage,
  Shield,
  AlertCircle,
  Search,
  Loader2,
  CheckCircle2,
  Settings,
  MessageSquare,
  Send,
  FileText
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HandoutCustomizer from "../components/education/HandoutCustomizer";
import HandoutPreview from "../components/education/HandoutPreview";
import HandoutStyleCustomizer from "../components/education/HandoutStyleCustomizer";
import PersonalizedEducationGenerator from "../components/education/PersonalizedEducationGenerator";
import { toast } from 'sonner';

const PatientEducation = lazy(() => import("@/components/hub-tabs/PatientEducation"));
const PatientEducationPortal = lazy(() => import("@/components/hub-tabs/PatientEducationPortal"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so redirects from the retired standalone pages (Teach-Back,
// Sent / Tracking) land on the right tab. "create" is the default.
const TAB_KEYS = ["create", "teachback", "tracking"];

const educationTopics = [
  {
    id: 'chf',
    title: 'Congestive Heart Failure (CHF)',
    icon: Heart,
    color: 'from-red-500 to-gold-500',
    description: 'Learn about managing heart failure, recognizing symptoms, and preventing complications.'
  },
  {
    id: 'copd',
    title: 'COPD',
    icon: Activity,
    color: 'from-blue-500 to-navy-500',
    description: 'Breathing techniques, medication management, and lifestyle tips for COPD patients.'
  },
  {
    id: 'copd_oxygen',
    title: 'Home Oxygen Therapy',
    icon: Activity,
    color: 'from-navy-500 to-blue-500',
    description: 'Safe use of home oxygen equipment, oxygen therapy guidelines, and troubleshooting.'
  },
  {
    id: 'diabetes',
    title: 'Diabetes Management',
    icon: Droplet,
    color: 'from-navy-500 to-indigo-500',
    description: 'Blood sugar monitoring, diet, medications, and preventing diabetes complications.'
  },
  {
    id: 'hypertension',
    title: 'High Blood Pressure',
    icon: Activity,
    color: 'from-orange-500 to-red-500',
    description: 'Managing blood pressure through lifestyle changes and medications.'
  },
  {
    id: 'stroke',
    title: 'Stroke Recovery',
    icon: Brain,
    color: 'from-teal-500 to-emerald-500',
    description: 'Recovery tips, preventing another stroke, and recognizing warning signs.'
  },
  {
    id: 'wound_care',
    title: 'Wound Care',
    icon: Bandage,
    color: 'from-emerald-500 to-emerald-500',
    description: 'Proper wound care techniques, signs of infection, and promoting healing.'
  },
  {
    id: 'fall_prevention',
    title: 'Fall Prevention',
    icon: Shield,
    color: 'from-amber-500 to-orange-500',
    description: 'Home safety tips and strategies to prevent falls at home.'
  },
  {
    id: 'pain_management',
    title: 'Pain Management',
    icon: AlertCircle,
    color: 'from-gold-500 to-navy-500',
    description: 'Managing pain safely with medications and non-drug approaches.'
  },
  {
    id: 'ckd',
    title: 'Chronic Kidney Disease',
    icon: Droplet,
    color: 'from-amber-500 to-orange-500',
    description: 'Managing kidney disease, diet modifications, and understanding CKD stages.'
  },
  {
    id: 'osteoporosis',
    title: 'Osteoporosis & Bone Health',
    icon: Shield,
    color: 'from-slate-500 to-slate-500',
    description: 'Building strong bones, fall prevention, and osteoporosis management.'
  },
  {
    id: 'dementia_care',
    title: 'Dementia & Memory Care',
    icon: Brain,
    color: 'from-navy-600 to-navy-500',
    description: 'Communication strategies, daily care tips, and caregiver support for dementia.'
  },
  {
    id: 'anticoagulation',
    title: 'Blood Thinner Management',
    icon: Droplet,
    color: 'from-red-500 to-red-500',
    description: 'Safe use of blood thinners, diet considerations, and recognizing bleeding risks.'
  },
  {
    id: 'nutrition',
    title: 'Healthy Eating for Seniors',
    icon: Heart,
    color: 'from-lime-500 to-emerald-500',
    description: 'Essential nutrients, meal planning, and overcoming common eating challenges.'
  },
  {
    id: 'pneumonia',
    title: 'Pneumonia Recovery',
    icon: Activity,
    color: 'from-navy-500 to-blue-500',
    description: 'Recovery tips, breathing exercises, and preventing pneumonia complications.'
  },
  {
    id: 'uti',
    title: 'UTI Prevention & Care',
    icon: Droplet,
    color: 'from-blue-500 to-indigo-500',
    description: 'Preventing and treating urinary tract infections, catheter care tips.'
  },
  {
    id: 'parkinsons',
    title: 'Parkinson\'s Disease',
    icon: Brain,
    color: 'from-navy-500 to-gold-500',
    description: 'Living with Parkinson\'s, medication management, and daily living strategies.'
  },
  {
    id: 'catheter_care',
    title: 'Urinary Catheter Care',
    icon: Droplet,
    color: 'from-teal-500 to-navy-500',
    description: 'Daily catheter care, preventing infection, and managing drainage bags.'
  },
  {
    id: 'tube_feeding',
    title: 'Tube Feeding Care',
    icon: Heart,
    color: 'from-orange-500 to-amber-500',
    description: 'Tube feeding instructions, site care, and preventing complications.'
  },
  {
    id: 'hospice_comfort',
    title: 'Hospice & Comfort Care',
    icon: Heart,
    color: 'from-gold-500 to-red-500',
    description: 'Comfort measures, symptom management, and supporting loved ones in hospice.'
  }
];

export default function PatientEducationHub() {
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [patientId, setPatientId] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEmailing, setIsEmailing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSections, setSelectedSections] = useState({});
  const [customNotes, setCustomNotes] = useState("");
  const [showCustomization, setShowCustomization] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [readingLevel, setReadingLevel] = useState("5th-6th");
  const [format, setFormat] = useState("comprehensive");
  const [styleOptions, setStyleOptions] = useState({
    colorScheme: 'penn_health',
    fontFamily: 'helvetica',
    layout: 'standard',
    customHeader: '',
    customFooter: '',
    agencyName: '',
    agencyPhone: ''
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "create";
  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and the
  // redirects from the retired pages deep-link correctly. "create" is the
  // default, so it stays a clean /PatientEducationHub with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "create" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /PatientEducationHub. Only fires when the param resolved
  // to the default tab, leaving valid deep-links like ?tab=teachback untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "create") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
  });

  const selectedPatient = patients.find(p => p.id === patientId);

  const filteredTopics = educationTopics.filter(topic =>
    topic.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    topic.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Initialize selections when topic changes
  React.useEffect(() => {
    if (selectedTopic) {
      const template = educationTopics.find(t => t.id === selectedTopic.id);
      if (template) {
        // Auto-select all sections and bullets by default
        const _initialSelections = {};
        // Since templates are defined in the backend function, we'll handle this dynamically
        setSelectedSections({});
        setCustomNotes("");
        setShowCustomization(false);
      }
    }
  }, [selectedTopic]);

  const handleDownload = async () => {
    if (!selectedTopic) return;
    
    setIsGenerating(true);
    setSuccessMessage("");
    
    const diagnostics = {
      condition: selectedTopic.id,
      hasPatient: !!selectedPatient,
      hasSections: Object.keys(selectedSections).length > 0,
      hasNotes: !!customNotes,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      browser: navigator.userAgent.match(/(firefox|msie|chrome|safari|trident)/gi)?.[0] || 'unknown'
    };
    
    try {
      const payload = {
        condition: selectedTopic.id,
        patientName: selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : null,
        action: 'download',
        selectedSections: Object.keys(selectedSections).length > 0 ? selectedSections : null,
        customNotes: customNotes || null,
        readingLevel,
        format,
        styleOptions: styleOptions
      };

      const response = await base44.functions.invoke('generatePatientHandout', payload);

      // Handle axios response wrapper - check multiple levels
      let data = response;
      if (response?.data) {
        data = response.data;
      }
      if (data?.data) {
        data = data.data;
      }

      if (data?.error) {
        throw new Error(`Backend error: ${data.error}${data.details ? '\n\n' + data.details : ''}`);
      }

      if (!data || !data.pdf) {
        throw new Error(`Invalid response from handout generator.`);
      }

      // Decode base64 PDF and download
      try {
        const binaryString = atob(data.pdf);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename || `${selectedTopic.id}_handout.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
      } catch (decodeError) {
        throw new Error(`Failed to process PDF: ${decodeError.message}`);
      }

      setSuccessMessage("Handout downloaded successfully!");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (error) {
      console.error('Error downloading handout:', error);
      console.error('Error type:', error.constructor.name);
      console.error('Error stack:', error.stack);
      
      // Log to backend for debugging
      try {
        await base44.asServiceRole.entities.SystemLog.create({
          job_name: 'PDF Download Error (Frontend)',
          job_type: 'other',
          status: 'error',
          message: `Frontend PDF download failed for ${selectedTopic.id}`,
          details: {
            ...diagnostics,
            errorMessage: error.message,
            errorType: error.constructor.name,
            responseData: error?.response?.data
          }
        });
      } catch (logErr) {
        console.error('Failed to log frontend error:', logErr);
      }
      
      const errorDetails = error?.response?.data?.error || error?.response?.data?.details || error?.message || 'Failed to generate handout. Please try again.';
      toast.error(`Error generating handout:\n\n${errorDetails}\n\nCheck console for details.`);
    }
    
    setIsGenerating(false);
  };

  const handleEmail = async () => {
    if (!selectedTopic || !patientEmail) return;
    
    setIsEmailing(true);
    setSuccessMessage("");
    
    try {
      const response = await base44.functions.invoke('generatePatientHandout', {
        condition: selectedTopic.id,
        patientName: selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : null,
        patientEmail,
        action: 'email',
        selectedSections: Object.keys(selectedSections).length > 0 ? selectedSections : null,
        customNotes: customNotes || null,
        readingLevel,
        format,
        styleOptions: styleOptions
      });


      // Handle axios response wrapper
      const data = response?.data || response;

      if (data?.error) {
        throw new Error(data.error);
      }

      setSuccessMessage(`Handout emailed to ${patientEmail}!`);
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (error) {
      console.error('Error emailing handout:', error);
      const errorDetails = error?.response?.data?.error || error?.response?.data?.details || error?.message || 'Failed to email handout. Please try again.';
      toast.error(`Error emailing handout:\n\n${errorDetails}`);
    }
    
    setIsEmailing(false);
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Heart}
        eyebrow="Patient Care"
        title="Patient Education Hub"
        description="Generate personalized, AI-powered educational materials for your patients"
        favoritePage="PatientEducationHub"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="create" className="min-h-[44px] flex-1 gap-2 sm:flex-none">
            <BookOpen className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>Create &amp; Customize</span>
          </TabsTrigger>
          <TabsTrigger value="teachback" className="min-h-[44px] flex-1 gap-2 sm:flex-none">
            <MessageSquare className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>Teach-Back</span>
          </TabsTrigger>
          <TabsTrigger value="tracking" className="min-h-[44px] flex-1 gap-2 sm:flex-none">
            <Send className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>Sent / Tracking</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4 sm:space-y-6">
      {/* AI Personalized Generator for Selected Patient */}
      {selectedPatient && (
        <div className="mb-4 sm:mb-6">
          <PersonalizedEducationGenerator
            patient={selectedPatient}
            carePlans={[]}
            recentVisits={[]}
          />
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <Card className="mb-4 sm:mb-6 modern-card border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-3 sm:p-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <p className="text-emerald-800 font-medium">{successMessage}</p>
          </CardContent>
        </Card>
      )}

      {/* Search and Patient Selection */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <Label className="text-xs sm:text-sm mb-2 block">Select Patient (Optional)</Label>
              <Select value={patientId} onValueChange={(value) => {
                setPatientId(value);
                const patient = patients.find(p => p.id === value);
                if (patient?.email) {
                  setPatientEmail(patient.email);
                }
              }}>
                <SelectTrigger className="h-11 touch-target">
                  <SelectValue placeholder="Select patient for personalization..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.first_name} {patient.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs sm:text-sm mb-2 block">Search Topics</Label>
              <div className="relative">
                <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search education topics..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-11 touch-target"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Topics Grid */}
        <div className="lg:col-span-2">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 mb-3 sm:mb-4">Standard Education Templates</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {filteredTopics.map((topic) => {
              const Icon = topic.icon;
              const isSelected = selectedTopic?.id === topic.id;
              
              return (
                <Card
                  key={topic.id}
                  className={`modern-card-interactive cursor-pointer touch-target group ${
                    isSelected ? 'border-blue-500 shadow-md ring-1 ring-blue-500' : ''
                  }`}
                  onClick={() => setSelectedTopic(topic)}
                >
                  <CardContent className="p-3 sm:p-4 md:p-6">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className={`p-2 sm:p-3 rounded-xl bg-slate-50 border border-slate-100 flex-shrink-0 transition-colors ${isSelected ? 'bg-blue-50 border-blue-100' : 'group-hover:bg-white'}`}>
                        <Icon className={`w-5 h-5 sm:w-6 sm:h-6 transition-colors ${isSelected ? 'text-blue-600' : 'text-slate-500 group-hover:text-blue-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={`font-semibold text-sm sm:text-base mb-1 transition-colors ${isSelected ? 'text-blue-900' : 'text-slate-800 group-hover:text-blue-700'}`}>{topic.title}</h3>
                        <p className="text-xs sm:text-sm text-slate-500">{topic.description}</p>
                        {isSelected && (
                          <Badge className="mt-2 bg-blue-600">Selected</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Actions Panel */}
        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader className="p-3 sm:p-4 md:p-6">
              <CardTitle className="text-base sm:text-lg">Generate Handout</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4">
              {!selectedTopic ? (
                <EmptyState icon={BookOpen} title="Select a topic" description="Choose a topic above to generate a patient handout." />
              ) : (
                <>
                  <div>
                    <Label>Selected Topic</Label>
                    <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="font-medium text-blue-900">{selectedTopic.title}</p>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm">Patient (Optional)</Label>
                    <Select value={patientId} onValueChange={(value) => {
                      setPatientId(value);
                      const patient = patients.find(p => p.id === value);
                      if (patient?.email) {
                        setPatientEmail(patient.email);
                      }
                    }}>
                      <SelectTrigger className="mt-2 h-11 touch-target">
                        <SelectValue placeholder="Select patient..." />
                      </SelectTrigger>
                      <SelectContent>
                        {patients.map(patient => (
                          <SelectItem key={patient.id} value={patient.id}>
                            {patient.first_name} {patient.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm">Email Address (for emailing)</Label>
                    <Input
                      type="email"
                      placeholder="patient@example.com"
                      value={patientEmail}
                      onChange={(e) => setPatientEmail(e.target.value)}
                      className="mt-2 h-11 touch-target"
                    />
                  </div>

                  {/* Customization Toggle */}
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCustomization(!showCustomization)}
                      className="w-full min-h-[44px]"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      {showCustomization ? 'Hide' : 'Show'} Customization
                    </Button>
                  </div>

                  {/* Customization Panel */}
                  {showCustomization && (
                    <div className="space-y-4 pt-2">
                      <div>
                        <Label className="text-sm">Reading Level</Label>
                        <Select value={readingLevel} onValueChange={setReadingLevel}>
                          <SelectTrigger className="mt-2 h-11 touch-target">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3rd-4th">3rd-4th Grade (Very Simple)</SelectItem>
                            <SelectItem value="5th-6th">5th-6th Grade (Simple)</SelectItem>
                            <SelectItem value="7th-8th">7th-8th Grade (Moderate)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-sm">Format Style</Label>
                        <Select value={format} onValueChange={setFormat}>
                          <SelectTrigger className="mt-2 h-11 touch-target">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="comprehensive">Comprehensive</SelectItem>
                            <SelectItem value="quick_reference">Quick Reference</SelectItem>
                            <SelectItem value="caregiver_focused">Caregiver Focused</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <HandoutStyleCustomizer
                        styleOptions={styleOptions}
                        onStyleChange={setStyleOptions}
                      />

                      <HandoutCustomizer
                        topicId={selectedTopic.id}
                        selectedSections={selectedSections}
                        onSelectionChange={setSelectedSections}
                      />

                      <div>
                        <Label>Custom Notes / Instructions</Label>
                        <Textarea
                          placeholder="Add patient-specific instructions or notes here..."
                          value={customNotes}
                          onChange={(e) => setCustomNotes(e.target.value)}
                          className="mt-2 min-h-[100px]"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          These notes will appear at the end of the handout.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 space-y-2">
                    <Button
                      onClick={() => setShowPreview(true)}
                      variant="outline"
                      className="w-full border-blue-600 text-blue-600 hover:bg-blue-50 min-h-[44px]"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      Preview Handout
                    </Button>

                    <Button
                      onClick={handleDownload}
                      disabled={isGenerating}
                      className="w-full bg-blue-600 hover:bg-blue-700 min-h-[44px]"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Download PDF
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={handleEmail}
                      disabled={!patientEmail || isEmailing}
                      variant="outline"
                      className="w-full min-h-[44px]"
                    >
                      {isEmailing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          Email to Patient
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="pt-4 border-t text-xs text-slate-500">
                    <p className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /> Generated handouts include the Penn Home Health logo and are printer-friendly.</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Preview Modal */}
      <HandoutPreview
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        template={selectedTopic}
        patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : null}
        selectedSections={selectedSections}
        customNotes={customNotes}
        onDownload={() => {
          setShowPreview(false);
          handleDownload();
        }}
        onEmail={() => {
          setShowPreview(false);
          handleEmail();
        }}
      />
        </TabsContent>

        <TabsContent value="teachback">
          <Suspense fallback={<LoadingState />}>
            <PatientEducation />
          </Suspense>
        </TabsContent>

        <TabsContent value="tracking">
          <Suspense fallback={<LoadingState />}>
            <PatientEducationPortal />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}