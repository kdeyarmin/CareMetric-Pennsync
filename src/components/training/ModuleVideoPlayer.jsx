import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Play, Pause, SkipForward, SkipBack, RotateCcw, Volume2, VolumeX, Video, Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Video-first lesson player.
 *
 * If the module has a real `video_url`, that plays. Otherwise the module's
 * written content (intro → sections → key takeaways) is presented as a short,
 * auto-advancing narrated slideshow using the browser's built-in speech
 * synthesis — so every lesson opens with a "watch" experience like Relias /
 * Home Care Institute, with no external video service or per-video cost.
 *
 * Narration degrades gracefully: when speech synthesis is unavailable or the
 * learner mutes it, slides advance on a reading-time timer instead, and the
 * caption text is always on screen.
 */

// Compose the on-screen slides + spoken narration from a module's content_json.
function buildSlides(module) {
  const c = module?.content_json || {};
  const slides = [];

  const intro = c.intro || `In this lesson we cover ${module?.title || "the key points"}.`;
  slides.push({
    kind: "intro",
    heading: module?.title || "Lesson",
    body: c.intro || "",
    bullets: [],
    narration: `${module?.title ? module.title + ". " : ""}${intro}`,
  });

  (c.sections || []).forEach((s) => {
    const bulletText = (s.bullets || []).join(". ");
    const exampleText = s.example ? ` For example: ${s.example}` : "";
    slides.push({
      kind: "section",
      heading: s.heading || "",
      body: s.body || "",
      bullets: s.bullets || [],
      example: s.example || "",
      narration: [s.heading, s.body, bulletText, exampleText].filter(Boolean).join(". "),
    });
  });

  if ((c.key_takeaways || []).length) {
    slides.push({
      kind: "takeaways",
      heading: "Key Takeaways",
      body: "",
      bullets: c.key_takeaways,
      narration: `Key takeaways. ${c.key_takeaways.join(". ")}`,
    });
  }

  return slides;
}

const speechSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance !== "undefined";

const readingMs = (text) => Math.max(4000, (text || "").split(/\s+/).filter(Boolean).length * 380);

export default function ModuleVideoPlayer({ module, onEnded }) {
  const realVideoUrl = module?.video_url;
  const slides = useMemo(() => buildSlides(module), [module]);
  const supported = useMemo(speechSupported, []);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);

  // Keep onEnded out of the narration effect deps so an inline callback from a
  // parent doesn't restart narration on every render.
  const onEndedRef = useRef(onEnded);
  useEffect(() => { onEndedRef.current = onEnded; }, [onEnded]);

  // Reset when the module changes.
  useEffect(() => {
    setIndex(0);
    setPlaying(false);
    if (supported) window.speechSynthesis.cancel();
  }, [module?.id, supported]);

  // Drive narration / auto-advance for the active slide while playing.
  useEffect(() => {
    if (realVideoUrl || !playing) return;
    const slide = slides[index];
    if (!slide) return;

    let cancelled = false;
    let timer;
    const finish = () => {
      if (cancelled) return;
      if (index < slides.length - 1) {
        setIndex((i) => i + 1);
      } else {
        setPlaying(false);
        onEndedRef.current?.();
      }
    };

    if (supported && !muted && slide.narration) {
      const utter = new window.SpeechSynthesisUtterance(slide.narration);
      utter.rate = 1;
      utter.onend = finish;
      utter.onerror = finish;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } else {
      timer = setTimeout(finish, readingMs(slide.narration));
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (supported) window.speechSynthesis.cancel();
    };
  }, [index, playing, muted, slides, supported, realVideoUrl]);

  // Stop any narration on unmount.
  useEffect(() => () => { if (speechSupported()) window.speechSynthesis.cancel(); }, []);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(slides.length - 1, i + 1)), [slides.length]);
  const replay = useCallback(() => { setIndex(0); setPlaying(true); }, []);

  // ─── Real produced video ────────────────────────────────────────────────
  if (realVideoUrl) {
    return (
      <div className="rounded-xl overflow-hidden border border-navy-200 bg-black">
        <video
          controls
          preload="metadata"
          poster={module.video_thumbnail_url || undefined}
          className="w-full aspect-video"
          onEnded={() => onEndedRef.current?.()}
        >
          <source src={realVideoUrl} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        <div className="bg-navy-50 px-4 py-2 flex items-center gap-2 text-xs text-navy-700">
          <Video className="w-3.5 h-3.5" />
          <span>Lesson video</span>
        </div>
      </div>
    );
  }

  if (slides.length === 0) return null;

  const slide = slides[index];
  const progress = Math.round(((index + 1) / slides.length) * 100);

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white">
      {/* Stage */}
      <div className="relative aspect-video bg-gradient-to-br from-slate-900 via-indigo-900 to-blue-900 text-white p-5 sm:p-8 flex flex-col">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-indigo-200/80">
          <span className="inline-flex items-center gap-1.5"><Video className="w-3.5 h-3.5" /> Narrated lesson</span>
          <span>{index + 1} / {slides.length}</span>
        </div>

        <div className="flex-1 flex flex-col justify-center min-h-0 overflow-y-auto py-3">
          <h3 className="text-lg sm:text-2xl font-bold mb-3">{slide.heading}</h3>
          {slide.body && <p className="text-sm sm:text-base text-indigo-50/90 leading-relaxed mb-3">{slide.body}</p>}
          {slide.bullets?.length > 0 && (
            <ul className="space-y-1.5">
              {slide.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm sm:text-base text-indigo-50/90">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-300 flex-shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {slide.example && (
            <div className="mt-3 rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm text-blue-50">
              <span className="font-semibold">Example: </span>{slide.example}
            </div>
          )}
        </div>

        {!playing && index === 0 && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20 transition-colors"
            aria-label="Play lesson"
          >
            <span className="w-16 h-16 rounded-full bg-white/90 text-indigo-700 flex items-center justify-center shadow-lg">
              <Play className="w-7 h-7 ml-1" fill="currentColor" />
            </span>
          </button>
        )}
      </div>

      {/* Captions */}
      {showCaptions && (
        <div className="px-4 py-2.5 bg-slate-900 text-slate-100 text-sm leading-6 min-h-[44px]">
          {slide.narration}
        </div>
      )}

      {/* Controls */}
      <div className="px-3 py-2.5 border-t border-slate-100">
        <Progress value={progress} className="h-1.5 mb-2.5 [&>div]:bg-indigo-500" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={goPrev} disabled={index === 0} aria-label="Previous slide">
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={goNext} disabled={index === slides.length - 1} aria-label="Next slide">
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={replay} aria-label="Replay from start">
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {supported && (
              <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute narration" : "Mute narration"}>
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className={`h-9 w-9 ${showCaptions ? "text-indigo-600" : ""}`}
              onClick={() => setShowCaptions((c) => !c)}
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
            >
              <Captions className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {!supported && (
          <p className="text-[11px] text-slate-400 mt-1.5 text-center">
            Audio narration isn’t available in this browser — slides advance automatically with on-screen captions.
          </p>
        )}
      </div>
    </div>
  );
}
