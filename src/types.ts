export type AppTab =
  | 'home'
  | 'chat'
  | 'voice'
  | 'memory'
  | 'image'
  | 'video'
  | 'music'
  | 'script'
  | 'document'
  | 'search'
  | 'coding'
  | 'testing'
  | 'subscription'
  | 'account'
  | 'admin';

export type ChatMode = 'chat' | 'coding' | 'script' | 'search' | 'document';

export type PlanId = 'free' | 'basic' | 'standard' | 'pro' | 'premium' | 'ultra';

export type VideoQuality = '480p' | '720p' | '1080p' | '4k';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  priceInr: number;
  durationDays: number;
  singleVideoLimitSec: number;
  dailyVideoLimitSec: number;
  monthlyVideoLimitSec: number;
  includedVideoCredits: number;
  enabled: boolean;
  features: string[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  plan: PlanId;
  subscriptionStatus?: 'active' | 'expired' | 'cancelled';
  subscriptionExpiresAt?: string;
  banned: boolean;
  imageCredits: number;
  videoCredits: number;
  musicCredits: number;
  dailyVideoLimit: number;
  monthlyVideoLimit: number;
  dailyVideosUsed: number;
  monthlyVideosUsed: number;
  singleVideoLimitSec?: number;
  dailyVideoLimitSec?: number;
  monthlyVideoLimitSec?: number;
  dailyVideoSecondsUsed?: number;
  monthlyVideoSecondsUsed?: number;
  lastDailyReset: string;
  lastMonthlyReset: string;
  lastTxId?: string;
  preferredLanguage: 'auto' | 'hi' | 'en' | 'bho';
  voiceEnabled: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  mode: ChatMode;
  language: string;
  model: string;
  messageCount: number;
  lastMessagePreview: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string;
  attachmentName?: string;
  sourcesCount?: number;
  sources?: GroundingSource[];
  createdAt: unknown;
}

export interface UserMemory {
  id: string;
  userId: string;
  content: string;
  category: 'preference' | 'fact' | 'project' | 'style';
  active: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface MediaHistoryItem {
  id: string;
  userId: string;
  type: 'image' | 'video' | 'music';
  mode?: string;
  prompt: string;
  style: string;
  model: string;
  aspectRatio?: string;
  quality?: string;
  duration?: string;
  durationSec?: number;
  status: 'completed' | 'failed' | 'partial_failed';
  creditsCost: number;
  apiCostInr?: number;
  refunded: boolean;
  mediaUrl?: string;
  subtitleUrl?: string;
  mimeType?: string;
  lyrics?: string;
  errorMessage?: string;
  createdAt: unknown;
}

export interface VideoScene {
  sceneIndex: number;
  durationSec: number;
  visualPrompt: string;
  cameraMovement: string;
  narrationText: string;
  subtitleText: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  audioUrl?: string;
  interactionId?: string;
  errorMessage?: string;
  apiCostInr: number;
}

export interface VideoJobRecord {
  id: string;
  userId: string;
  mode: 'text_to_video' | 'image_to_video';
  prompt: string;
  scriptSummary?: string;
  characterGuide?: string;
  style: string;
  aspectRatio: string;
  quality: VideoQuality;
  model: string;
  voiceOption: 'none' | 'hi' | 'en';
  backgroundMusic: boolean;
  subtitlesEnabled: boolean;
  durationSec: number;
  status: 'queued' | 'processing' | 'completed' | 'partial_failed' | 'failed';
  queuePosition: number;
  progressPct: number;
  etaSeconds: number;
  totalScenes: number;
  completedScenes: number;
  creditsReserved: number;
  creditsRefunded: number;
  estimatedApiCostInr: number;
  finalVideoUrl?: string;
  subtitleUrl?: string;
  errorMessage?: string;
  scenes: VideoScene[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  userEmail: string;
  planId: Exclude<PlanId, 'free'>;
  amountInr: number;
  gateway: string;
  orderId: string;
  paymentId?: string;
  invoiceNumber: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  errorMessage?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  creditType: 'image' | 'video' | 'music';
  action: 'deduct' | 'refund' | 'admin_grant' | 'signup_bonus' | 'plan_credit';
  delta: number;
  balanceAfter: number;
  reason: string;
  jobId: string;
  createdAt: unknown;
}

export interface SystemConfig {
  freeDailyVideoLimit: number;
  freeMonthlyVideoLimit: number;
  premiumDailyVideoLimit: number;
  premiumMonthlyVideoLimit: number;
  dailyResetHourIST?: number;
  costAlertThresholdInr?: number;
  featureChat: boolean;
  featureVoice: boolean;
  featureMemory: boolean;
  featureImage: boolean;
  featureVideo: boolean;
  featureTextToVideo?: boolean;
  featureImageToVideo?: boolean;
  featureMusic: boolean;
  featureScript: boolean;
  featureDocument: boolean;
  featureSearch: boolean;
  featureCoding: boolean;
  featureAppTesting: boolean;
  modelHydrogen: boolean;
  modelNeon: boolean;
  modelImage: boolean;
  modelVideo: boolean;
  modelMusic: boolean;
  quality480p?: boolean;
  quality720p?: boolean;
  quality1080p?: boolean;
  quality4k?: boolean;
  planConfigsJson?: string;
  updatedBy: string;
  updatedAt: unknown;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  targetId: string;
  details: string;
  createdAt: unknown;
}

export interface BharatTubeCheck {
  id: string;
  userId: string;
  targetUrl: string;
  serverStatus: string;
  dbStatus: string;
  uploadTestStatus: string;
  playbackTestStatus: string;
  admobStatus: string;
  errorReport: string;
  createdAt: unknown;
}
