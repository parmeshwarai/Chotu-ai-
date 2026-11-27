import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Crown,
  Download,
  Edit3,
  Film,
  History,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Lock,
  Music,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Subtitles,
  Upload,
  Volume2,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { apiFetch } from '../lib/api';
import {
  createJobId,
  deductCreditsAtomic,
  recordMediaHistory,
  refundCreditsAtomic,
} from '../lib/credits';
import { db } from '../lib/firebase';
import {
  calculateVideoCreditsAndCost,
  formatDurationSec,
  formatISTDateTime,
  getEffectiveLimits,
  VIDEO_DURATION_OPTIONS,
  VIDEO_MODEL_SPECS,
} from '../lib/plans';
import {
  AppTab,
  MediaHistoryItem,
  SystemConfig,
  UserProfile,
  VideoJobRecord,
  VideoQuality,
  VideoScene,
} from '../types';

interface Props {
  profile: UserProfile;
  config: SystemConfig;
  mediaHistory: MediaHistoryItem[];
  initialMode?: 'text_to_video' | 'image_to_video';
  initialSection?: 'create' | 'history';
  onNavigate: (tab: AppTab) => void;
}

interface ServerQuotaSnapshot {
  plan: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: string;
  singleVideoLimitSec: number;
  dailyVideoLimitSec: number;
  monthlyVideoLimitSec: number;
  dailySecondsUsed: number;
  monthlySecondsUsed: number;
  videoCredits: number;
  dailyResetHourIST: number;
  featureTextToVideo: boolean;
  featureImageToVideo: boolean;
  qualityEnabled: Record<VideoQuality, boolean>;
  modelEnabled: Record<string, boolean>;
}

const VIDEO_STYLES = [
  { id: 'Cinematic', label: 'Cinematic Film' },
  { id: 'Realistic', label: 'Realistic Live-Action' },
  { id: 'Cartoon', label: 'Cartoon Animation' },
  { id: '3D Animation', label: '3D Animation (CGI)' },
];

export function VideoStudio({
  profile,
  config,
  mediaHistory,
  initialMode = 'text_to_video',
  initialSection = 'create',
  onNavigate,
}: Props) {
  const [section, setSection] = useState<'create' | 'history'>(initialSection);
  const [mode, setMode] = useState<'text_to_video' | 'image_to_video'>(initialMode);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('Cinematic');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSec, setDurationSec] = useState<number>(10);
  const [modelId, setModelId] = useState<string>('gemini-omni-1.2-flash');
  const [quality, setQuality] = useState<VideoQuality>('720p');
  const [voiceOption, setVoiceOption] = useState<'none' | 'hi' | 'en'>('none');
  const [backgroundMusic, setBackgroundMusic] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [cameraHint, setCameraHint] = useState('Smooth cinematic tracking with natural character motion');

  // Reference image for Image-to-Video
  const [sourceImage, setSourceImage] = useState<{
    base64: string;
    mimeType: string;
    previewUrl: string;
    name: string;
  } | null>(null);

  // Scene-by-scene planner
  const [planningScenes, setPlanningScenes] = useState(false);
  const [scriptSummary, setScriptSummary] = useState('');
  const [characterGuide, setCharacterGuide] = useState('');
  const [plannedScenes, setPlannedScenes] = useState<VideoScene[]>([]);

  // Backend Quota & Jobs
  const [serverQuota, setServerQuota] = useState<ServerQuotaSnapshot | null>(null);
  const [jobs, setJobs] = useState<VideoJobRecord[]>([]);
  const [activeJob, setActiveJob] = useState<VideoJobRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingSceneIdx, setRetryingSceneIdx] = useState<number | null>(null);
  const [editingSceneIdx, setEditingSceneIdx] = useState<number | null>(null);
  const [sceneEditDraft, setSceneEditDraft] = useState<{
    visualPrompt: string;
    cameraMovement: string;
    narrationText: string;
  }>({ visualPrompt: '', cameraMovement: '', narrationText: '' });

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const notifiedJobsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const loadQuotaAndJobs = useCallback(async () => {
    try {
      const [qRes, jRes] = await Promise.all([
        apiFetch<ServerQuotaSnapshot>('/api/video/quota'),
        apiFetch<{ jobs: VideoJobRecord[] }>('/api/video/jobs'),
      ]);
      setServerQuota(qRes);
      setJobs(jRes.jobs || []);
      if (jRes.jobs?.length) {
        const running = jRes.jobs.find((j) => j.status === 'queued' || j.status === 'processing');
        setActiveJob((prev) => {
          if (prev) {
            return jRes.jobs.find((j) => j.id === prev.id) || running || jRes.jobs[0];
          }
          return running || jRes.jobs[0];
        });
      }
    } catch {
      // Fall back silently to Firestore profile
    }
  }, []);

  useEffect(() => {
    void loadQuotaAndJobs();
  }, [loadQuotaAndJobs]);

  // Live poll active queued/processing job
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'queued' && activeJob.status !== 'processing')) {
      return;
    }
    const timer = setInterval(async () => {
      try {
        const updated = await apiFetch<VideoJobRecord>(`/api/video/jobs/${activeJob.id}`);
        setActiveJob(updated);
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));

        if (updated.status !== 'queued' && updated.status !== 'processing') {
          void loadQuotaAndJobs();
          // Sync terminal state to Firestore videoJobs & mediaHistory
          await setDoc(
            doc(db, 'videoJobs', updated.id),
            {
              id: updated.id,
              userId: profile.uid,
              mode: updated.mode,
              prompt: updated.prompt,
              style: updated.style,
              aspectRatio: updated.aspectRatio,
              quality: updated.quality,
              model: updated.model,
              durationSec: updated.durationSec,
              status: updated.status,
              progressPct: updated.progressPct,
              etaSeconds: 0,
              totalScenes: updated.totalScenes,
              completedScenes: updated.completedScenes,
              creditsReserved: updated.creditsReserved,
              creditsRefunded: updated.creditsRefunded,
              estimatedApiCostInr: updated.estimatedApiCostInr,
              ...(updated.finalVideoUrl ? { finalVideoUrl: updated.finalVideoUrl } : {}),
              ...(updated.subtitleUrl ? { subtitleUrl: updated.subtitleUrl } : {}),
              ...(updated.errorMessage ? { errorMessage: updated.errorMessage.slice(0, 580) } : {}),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          ).catch(() => {});

          if (updated.creditsRefunded > 0) {
            const failedSec = updated.scenes
              .filter((s) => s.status === 'failed')
              .reduce((acc, s) => acc + s.durationSec, 0);
            await refundCreditsAtomic({
              uid: profile.uid,
              creditType: 'video',
              cost: updated.creditsRefunded,
              durationSec: failedSec,
              jobId: updated.id,
              reason: `Automatic refund: ${updated.errorMessage || 'Generation failed'}`,
            }).catch(() => {});
          }

          await recordMediaHistory({
            id: updated.id,
            userId: profile.uid,
            type: 'video',
            mode: updated.mode,
            prompt: updated.prompt,
            style: updated.style,
            model: updated.model,
            aspectRatio: updated.aspectRatio,
            quality: updated.quality,
            duration: formatDurationSec(updated.durationSec),
            durationSec: updated.durationSec,
            status: updated.status === 'completed' ? 'completed' : updated.status === 'partial_failed' ? 'partial_failed' : 'failed',
            creditsCost: updated.creditsReserved,
            apiCostInr: updated.estimatedApiCostInr,
            refunded: updated.creditsRefunded > 0,
            ...(updated.finalVideoUrl ? { mediaUrl: updated.finalVideoUrl } : {}),
            ...(updated.subtitleUrl ? { subtitleUrl: updated.subtitleUrl } : {}),
            ...(updated.errorMessage ? { errorMessage: updated.errorMessage.slice(0, 580) } : {}),
          }).catch(() => {});

          if (!notifiedJobsRef.current.has(updated.id)) {
            notifiedJobsRef.current.add(updated.id);
            if (updated.status === 'completed') {
              setStatusMessage('Your video is ready to preview and download!');
              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('Chhotu AI Video Ready', {
                  body: `${formatDurationSec(updated.durationSec)} ${updated.quality} video completed.`,
                });
              }
            } else {
              setError(
                `${updated.errorMessage || 'Video generation failed.'}${
                  updated.creditsRefunded > 0
                    ? ` (${updated.creditsRefunded} video credit(s) & quota seconds automatically refunded.)`
                    : ''
                }`
              );
            }
          }
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [activeJob, loadQuotaAndJobs, profile.uid]);

  // Effective limits merging backend ledger & Firestore profile
  const firestoreLimits = useMemo(() => getEffectiveLimits(profile, config), [profile, config]);
  const singleLimitSec = serverQuota?.singleVideoLimitSec ?? firestoreLimits.singleVideoLimitSec;
  const dailyLimitSec = serverQuota?.dailyVideoLimitSec ?? firestoreLimits.dailyVideoLimitSec;
  const dailyUsedSec = serverQuota?.dailySecondsUsed ?? firestoreLimits.dailySecondsUsed;
  const dailyRemainingSec = Math.max(0, dailyLimitSec - dailyUsedSec);
  const monthlyUsedSec = serverQuota?.monthlySecondsUsed ?? firestoreLimits.monthlySecondsUsed;
  const availableCredits = serverQuota?.videoCredits ?? profile.videoCredits;
  const activePlanName = serverQuota?.plan ?? firestoreLimits.activePlanId;
  const expiresAtIso = serverQuota?.subscriptionExpiresAt ?? profile.subscriptionExpiresAt;

  // Dynamic model & quality filtering (shows ONLY qualities supported by selected model AND enabled by Admin)
  const selectedModelSpec = useMemo(
    () => VIDEO_MODEL_SPECS.find((m) => m.id === modelId) || VIDEO_MODEL_SPECS[0],
    [modelId]
  );

  const availableQualities = useMemo(() => {
    const adminQualityMap: Record<VideoQuality, boolean> = {
      '480p': serverQuota?.qualityEnabled?.['480p'] ?? config.quality480p ?? false,
      '720p': serverQuota?.qualityEnabled?.['720p'] ?? config.quality720p ?? true,
      '1080p': serverQuota?.qualityEnabled?.['1080p'] ?? config.quality1080p ?? true,
      '4k': serverQuota?.qualityEnabled?.['4k'] ?? config.quality4k ?? true,
    };
    return selectedModelSpec.supportedQualities.filter((q) => adminQualityMap[q]);
  }, [selectedModelSpec, serverQuota, config]);

  useEffect(() => {
    if (availableQualities.length > 0 && !availableQualities.includes(quality)) {
      setQuality(availableQualities[0]);
    }
  }, [availableQualities, quality]);

  const estimate = useMemo(
    () => calculateVideoCreditsAndCost(durationSec, quality, modelId),
    [durationSec, quality, modelId]
  );

  const textModeEnabled = (config.featureTextToVideo ?? true) && (serverQuota?.featureTextToVideo ?? true);
  const imageModeEnabled = (config.featureImageToVideo ?? true) && (serverQuota?.featureImageToVideo ?? true);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Reference image must be under 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      setSourceImage({
        base64,
        mimeType: file.type || 'image/png',
        previewUrl: dataUrl,
        name: file.name,
      });
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePlanScenes = async () => {
    setError(null);
    setStatusMessage(null);
    if (!prompt.trim()) {
      setError('Please enter your video story or prompt first.');
      return;
    }
    setPlanningScenes(true);
    setStatusMessage('Planning story arc & scene breakdown...');
    try {
      const res = await apiFetch<{
        scriptSummary: string;
        characterGuide: string;
        scenes: VideoScene[];
      }>('/api/video/plan-scenes', {
        method: 'POST',
        body: JSON.stringify({
          prompt: mode === 'image_to_video' ? `${prompt.trim()}. Camera/Movement: ${cameraHint}` : prompt.trim(),
          mode,
          style,
          durationSec,
          voiceOption,
          model: modelId,
        }),
      });
      setScriptSummary(res.scriptSummary);
      setCharacterGuide(res.characterGuide);
      setPlannedScenes(res.scenes);
      setStatusMessage(`Prepared ${res.scenes.length} continuous scene(s) for ${formatDurationSec(durationSec)}. Review or edit below.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to plan scenes.');
      setStatusMessage(null);
    } finally {
      setPlanningScenes(false);
    }
  };

  const handleGenerateVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setStatusMessage(null);

    if (!config.featureVideo || !config.modelVideo) {
      setError('AI Video Studio is currently turned OFF by Admin.');
      return;
    }
    if (mode === 'text_to_video' && !textModeEnabled) {
      setError('Text-to-Video mode is currently disabled by Admin.');
      return;
    }
    if (mode === 'image_to_video' && !imageModeEnabled) {
      setError('Image-to-Video mode is currently disabled by Admin.');
      return;
    }
    if (mode === 'image_to_video' && !sourceImage) {
      setError('Please upload a reference photo/image for Image-to-Video mode.');
      return;
    }
    if (!prompt.trim()) {
      setError('Please enter a prompt describing your video.');
      return;
    }
    if (durationSec > singleLimitSec) {
      setError(
        `Single video limit exceeded: Your ${activePlanName.toUpperCase()} plan supports up to ${formatDurationSec(
          singleLimitSec
        )} per video. Upgrade your plan for longer videos.`
      );
      return;
    }
    if (durationSec > dailyRemainingSec) {
      setError(
        `Daily video limit reached: ${formatDurationSec(dailyRemainingSec)} remaining today (IST). Upgrade plan or wait for IST daily reset.`
      );
      return;
    }
    if (availableCredits < estimate.credits) {
      setError(
        `Insufficient Video Credits (${availableCredits} available, ${estimate.credits} required). Upgrade your plan to get more credits.`
      );
      return;
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => {});
    }

    const jobId = createJobId();
    setSubmitting(true);
    setStatusMessage('Validating quota, reserving credits, and queuing generation...');

    try {
      // Mirror deduction into Firestore transaction so client/account ledger matches backend
      await deductCreditsAtomic({
        uid: profile.uid,
        creditType: 'video',
        cost: estimate.credits,
        durationSec,
        resetHourIST: config.dailyResetHourIST ?? 0,
        jobId,
        reason: `Video (${mode === 'image_to_video' ? 'I2V' : 'T2V'}, ${formatDurationSec(durationSec)}, ${quality})`,
      }).catch(() => {
        // Backend ledger remains authoritative even if Firestore client doc was out of sync
      });

      const createdJob = await apiFetch<VideoJobRecord>('/api/video/jobs', {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          mode,
          prompt:
            mode === 'image_to_video'
              ? `${prompt.trim()}. Camera & Character Motion: ${cameraHint}`
              : prompt.trim(),
          scriptSummary,
          characterGuide,
          style,
          aspectRatio,
          quality,
          model: modelId,
          voiceOption,
          backgroundMusic,
          subtitlesEnabled,
          durationSec,
          scenes: plannedScenes.length > 0 ? plannedScenes : undefined,
          sourceImageBase64: mode === 'image_to_video' ? sourceImage?.base64 : undefined,
          sourceMimeType: mode === 'image_to_video' ? sourceImage?.mimeType : undefined,
        }),
      });

      setActiveJob(createdJob);
      setJobs((prev) => [createdJob, ...prev]);
      setStatusMessage(
        `Job queued (#${createdJob.queuePosition || 1}). Generating ${createdJob.totalScenes} scene(s)...`
      );
      void loadQuotaAndJobs();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start video job.';
      await refundCreditsAtomic({
        uid: profile.uid,
        creditType: 'video',
        cost: estimate.credits,
        durationSec,
        jobId,
        reason: `Refund: ${msg}`,
      }).catch(() => {});
      setError(msg);
      setStatusMessage(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndRetryScene = async (job: VideoJobRecord, scene: VideoScene, retryAfterSave: boolean) => {
    setRetryingSceneIdx(scene.sceneIndex);
    setError(null);
    try {
      await apiFetch(`/api/video/jobs/${job.id}/scenes/${scene.sceneIndex}`, {
        method: 'PATCH',
        body: JSON.stringify({
          visualPrompt: sceneEditDraft.visualPrompt,
          cameraMovement: sceneEditDraft.cameraMovement,
          narrationText: sceneEditDraft.narrationText,
        }),
      });
      setEditingSceneIdx(null);

      if (retryAfterSave) {
        setStatusMessage(`Retrying ONLY Scene ${scene.sceneIndex} (keeping other completed scenes)...`);
        const updated = await apiFetch<VideoJobRecord>(
          `/api/video/jobs/${job.id}/scenes/${scene.sceneIndex}/retry`,
          { method: 'POST' }
        );
        setActiveJob(updated);
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
        setStatusMessage(
          updated.status === 'completed'
            ? `Scene ${scene.sceneIndex} succeeded and final video was re-assembled!`
            : updated.errorMessage || `Scene ${scene.sceneIndex} retry finished.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scene retry failed.');
    } finally {
      setRetryingSceneIdx(null);
    }
  };

  const handleQuickRetryScene = async (job: VideoJobRecord, sceneIndex: number) => {
    setRetryingSceneIdx(sceneIndex);
    setError(null);
    setStatusMessage(`Retrying Scene ${sceneIndex} only...`);
    try {
      const updated = await apiFetch<VideoJobRecord>(
        `/api/video/jobs/${job.id}/scenes/${sceneIndex}/retry`,
        { method: 'POST' }
      );
      setActiveJob(updated);
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      if (updated.status === 'completed') {
        setStatusMessage(`Scene ${sceneIndex} fixed and final MP4 assembled.`);
      } else if (updated.errorMessage) {
        setError(updated.errorMessage);
        setStatusMessage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scene retry failed.');
      setStatusMessage(null);
    } finally {
      setRetryingSceneIdx(null);
    }
  };

  const handleLoadForRegenerate = (job: VideoJobRecord) => {
    setSection('create');
    setMode(job.mode);
    setPrompt(job.prompt);
    setStyle(job.style);
    setAspectRatio((job.aspectRatio as '16:9' | '9:16' | '1:1') || '16:9');
    setDurationSec(job.durationSec);
    setQuality(job.quality);
    setVoiceOption(job.voiceOption);
    setBackgroundMusic(job.backgroundMusic);
    setSubtitlesEnabled(job.subtitlesEnabled);
    setPlannedScenes(job.scenes.map((s) => ({ ...s, status: 'pending' })));
    setStatusMessage('Loaded settings & scene prompts into editor. Adjust anything and click Generate Video.');
  };

  return (
    <div className="space-y-6">
      {/* Live Quota, Subscription & Daily Limit Banner (IST) */}
      <section className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h1 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                Advanced AI Video Generator
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Image-to-Video & Text-to-Video with scene continuity, IST daily quota enforcement, and automatic refunds.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSection('create')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 ${
                section === 'create'
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Create Video
            </button>
            <button
              type="button"
              onClick={() => setSection('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 ${
                section === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              History ({jobs.length || mediaHistory.filter((m) => m.type === 'video').length})
            </button>
            <button
              type="button"
              onClick={() => onNavigate('subscription')}
              className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Crown className="w-3.5 h-3.5" />
              Upgrade Plan
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs tabular-nums">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Current Plan</div>
            <div className="font-semibold capitalize text-blue-600 dark:text-blue-400 mt-0.5">
              {activePlanName}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Plan Expiry (IST)</div>
            <div className="font-medium text-slate-900 dark:text-white mt-0.5 truncate">
              {formatISTDateTime(expiresAtIso)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Single Video Limit</div>
            <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
              {formatDurationSec(singleLimitSec)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Today&apos;s Limit (IST)</div>
            <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
              {formatDurationSec(dailyLimitSec)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Used / Remaining Today</div>
            <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
              {formatDurationSec(dailyUsedSec)} / {formatDurationSec(dailyRemainingSec)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Monthly Usage</div>
            <div className="font-mono font-semibold text-slate-900 dark:text-white mt-0.5">
              {formatDurationSec(monthlyUsedSec)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Video Credits</div>
            <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {availableCredits}
            </div>
          </div>
        </div>
      </section>

      {section === 'create' ? (
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Creation Form */}
          <form onSubmit={handleGenerateVideo} className="lg:col-span-7 space-y-5 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            {/* Mode Switcher: Image-to-Video vs Text-to-Video */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                disabled={!textModeEnabled}
                onClick={() => setMode('text_to_video')}
                className={`py-2.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  mode === 'text_to_video'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                } disabled:opacity-40`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Text to Video
              </button>
              <button
                type="button"
                disabled={!imageModeEnabled}
                onClick={() => setMode('image_to_video')}
                className={`py-2.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  mode === 'image_to_video'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                } disabled:opacity-40`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Image to Video
              </button>
            </div>

            {/* Image Upload Box (Mode 1: Image to Video) */}
            {mode === 'image_to_video' && (
              <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Upload Reference Photo / Character Image
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Original character face, outfit &amp; appearance are preserved across motion &amp; camera movement.
                    </p>
                  </div>
                  <label className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer inline-flex items-center gap-1.5 shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    {sourceImage ? 'Replace Photo' : 'Upload Photo'}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>

                {sourceImage && (
                  <div className="flex items-center gap-3 pt-1">
                    <img
                      src={sourceImage.previewUrl}
                      alt={sourceImage.name}
                      className="w-20 h-20 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="text-xs font-medium truncate">{sourceImage.name}</div>
                      <input
                        type="text"
                        value={cameraHint}
                        onChange={(e) => setCameraHint(e.target.value)}
                        placeholder="Character movement & camera angle (e.g. slow dolly-in, character smiles & waves)..."
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Main Prompt */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {mode === 'image_to_video' ? 'Animation & Motion Prompt' : 'Story / Scene Prompt (Hindi or English)'}
              </label>
              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === 'image_to_video'
                    ? 'Describe how the character and camera should move while keeping original likeness...'
                    : 'Describe your video story, characters, setting, and mood in Hindi or English...'
                }
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* Duration Options (Strictly NO 5s option!) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">Video Duration</span>
                <span className="text-[11px] text-slate-500">
                  Max Single: {formatDurationSec(singleLimitSec)} · Daily Left: {formatDurationSec(dailyRemainingSec)}
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {VIDEO_DURATION_OPTIONS.map((opt) => {
                  const lockedBySingle = opt.seconds > singleLimitSec;
                  const lockedByDaily = opt.seconds > dailyRemainingSec;
                  const locked = lockedBySingle || lockedByDaily;
                  const active = durationSec === opt.seconds;
                  return (
                    <button
                      key={opt.seconds}
                      type="button"
                      onClick={() => {
                        setDurationSec(opt.seconds);
                        setPlannedScenes([]);
                      }}
                      className={`p-2 rounded-xl border text-center transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-semibold flex items-center justify-center gap-1">
                        {locked && <Lock className="w-3 h-3 text-amber-500" />}
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-slate-500 capitalize mt-0.5">{opt.minPlan}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Style, Aspect Ratio, Model, Quality */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Video Style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  {VIDEO_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">Aspect Ratio</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16' | '1:1')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  <option value="16:9">16:9 Landscape (YouTube)</option>
                  <option value="9:16">9:16 Portrait (Shorts / Reels)</option>
                  <option value="1:1">1:1 Square</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">AI Video Model</label>
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  {VIDEO_MODEL_SPECS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">
                  Quality (Supported by {selectedModelSpec.name.split(' ')[0]})
                </label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as VideoQuality)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  {availableQualities.length === 0 ? (
                    <option value="720p">All qualities disabled by Admin</option>
                  ) : (
                    availableQualities.map((q) => (
                      <option key={q} value={q}>
                        {q === '720p' ? '720p HD' : q === '1080p' ? '1080p Full HD' : q === '4k' ? '4K Ultra HD' : '480p SD'}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            {/* Audio, Background Music & Subtitles */}
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-500 flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5" />
                  AI Voiceover
                </label>
                <select
                  value={voiceOption}
                  onChange={(e) => setVoiceOption(e.target.value as 'none' | 'hi' | 'en')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="none">No Narration</option>
                  <option value="hi">Hindi AI Voice</option>
                  <option value="en">English AI Voice</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setBackgroundMusic((v) => !v)}
                  className={`w-full px-3 py-2 rounded-xl border font-medium flex items-center justify-center gap-1.5 ${
                    backgroundMusic
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  {backgroundMusic ? 'Background Music ON' : 'Background Music OFF'}
                </button>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setSubtitlesEnabled((v) => !v)}
                  className={`w-full px-3 py-2 rounded-xl border font-medium flex items-center justify-center gap-1.5 ${
                    subtitlesEnabled
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Subtitles className="w-3.5 h-3.5" />
                  {subtitlesEnabled ? 'SRT Subtitles ON' : 'SRT Subtitles OFF'}
                </button>
              </div>
            </div>

            {/* Credit & Scene Estimate Bar */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
              <div className="space-y-0.5">
                <div>
                  Credits Required: <strong className="font-mono text-slate-900 dark:text-white">{estimate.credits}</strong>
                  <span className="mx-2 text-slate-400">·</span>
                  Available: <strong className="font-mono text-emerald-600 dark:text-emerald-400">{availableCredits}</strong>
                </div>
                <div className="text-[11px] text-slate-500">
                  {estimate.sceneCount} scene clip(s) (~{selectedModelSpec.maxClipSec}s/clip) · Est. Engine Cost ₹{estimate.estimatedApiCostInr}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={planningScenes || submitting}
                  onClick={() => void handlePlanScenes()}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {planningScenes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                  Plan Script &amp; Scenes
                </button>
                <button
                  type="submit"
                  disabled={submitting || availableQualities.length === 0}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {submitting ? 'Queuing...' : 'Generate Video'}
                </button>
              </div>
            </div>

            {/* Honest API Policy Note */}
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 flex items-start gap-2.5 text-[11px] text-amber-900 dark:text-amber-200">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Connected Engine: <strong>Gemini Omni Flash</strong> (requires a paid-tier GEMINI_API_KEY in Settings &gt; Secrets).
                If generation fails on any scene, unused/failed credits &amp; daily seconds are automatically refunded.
              </span>
            </div>

            {error && (
              <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div>{error}</div>
                  {(error.includes('limit') || error.includes('Credits')) && (
                    <button
                      type="button"
                      onClick={() => onNavigate('subscription')}
                      className="text-blue-600 dark:text-blue-400 font-semibold underline"
                    >
                      View Plans &amp; Upgrade Limit
                    </button>
                  )}
                </div>
              </div>
            )}

            {statusMessage && (
              <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
                {(planningScenes || submitting || activeJob?.status === 'processing' || activeJob?.status === 'queued') && (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                )}
                <span>{statusMessage}</span>
              </div>
            )}

            {/* Editable Pre-Generation Scene Breakdown */}
            {plannedScenes.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">
                    Planned Storyboard ({plannedScenes.length} Scenes)
                  </div>
                  <span className="text-[11px] text-slate-500">Editable before generating</span>
                </div>
                {characterGuide && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-lg">
                    <strong>Continuity Guide:</strong> {characterGuide}
                  </p>
                )}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {plannedScenes.map((sc, idx) => (
                    <div key={sc.sceneIndex} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                        <span>Scene {sc.sceneIndex} ({sc.durationSec}s)</span>
                        <span>{sc.cameraMovement}</span>
                      </div>
                      <textarea
                        rows={2}
                        value={sc.visualPrompt}
                        onChange={(e) =>
                          setPlannedScenes((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, visualPrompt: e.target.value } : item))
                          )
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>

          {/* Right Column: Live Progress, Queue Status, Scene Retry & Preview */}
          <div className="lg:col-span-5 space-y-4">
            <div className="p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold flex items-center gap-2">
                  <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  Live Render Queue &amp; Output Preview
                </h2>
                <button
                  type="button"
                  onClick={() => void loadQuotaAndJobs()}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
              </div>

              {!activeJob ? (
                <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                  <Film className="w-8 h-8 mx-auto text-slate-400" />
                  <p>Configure your prompt and duration, then start generation to track live progress here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status & Progress Bar */}
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold capitalize flex items-center gap-1.5">
                        {activeJob.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : activeJob.status === 'failed' || activeJob.status === 'partial_failed' ? (
                          <AlertCircle className="w-4 h-4 text-rose-500" />
                        ) : (
                          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        )}
                        Status: {activeJob.status.replace('_', ' ')}
                      </span>
                      <span className="font-mono tabular-nums">{activeJob.progressPct}%</span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          activeJob.status === 'failed'
                            ? 'bg-rose-500'
                            : activeJob.status === 'completed'
                              ? 'bg-emerald-500'
                              : 'bg-blue-600'
                        }`}
                        style={{ width: `${activeJob.progressPct}%` }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 tabular-nums">
                      <span>
                        Scenes: {activeJob.completedScenes}/{activeJob.totalScenes}
                        {activeJob.queuePosition > 0 ? ` · Queue #${activeJob.queuePosition}` : ''}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {activeJob.etaSeconds > 0 ? `ETA ~${activeJob.etaSeconds}s` : 'Finished'}
                      </span>
                    </div>
                  </div>

                  {/* Final Video Preview & Downloads */}
                  {activeJob.finalVideoUrl && (
                    <div className="space-y-2.5">
                      <video
                        src={activeJob.finalVideoUrl}
                        controls
                        className="w-full rounded-xl bg-black max-h-72 object-contain"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={activeJob.finalVideoUrl}
                          download={`chhotu-ai-${activeJob.id}.mp4`}
                          className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download MP4
                        </a>
                        {activeJob.subtitleUrl && (
                          <a
                            href={activeJob.subtitleUrl}
                            download={`chhotu-ai-${activeJob.id}.srt`}
                            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <Subtitles className="w-3.5 h-3.5" />
                            Download Subtitles (.srt)
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleLoadForRegenerate(activeJob)}
                          className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Regenerate
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Failure / Refund Summary */}
                  {activeJob.errorMessage && (
                    <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                      <div className="font-semibold">
                        Generation Error {activeJob.creditsRefunded > 0 ? `· ${activeJob.creditsRefunded} Credit(s) Refunded` : ''}
                      </div>
                      <p className="break-words">{activeJob.errorMessage}</p>
                    </div>
                  )}

                  {/* Per-Scene Cards (Individual Scene Edit & Retry without Full Regenerate) */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Scene Breakdown ({activeJob.scenes.length})
                    </div>
                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                      {activeJob.scenes.map((sc) => (
                        <div
                          key={sc.sceneIndex}
                          className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold">
                              Scene {sc.sceneIndex} · {sc.durationSec}s
                            </span>
                            <span
                              className={`font-medium capitalize ${
                                sc.status === 'completed'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : sc.status === 'failed'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-blue-600 dark:text-blue-400'
                              }`}
                            >
                              {sc.status}
                            </span>
                          </div>

                          {editingSceneIdx === sc.sceneIndex ? (
                            <div className="space-y-2">
                              <textarea
                                rows={2}
                                value={sceneEditDraft.visualPrompt}
                                onChange={(e) => setSceneEditDraft((d) => ({ ...d, visualPrompt: e.target.value }))}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                              />
                              <input
                                type="text"
                                value={sceneEditDraft.cameraMovement}
                                onChange={(e) => setSceneEditDraft((d) => ({ ...d, cameraMovement: e.target.value }))}
                                placeholder="Camera movement"
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={retryingSceneIdx === sc.sceneIndex}
                                  onClick={() => void handleSaveAndRetryScene(activeJob, sc, true)}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-medium"
                                >
                                  Save &amp; Retry Scene {sc.sceneIndex}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingSceneIdx(null)}
                                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px]"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                                {sc.visualPrompt}
                              </p>
                              {sc.errorMessage && (
                                <p className="text-[11px] text-rose-600 dark:text-rose-400 line-clamp-2">
                                  {sc.errorMessage}
                                </p>
                              )}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSceneIdx(sc.sceneIndex);
                                    setSceneEditDraft({
                                      visualPrompt: sc.visualPrompt,
                                      cameraMovement: sc.cameraMovement,
                                      narrationText: sc.narrationText,
                                    });
                                  }}
                                  className="text-[11px] text-slate-600 dark:text-slate-300 hover:underline inline-flex items-center gap-1"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  Edit Scene
                                </button>
                                <button
                                  type="button"
                                  disabled={retryingSceneIdx === sc.sceneIndex}
                                  onClick={() => void handleQuickRetryScene(activeJob, sc.sceneIndex)}
                                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  {retryingSceneIdx === sc.sceneIndex ? 'Retrying...' : 'Retry This Scene'}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Video History Section */
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">
              Video Generation History ({jobs.length})
            </h2>
            <button
              type="button"
              onClick={() => setSection('create')}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium"
            >
              + New Video
            </button>
          </div>

          {jobs.length === 0 ? (
            <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center text-sm text-slate-500">
              No video generation jobs recorded yet.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden flex flex-col justify-between"
                >
                  {job.finalVideoUrl ? (
                    <video src={job.finalVideoUrl} controls className="w-full h-48 bg-black object-contain" />
                  ) : (
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/60 text-xs space-y-1">
                      <div className="font-semibold capitalize text-rose-600 dark:text-rose-400">
                        {job.status.replace('_', ' ')} · {job.creditsRefunded > 0 ? `${job.creditsRefunded} cr refunded` : `${job.progressPct}%`}
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 line-clamp-3">
                        {job.errorMessage || 'Inspect job scenes to retry individually.'}
                      </p>
                    </div>
                  )}

                  <div className="p-4 space-y-2.5 text-xs">
                    <div className="text-slate-500 dark:text-slate-400 tabular-nums">
                      {job.mode === 'image_to_video' ? 'Image to Video' : 'Text to Video'} · {job.style} · {formatDurationSec(job.durationSec)} · {job.quality}
                    </div>
                    <p className="text-slate-900 dark:text-white line-clamp-2">{job.prompt}</p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveJob(job);
                          setSection('create');
                        }}
                        className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                      >
                        Inspect / Edit Scenes
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLoadForRegenerate(job)}
                        className="text-slate-600 dark:text-slate-300 hover:underline"
                      >
                        Regenerate
                      </button>
                      {job.finalVideoUrl && (
                        <a href={job.finalVideoUrl} download className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1">
                          <Download className="w-3 h-3" />
                          MP4
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
