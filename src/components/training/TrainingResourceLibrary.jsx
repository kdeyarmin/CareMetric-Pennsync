import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { 
  Search, 
  BookOpen, 
  Clock, 
  CheckCircle2, 
  Play, 
  Filter,
  Video,
  FileText,
  HelpCircle,
  Layers,
  Star,
  ArrowUpRight
} from 'lucide-react';
import { toast } from 'sonner';

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'clinical', label: 'Clinical' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'safety', label: 'Safety' },
  { value: 'technology', label: 'Technology' },
  { value: 'specialty', label: 'Specialty' },
  { value: 'onboarding', label: 'Onboarding' }
];

const DIFFICULTY_LEVELS = [
  { value: 'all', label: 'All Levels' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' }
];

const CONTENT_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'video', label: 'Video' },
  { value: 'text', label: 'Article' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'document', label: 'Document' }
];

const getContentTypeIcon = (type) => {
  switch (type) {
    case 'video': return <Video className="w-4 h-4" />;
    case 'text': return <FileText className="w-4 h-4" />;
    case 'quiz': return <HelpCircle className="w-4 h-4" />;
    case 'interactive': return <Layers className="w-4 h-4" />;
    default: return <BookOpen className="w-4 h-4" />;
  }
};

const getDifficultyColor = (level) => {
  switch (level) {
    case 'beginner': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'intermediate': return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
    case 'advanced': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    default: return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
  }
};

export default function TrainingResourceLibrary({ trainingModules, completions, userEmail }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [contentTypeFilter, setContentTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('recommended');
  const queryClient = useQueryClient();

  const assignTrainingMutation = useMutation({
    mutationFn: (moduleId) => base44.entities.TrainingCompletion.create({
      nurse_email: userEmail,
      training_module_id: moduleId,
      status: 'assigned',
      due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['myCompletions', userEmail]);
      toast.success('Training module enrolled successfully');
    }
  });

  const getModuleStatus = (moduleId) => {
    const completion = completions.find(c => c.training_module_id === moduleId);
    if (!completion) return 'not_started';
    return completion.status;
  };

  const getModuleProgress = (moduleId) => {
    const completion = completions.find(c => c.training_module_id === moduleId);
    if (!completion) return 0;
    if (completion.status === 'completed') return 100;
    if (completion.status === 'in_progress') return 50;
    return 10;
  };

  const filteredModules = useMemo(() => {
    let filtered = trainingModules.filter(m => m.is_active !== false);

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(m => 
        m.title?.toLowerCase().includes(query) ||
        m.description?.toLowerCase().includes(query) ||
        m.related_skills?.some(s => s.toLowerCase().includes(query))
      );
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(m => m.category === categoryFilter);
    }

    // Difficulty filter
    if (difficultyFilter !== 'all') {
      filtered = filtered.filter(m => m.difficulty_level === difficultyFilter);
    }

    // Content type filter
    if (contentTypeFilter !== 'all') {
      filtered = filtered.filter(m => m.content_type === contentTypeFilter);
    }

    // Sort
    switch (sortBy) {
      case 'title':
        filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
      case 'duration':
        filtered.sort((a, b) => (a.duration_minutes || 0) - (b.duration_minutes || 0));
        break;
      case 'difficulty':
        const difficultyOrder = { beginner: 1, intermediate: 2, advanced: 3 };
        filtered.sort((a, b) => 
          (difficultyOrder[a.difficulty_level] || 0) - (difficultyOrder[b.difficulty_level] || 0)
        );
        break;
      case 'recommended':
      default:
        // Required modules first, then by category
        filtered.sort((a, b) => {
          if (a.is_required && !b.is_required) return -1;
          if (!a.is_required && b.is_required) return 1;
          return (a.order || 999) - (b.order || 999);
        });
        break;
    }

    return filtered;
  }, [trainingModules, searchQuery, categoryFilter, difficultyFilter, contentTypeFilter, sortBy]);

  // Stats
  const totalModules = trainingModules.filter(m => m.is_active !== false).length;
  const completedCount = completions.filter(c => c.status === 'completed').length;
  const inProgressCount = completions.filter(c => c.status === 'in_progress' || c.status === 'assigned').length;

  return (
    <div className="space-y-6">
      {/* Stats Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-slate-200 dark:bg-slate-700 rounded-lg flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{totalModules}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Modules</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-green-200 dark:bg-green-800 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-800 dark:text-green-200">{completedCount}</p>
              <p className="text-sm text-green-600 dark:text-green-400">Completed</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-200 dark:bg-blue-800 rounded-lg flex items-center justify-center">
              <Play className="w-6 h-6 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">{inProgressCount}</p>
              <p className="text-sm text-blue-600 dark:text-blue-400">In Progress</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Search modules, skills, topics..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_LEVELS.map(level => (
                    <SelectItem key={level.value} value={level.value}>{level.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recommended">Recommended</SelectItem>
                  <SelectItem value="title">Title A-Z</SelectItem>
                  <SelectItem value="duration">Duration</SelectItem>
                  <SelectItem value="difficulty">Difficulty</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Module Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredModules.map((module) => {
          const status = getModuleStatus(module.id);
          const progress = getModuleProgress(module.id);
          const isCompleted = status === 'completed';
          const isInProgress = status === 'in_progress' || status === 'assigned';

          return (
            <Card 
              key={module.id} 
              className={`transition-all hover:shadow-lg ${
                isCompleted ? 'bg-green-50/50 dark:bg-green-950/30 border-green-200 dark:border-green-800' :
                isInProgress ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800' :
                ''
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {module.is_required && (
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
                          Required
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs flex items-center gap-1">
                        {getContentTypeIcon(module.content_type)}
                        {module.content_type || 'text'}
                      </Badge>
                    </div>
                    <CardTitle className="text-base line-clamp-2">{module.title}</CardTitle>
                  </div>
                  {isCompleted && (
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                  {module.description}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Badge className={getDifficultyColor(module.difficulty_level)}>
                    {module.difficulty_level || 'beginner'}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {module.category}
                  </Badge>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {module.duration_minutes || 15} min
                  </span>
                  {module.passing_score && (
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      Pass: {module.passing_score}%
                    </span>
                  )}
                </div>

                {/* Skills */}
                {module.related_skills?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {module.related_skills.slice(0, 3).map((skill, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs bg-slate-100 dark:bg-slate-800">
                        {skill}
                      </Badge>
                    ))}
                    {module.related_skills.length > 3 && (
                      <Badge variant="secondary" className="text-xs bg-slate-100 dark:bg-slate-800">
                        +{module.related_skills.length - 3}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Progress */}
                {isInProgress && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Progress</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-1" />
                  </div>
                )}

                {/* Action Button */}
                <Button 
                  className="w-full"
                  variant={isCompleted ? 'outline' : isInProgress ? 'secondary' : 'default'}
                  onClick={() => {
                    if (!isInProgress && !isCompleted) {
                      assignTrainingMutation.mutate(module.id);
                    }
                  }}
                  disabled={assignTrainingMutation.isPending}
                >
                  {isCompleted ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Review Module
                    </>
                  ) : isInProgress ? (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Continue Learning
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-4 h-4 mr-2" />
                      Start Module
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredModules.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-400">No training modules match your filters.</p>
            <Button 
              variant="link" 
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('all');
                setDifficultyFilter('all');
                setContentTypeFilter('all');
              }}
            >
              Clear all filters
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}