import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Sparkles, TrendingUp, Award } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function SmartNotesStatsCard() {
  const { data: noteConversions = [], isLoading } = useQuery({
    queryKey: ['noteConversions'],
    queryFn: () => base44.entities.NoteConversion.list('-created_date', 500),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  // Calculate stats per user
  const userStats = users
    .filter(u => u.role === 'user')
    .map(user => {
      const userNotes = noteConversions.filter(n => n.created_by === user.email);
      const avgQuality = userNotes.length > 0
        ? Math.round(userNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / userNotes.length)
        : 0;

      return {
        name: user.full_name || user.email,
        email: user.email,
        totalEnhanced: userNotes.length,
        avgQuality,
        recentEnhanced: userNotes.filter(n => {
          const daysSince = Math.floor((Date.now() - new Date(n.created_date)) / (1000 * 60 * 60 * 24));
          return daysSince <= 7;
        }).length
      };
    })
    .filter(stat => stat.totalEnhanced > 0)
    .sort((a, b) => b.totalEnhanced - a.totalEnhanced);

  const totalEnhanced = noteConversions.length;
  const avgQualityAll = noteConversions.length > 0
    ? Math.round(noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length)
    : 0;

  const getQualityColor = (score) => {
    if (score >= 90) return 'text-green-600 bg-green-50';
    if (score >= 80) return 'text-blue-600 bg-blue-50';
    if (score >= 70) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          Loading smart notes statistics...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-navy-600" />
          AI-Enhanced Smart Notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center p-3 bg-navy-50 rounded-lg">
            <Sparkles className="w-5 h-5 text-navy-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-navy-600">{totalEnhanced}</p>
            <p className="text-xs text-slate-600">Total Enhanced</p>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <TrendingUp className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-600">{avgQualityAll}</p>
            <p className="text-xs text-slate-600">Avg Quality Score</p>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <Award className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-600">{userStats.length}</p>
            <p className="text-xs text-slate-600">Active Users</p>
          </div>
        </div>

        <ScrollArea className="h-64">
          <div className="space-y-3">
            {userStats.map((stat, idx) => (
              <div
                key={stat.email}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-navy-500 to-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {idx + 1}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{stat.name}</p>
                    <p className="text-xs text-slate-500">
                      {stat.recentEnhanced} enhanced this week
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-navy-100 text-navy-700">
                    {stat.totalEnhanced}
                  </Badge>
                  <Badge className={getQualityColor(stat.avgQuality)}>
                    {stat.avgQuality}
                  </Badge>
                </div>
              </div>
            ))}
            {userStats.length === 0 && (
              <p className="text-center text-slate-500 py-8">
                No enhanced notes yet
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}