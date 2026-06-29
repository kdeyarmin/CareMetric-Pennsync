import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Trophy, 
  Award, 
  Zap,
  Medal,
  Crown,
  Target
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';

export default function GamificationDashboard({ userId }) {
  const { data: leaderboard } = useQuery({
    queryKey: ['leaderboard-entry', userId],
    queryFn: async () => {
      const entries = await base44.entities.Leaderboard.filter({ user_id: userId });
      return entries[0] || null;
    }
  });

  const { data: badges = [] } = useQuery({
    queryKey: ['user-badges', userId],
    queryFn: () => base44.entities.UserBadge.filter({ user_id: userId, displayed: true }, '-earned_at', 50),
    initialData: []
  });

  const { data: topPerformers = [] } = useQuery({
    queryKey: ['top-performers'],
    queryFn: () => base44.entities.Leaderboard.list('-total_points', 10),
    initialData: []
  });

  const rarityColors = {
    common: 'bg-slate-400',
    uncommon: 'bg-green-500',
    rare: 'bg-blue-500',
    epic: 'bg-navy-500',
    legendary: 'bg-yellow-500'
  };

  const userRankIdx = topPerformers.findIndex(p => p.user_id === userId);
  const userRank = userRankIdx >= 0 ? userRankIdx + 1 : null;

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Points</p>
                <p className="text-2xl font-bold text-yellow-600">{leaderboard?.total_points || 0}</p>
              </div>
              <Trophy className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Badges Earned</p>
                <p className="text-2xl font-bold text-blue-600">{leaderboard?.badges_earned || 0}</p>
              </div>
              <Award className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Current Streak</p>
                <p className="text-2xl font-bold text-green-600">{leaderboard?.current_streak || 0}</p>
              </div>
              <Zap className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-navy-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Rank</p>
                <p className="text-2xl font-bold text-navy-600">#{userRank || 'N/A'}</p>
              </div>
              <Crown className="w-8 h-8 text-navy-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Badges */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600" />
            Recent Badges
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {badges.slice(0, 8).map(badge => (
              <div key={badge.id} className="flex flex-col items-center p-4 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border-2 border-slate-200 hover:border-blue-300 transition">
                <div className={`w-16 h-16 rounded-full ${rarityColors[badge.trigger_context?.rarity || 'common']} flex items-center justify-center mb-2`}>
                  <Medal className="w-8 h-8 text-white" />
                </div>
                <p className="text-sm font-semibold text-slate-900 text-center">{badge.badge_name}</p>
                <p className="text-xs text-slate-600 mt-1">{badge.points_awarded} pts</p>
                <Badge variant="outline" className="mt-2 text-xs">
                  {new Date(badge.earned_at).toLocaleDateString()}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-600" />
            Top Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topPerformers.map((performer, idx) => {
              const isCurrentUser = performer.user_id === userId;
              return (
                <div
                  key={performer.id}
                  className={`flex items-center justify-between p-4 rounded-lg border-2 transition ${
                    isCurrentUser ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                      idx === 0 ? 'bg-yellow-500' :
                      idx === 1 ? 'bg-slate-400' :
                      idx === 2 ? 'bg-orange-600' :
                      'bg-blue-600'
                    }`}>
                      {idx + 1}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">
                        {performer.user_name}
                        {isCurrentUser && <Badge className="ml-2 bg-blue-500">You</Badge>}
                      </p>
                      <p className="text-sm text-slate-600">
                        {performer.courses_completed} courses • {performer.badges_earned} badges
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-900">{performer.total_points}</p>
                    <p className="text-xs text-slate-600">points</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Next Milestone */}
      <Card className="bg-gradient-to-br from-navy-50 to-indigo-50 border-2 border-navy-200">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-6 h-6 text-navy-600" />
            <h3 className="text-lg font-semibold text-navy-900">Next Milestone</h3>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-navy-900">Streak Goal: 10 Courses</span>
                <span className="text-sm font-semibold text-navy-600">
                  {leaderboard?.current_streak || 0} / 10
                </span>
              </div>
              <Progress 
                value={((leaderboard?.current_streak || 0) / 10) * 100} 
                className="h-2 bg-navy-200"
              />
            </div>
            <p className="text-sm text-navy-700">
              Complete {10 - (leaderboard?.current_streak || 0)} more courses to earn the "Dedicated Learner" badge!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}