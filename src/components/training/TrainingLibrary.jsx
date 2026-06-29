import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";
import {
  Search,
  Clock,
  PlayCircle,
  CheckCircle2,
  Video,
  FileText,
  Brain
} from "lucide-react";

export default function TrainingLibrary({ nurseEmail, moduleType, onStartModule }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");

  const { data: modules = [] } = useQuery({
    queryKey: ['trainingModules', moduleType],
    queryFn: () => base44.entities.TrainingModule.filter({}),
    initialData: [],
  });

  // Completion is course-based in the live system: a module is "completed" when
  // its course has a passing assignment/certificate for this nurse.
  const { completedCourseIds, scoreByCourse } = useMyTrainingCompletions(nurseEmail);

  const filteredModules = modules.filter(module => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = !searchTerm ||
                         (module.title || '').toLowerCase().includes(search) ||
                         (module.description || '').toLowerCase().includes(search);
    const matchesCategory = categoryFilter === "all" || module.category === categoryFilter;
    const matchesDifficulty = difficultyFilter === "all" || module.difficulty_level === difficultyFilter;
    // Tabs have no dedicated category field, so split by requirement:
    // "ongoing" = mandatory modules (is_required, default true),
    // "skill_development" = optional modules. Other callers see everything.
    const matchesModuleType =
      moduleType === 'ongoing' ? module.is_required !== false :
      moduleType === 'skill_development' ? module.is_required === false :
      true;

    return matchesSearch && matchesCategory && matchesDifficulty && matchesModuleType;
  });

  const categories = [...new Set(modules.map(m => m.category))];

  const getModuleStatus = (module) => (
    module?.course_id && completedCourseIds.has(module.course_id) ? 'completed' : 'not_started'
  );

  const getContentTypeIcon = (contentType) => {
    switch (contentType) {
      case 'video': return <Video className="w-4 h-4" />;
      case 'quiz': return <Brain className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid md:grid-cols-4 gap-4">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search training modules..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Levels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Module Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredModules.map(module => {
          const status = getModuleStatus(module);
          const moduleScore = module.course_id ? scoreByCourse[module.course_id] : undefined;

          return (
            <Card key={module.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <Badge variant="outline" className="capitalize">
                    {module.category}
                  </Badge>
                  {status === 'completed' && (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  )}
                </div>

                <h3 className="font-semibold text-slate-900 mb-2">{module.title}</h3>
                <p className="text-sm text-slate-600 mb-4 line-clamp-2">
                  {module.description}
                </p>

                <div className="flex items-center gap-4 text-xs text-slate-600 mb-4">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {module.duration_minutes} min
                  </span>
                  <span className="flex items-center gap-1">
                    {getContentTypeIcon(module.content_type)}
                    {module.content_type}
                  </span>
                  {module.difficulty_level && (
                    <Badge variant="secondary" className="capitalize text-xs">
                      {module.difficulty_level}
                    </Badge>
                  )}
                </div>

                {moduleScore !== undefined && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-600">Your Score:</span>
                      <span className={`font-semibold ${
                        moduleScore >= (module.passing_score || 80)
                          ? 'text-green-600'
                          : 'text-orange-600'
                      }`}>
                        {moduleScore}%
                      </span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => onStartModule(module)}
                  className="w-full"
                  variant={status === 'completed' ? 'outline' : 'default'}
                >
                  <PlayCircle className="w-4 h-4 mr-2" />
                  {status === 'completed' ? 'Review' :
                   status === 'in_progress' ? 'Continue' :
                   'Start Training'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredModules.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            <p>No training modules found matching your filters</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}