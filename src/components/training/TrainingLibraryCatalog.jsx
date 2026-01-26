import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, BookOpen, Clock, Award, Play, CheckCircle2, Filter, Video, FileText, Headphones } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export default function TrainingLibraryCatalog({ modules, userCompletions, currentUser }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [difficultyFilter, setDifficultyFilter] = useState('all');
  const [selectedModule, setSelectedModule] = useState(null);
  const queryClient = useQueryClient();

  const startTrainingMutation = useMutation({
    mutationFn: async (moduleId) => {
      await base44.entities.TrainingCompletion.create({
        nurse_email: currentUser.email,
        module_id: moduleId,
        status: 'in_progress',
        started_date: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myTrainingCompletions'] });
      setSelectedModule(null);
      toast.success('Training started successfully! 🎯');
    }
  });

  const filteredModules = useMemo(() => {
    return modules.filter(module => {
      const matchesSearch = !searchTerm || 
        module.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        module.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        module.topics?.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesCategory = categoryFilter === 'all' || module.category === categoryFilter;
      const matchesDifficulty = difficultyFilter === 'all' || module.difficulty_level === difficultyFilter;

      return matchesSearch && matchesCategory && matchesDifficulty;
    });
  }, [modules, searchTerm, categoryFilter, difficultyFilter]);

  const getCompletionStatus = (moduleId) => {
    const completion = userCompletions.find(c => c.module_id === moduleId);
    return completion?.status || 'not_started';
  };

  const getModuleTypeIcon = (type) => {
    switch (type) {
      case 'video': return <Video className="w-4 h-4" />;
      case 'interactive': return <Play className="w-4 h-4" />;
      case 'reading': return <FileText className="w-4 h-4" />;
      case 'audio': return <Headphones className="w-4 h-4" />;
      default: return <BookOpen className="w-4 h-4" />;
    }
  };

  const categories = [...new Set(modules.map(m => m.category).filter(Boolean))];
  const difficulties = ['beginner', 'intermediate', 'advanced', 'expert'];

  return (
    <>
      <div className="space-y-6">
        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search training modules..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat}>
                      {cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="All Levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {difficulties.map(diff => (
                    <SelectItem key={diff} value={diff}>
                      {diff.charAt(0).toUpperCase() + diff.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 mt-3 text-sm text-gray-600">
              <Filter className="w-4 h-4" />
              <span>Showing {filteredModules.length} of {modules.length} modules</span>
            </div>
          </CardContent>
        </Card>

        {/* Training Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModules.map((module) => {
            const status = getCompletionStatus(module.id);
            const completion = userCompletions.find(c => c.module_id === module.id);
            
            return (
              <Card 
                key={module.id} 
                className={`hover:shadow-lg transition-all cursor-pointer ${
                  status === 'completed' ? 'border-green-300 bg-green-50' :
                  status === 'in_progress' ? 'border-blue-300 bg-blue-50' :
                  'border-gray-200'
                }`}
                onClick={() => setSelectedModule(module)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <CardTitle className="text-base leading-tight">{module.title}</CardTitle>
                    {status === 'completed' && (
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-xs">
                      {getModuleTypeIcon(module.module_type)}
                      <span className="ml-1">{module.module_type || 'module'}</span>
                    </Badge>
                    {module.difficulty_level && (
                      <Badge variant="outline" className="text-xs">
                        {module.difficulty_level}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                    {module.description}
                  </p>

                  <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {module.estimated_duration_minutes || 30} min
                    </div>
                    {completion?.score && (
                      <div className="flex items-center gap-1">
                        <Award className="w-3 h-3 text-amber-600" />
                        <span className="font-semibold">{completion.score}%</span>
                      </div>
                    )}
                  </div>

                  {status === 'in_progress' && completion?.progress_percentage && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span>Progress</span>
                        <span>{completion.progress_percentage}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${completion.progress_percentage}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <Button 
                    className="w-full" 
                    size="sm"
                    variant={status === 'completed' ? 'outline' : 'default'}
                  >
                    {status === 'completed' ? 'Review Module' :
                     status === 'in_progress' ? 'Continue Learning' :
                     'Start Module'}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {filteredModules.length === 0 && (
          <Card className="border-2 border-dashed border-gray-300">
            <CardContent className="p-12 text-center">
              <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No training modules found matching your criteria</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Module Detail Dialog */}
      {selectedModule && (
        <Dialog open={!!selectedModule} onOpenChange={() => setSelectedModule(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">{selectedModule.title}</DialogTitle>
              <DialogDescription>
                {selectedModule.category && (
                  <Badge className="mr-2 mt-2">
                    {selectedModule.category.replace(/_/g, ' ')}
                  </Badge>
                )}
                {selectedModule.difficulty_level && (
                  <Badge variant="outline">
                    {selectedModule.difficulty_level}
                  </Badge>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-gray-700">{selectedModule.description}</p>

              {selectedModule.learning_objectives && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Learning Objectives</h4>
                  <ul className="space-y-1">
                    {selectedModule.learning_objectives.map((obj, idx) => (
                      <li key={idx} className="text-sm text-gray-600 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        {obj}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedModule.topics && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Topics Covered</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedModule.topics.map((topic, idx) => (
                      <Badge key={idx} variant="outline">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 text-sm text-gray-600 border-t pt-4">
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {selectedModule.estimated_duration_minutes || 30} minutes
                </div>
                {getModuleTypeIcon(selectedModule.module_type)}
                <span>{selectedModule.module_type || 'module'}</span>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={() => startTrainingMutation.mutate(selectedModule.id)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={startTrainingMutation.isPending}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start This Module
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedModule(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}