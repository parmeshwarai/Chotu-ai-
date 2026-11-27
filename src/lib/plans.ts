import { PlanDefinition, PlanId, SystemConfig, UserProfile, VideoQuality } from '../types';

export const DEFAULT_PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free Plan',
    priceInr: 0,
    durationDays: 0,
    singleVideoLimitSec: 10,
    dailyVideoLimitSec: 10,
    monthlyVideoLimitSec: 300,
    includedVideoCredits: 5,
    enabled: true,
    features: [
      'Single Video Limit: 10 Seconds',
      'Daily Video Limit: 10 Seconds',
      'Image to Video & Text to Video',
      '720p HD Output',
    ],
  },
  basic: {
    id: 'basic',
    name: 'Basic Plan',
    priceInr: 499,
    durationDays: 30,
    singleVideoLimitSec: 60,
    dailyVideoLimitSec: 120,
    monthlyVideoLimitSec: 3600,
    includedVideoCredits: 30,
    enabled: true,
    features: [
      'Single Video Limit: 1 Minute',
      'Daily Video Limit: 2 Minutes',
      'Scene-by-Scene Continuity',
      'Hindi / English AI Voice & Subtitles',
    ],
  },
  standard: {
    id: 'standard',
    name: 'Standard Plan',
    priceInr: 999,
    durationDays: 30,
    singleVideoLimitSec: 120,
    dailyVideoLimitSec: 300,
    monthlyVideoLimitSec: 9000,
    includedVideoCredits: 75,
    enabled: true,
    features: [
      'Single Video Limit: 2 Minutes',
      'Daily Video Limit: 5 Minutes',
      '1080p Full HD Support',
      'Background Music + Voice Mixing',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro Plan',
    priceInr: 2499,
    durationDays: 30,
    singleVideoLimitSec: 300,
    dailyVideoLimitSec: 600,
    monthlyVideoLimitSec: 18000,
    includedVideoCredits: 180,
    enabled: true,
    features: [
      'Single Video Limit: 5 Minutes',
      'Daily Video Limit: 10 Minutes',
      'Multi-Scene Script & Assembly',
      'Priority Generation Queue',
    ],
  },
  premium: {
    id: 'premium',
    name: 'Premium Plan',
    priceInr: 4999,
    durationDays: 30,
    singleVideoLimitSec: 600,
    dailyVideoLimitSec: 1200,
    monthlyVideoLimitSec: 36000,
    includedVideoCredits: 400,
    enabled: true,
    features: [
      'Single Video Limit: 10 Minutes',
      'Daily Video Limit: 20 Minutes',
      '4K Ultra HD Support',
      'Scene Editing & Per-Scene Retry',
    ],
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra Plan',
    priceInr: 9999,
    durationDays: 30,
    singleVideoLimitSec: 1200,
    dailyVideoLimitSec: 1800,
    monthlyVideoLimitSec: 54000,
    includedVideoCredits: 900,
    enabled: true,
    features: [
      'Single Video Limit: 20 Minutes',
      'Daily Video Limit: 30 Minutes',
      '4K Ultra HD + Full Voice/Music/SRT',
      'Dedicated Production Capacity',
    ],
  },
};

// Strictly no 5-second option!
export const VIDEO_DURATION_OPTIONS: Array<{
  seconds: number;
  label: string;
  minPlan: PlanId;
}> = [
  { seconds: 10, label: '10 Seconds', minPlan: 'free' },
  { seconds: 60, label: '1 Minute', minPlan: 'basic' },
  { seconds: 120, label: '2 Minutes', minPlan: 'standard' },
  { seconds: 300, label: '5 Minutes', minPlan: 'pro' },
  { seconds: 600, label: '10 Minutes', minPlan: 'premium' },
  { seconds: 1200, label: '20 Minutes', minPlan: 'ultra' },
];

export interface VideoModelSpec {
  id: string;
  name: string;
  provider: string;
  maxClipSec: number;
  supportedQualities: VideoQuality[];
  creditsPer10Sec: Record<VideoQuality, number>;
  apiCostInrPer10Sec: Record<VideoQuality, number>;
}

export const VIDEO_MODEL_SPECS: VideoModelSpec[] = [
  {
    id: 'gemini-omni-1.2-flash',
    name: 'Gemini Omni Flash (Veo Engine)',
    provider: 'Google Gemini API',
    maxClipSec: 15,
    // Omni Flash natively supports 720p, 1080p, 4k (480p is NOT supported by this model)
    supportedQualities: ['720p', '1080p', '4k'],
    creditsPer10Sec: { '480p': 1, '720p': 1, '1080p': 2, '4k': 4 },
    apiCostInrPer10Sec: { '480p': 6, '720p': 8, '1080p': 16, '4k': 32 },
  },
  {
    id: 'external-multi-model-slot',
    name: 'External Video API (Runway / Kling / Luma)',
    provider: 'External Adapter (Not Connected)',
    maxClipSec: 10,
    supportedQualities: ['480p', '720p', '1080p'],
    creditsPer10Sec: { '480p': 1, '720p': 2, '1080p': 3, '4k': 6 },
    apiCostInrPer10Sec: { '480p': 5, '720p': 10, '1080p': 20, '4k': 40 },
  },
];

export function parsePlansFromConfig(config?: SystemConfig | null): Record<PlanId, PlanDefinition> {
  const base = structuredClone(DEFAULT_PLANS);
  if (!config?.planConfigsJson) return base;
  try {
    const parsed = JSON.parse(config.planConfigsJson) as Partial<Record<PlanId, Partial<PlanDefinition>>>;
    for (const key of Object.keys(base) as PlanId[]) {
      if (parsed[key]) {
        base[key] = { ...base[key], ...parsed[key], id: key };
      }
    }
  } catch {
    // Fallback to defaults
  }
  return base;
}

export function getISTDateKey(resetHourIST = 0): string {
  const now = new Date();
  // Shift back by resetHourIST hours so day rolls over at resetHourIST in Asia/Kolkata
  const shifted = new Date(now.getTime() - resetHourIST * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

export function getISTMonthKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
}

export function formatISTDateTime(iso?: string): string {
  if (!iso) return 'No Expiry (Free)';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d) + ' IST';
}

export function formatDurationSec(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

export function isSubscriptionExpired(profile: UserProfile): boolean {
  if (profile.plan === 'free') return false;
  if (profile.subscriptionStatus === 'expired' || profile.subscriptionStatus === 'cancelled') {
    if (!profile.subscriptionExpiresAt) return true;
  }
  if (!profile.subscriptionExpiresAt) return false;
  return Date.now() > Date.parse(profile.subscriptionExpiresAt);
}

export function getEffectiveLimits(profile: UserProfile, config?: SystemConfig | null) {
  const plans = parsePlansFromConfig(config);
  const expired = isSubscriptionExpired(profile);
  const activePlanId: PlanId = expired ? 'free' : profile.plan || 'free';
  const planDef = plans[activePlanId] || plans.free;

  const singleVideoLimitSec =
    !expired && profile.singleVideoLimitSec && profile.singleVideoLimitSec > 0
      ? profile.singleVideoLimitSec
      : planDef.singleVideoLimitSec;

  const dailyVideoLimitSec =
    !expired && profile.dailyVideoLimitSec && profile.dailyVideoLimitSec > 0
      ? profile.dailyVideoLimitSec
      : planDef.dailyVideoLimitSec;

  const monthlyVideoLimitSec =
    !expired && profile.monthlyVideoLimitSec && profile.monthlyVideoLimitSec > 0
      ? profile.monthlyVideoLimitSec
      : planDef.monthlyVideoLimitSec;

  const resetHour = config?.dailyResetHourIST ?? 0;
  const todayIST = getISTDateKey(resetHour);
  const monthIST = getISTMonthKey();

  const dailySecondsUsed =
    profile.lastDailyReset === todayIST ? (profile.dailyVideoSecondsUsed ?? 0) : 0;
  const monthlySecondsUsed =
    profile.lastMonthlyReset === monthIST ? (profile.monthlyVideoSecondsUsed ?? 0) : 0;

  return {
    expired,
    activePlanId,
    planDef,
    singleVideoLimitSec,
    dailyVideoLimitSec,
    monthlyVideoLimitSec,
    dailySecondsUsed,
    dailySecondsRemaining: Math.max(0, dailyVideoLimitSec - dailySecondsUsed),
    monthlySecondsUsed,
    monthlySecondsRemaining: Math.max(0, monthlyVideoLimitSec - monthlySecondsUsed),
    todayIST,
    monthIST,
  };
}

export function calculateVideoCreditsAndCost(
  durationSec: number,
  quality: VideoQuality,
  modelId: string
): { credits: number; estimatedApiCostInr: number; sceneCount: number } {
  const spec = VIDEO_MODEL_SPECS.find((m) => m.id === modelId) || VIDEO_MODEL_SPECS[0];
  const units = Math.max(1, Math.ceil(durationSec / 10));
  const sceneCount = Math.max(1, Math.ceil(durationSec / spec.maxClipSec));
  const credits = units * (spec.creditsPer10Sec[quality] ?? 1);
  const estimatedApiCostInr = units * (spec.apiCostInrPer10Sec[quality] ?? 8);
  return { credits, estimatedApiCostInr, sceneCount };
}
