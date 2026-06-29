import { useState } from 'react';
import { configNotReadyMessage } from '@/lib/aiFeatureError';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles, BookOpen, AlertTriangle, CheckCircle2, Loader2, Brain } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { useQuery } from '@tanstack/react-query';
import { generateTrainingCourse } from '@/functions/generateTrainingCourse';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';

export default function AITrainingGenerator() {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    topic: '',
    audience_roles: [],
    state: '',
    setting: 'home_health',
    skill_level: 'intermediate',
    time_length_minutes: 30,
    policy_ids: [],
    include_competency: true
  });
  const [generatedCourse, setGeneratedCourse] = useState(null);

  const { data: policies = [] } = useQuery({
    queryKey: ['active-policies'],
    queryFn: () => base44.entities.PolicyLibrary.filter({ status: 'active' }, 'title', 100),
    initialData: []
  });

  const availableRoles = [
    'RN',
    'LPN',
    'Home Health Aide',
    'Physical Therapist',
    'Occupational Therapist',
    'Speech Therapist',
    'Social Worker',
    'Chaplain',
    'Administrative Staff',
    'DME Technician'
  ];

  const handleRoleToggle = (role) => {
    setFormData(prev => ({
      ...prev,
      audience_roles: prev.audience_roles.includes(role)
        ? prev.audience_roles.filter(r => r !== role)
        : [...prev.audience_roles, role]
    }));
  };

  const handlePolicyToggle = (policyId) => {
    setFormData(prev => ({
      ...prev,
      policy_ids: prev.policy_ids.includes(policyId)
        ? prev.policy_ids.filter(id => id !== policyId)
        : [...prev.policy_ids, policyId]
    }));
  };

  const handleGenerate = async () => {
    if (!formData.topic.trim()) {
      toast.error('Please enter a training topic');
      return;
    }

    if (formData.audience_roles.length === 0) {
      toast.error('Please select at least one audience role');
      return;
    }

    setLoading(true);

    try {
      const response = await generateTrainingCourse(formData);
      // functions.invoke returns the full axios response; body is under .data.
      setGeneratedCourse(response?.data || response);
      toast.success('Training course generated successfully!');
    } catch (error) {
      const friendly = configNotReadyMessage(error);
      if (!friendly) console.error('Generation failed:', error);
      toast.error(friendly || ('Failed to generate course: ' + error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Brain}
        eyebrow="My Learning"
        title="AI Training Generator"
        description="Create audit-ready in-service training with AI"
        favoritePage="AITrainingGenerator"
      />

      {/* Important Notice */}
      <Alert className="bg-amber-50 border-amber-300">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <AlertDescription className="text-amber-900">
          <strong>Review Required:</strong> All AI-generated content will be created in "Pending Review" status. An educator or admin must review and approve before it becomes active for employees.
        </AlertDescription>
      </Alert>

      {/* Generation Form */}
      <Card>
        <CardHeader>
          <CardTitle>Course Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Topic */}
          <div className="space-y-2">
            <Label htmlFor="topic">Training Topic <span className="text-red-500">*</span></Label>
            <Input
              id="topic"
              placeholder="e.g., OASIS M Items Documentation, Infection Control, Falls Prevention"
              value={formData.topic}
              onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
            />
          </div>

          {/* Audience Roles */}
          <div className="space-y-2">
            <Label>Target Audience <span className="text-red-500">*</span></Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableRoles.map(role => (
                <div key={role} className="flex items-center space-x-2">
                  <Checkbox
                    id={role}
                    checked={formData.audience_roles.includes(role)}
                    onCheckedChange={() => handleRoleToggle(role)}
                  />
                  <label htmlFor={role} className="text-sm cursor-pointer">{role}</label>
                </div>
              ))}
            </div>
          </div>

          {/* Setting and State */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="setting">Care Setting</Label>
              <Select value={formData.setting} onValueChange={(val) => setFormData({ ...formData, setting: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                  <SelectItem value="dme">DME</SelectItem>
                  <SelectItem value="all">All Settings</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="state">State (optional)</Label>
              <Input
                id="state"
                placeholder="e.g., Pennsylvania"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </div>
          </div>

          {/* Skill Level and Duration */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="skill_level">Skill Level</Label>
              <Select value={formData.skill_level} onValueChange={(val) => setFormData({ ...formData, skill_level: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="time_length">Target Duration (minutes)</Label>
              <Input
                id="time_length"
                type="number"
                min="10"
                max="120"
                value={formData.time_length_minutes}
                onChange={(e) => setFormData({ ...formData, time_length_minutes: parseInt(e.target.value) })}
              />
            </div>
          </div>

          {/* Policy Selection */}
          <div className="space-y-2">
            <Label>Include Internal Policies (optional)</Label>
            <p className="text-sm text-slate-600 mb-2">Select policies to use as primary authority</p>
            <div className="max-h-48 overflow-y-auto border rounded-lg p-3 space-y-2">
              {policies.length === 0 ? (
                <p className="text-sm text-slate-500">No active policies available</p>
              ) : (
                policies.map(policy => (
                  <div key={policy.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={policy.id}
                      checked={formData.policy_ids.includes(policy.id)}
                      onCheckedChange={() => handlePolicyToggle(policy.id)}
                    />
                    <label htmlFor={policy.id} className="text-sm cursor-pointer">
                      {policy.title} <Badge variant="outline" className="ml-2">{policy.category}</Badge>
                    </label>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Competency Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include_competency"
              checked={formData.include_competency}
              onCheckedChange={(checked) => setFormData({ ...formData, include_competency: checked })}
            />
            <label htmlFor="include_competency" className="text-sm cursor-pointer">
              Generate competency checklist with supervisor validation
            </label>
          </div>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating Course...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate Training Course
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generation Result */}
      {generatedCourse && (
        <Card className="border-2 border-emerald-300 bg-emerald-50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
              <CardTitle className="text-emerald-900">Course Generated Successfully!</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold text-slate-900 mb-1">{generatedCourse.title}</h3>
              <Badge className="bg-amber-500">Pending Review</Badge>
              {generatedCourse.needs_sme_review && (
                <Badge className="bg-orange-500 ml-2">SME Review Required</Badge>
              )}
            </div>

            {generatedCourse.risk_flags && generatedCourse.risk_flags.length > 0 && (
              <Alert className="bg-orange-50 border-orange-300">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-900">
                  <strong>Risk Flags:</strong>
                  <ul className="list-disc ml-5 mt-1">
                    {generatedCourse.risk_flags.map((flag, idx) => (
                      <li key={idx}>{flag}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-3">
              <Button
                onClick={() => window.location.href = `${createPageUrl('AdminTraining')}?tab=courses&course=${generatedCourse.course_id}`}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                Review & Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setGeneratedCourse(null);
                  setFormData({
                    topic: '',
                    audience_roles: [],
                    state: '',
                    setting: 'home_health',
                    skill_level: 'intermediate',
                    time_length_minutes: 30,
                    policy_ids: [],
                    include_competency: true
                  });
                }}
              >
                Generate Another Course
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}