import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Video, Sparkles, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Play,
  Settings2, Info, Clapperboard,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { manageTrainingVideos } from "@/functions/manageTrainingVideos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const fmtDuration = (s) =>
  s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : null;

const statusMeta = {
  completed: { label: "Ready", cls: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  processing: { label: "Generating…", cls: "bg-blue-100 text-blue-800", icon: Loader2 },
  failed: { label: "Failed", cls: "bg-red-100 text-red-800", icon: AlertTriangle },
  none: { label: "No video", cls: "bg-slate-100 text-slate-600", icon: Video },
};

export default function TrainingVideoStudio() {
  const queryClient = useQueryClient();
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: courses = [] } = useQuery({
    queryKey: ["video-studio-courses"],
    queryFn: () => base44.entities.TrainingCourse.filter({ status: "published" }, "-updated_date", 500),
    initialData: [],
  });

  const statusKey = ["training-video-status", selectedCourseId];
  const { data: statusData, isFetching } = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const res = await manageTrainingVideos({ action: "status", course_id: selectedCourseId });
      return res?.data || res;
    },
    enabled: !!selectedCourseId,
    // Keep polling while any module is still generating.
    refetchInterval: (query) =>
      (query.state.data?.modules || []).some((m) => m.video_status === "processing") ? 12000 : false,
  });

  const modules = useMemo(() => statusData?.modules || [], [statusData]);
  const heygenConfigured = statusData?.heygen_configured;
  const anyProcessing = modules.some((m) => m.video_status === "processing");
  const missingCount = modules.filter((m) => m.video_status !== "completed").length;

  const startMutation = useMutation({
    mutationFn: (payload) =>
      manageTrainingVideos({ action: "start", avatar_id: avatarId || undefined, voice_id: voiceId || undefined, ...payload }),
    onSuccess: (res) => {
      const data = res?.data || res;
      toast.success(`Started generating ${data?.started ?? 0} video${data?.started === 1 ? "" : "s"}. They'll appear here when ready.`);
      queryClient.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e) => toast.error(`Could not start video generation: ${e.message}`),
  });

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  return (
    <div className="space-y-6">
      <Card className="border-indigo-200 bg-indigo-50/40">
        <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
              <Clapperboard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900">AI Presenter Video Studio</h2>
              <p className="text-sm text-slate-600">
                Generate a HeyGen presenter video for each lesson from its script, or regenerate to
                enhance an existing one. Videos generate in the background and attach to the module
                automatically — staff see the video at the top of the lesson, then take the quiz.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* HeyGen not configured */}
      {selectedCourseId && heygenConfigured === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">HeyGen isn’t connected yet</p>
            <p className="mt-0.5">
              Add a <code className="bg-amber-100 px-1 rounded">HEYGEN_API_KEY</code> to this environment’s
              function secrets to enable AI presenter videos. Until then, lessons fall back to the built-in
              narrated player. You can get a key from your HeyGen account’s API settings.
            </p>
          </div>
        </div>
      )}

      {/* Course picker + actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Video className="w-4 h-4 text-indigo-600" /> Choose a course
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <Label className="text-xs text-slate-500">Published course</Label>
              <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                <SelectTrigger><SelectValue placeholder="Select a course to add videos to" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedCourseId && (
              <Button
                onClick={() => startMutation.mutate({ course_id: selectedCourseId, action: missingCount > 0 ? "start" : "regenerate" })}
                disabled={!heygenConfigured || startMutation.isPending || anyProcessing || modules.length === 0}
              >
                {startMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
                ) : missingCount === 0 ? (
                  <><RefreshCw className="w-4 h-4 mr-2" />Regenerate all</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" />{missingCount < modules.length ? `Generate ${missingCount} missing` : "Generate all"}</>
                )}
              </Button>
            )}
          </div>

          {/* Advanced avatar/voice */}
          {selectedCourseId && (
            <div>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1.5"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                <Settings2 className="w-3.5 h-3.5" /> Presenter options {showAdvanced ? "▲" : "▼"}
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 rounded-xl border bg-slate-50 p-3">
                  <div>
                    <Label className="text-xs text-slate-500">Avatar ID</Label>
                    <Input value={avatarId} onChange={(e) => setAvatarId(e.target.value)} placeholder="Daisy-inskirt-20220818 (default)" className="h-9" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">Voice ID</Label>
                    <Input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} placeholder="Elizabeth – Friendly (default)" className="h-9" />
                  </div>
                  <p className="sm:col-span-2 text-xs text-slate-400">
                    Leave blank to use the default friendly presenter. Find avatar &amp; voice IDs in your HeyGen account.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Module list */}
      {selectedCourseId && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base">
                Lessons in “{selectedCourse?.title}” ({modules.length})
              </CardTitle>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {(isFetching || anyProcessing) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {anyProcessing ? "Generating — auto-refreshing…" : "Up to date"}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {modules.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">
                This course has no lesson modules to turn into videos.
              </p>
            ) : (
              modules.map((m, i) => {
                const meta = statusMeta[m.video_status] || statusMeta.none;
                const Icon = meta.icon;
                const busy = m.video_status === "processing";
                return (
                  <div key={m.module_id} className="flex items-center gap-3 p-3 rounded-xl border bg-white">
                    <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>

                    {m.video_thumbnail_url ? (
                      <img src={m.video_thumbnail_url} alt="" className="w-20 h-12 rounded object-cover border flex-shrink-0" />
                    ) : (
                      <div className="w-20 h-12 rounded bg-slate-100 border flex items-center justify-center flex-shrink-0">
                        <Video className="w-4 h-4 text-slate-400" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-slate-900 truncate">{m.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={`${meta.cls} text-xs`}>
                          <Icon className={`w-3 h-3 mr-1 ${busy ? "animate-spin" : ""}`} />
                          {meta.label}
                        </Badge>
                        {m.video_duration_seconds && (
                          <span className="text-xs text-slate-400">{fmtDuration(m.video_duration_seconds)}</span>
                        )}
                        {m.video_status === "failed" && m.video_error && (
                          <span className="text-xs text-red-500 truncate max-w-[260px]" title={m.video_error}>{m.video_error}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.video_url && (
                        <a href={m.video_url} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline"><Play className="w-3.5 h-3.5 mr-1.5" />Preview</Button>
                        </a>
                      )}
                      <Button
                        size="sm"
                        variant={m.video_status === "completed" ? "outline" : "default"}
                        disabled={!heygenConfigured || busy || startMutation.isPending}
                        onClick={() => startMutation.mutate({ module_id: m.module_id, action: m.video_status === "completed" ? "regenerate" : "start" })}
                      >
                        {m.video_status === "completed" ? (
                          <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Regenerate</>
                        ) : busy ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating</>
                        ) : (
                          <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate</>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
