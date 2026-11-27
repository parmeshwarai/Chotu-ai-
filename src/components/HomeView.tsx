import React, { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Brain,
  Clock,
  Code2,
  Coins,
  Crown,
  FileText,
  Film,
  Globe,
  History,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Music,
  PenTool,
  Shield,
  Sparkles,
  UserCircle,
} from 'lucide-react';
import { formatDurationSec, formatISTDateTime, getEffectiveLimits } from '../lib/plans';
import { AppTab, SystemConfig, UserProfile } from '../types';

interface Props {
  profile: UserProfile;
  config: SystemConfig;
  isAdmin: boolean;
  onNavigate: (tab: AppTab) => void;
  onLaunchVideo?: (mode: 'text_to_video' | 'image_to_video', section?: 'create' | 'history') => void;
  stats: {
    chats: number;
    memories: number;
    media: number;
  };
}

export function HomeView({ profile, config, isAdmin, onNavigate, onLaunchVideo, stats }: Props) {
  const effective = getEffectiveLimits(profile, config);
  const [heroError, setHeroError] = useState(false);

  const tools: Array<{
    id: AppTab;
    title: string;
    subtitle: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    enabled: boolean;
    meta: string;
  }> = [
    {
      id: 'chat',
      title: 'AI Chat Assistant',
      subtitle: 'Multilingual Reasoning',
      description: 'Chat in Hindi, English, and Bhojpuri with saved conversations, rename/delete, copy & share.',
      icon: MessageSquare,
      enabled: config.featureChat,
      meta: `${stats.chats} saved chats`,
    },
    {
      id: 'voice',
      title: 'Voice AI Studio',
      subtitle: 'Speech In & Speech Out',
      description: 'Speak into your microphone with Hindi/English transcription and natural AI voice playback.',
      icon: Mic,
      enabled: config.featureVoice,
      meta: profile.voiceEnabled ? 'Voice active' : 'Voice muted',
    },
    {
      id: 'memory',
      title: 'AI Memory',
      subtitle: 'Long-Term Context',
      description: 'Manage personal preferences, project facts, and style rules remembered across chats.',
      icon: Brain,
      enabled: config.featureMemory,
      meta: `${stats.memories} memories`,
    },
    {
      id: 'image',
      title: 'AI Image Generator',
      subtitle: 'Generate & Edit',
      description: 'Create Realistic, Cartoon, 3D renders, and YouTube Thumbnails or edit uploaded images.',
      icon: ImageIcon,
      enabled: config.featureImage,
      meta: `${profile.imageCredits} credits`,
    },
    {
      id: 'video',
      title: 'AI Video Studio',
      subtitle: 'Text & Image to Video',
      description: 'Generate 16:9, 9:16, or 1:1 scene-by-scene videos with strict daily & monthly quota tracking.',
      icon: Film,
      enabled: config.featureVideo,
      meta: `${profile.dailyVideosUsed}/${profile.dailyVideoLimit} daily`,
    },
    {
      id: 'music',
      title: 'AI Music Generator',
      subtitle: 'Lyria Audio Tracks',
      description: 'Compose background and instrumental music with audio preview, download, and usage terms.',
      icon: Music,
      enabled: config.featureMusic,
      meta: `${profile.musicCredits} credits`,
    },
    {
      id: 'script',
      title: 'AI Script Writer',
      subtitle: 'YouTube, Shorts & Stories',
      description: 'Write Hindi, Bhojpuri, and Cartoon scripts with titles, tags, thumbnail text, and scene prompts.',
      icon: PenTool,
      enabled: config.featureScript,
      meta: 'Creator templates',
    },
    {
      id: 'document',
      title: 'Document Assistant',
      subtitle: 'PDF & Text Analyst',
      description: 'Upload PDFs or text files for deep summaries, Q&A, and downloadable structured reports.',
      icon: FileText,
      enabled: config.featureDocument,
      meta: 'PDF & TXT ready',
    },
    {
      id: 'search',
      title: 'Internet Search AI',
      subtitle: 'Live Web Grounding',
      description: 'Search latest live information with verified web sources and clear old-vs-new comparisons.',
      icon: Globe,
      enabled: config.featureSearch,
      meta: 'Google Search grounded',
    },
    {
      id: 'coding',
      title: 'Coding Assistant',
      subtitle: 'Build & Debug',
      description: 'Write HTML, CSS, JavaScript, TypeScript, and apps with error detection and code export.',
      icon: Code2,
      enabled: config.featureCoding,
      meta: 'Copy & download code',
    },
    {
      id: 'testing',
      title: 'BharatTube Testing',
      subtitle: 'Integration & Health',
      description: 'Probe BharatTube backend, DB, upload/playback APIs, AdMob status, and error reports.',
      icon: Activity,
      enabled: config.featureAppTesting,
      meta: 'Bridge ready',
    },
    {
      id: isAdmin ? 'admin' : 'account',
      title: isAdmin ? 'Admin Control Panel' : 'Account & Credits',
      subtitle: isAdmin ? 'Users, Limits & Models' : 'Profile & Ledger',
      description: isAdmin
        ? 'Manage users, plans, video limits, credits, model switches, API errors, and audit logs.'
        : 'View profile details, plan tier, credit balances, and immutable credit transaction history.',
      icon: isAdmin ? Shield : UserCircle,
      enabled: true,
      meta: isAdmin ? 'Admin verified' : `${profile.plan} plan`,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="grid lg:grid-cols-12 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden items-stretch">
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>Chhotu AI Workspace</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{profile.plan} Plan</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{stats.media} Media Items</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-white tracking-tight text-balance">
              Namaste, {profile.displayName}. What would you like to build today?
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              Launch a multilingual chat, speak directly with Voice AI, search live web sources,
              analyze PDF documents, write Bhojpuri or YouTube scripts, or generate media inside
              your credit-protected studio.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('chat')}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Open AI Chat
            </button>
            <button
              type="button"
              onClick={() => onNavigate('testing')}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              BharatTube Diagnostics
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 relative min-h-[220px] bg-slate-900 overflow-hidden">
          {!heroError ? (
            <img
              src="/src/assets/images/studio_hero_workspace_1795758199188.jpg"
              alt="Chhotu AI studio workspace"
              referrerPolicy="no-referrer"
              onError={() => setHeroError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-800 text-slate-300 text-sm">
              Chhotu AI Studio
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent" />
        </div>
      </section>

      {/* Credit & Quota Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Image Credits</div>
          <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {profile.imageCredits}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Video Credits</div>
          <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {profile.videoCredits}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Music Credits</div>
          <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {profile.musicCredits}
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-1">
          <div className="text-xs text-slate-500 dark:text-slate-400">Daily Video Limit (IST)</div>
          <div className="font-mono text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {formatDurationSec(effective.dailySecondsUsed)} / {formatDurationSec(effective.dailyVideoLimitSec)}
          </div>
        </div>
      </section>

      {/* Video Studio & Subscription Quick Access (6 Dedicated Cards) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            Video Studio &amp; Subscription Controls
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">
            {effective.activePlanId} Plan · Max Single Video {formatDurationSec(effective.singleVideoLimitSec)}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            type="button"
            disabled={!config.featureVideo || config.featureImageToVideo === false}
            onClick={() => (onLaunchVideo ? onLaunchVideo('image_to_video', 'create') : onNavigate('video'))}
            className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-3 disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <ImageIcon className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">Image to Video</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Upload a photo &amp; animate character and camera while keeping original likeness.
              </p>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
              Realistic · Cinematic · Cartoon · 3D
            </div>
          </button>

          <button
            type="button"
            disabled={!config.featureVideo || config.featureTextToVideo === false}
            onClick={() => (onLaunchVideo ? onLaunchVideo('text_to_video', 'create') : onNavigate('video'))}
            className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-3 disabled:opacity-50"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">Text to Video</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Create scene-by-scene videos from Hindi or English text prompts with voice &amp; subtitles.
              </p>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
              10s up to 20m (Plan-based)
            </div>
          </button>

          <button
            type="button"
            onClick={() => (onLaunchVideo ? onLaunchVideo('text_to_video', 'history') : onNavigate('video'))}
            className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <History className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">Video History</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Preview rendered MP4s, download subtitles, edit individual scenes, or regenerate.
              </p>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800 tabular-nums">
              {stats.media} media records
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('subscription')}
            className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Crown className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">My Subscription</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Active: <strong className="capitalize">{effective.activePlanId} Plan</strong> · Expiry: {formatISTDateTime(profile.subscriptionExpiresAt)}
              </p>
            </div>
            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium pt-2 border-t border-slate-100 dark:border-slate-800">
              View 6 Plans &amp; Invoices
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('video')}
            className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Clock className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">Daily Limit</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 tabular-nums">
                Used {formatDurationSec(effective.dailySecondsUsed)} · Remaining {formatDurationSec(effective.dailySecondsRemaining)} of {formatDurationSec(effective.dailyVideoLimitSec)}
              </p>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
              Auto-resets daily in IST
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('account')}
            className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Coins className="w-4 h-4" />
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400" />
            </div>
            <div>
              <div className="font-display text-base font-semibold">Available Credits</div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 tabular-nums">
                {profile.videoCredits} Video · {profile.imageCredits} Image · {profile.musicCredits} Music
              </p>
            </div>
            <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
              View Immutable Credit Ledger
            </div>
          </button>
        </div>
      </section>

      {/* All AI Feature Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            AI Modules & Studios
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Select any tool to launch its dedicated workspace
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                disabled={!tool.enabled}
                onClick={() => onNavigate(tool.id)}
                className="text-left p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:border-blue-500/60 dark:hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-4 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-blue-600 dark:text-blue-400">
                      <Icon className="w-4 h-4" />
                    </div>
                    <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <div className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      {tool.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {tool.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <span>{tool.subtitle}</span>
                  <span aria-hidden="true">·</span>
                  <span>{tool.enabled ? tool.meta : 'Disabled by Admin'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
