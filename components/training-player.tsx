"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Download,
  FileText,
  ListChecks,
  Loader2,
  Pause,
  PlayCircle,
  Gauge,
  Video,
  Volume2
} from "lucide-react";
import { speakWithBrowserSpeech, stopBrowserSpeech } from "@/components/browser-speech";
import { StatusPill } from "@/components/status-pill";
import type { TrainingCertificate, TrainingJob, TrainingProgress, TrainingQuestionType, TrainingQuizAttempt, TrainingVideoJob } from "@/lib/types";

type QuizQuestion = {
  id: string;
  type: TrainingQuestionType;
  prompt: string;
  options: string[];
};

type QuizSession = { id: string; question_snapshot: QuizQuestion[]; expires_at: string };
type QuizSettings = { pass_score: number; max_attempts: number; time_limit_minutes: number; certificate_enabled: boolean };

export function TrainingPlayer({ job }: { job: TrainingJob }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [failedSlideImages, setFailedSlideImages] = useState<number[]>([]);
  const [completedPages, setCompletedPages] = useState<number[]>([]);
  const [progressRecord, setProgressRecord] = useState<TrainingProgress | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string | string[]>>({});
  const [latestAttempt, setLatestAttempt] = useState<TrainingQuizAttempt | null>(null);
  const [quizSession, setQuizSession] = useState<QuizSession | null>(null);
  const [quizSettings, setQuizSettings] = useState<QuizSettings | null>(null);
  const [quizEligible, setQuizEligible] = useState(false);
  const [quizBlockedReason, setQuizBlockedReason] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<TrainingCertificate | null>(null);
  const [quizClock, setQuizClock] = useState(Date.now());
  const [videoJobs, setVideoJobs] = useState<TrainingVideoJob[]>([]);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [trainingNotice, setTrainingNotice] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioStatus, setAudioStatus] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlCacheRef = useRef<Record<number, string>>({});
  const browserSpeechPageRef = useRef<number | null>(null);
  const autoPlayRef = useRef(false);
  const completedPagesRef = useRef<number[]>([]);
  const resumePositionRef = useRef(0);

  const slide = job.script_json[pageIndex];
  const canPrev = pageIndex > 0;
  const canNext = pageIndex < job.script_json.length - 1;

  const pageProgress = useMemo(() => {
    if (job.script_json.length === 0) {
      return 0;
    }

    return Math.round(((pageIndex + 1) / job.script_json.length) * 100);
  }, [job.script_json.length, pageIndex]);
  const learningProgress = useMemo(() => {
    if (job.script_json.length === 0) {
      return 0;
    }

    return Math.round((completedPages.length / job.script_json.length) * 100);
  }, [completedPages.length, job.script_json.length]);
  const cachedAudioPages = job.audio_paths.filter(Boolean).length;
  const currentScriptLength = slide?.script.length ?? 0;
  const slideImageSrc = slide?.image_path && !failedSlideImages.includes(pageIndex)
    ? `/api/training/${job.id}/slides/${slide.page}`
    : null;
  const latestVideo = useMemo(() => {
    const sorted = videoJobs
      .filter((item) => item.provider !== "training-audio")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sorted.find((item) => item.provider === "slide-video") ?? sorted[0] ?? null;
  }, [videoJobs]);

  useEffect(() => {
    void loadTrainingState();
  }, [job.id]);

  useEffect(() => {
    if (!videoJobs.some((item) => item.provider !== "training-audio" && ["queued", "generating"].includes(item.status))) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTrainingState();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [job.id, videoJobs]);

  useEffect(() => {
    completedPagesRef.current = completedPages;
  }, [completedPages]);

  useEffect(() => {
    if (!quizSession) return;
    const timer = window.setInterval(() => setQuizClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quizSession]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      void saveProgress(pageIndex, 5 * playbackRate, 5, audioRef.current?.currentTime ?? 0);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pageIndex, playbackRate, playing]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      stopBrowserSpeech();
      autoPlayRef.current = false;
      for (const url of Object.values(audioUrlCacheRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  async function loadTrainingState() {
    const [progressResponse, quizResponse, videoResponse] = await Promise.all([
      fetch(`/api/training/${job.id}/progress`, { cache: "no-store" }),
      fetch(`/api/training/${job.id}/quiz`, { cache: "no-store" }),
      fetch(`/api/training/${job.id}/digital-human`, { cache: "no-store" })
    ]);
    const progressData = await progressResponse.json();
    const quizData = await quizResponse.json();
    const videoData = await videoResponse.json();

    if (progressResponse.ok && progressData.progress) {
      setProgressRecord(progressData.progress);
      setCompletedPages(progressData.progress.completed_pages ?? []);
      setPageIndex(Math.min(progressData.progress.current_page ?? 0, Math.max(job.script_json.length - 1, 0)));
      resumePositionRef.current = Number(progressData.progress.playback_position_seconds ?? 0);
    }

    if (quizResponse.ok) {
      setQuizSession(quizData.session ?? null);
      setQuizQuestions(quizData.session?.question_snapshot ?? []);
      setQuizSettings(quizData.settings ?? null);
      setQuizEligible(Boolean(quizData.eligible));
      setQuizBlockedReason(quizData.blocked_reason ?? null);
      setLatestAttempt(quizData.latestAttempt ?? null);
      setCertificate(quizData.certificate ?? null);
    }

    if (videoResponse.ok) {
      setVideoJobs(videoData.videoJobs ?? []);
    }
  }

  async function saveProgress(nextPageIndex: number, consumedSecondsDelta = 0, activeSecondsDelta = 0, playbackPositionSeconds = 0) {
    const response = await fetch(`/api/training/${job.id}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_page: nextPageIndex,
        consumed_seconds_delta: consumedSecondsDelta,
        active_seconds_delta: activeSecondsDelta,
        playback_position_seconds: playbackPositionSeconds
      })
    });
    const data = await response.json();

    if (response.ok) {
      setProgressRecord(data.progress);
      setCompletedPages(data.progress.completed_pages ?? []);
      completedPagesRef.current = data.progress.completed_pages ?? [];
    }
  }

  function stopPlayback() {
    if (audioRef.current && !audioRef.current.paused) {
      void saveProgress(pageIndex, 0, 0, audioRef.current.currentTime);
    }
    audioRef.current?.pause();
    stopBrowserSpeech();
    autoPlayRef.current = false;
    browserSpeechPageRef.current = null;
    setAutoPlaying(false);
    setPlaying(false);
    setLoadingAudio(false);
  }

  function handleSlideEnded(index: number, continueDeck: boolean) {
    setPlaying(false);
    browserSpeechPageRef.current = null;
    const nextIndex = index + 1;

    if (continueDeck && autoPlayRef.current && nextIndex < job.script_json.length) {
      setPageIndex(nextIndex);
      resumePositionRef.current = 0;
      void saveProgress(index, 3 * playbackRate, 3, audioRef.current?.duration ?? 0);
      void playSlideAt(nextIndex, true);
      return;
    }

    autoPlayRef.current = false;
    setAutoPlaying(false);
    void saveProgress(index, 3 * playbackRate, 3, audioRef.current?.duration ?? 0);
  }

  async function playSlideAt(index: number, continueDeck = false) {
    const targetSlide = job.script_json[index];
    if (!targetSlide) {
      return;
    }

    audioRef.current?.pause();
    stopBrowserSpeech();
    setLoadingAudio(true);
    setAudioError(null);
    setAudioStatus(job.audio_paths[index] ? `正在读取第 ${index + 1} 页缓存音频...` : `正在生成第 ${index + 1} 页语音...`);
    try {
      let url = audioUrlCacheRef.current[index];

      if (!url) {
        const response = await fetch(`/api/training/${job.id}/audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page_index: index })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error ?? "语音生成失败");
        }

        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        audioUrlCacheRef.current[index] = url;
        setAudioStatus(response.headers.get("X-Audio-Cache") === "hit" ? `第 ${index + 1} 页已使用缓存音频` : `第 ${index + 1} 页语音已生成`);
      }

      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.onloadedmetadata = () => {
        if (resumePositionRef.current > 0 && resumePositionRef.current < (audioRef.current?.duration ?? 0) - 1) {
          audioRef.current!.currentTime = resumePositionRef.current;
        }
        resumePositionRef.current = 0;
      };
      audioRef.current.onended = () => {
        handleSlideEnded(index, continueDeck);
      };
      await audioRef.current.play();
      setPlaying(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "语音生成失败";
      const fallbackStarted = speakWithBrowserSpeech(targetSlide.script, {
        onEnd: () => {
          if (browserSpeechPageRef.current === index) {
            handleSlideEnded(index, continueDeck);
          }
        },
        onError: () => {
          if (browserSpeechPageRef.current === index) {
            browserSpeechPageRef.current = null;
            autoPlayRef.current = false;
            setAutoPlaying(false);
            setPlaying(false);
            setAudioStatus(null);
            setAudioError("浏览器语音朗读失败，请检查浏览器权限或稍后重试。");
          }
        }
      });

      if (fallbackStarted) {
        browserSpeechPageRef.current = index;
        setPlaying(true);
        setAudioStatus(`服务器语音暂不可用，已改用浏览器朗读第 ${index + 1} 页。原因：${errorMessage}`);
        return;
      }

      autoPlayRef.current = false;
      setAutoPlaying(false);
      setAudioError(`${errorMessage}；当前浏览器也不支持本地朗读。`);
      setAudioStatus(null);
    } finally {
      setLoadingAudio(false);
    }
  }

  async function playCurrentSlide() {
    if (playing || autoPlaying) {
      stopPlayback();
      return;
    }

    await playSlideAt(pageIndex, false);
  }

  async function playFromCurrentSlide() {
    if (playing || autoPlaying) {
      stopPlayback();
      return;
    }

    autoPlayRef.current = true;
    setAutoPlaying(true);
    await playSlideAt(pageIndex, true);
  }

  function changePage(nextIndex: number) {
    stopPlayback();
    setAudioStatus(null);
    setAudioError(null);
    resumePositionRef.current = 0;
    void saveProgress(nextIndex, 0, 0, 0);
    setPageIndex(nextIndex);
  }

  function markSlideImageFailed(index: number) {
    setFailedSlideImages((current) => current.includes(index) ? current : [...current, index]);
  }

  async function startQuiz() {
    setSubmittingQuiz(true);
    setTrainingNotice(null);
    try {
      const response = await fetch(`/api/training/${job.id}/quiz`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "开始考试失败");
      setQuizSession(data.session);
      setQuizQuestions(data.session.question_snapshot ?? []);
      setQuizSettings(data.settings ?? quizSettings);
      setQuizAnswers({});
      setQuizClock(Date.now());
    } catch (error) {
      setTrainingNotice(error instanceof Error ? error.message : "开始考试失败");
    } finally {
      setSubmittingQuiz(false);
    }
  }

  async function submitQuiz() {
    setSubmittingQuiz(true);
    setTrainingNotice(null);

    try {
      const response = await fetch(`/api/training/${job.id}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", session_id: quizSession?.id, answers: quizAnswers })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "提交测验失败");
      }

      setLatestAttempt(data.attempt);
      setCertificate(data.certificate ?? certificate);
      setQuizSession(null);
      setQuizQuestions([]);
      setTrainingNotice(`考试完成：${data.attempt.score} 分，答对 ${data.correct}/${data.total} 题。`);
      await loadTrainingState();
    } catch (error) {
      setTrainingNotice(error instanceof Error ? error.message : "提交测验失败");
    } finally {
      setSubmittingQuiz(false);
    }
  }

  if (!slide) {
    return (
      <section className="ui-card p-8 text-center text-sm text-slate-500">
        该培训任务暂无讲稿。
      </section>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <section className="ui-card p-6 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-sm font-medium text-brand">{job.title}</p>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{slide.title}</h1>
            <p className="mt-2 text-sm text-slate-500">
              第 {slide.page} 页 / 共 {job.script_json.length} 页
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm text-slate-700">
              <Gauge size={17} />
              <span className="sr-only">播放速度</span>
              <select
                aria-label="播放速度"
                value={playbackRate}
                onChange={(event) => {
                  const nextRate = Number(event.target.value);
                  setPlaybackRate(nextRate);
                  if (audioRef.current) audioRef.current.playbackRate = nextRate;
                }}
                className="bg-transparent outline-none"
              >
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void playCurrentSlide()}
              disabled={loadingAudio && !playing}
              className="ui-button-secondary h-11"
            >
              {loadingAudio && !autoPlaying ? (
                <Loader2 className="animate-spin" size={17} />
              ) : playing && !autoPlaying ? (
                <Pause size={17} />
              ) : (
                <Volume2 size={17} />
              )}
              {playing && !autoPlaying ? "暂停本页" : "播放本页"}
            </button>
            <button
              type="button"
              onClick={() => void playFromCurrentSlide()}
              disabled={loadingAudio && !autoPlaying}
              className="ui-button-primary h-11"
            >
              {loadingAudio && autoPlaying ? (
                <Loader2 className="animate-spin" size={17} />
              ) : autoPlaying ? (
                <Pause size={17} />
              ) : (
                <PlayCircle size={17} />
              )}
              {autoPlaying ? "停止讲解" : "开始讲解"}
            </button>
          </div>
        </div>
        {audioStatus && <p className="mt-3 text-sm text-slate-500">{audioStatus}</p>}
        {audioError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="inline-flex items-center gap-2 font-medium">
              <CircleAlert size={15} />
              语音生成失败
            </span>
            <p className="mt-1">{audioError}</p>
          </div>
        )}

        {latestVideo && (
          <div className="mt-5 ui-card-muted p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Video size={17} className="text-brand" />
                <h2 className="text-sm font-semibold text-ink">课程讲解视频</h2>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">
                {videoStatusHint(latestVideo)}
              </span>
            </div>
            {latestVideo.status === "ready" && latestVideo.video_url ? (
              <video
                controls
                poster={latestVideo.cover_url ?? undefined}
                src={latestVideo.video_url}
                className="mt-4 aspect-video w-full rounded-lg bg-black"
              />
            ) : (
              <VideoProgressNotice videoJob={latestVideo} />
            )}
          </div>
        )}

        <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pageProgress}%` }} />
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-line bg-slate-950 shadow-soft">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <FileText size={16} className="text-cyan" />
              课件播放
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-200">
              {Math.max(1, Math.min(pageProgress, 100))}%
            </span>
          </div>
          <div className="bg-slate-950 p-3 sm:p-5">
            <div className="aspect-video overflow-hidden rounded-lg bg-white shadow-soft">
              {slideImageSrc ? (
                <img
                  src={slideImageSrc}
                  alt={`${job.title} 第 ${slide.page} 页课件`}
                  className="h-full w-full bg-white object-contain"
                  onError={() => markSlideImageFailed(pageIndex)}
                />
              ) : (
                <SlideFallbackCanvas job={job} slide={slide} />
              )}
            </div>
            {slide.notes && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">讲师备注</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-900">{slide.notes}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
              <ListChecks size={16} className="text-brand" />
              讲稿
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              约 {currentScriptLength} 字
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{slide.script}</p>
        </div>

        {job.quiz_enabled && (
          <div className="mt-8 ui-card-muted p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck size={17} className="text-brand" />
                <h2 className="text-sm font-semibold text-ink">课程考试</h2>
              </div>
              {latestAttempt && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  latestAttempt.passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}>
                  最近成绩：{latestAttempt.score} 分
                </span>
              )}
            </div>
            {quizSettings && <p className="mt-2 text-xs text-slate-500">合格 {quizSettings.pass_score} 分 · 最多 {quizSettings.max_attempts} 次 · 限时 {quizSettings.time_limit_minutes} 分钟</p>}
            {certificate && !certificate.revoked_at && <a href={`/api/training/${job.id}/certificate`} className="ui-button-secondary mt-3 h-10"><Download size={16} />下载完课证书</a>}
            {!quizSession && !certificate && (
              <div className="mt-4 rounded-lg border border-line bg-white p-4">
                <p className="text-sm text-slate-600">{quizBlockedReason ?? "课程已学完，可以开始正式考试。"}</p>
                <button type="button" onClick={() => void startQuiz()} disabled={!quizEligible || submittingQuiz} className="ui-button-primary mt-3 h-10">
                  {submittingQuiz ? <Loader2 className="animate-spin" size={16} /> : <ClipboardCheck size={16} />}开始考试
                </button>
              </div>
            )}
            {quizSession && <div className="mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><span>考试进行中</span><strong>剩余 {formatCountdown(Math.max(0, new Date(quizSession.expires_at).getTime() - quizClock))}</strong></div>}
            {quizSession && <div className="mt-4 space-y-4">
              {quizQuestions.map((question) => (
                <div key={question.id} className="ui-card p-3">
                  <p className="text-sm font-medium text-ink">{question.prompt}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {question.options.map((option) => (
                      <label key={option} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-slate-700">
                        <input
                          type={question.type === "multiple" ? "checkbox" : "radio"}
                          name={question.id}
                          value={option}
                          checked={answerIncludes(quizAnswers[question.id], option)}
                          onChange={(event) => setQuizAnswers((current) => ({ ...current, [question.id]: updateAnswer(current[question.id], option, question.type === "multiple", event.target.checked) }))}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>}
            {quizSession && <button
              type="button"
              onClick={() => void submitQuiz()}
              disabled={submittingQuiz || quizQuestions.some((question) => !quizAnswers[question.id] || answerValues(quizAnswers[question.id]).length === 0)}
              className="ui-button-success mt-4 h-10"
            >
              {submittingQuiz ? <Loader2 className="animate-spin" size={16} /> : <ClipboardCheck size={16} />}
              提交考试
            </button>}
            {(latestAttempt?.result_detail?.length ?? 0) > 0 && <div className="mt-4 space-y-2"><p className="text-sm font-semibold text-ink">最近考试解析</p>{latestAttempt!.result_detail.map((item, index) => <div key={item.question_id} className={`rounded-lg px-3 py-2 text-xs leading-5 ${item.correct ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}><strong>第 {index + 1} 题：{item.correct ? "正确" : "错误"}</strong>{item.explanation && <p>{item.explanation}</p>}</div>)}</div>}
            {trainingNotice && <p className="mt-3 text-sm text-slate-600">{trainingNotice}</p>}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={() => changePage(pageIndex - 1)}
            disabled={!canPrev}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <ChevronLeft size={16} />
            上一页
          </button>
          <button
            onClick={() => changePage(pageIndex + 1)}
            disabled={!canNext}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            下一页
            <ChevronRight size={16} />
          </button>
        </div>
      </section>

      <aside className="ui-card p-4">
        <div className="ui-card-muted p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">课程概览</h2>
            <StatusPill status={job.status} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <OverviewMetric label="讲稿页" value={job.script_json.length} />
            <OverviewMetric label="语音页" value={cachedAudioPages} />
            <OverviewMetric label="当前页" value={pageIndex + 1} />
            <OverviewMetric label="完课率" value={`${learningProgress}%`} />
            <OverviewMetric label="学习时长" value={formatLearningTime(progressRecord?.total_learning_seconds ?? 0)} />
            <OverviewMetric label="视频" value={latestVideo?.status === "ready" ? "可播放" : latestVideo ? "生成中" : "未生成"} />
          </div>
          <div className="mt-4 rounded-lg border border-cyan/20 bg-cyan/10 px-3 py-2 text-xs leading-5 text-steel">
            已学习 {completedPages.length} / {job.script_json.length} 页。每页有效收听达到约 80% 后计为完成，拖动或仅翻页不会直接完课。
          </div>
          {progressRecord?.completed_at && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700">
              已完成课程：{new Date(progressRecord.completed_at).toLocaleString("zh-CN")}
            </div>
          )}
        </div>

        <h2 className="mt-5 text-sm font-semibold text-ink">页面目录</h2>
        <div className="mt-4 space-y-2">
          {job.script_json.map((item, index) => (
            <button
              key={`${item.page}-${item.title}`}
              onClick={() => changePage(index)}
              className={`w-full rounded-lg border px-3 py-3 text-left text-sm transition ${
                index === pageIndex ? "border-cyan bg-cyan/10 text-ink" : "border-line text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="block text-xs text-slate-400">第 {item.page} 页</span>
              <span className="mt-1 block font-medium">{item.title}</span>
              <span
                className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  completedPages.includes(index)
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {completedPages.includes(index) ? <CheckCircle2 size={12} /> : <Volume2 size={12} />}
                {completedPages.includes(index) ? "已学习" : job.audio_paths[index] ? "已缓存语音" : "待学习"}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function OverviewMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="ui-card-muted px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function SlideFallbackCanvas({ job, slide }: { job: TrainingJob; slide: TrainingJob["script_json"][number] }) {
  return (
    <div className="flex h-full flex-col justify-between bg-[linear-gradient(rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(16,32,51,0.035)_1px,transparent_1px)] bg-[length:28px_28px] p-5 sm:p-8">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="rounded-full bg-cyan/10 px-3 py-1 text-xs font-semibold text-brand">
            Slide {slide.page}
          </p>
          <p className="text-xs font-medium text-slate-400">{job.ppt_file_name}</p>
        </div>
        <h2 className="mt-5 text-2xl font-semibold leading-tight text-ink sm:text-3xl">
          {slide.title}
        </h2>
        <ul className="mt-6 grid gap-3 text-sm leading-6 text-slate-700 sm:text-base">
          {slide.bullets.length > 0 ? (
            slide.bullets.slice(0, 6).map((bullet) => (
              <li key={bullet} className="flex gap-3">
                <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" />
                <span>{bullet}</span>
              </li>
            ))
          ) : (
            <li className="flex gap-3">
              <span className="mt-2 size-2 shrink-0 rounded-full bg-slate-300" />
              <span>本页未解析到正文要点。</span>
            </li>
          )}
        </ul>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-slate-500">
        <span>{job.title}</span>
        <span>{slide.page} / {job.script_json.length}</span>
      </div>
    </div>
  );
}

function VideoProgressNotice({ videoJob }: { videoJob: TrainingVideoJob }) {
  const progress = getVideoProgress(videoJob);

  if (videoJob.status === "failed") {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
        <span className="inline-flex items-center gap-2 font-medium">
          <CircleAlert size={15} />
          视频生成失败
        </span>
        <p className="mt-1">{videoJob.error_message ?? progress.message ?? "请联系管理员重新生成课件视频。"}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
      <div className="flex items-center justify-between gap-3">
        <span>{progress.message || "视频正在生成，当前仍可使用逐页语音学习。"}</span>
        <span className="shrink-0 tabular-nums text-xs text-slate-500">{progress.progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.progress}%` }} />
      </div>
      {progress.total_slides > 0 && (
        <p className="text-xs text-slate-500">
          课件画面 {progress.slide_images_done}/{progress.total_slides}，语音 {progress.audio_done}/{progress.total_slides}，视频 {progress.video_done}/{progress.total_slides}
        </p>
      )}
    </div>
  );
}

function videoStatusHint(videoJob: TrainingVideoJob) {
  if (videoJob.status === "ready") {
    return "可播放";
  }

  if (videoJob.status === "failed") {
    return "失败";
  }

  if (videoJob.status === "queued") {
    return "排队中";
  }

  return "生成中";
}

function getVideoProgress(videoJob: TrainingVideoJob) {
  const metadata = videoJob.metadata ?? {};
  const totalSlides = numberFromMetadata(metadata.total_slides) || numberFromMetadata(metadata.slide_count);
  const progress = numberFromMetadata(metadata.progress);

  return {
    progress: Math.max(0, Math.min(100, progress || (videoJob.status === "ready" ? 100 : 0))),
    total_slides: Math.max(0, totalSlides),
    slide_images_done: Math.max(0, numberFromMetadata(metadata.slide_images_done)),
    audio_done: Math.max(0, numberFromMetadata(metadata.audio_done)),
    video_done: Math.max(0, numberFromMetadata(metadata.video_done)),
    message: typeof metadata.message === "string" ? metadata.message : ""
  };
}

function numberFromMetadata(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return 0;
}

function formatLearningTime(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 1) return `${Math.max(0, Math.round(seconds))} 秒`;
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  return `${Math.floor(totalMinutes / 60)} 小时 ${totalMinutes % 60} 分`;
}

function answerValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function answerIncludes(value: string | string[] | undefined, option: string) {
  return answerValues(value).includes(option);
}

function updateAnswer(current: string | string[] | undefined, option: string, multiple: boolean, checked: boolean): string | string[] {
  if (!multiple) return option;
  const values = answerValues(current);
  return checked ? [...new Set([...values, option])] : values.filter((value) => value !== option);
}

function formatCountdown(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
