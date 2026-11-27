import 'dotenv/config';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { promisify } from 'util';
import express, { NextFunction, Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { DecodedIdToken, getAuth } from 'firebase-admin/auth';
import { createServer as createViteServer } from 'vite';

const execFileAsync = promisify(execFile);

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = fs.existsSync(firebaseConfigPath)
  ? JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'))
  : { projectId: process.env.GOOGLE_CLOUD_PROJECT || '' };

const adminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: firebaseConfig.projectId });
const adminAuth = getAuth(adminApp);

const STORAGE_DIR = path.resolve(process.cwd(), 'storage');
const MEDIA_DIR = path.resolve(STORAGE_DIR, 'media');
const LEDGER_PATH = path.resolve(STORAGE_DIR, 'server_ledger.json');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const ADMIN_EMAIL = 'cchotumarapo@gmail.com';

// --- Authoritative Server Ledger (Persists across restarts) ---
type PlanId = 'free' | 'basic' | 'standard' | 'pro' | 'premium' | 'ultra';
type VideoQuality = '480p' | '720p' | '1080p' | '4k';

interface PlanConfig {
  id: PlanId;
  name: string;
  priceInr: number;
  durationDays: number;
  singleVideoLimitSec: number;
  dailyVideoLimitSec: number;
  monthlyVideoLimitSec: number;
  includedVideoCredits: number;
  enabled: boolean;
}

const DEFAULT_PLANS: Record<PlanId, PlanConfig> = {
  free: { id: 'free', name: 'Free Plan', priceInr: 0, durationDays: 0, singleVideoLimitSec: 10, dailyVideoLimitSec: 10, monthlyVideoLimitSec: 300, includedVideoCredits: 5, enabled: true },
  basic: { id: 'basic', name: 'Basic Plan', priceInr: 499, durationDays: 30, singleVideoLimitSec: 60, dailyVideoLimitSec: 120, monthlyVideoLimitSec: 3600, includedVideoCredits: 30, enabled: true },
  standard: { id: 'standard', name: 'Standard Plan', priceInr: 999, durationDays: 30, singleVideoLimitSec: 120, dailyVideoLimitSec: 300, monthlyVideoLimitSec: 9000, includedVideoCredits: 75, enabled: true },
  pro: { id: 'pro', name: 'Pro Plan', priceInr: 2499, durationDays: 30, singleVideoLimitSec: 300, dailyVideoLimitSec: 600, monthlyVideoLimitSec: 18000, includedVideoCredits: 180, enabled: true },
  premium: { id: 'premium', name: 'Premium Plan', priceInr: 4999, durationDays: 30, singleVideoLimitSec: 600, dailyVideoLimitSec: 1200, monthlyVideoLimitSec: 36000, includedVideoCredits: 400, enabled: true },
  ultra: { id: 'ultra', name: 'Ultra Plan', priceInr: 9999, durationDays: 30, singleVideoLimitSec: 1200, dailyVideoLimitSec: 1800, monthlyVideoLimitSec: 54000, includedVideoCredits: 900, enabled: true },
};

interface ServerUserQuota {
  uid: string;
  email: string;
  plan: PlanId;
  subscriptionStatus: 'active' | 'expired' | 'cancelled';
  subscriptionExpiresAt: string;
  singleVideoLimitSec: number;
  dailyVideoLimitSec: number;
  monthlyVideoLimitSec: number;
  dailySecondsUsed: number;
  monthlySecondsUsed: number;
  lastDailyResetIST: string;
  lastMonthlyResetIST: string;
  videoCredits: number;
  banned: boolean;
}

interface ServerVideoScene {
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

interface ServerVideoJob {
  id: string;
  userId: string;
  mode: 'text_to_video' | 'image_to_video';
  prompt: string;
  scriptSummary: string;
  characterGuide: string;
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
  sourceImageBase64?: string;
  sourceMimeType?: string;
  errorMessage?: string;
  scenes: ServerVideoScene[];
  createdAt: string;
  updatedAt: string;
}

interface ServerPayment {
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
  createdAt: string;
  updatedAt: string;
}

interface ApiCostLog {
  id: string;
  userId: string;
  jobId: string;
  model: string;
  resolution: string;
  durationSec: number;
  costInr: number;
  status: 'completed' | 'failed';
  createdAt: string;
}

interface ServerLedger {
  dailyResetHourIST: number;
  costAlertThresholdInr: number;
  featureTextToVideo: boolean;
  featureImageToVideo: boolean;
  qualityEnabled: Record<VideoQuality, boolean>;
  modelEnabled: Record<string, boolean>;
  plans: Record<PlanId, PlanConfig>;
  users: Record<string, ServerUserQuota>;
  jobs: Record<string, ServerVideoJob>;
  payments: Record<string, ServerPayment>;
  costLogs: ApiCostLog[];
}

function getISTDateKey(resetHourIST = 0): string {
  const shifted = new Date(Date.now() - resetHourIST * 3600 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

function getISTMonthKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
}

function loadLedger(): ServerLedger {
  const initial: ServerLedger = {
    dailyResetHourIST: 0,
    costAlertThresholdInr: 5000,
    featureTextToVideo: true,
    featureImageToVideo: true,
    qualityEnabled: { '480p': false, '720p': true, '1080p': true, '4k': true },
    modelEnabled: { 'gemini-omni-1.2-flash': true, 'external-multi-model-slot': false },
    plans: structuredClone(DEFAULT_PLANS),
    users: {},
    jobs: {},
    payments: {},
    costLogs: [],
  };
  if (!fs.existsSync(LEDGER_PATH)) {
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf-8')) as Partial<ServerLedger>;
    return {
      ...initial,
      ...parsed,
      plans: { ...initial.plans, ...(parsed.plans || {}) },
      qualityEnabled: { ...initial.qualityEnabled, ...(parsed.qualityEnabled || {}) },
      modelEnabled: { ...initial.modelEnabled, ...(parsed.modelEnabled || {}) },
      users: parsed.users || {},
      jobs: parsed.jobs || {},
      payments: parsed.payments || {},
      costLogs: parsed.costLogs || [],
    };
  } catch {
    return initial;
  }
}

let ledger: ServerLedger = loadLedger();

function saveLedger() {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
}

function ensureUserQuota(uid: string, email: string): ServerUserQuota {
  const todayIST = getISTDateKey(ledger.dailyResetHourIST);
  const monthIST = getISTMonthKey();
  let u = ledger.users[uid];
  if (!u) {
    const freePlan = ledger.plans.free;
    u = {
      uid,
      email,
      plan: 'free',
      subscriptionStatus: 'active',
      subscriptionExpiresAt: '',
      singleVideoLimitSec: freePlan.singleVideoLimitSec,
      dailyVideoLimitSec: freePlan.dailyVideoLimitSec,
      monthlyVideoLimitSec: freePlan.monthlyVideoLimitSec,
      dailySecondsUsed: 0,
      monthlySecondsUsed: 0,
      lastDailyResetIST: todayIST,
      lastMonthlyResetIST: monthIST,
      videoCredits: freePlan.includedVideoCredits,
      banned: false,
    };
    ledger.users[uid] = u;
    saveLedger();
  }
  // Automatic Asia/Kolkata daily & monthly resets
  let changed = false;
  if (u.lastDailyResetIST !== todayIST) {
    u.dailySecondsUsed = 0;
    u.lastDailyResetIST = todayIST;
    changed = true;
  }
  if (u.lastMonthlyResetIST !== monthIST) {
    u.monthlySecondsUsed = 0;
    u.lastMonthlyResetIST = monthIST;
    changed = true;
  }
  // Subscription expiry check
  if (u.plan !== 'free' && u.subscriptionExpiresAt && Date.now() > Date.parse(u.subscriptionExpiresAt)) {
    u.plan = 'free';
    u.subscriptionStatus = 'expired';
    u.singleVideoLimitSec = ledger.plans.free.singleVideoLimitSec;
    u.dailyVideoLimitSec = ledger.plans.free.dailyVideoLimitSec;
    u.monthlyVideoLimitSec = ledger.plans.free.monthlyVideoLimitSec;
    changed = true;
  }
  if (changed) saveLedger();
  return u;
}

const MODEL_CAPABILITIES: Record<
  string,
  {
    name: string;
    connected: boolean;
    maxClipSec: number;
    supportedQualities: VideoQuality[];
    creditsPer10Sec: Record<VideoQuality, number>;
    apiCostInrPer10Sec: Record<VideoQuality, number>;
  }
> = {
  'gemini-omni-1.2-flash': {
    name: 'Gemini Omni Flash (Veo Engine)',
    connected: true,
    maxClipSec: 15,
    supportedQualities: ['720p', '1080p', '4k'],
    creditsPer10Sec: { '480p': 1, '720p': 1, '1080p': 2, '4k': 4 },
    apiCostInrPer10Sec: { '480p': 6, '720p': 8, '1080p': 16, '4k': 32 },
  },
  'external-multi-model-slot': {
    name: 'External Video API (Runway / Kling / Luma)',
    connected: false,
    maxClipSec: 10,
    supportedQualities: ['480p', '720p', '1080p'],
    creditsPer10Sec: { '480p': 1, '720p': 2, '1080p': 3, '4k': 6 },
    apiCostInrPer10Sec: { '480p': 5, '720p': 10, '1080p': 20, '4k': 40 },
  },
};

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured in Settings > Secrets.'), {
      statusCode: 503,
      code: 'API_KEY_MISSING',
    });
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ApiErrorEntry {
  id: string;
  timestamp: string;
  endpoint: string;
  statusCode: number;
  message: string;
}

const serverTelemetry = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalAiCalls: 0,
  totalErrors: 0,
  recentErrors: [] as ApiErrorEntry[],
};

function recordError(endpoint: string, statusCode: number, message: string) {
  serverTelemetry.totalErrors += 1;
  serverTelemetry.recentErrors.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    endpoint,
    statusCode,
    message: message.slice(0, 400),
  });
  if (serverTelemetry.recentErrors.length > 50) {
    serverTelemetry.recentErrors.length = 50;
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const key = `${req.path}:${req.user?.uid || req.ip || 'anon'}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Rate limit exceeded. Please wait ${retryAfter}s before retrying.`,
        code: 'RATE_LIMITED',
      });
    }
    bucket.count += 1;
    return next();
  };
}

interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.', code: 'UNAUTHENTICATED' });
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Missing Firebase ID token.', code: 'UNAUTHENTICATED' });
    }
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid or expired authentication token.',
      code: 'INVALID_TOKEN',
    });
  }
}

function isVerifiedAdmin(user?: DecodedIdToken): boolean {
  return Boolean(user && user.email_verified === true && user.email === ADMIN_EMAIL);
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return true;
  }
  if (net.isIP(lower)) {
    if (lower === '::1' || lower === '0.0.0.0') return true;
    const parts = lower.split('.').map(Number);
    if (parts.length === 4) {
      if (parts[0] === 127 || parts[0] === 10 || parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
    }
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes('503') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
      if (!isTransient || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function formatGeminiError(err: unknown): { status: number; message: string; code: string; requiresPaidKey: boolean } {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const statusMatch = rawMsg.match(/\b(400|401|403|404|429|500|503)\b/);
  const status =
    (err as { statusCode?: number; status?: number })?.statusCode ||
    (err as { status?: number })?.status ||
    (statusMatch ? Number(statusMatch[1]) : 500);

  const lower = rawMsg.toLowerCase();
  const requiresPaidKey =
    lower.includes('resource_exhausted') ||
    lower.includes('billing') ||
    lower.includes('paid') ||
    lower.includes('quota') ||
    status === 429 ||
    (status === 403 && lower.includes('permission'));

  let code = 'AI_API_ERROR';
  if (status === 403 || lower.includes('api_key_invalid')) code = 'API_KEY_OR_PERMISSION_ERROR';
  else if (status === 429 || lower.includes('resource_exhausted')) code = 'QUOTA_OR_PAID_KEY_REQUIRED';
  else if (status === 404) code = 'MODEL_NOT_FOUND';

  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMsg,
    code,
    requiresPaidKey,
  };
}

function saveMediaBuffer(buffer: Buffer, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const filename = `${crypto.randomUUID()}.${safeExt}`;
  const resolved = path.resolve(MEDIA_DIR, filename);
  if (!resolved.startsWith(MEDIA_DIR + path.sep)) {
    throw new Error('Invalid media storage path.');
  }
  fs.writeFileSync(resolved, buffer);
  return `/api/media/${filename}`;
}

function resolveMediaFilePath(mediaUrl: string): string | null {
  const prefix = '/api/media/';
  if (!mediaUrl.startsWith(prefix)) return null;
  const filename = mediaUrl.slice(prefix.length);
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
  const resolved = path.resolve(MEDIA_DIR, filename);
  if (!resolved.startsWith(MEDIA_DIR + path.sep) || !fs.existsSync(resolved)) return null;
  return resolved;
}

function formatSrtTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

async function generateSceneVideoClip(job: ServerVideoJob, scene: ServerVideoScene): Promise<void> {
  scene.status = 'processing';
  scene.errorMessage = undefined;
  job.updatedAt = new Date().toISOString();
  saveLedger();

  const spec = MODEL_CAPABILITIES[job.model] || MODEL_CAPABILITIES['gemini-omni-1.2-flash'];
  const costPerScene = Math.ceil((scene.durationSec / 10) * (spec.apiCostInrPer10Sec[job.quality] ?? 8));

  try {
    const ai = getAiClient();
    serverTelemetry.totalAiCalls += 1;

    const styleGuide =
      job.style === 'Cartoon'
        ? 'Animated 2D/3D cartoon style, expressive motion, consistent character design: '
        : job.style === '3D Animation'
          ? 'Pixar-grade 3D CGI animation, rich lighting, consistent character rigging: '
          : job.style === 'Realistic'
            ? 'Hyper-realistic live-action cinematography, natural physics: '
            : 'Cinematic film grade, smooth camera movement, atmospheric lighting: ';

    const continuity = job.characterGuide ? `Continuity Guide: ${job.characterGuide}. ` : '';
    const fullPrompt = `${styleGuide}${continuity}Scene ${scene.sceneIndex}: ${scene.visualPrompt}. Camera: ${scene.cameraMovement}.`;

    const prevScene = job.scenes.find((s) => s.sceneIndex === scene.sceneIndex - 1 && s.interactionId);

    const inputPayload =
      job.mode === 'image_to_video' && job.sourceImageBase64
        ? [
            { type: 'image' as const, mime_type: job.sourceMimeType || 'image/png', data: job.sourceImageBase64 },
            { type: 'text' as const, text: `Preserve character appearance and likeness from reference image. ${fullPrompt}` },
          ]
        : fullPrompt;

    const interaction = await ai.interactions.create(
      {
        model: job.model,
        ...(prevScene?.interactionId ? { previous_interaction_id: prevScene.interactionId } : {}),
        input: inputPayload,
        background: false,
        store: true,
        stream: false,
        response_format: {
          type: 'video',
          aspect_ratio: job.aspectRatio === '1:1' ? '16:9' : job.aspectRatio,
          duration: `${Math.min(15, Math.max(3, scene.durationSec))}s`,
          resolution: job.quality === '480p' ? '720p' : job.quality,
        },
      },
      { timeout: 300000 }
    );

    const videoPart = interaction.output_video;
    if (!videoPart || (!videoPart.data && !videoPart.uri)) {
      throw new Error('Video model returned empty video payload.');
    }

    let mediaUrl = videoPart.uri || '';
    if (videoPart.data) {
      mediaUrl = saveMediaBuffer(Buffer.from(videoPart.data, 'base64'), 'mp4');
    }

    // Optional AI Voiceover for this scene
    if (job.voiceOption !== 'none' && scene.narrationText.trim()) {
      try {
        const ttsRes = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: scene.narrationText.slice(0, 800),
                  speechMetadata: {
                    style: job.voiceOption === 'hi' ? 'Natural expressive Hindi narrator' : 'Clear engaging English narrator',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: job.voiceOption === 'hi' ? 'Kore' : 'Puck' },
              },
            },
          },
        });
        const audioB64 = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioB64) {
          scene.audioUrl = saveMediaBuffer(Buffer.from(audioB64, 'base64'), 'wav');
        }
      } catch {
        // Non-fatal narration warning; video clip itself succeeded
      }
    }

    scene.status = 'completed';
    scene.videoUrl = mediaUrl;
    scene.interactionId = interaction.id;
    scene.apiCostInr = costPerScene;

    ledger.costLogs.unshift({
      id: crypto.randomUUID(),
      userId: job.userId,
      jobId: job.id,
      model: job.model,
      resolution: job.quality,
      durationSec: scene.durationSec,
      costInr: costPerScene,
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    const formatted = formatGeminiError(err);
    scene.status = 'failed';
    scene.errorMessage = formatted.message;
    scene.apiCostInr = Math.round(costPerScene * 0.25);
    recordError('/api/video/scene', formatted.status, formatted.message);

    ledger.costLogs.unshift({
      id: crypto.randomUUID(),
      userId: job.userId,
      jobId: job.id,
      model: job.model,
      resolution: job.quality,
      durationSec: scene.durationSec,
      costInr: scene.apiCostInr,
      status: 'failed',
      createdAt: new Date().toISOString(),
    });
  }
  if (ledger.costLogs.length > 500) ledger.costLogs.length = 500;
  saveLedger();
}

async function assembleFinalJob(job: ServerVideoJob): Promise<void> {
  const completed = job.scenes.filter((s) => s.status === 'completed' && s.videoUrl);
  if (completed.length !== job.scenes.length) {
    job.status = completed.length > 0 ? 'partial_failed' : 'failed';
    const firstErr = job.scenes.find((s) => s.errorMessage)?.errorMessage;
    job.errorMessage = firstErr || 'One or more scenes failed to generate.';
    job.etaSeconds = 0;
    job.updatedAt = new Date().toISOString();
    saveLedger();
    return;
  }

  // Generate SRT Subtitles
  if (job.subtitlesEnabled) {
    let cursor = 0;
    const srtLines: string[] = [];
    for (const s of job.scenes) {
      const start = formatSrtTime(cursor);
      const end = formatSrtTime(cursor + s.durationSec);
      cursor += s.durationSec;
      srtLines.push(`${s.sceneIndex}\n${start} --> ${end}\n${s.subtitleText || s.narrationText || s.visualPrompt}\n`);
    }
    job.subtitleUrl = saveMediaBuffer(Buffer.from(srtLines.join('\n'), 'utf-8'), 'srt');
  }

  // Optional AI background music via Lyria (non-fatal if paid key missing)
  let bgMusicPath: string | null = null;
  if (job.backgroundMusic) {
    try {
      const ai = getAiClient();
      const stream = await ai.models.generateContentStream({
        model: 'lyria-3-clip-preview',
        contents: `Instrumental background score matching ${job.style} video: ${job.prompt.slice(0, 300)}`,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) chunks.push(Buffer.from(part.inlineData.data, 'base64'));
        }
      }
      if (chunks.length > 0) {
        const bgUrl = saveMediaBuffer(Buffer.concat(chunks), 'mp3');
        bgMusicPath = resolveMediaFilePath(bgUrl);
      }
    } catch {
      // Non-fatal: continue assembly even if background music model fails or needs paid key
    }
  }

  // Assemble scenes with ffmpeg
  const clipPaths = completed
    .map((s) => (s.videoUrl ? resolveMediaFilePath(s.videoUrl) : null))
    .filter((p): p is string => Boolean(p));

  const voicePaths = completed
    .map((s) => (s.audioUrl ? resolveMediaFilePath(s.audioUrl) : null))
    .filter((p): p is string => Boolean(p));

  if (clipPaths.length === 1 && voicePaths.length === 0 && !bgMusicPath) {
    job.finalVideoUrl = completed[0].videoUrl;
  } else if (clipPaths.length >= 1) {
    try {
      let baseVideoPath = clipPaths[0];
      let tempConcatVideo: string | null = null;

      if (clipPaths.length > 1) {
        const listFile = path.resolve(MEDIA_DIR, `${job.id}_concat.txt`);
        const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listFile, listContent);

        const concatName = `${crypto.randomUUID()}.mp4`;
        tempConcatVideo = path.resolve(MEDIA_DIR, concatName);
        await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', tempConcatVideo], {
          timeout: 120000,
        });
        fs.unlinkSync(listFile);
        baseVideoPath = tempConcatVideo;
      }

      // Mux narration WAVs and/or background music if available
      if (voicePaths.length > 0 || bgMusicPath) {
        let voiceTrackPath: string | null = voicePaths[0] || null;
        if (voicePaths.length > 1) {
          const vListFile = path.resolve(MEDIA_DIR, `${job.id}_voice.txt`);
          fs.writeFileSync(vListFile, voicePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
          const vOut = path.resolve(MEDIA_DIR, `${crypto.randomUUID()}.wav`);
          await execFileAsync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', vListFile, '-c', 'copy', vOut], {
            timeout: 60000,
          });
          fs.unlinkSync(vListFile);
          voiceTrackPath = vOut;
        }

        const muxedName = `${crypto.randomUUID()}.mp4`;
        const muxedPath = path.resolve(MEDIA_DIR, muxedName);
        if (voiceTrackPath && bgMusicPath) {
          await execFileAsync(
            'ffmpeg',
            [
              '-y',
              '-i', baseVideoPath,
              '-i', voiceTrackPath,
              '-stream_loop', '-1', '-i', bgMusicPath,
              '-filter_complex', '[1:a]volume=1.0[v];[2:a]volume=0.22[m];[v][m]amix=inputs=2:duration=first:dropout_transition=2[aout]',
              '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', muxedPath,
            ],
            { timeout: 120000 }
          );
        } else {
          const audioInput = voiceTrackPath || bgMusicPath!;
          await execFileAsync(
            'ffmpeg',
            ['-y', '-i', baseVideoPath, '-i', audioInput, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', muxedPath],
            { timeout: 120000 }
          );
        }
        job.finalVideoUrl = `/api/media/${muxedName}`;
      } else {
        job.finalVideoUrl = `/api/media/${path.basename(baseVideoPath)}`;
      }
    } catch {
      job.finalVideoUrl = completed[0].videoUrl;
    }
  }

  job.status = 'completed';
  job.progressPct = 100;
  job.etaSeconds = 0;
  job.updatedAt = new Date().toISOString();
  saveLedger();
}

const activeQueue: string[] = [];
let queueRunning = false;

async function processVideoQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (activeQueue.length > 0) {
      const jobId = activeQueue.shift()!;
      const job = ledger.jobs[jobId];
      if (!job) continue;

      job.status = 'processing';
      job.queuePosition = 0;
      const startedMs = Date.now();
      saveLedger();

      for (let i = 0; i < job.scenes.length; i++) {
        const scene = job.scenes[i];
        if (scene.status === 'completed') continue;

        await generateSceneVideoClip(job, scene);
        const doneCount = job.scenes.filter((s) => s.status === 'completed' || s.status === 'failed').length;
        job.completedScenes = job.scenes.filter((s) => s.status === 'completed').length;
        job.progressPct = Math.round((doneCount / job.scenes.length) * 95);
        const avgPerSceneSec = (Date.now() - startedMs) / 1000 / Math.max(1, doneCount);
        job.etaSeconds = Math.round(avgPerSceneSec * (job.scenes.length - doneCount));
        job.estimatedApiCostInr = job.scenes.reduce((acc, s) => acc + s.apiCostInr, 0);
        job.updatedAt = new Date().toISOString();
        saveLedger();
      }

      await assembleFinalJob(job);

      // Refund credits & seconds on backend ledger for failed scenes
      const failedScenes = job.scenes.filter((s) => s.status === 'failed');
      if (failedScenes.length > 0) {
        const failedSec = failedScenes.reduce((acc, s) => acc + s.durationSec, 0);
        const refundRatio = failedSec / Math.max(1, job.durationSec);
        const refundCredits = Math.ceil(job.creditsReserved * refundRatio);
        job.creditsRefunded = refundCredits;
        const u = ledger.users[job.userId];
        if (u) {
          u.videoCredits += refundCredits;
          u.dailySecondsUsed = Math.max(0, u.dailySecondsUsed - failedSec);
          u.monthlySecondsUsed = Math.max(0, u.monthlySecondsUsed - failedSec);
        }
        saveLedger();
      }
    }
  } finally {
    queueRunning = false;
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '25mb' }));

  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/')) {
      serverTelemetry.totalRequests += 1;
    }
    next();
  });

  // Public health check
  app.get('/api/health', (_req, res) => {
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    const bharatTubeConfigured = Boolean(process.env.BHARATTUBE_API_URL && process.env.BHARATTUBE_BRIDGE_SECRET);
    const paymentConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
    res.json({
      status: 'online',
      service: 'Chhotu AI Backend',
      startedAt: serverTelemetry.startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      geminiConfigured,
      paymentGatewayConnected: paymentConfigured,
      firebaseProjectId: firebaseConfig.projectId || null,
      bharatTubeBridgeStatus: bharatTubeConfigured ? 'connected' : 'not_connected',
      bharatTubeUrlConfigured: Boolean(process.env.BHARATTUBE_API_URL),
    });
  });

  // Confined media file serving
  app.get('/api/media/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }
    const resolved = path.resolve(MEDIA_DIR, filename);
    if (!resolved.startsWith(MEDIA_DIR + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Media file not found.' });
    }
    return res.sendFile(resolved);
  });

  // 1. AI Chat / Coding / Script / Search / Document Assistant (PRESERVED)
  app.post('/api/ai/chat', requireAuth, rateLimit(30, 60_000), async (req: AuthenticatedRequest, res) => {
    try {
      const {
        prompt,
        history = [],
        mode = 'chat',
        language = 'auto',
        model = 'gemini-4-hydrogen',
        memories = [],
        useSearch = false,
        attachment,
      } = req.body ?? {};

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt must be a non-empty string.' });
      }
      if (prompt.length > 32000) {
        return res.status(400).json({ error: 'Prompt exceeds 32,000 characters.' });
      }

      const allowedModels = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-4-neon', 'gemini-4-carbon']);
      const selectedModel = allowedModels.has(model) ? model : 'gemini-4-hydrogen';

      const memoryBlock =
        Array.isArray(memories) && memories.length > 0
          ? `\n\nUser Personal Memories (reference naturally when helpful):\n${memories
              .slice(0, 20)
              .map((m: unknown) => `- ${String(m).slice(0, 300)}`)
              .join('\n')}`
          : '';

      const languageHint =
        language === 'hi'
          ? 'Respond primarily in natural, clear Hindi (Devanagari) unless code/terms require English.'
          : language === 'bho'
            ? 'Respond with Bhojpuri flavor/language where appropriate while staying clear and helpful.'
            : language === 'en'
              ? 'Respond in clear, concise English.'
              : "Match the user's language (Hindi, Hinglish, Bhojpuri, or English) naturally.";

      const modeInstructions: Record<string, string> = {
        chat: 'You are Chhotu AI, an advanced multilingual AI assistant. Give accurate, structured, easy-to-understand answers across coding, education, business, and technology.',
        coding:
          'You are Chhotu AI Coding Assistant. Provide production-grade HTML, CSS, JavaScript, TypeScript, Python, or React code with clear explanations, root-cause error detection, and debugging fixes.',
        script:
          'You are Chhotu AI Script & Creative Director. Create complete YouTube scripts, Short/Reels scripts, Cartoon stories, Bhojpuri stories/song concepts, or Hindi stories. Include Title, Description, Tags, Thumbnail Text Suggestions, and Scene-by-Scene visual/audio prompts.',
        search:
          'You are Chhotu AI Live Research Assistant. Use Google Search results to provide up-to-date answers. Clearly distinguish older baseline facts from recent updates, cite your verified sources, and explicitly state if reliable information is not available.',
        document:
          'You are Chhotu AI Document Analyst. Carefully analyze the uploaded PDF or text document. Provide clear summaries, answer specific questions accurately using only verified facts from the file, and structure downloadable reports when requested.',
      };

      const systemInstruction = `${modeInstructions[mode] || modeInstructions.chat}\n${languageHint}${memoryBlock}`;

      const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];
      if (Array.isArray(history)) {
        for (const item of history.slice(-14)) {
          if (item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string') {
            contents.push({
              role: item.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: item.content.slice(0, 12000) }],
            });
          }
        }
      }

      const currentParts: Array<Record<string, unknown>> = [];
      if (attachment && typeof attachment.data === 'string' && typeof attachment.mimeType === 'string') {
        currentParts.push({
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      currentParts.push({ text: prompt.trim() });
      contents.push({ role: 'user', parts: currentParts });

      const ai = getAiClient();
      serverTelemetry.totalAiCalls += 1;

      const config: Record<string, unknown> = { systemInstruction };
      if (useSearch || mode === 'search') {
        config.tools = [{ googleSearch: {} }];
      }
      if (selectedModel.startsWith('gemini-4-')) {
        config.thinkingConfig = {
          thinkingLevel: mode === 'coding' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
        };
      }

      const response = await withRetry(() =>
        ai.models.generateContent({
          model: selectedModel,
          contents,
          config,
        })
      );

      const text = response.text || '';
      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = rawChunks
        .filter((c) => c.web?.uri)
        .map((c) => ({
          title: c.web?.title || c.web?.uri || 'Source',
          uri: c.web?.uri || '',
        }));

      return res.json({ text, model: selectedModel, sources });
    } catch (err) {
      const formatted = formatGeminiError(err);
      recordError('/api/ai/chat', formatted.status, formatted.message);
      return res.status(formatted.status).json({
        error: formatted.message,
        code: formatted.code,
        requiresPaidKey: formatted.requiresPaidKey,
      });
    }
  });

  // 2. Voice AI: Audio Transcription (PRESERVED)
  app.post('/api/ai/transcribe', requireAuth, rateLimit(20, 60_000), async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm', languageHint = 'Hindi or English' } = req.body ?? {};
      if (typeof audioBase64 !== 'string' || !audioBase64) {
        return res.status(400).json({ error: 'Audio data is required.' });
      }
      const ai = getAiClient();
      serverTelemetry.totalAiCalls += 1;
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: `Transcribe this spoken audio accurately in its original language (${languageHint}). Return only the transcribed text.` },
          ],
        },
      });
      return res.json({ text: (response.text || '').trim() });
    } catch (err) {
      const formatted = formatGeminiError(err);
      recordError('/api/ai/transcribe', formatted.status, formatted.message);
      return res.status(formatted.status).json({
        error: formatted.message,
        code: formatted.code,
        requiresPaidKey: formatted.requiresPaidKey,
      });
    }
  });

  // 3. Voice AI: Text-to-Speech (PRESERVED)
  app.post('/api/ai/tts', requireAuth, rateLimit(20, 60_000), async (req, res) => {
    try {
      const { text, voiceName = 'Kore', style = 'Warm, clear, natural assistant voice' } = req.body ?? {};
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required for speech synthesis.' });
      }
      const allowedVoices = new Set(['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr']);
      const selectedVoice = allowedVoices.has(voiceName) ? voiceName : 'Kore';

      const ai = getAiClient();
      serverTelemetry.totalAiCalls += 1;
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [{ role: 'user', parts: [{ text: text.slice(0, 2500), speechMetadata: { style } }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) return res.status(502).json({ error: 'TTS model returned no audio data.' });
      return res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (err) {
      const formatted = formatGeminiError(err);
      recordError('/api/ai/tts', formatted.status, formatted.message);
      return res.status(formatted.status).json({
        error: formatted.message,
        code: formatted.code,
        requiresPaidKey: formatted.requiresPaidKey,
      });
    }
  });

  // 4. AI Image Generator & Editor (PRESERVED)
  app.post('/api/ai/image', requireAuth, rateLimit(10, 60_000), async (req, res) => {
    try {
      const {
        prompt,
        style = 'Realistic',
        aspectRatio = '1:1',
        quality = '1K',
        sourceImageBase64,
        sourceMimeType = 'image/png',
      } = req.body ?? {};

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Image prompt is required.' });
      }

      const useNanoBanana21 = quality === '2K' || quality === '4K';
      const model = useNanoBanana21 ? 'gemini-nano-banana-2.1' : 'gemini-3.1-flash-lite-image';

      const stylePrefix =
        style === 'Cartoon'
          ? 'Clean expressive 2D cartoon illustration style, crisp outlines, vibrant balanced palette: '
          : style === '3D Render'
            ? 'Clean 3D studio CGI render, soft global illumination, physically based materials: '
            : style === 'Thumbnail'
              ? 'High-contrast eye-catching YouTube thumbnail composition, dramatic subject lighting, sharp focus: '
              : 'Photorealistic high-detail photography, natural lighting, sharp optical clarity: ';

      const parts: Array<Record<string, unknown>> = [];
      if (typeof sourceImageBase64 === 'string' && sourceImageBase64.length > 0) {
        parts.push({ inlineData: { data: sourceImageBase64, mimeType: sourceMimeType } });
        parts.push({ text: prompt.trim() });
      } else {
        parts.push({ text: `${stylePrefix}${prompt.trim()}` });
      }

      const ai = getAiClient();
      serverTelemetry.totalAiCalls += 1;

      const config: Record<string, unknown> = {
        imageConfig: {
          aspectRatio: ['1:1', '3:4', '4:3', '9:16', '16:9'].includes(aspectRatio) ? aspectRatio : '1:1',
          ...(useNanoBanana21 ? { imageSize: quality } : {}),
        },
      };

      const response = await ai.models.generateContent({ model, contents: { parts }, config });
      let imageUrl = '';
      let mimeType = 'image/png';
      let caption = '';

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          mimeType = part.inlineData.mimeType || 'image/png';
          const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
          imageUrl = saveMediaBuffer(Buffer.from(part.inlineData.data, 'base64'), ext);
        } else if (part.text) {
          caption += part.text;
        }
      }

      if (!imageUrl) {
        return res.status(502).json({ error: 'Image model completed without returning image bytes.', code: 'EMPTY_IMAGE_OUTPUT' });
      }

      return res.json({ mediaUrl: imageUrl, mimeType, model, caption: caption.trim() });
    } catch (err) {
      const formatted = formatGeminiError(err);
      recordError('/api/ai/image', formatted.status, formatted.message);
      return res.status(formatted.status).json({
        error: formatted.message,
        code: formatted.code,
        requiresPaidKey: formatted.requiresPaidKey,
      });
    }
  });

  // 5. AI Music Generator (PRESERVED)
  app.post('/api/ai/music', requireAuth, rateLimit(8, 60_000), async (req, res) => {
    try {
      const { prompt, style = 'Cinematic', mode = 'clip', instrumental = false } = req.body ?? {};
      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Music prompt is required.' });
      }

      const model = mode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview';
      const fullPrompt = `${instrumental ? 'Instrumental only, no vocals. ' : ''}Style: ${style}. ${prompt.trim()}`;

      const ai = getAiClient();
      serverTelemetry.totalAiCalls += 1;
      const stream = await ai.models.generateContentStream({ model, contents: fullPrompt });

      const audioChunks: Buffer[] = [];
      let lyrics = '';
      let mimeType = 'audio/mpeg';

      for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (audioChunks.length === 0 && part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
            audioChunks.push(Buffer.from(part.inlineData.data, 'base64'));
          }
          if (part.text) lyrics += part.text;
        }
      }

      if (audioChunks.length === 0) {
        return res.status(502).json({ error: 'Music generation returned no audio stream.', code: 'EMPTY_MUSIC_OUTPUT' });
      }

      const ext = mimeType.includes('wav') ? 'wav' : 'mp3';
      const mediaUrl = saveMediaBuffer(Buffer.concat(audioChunks), ext);
      return res.json({ mediaUrl, mimeType, model, lyrics: lyrics.trim() });
    } catch (err) {
      const formatted = formatGeminiError(err);
      recordError('/api/ai/music', formatted.status, formatted.message);
      return res.status(formatted.status).json({
        error: formatted.message,
        code: formatted.code,
        requiresPaidKey: formatted.requiresPaidKey,
      });
    }
  });

  // =========================================================================
  // NEW: ADVANCED VIDEO GENERATOR + QUOTA + SCENE ENGINE + QUEUE + PAYMENTS
  // =========================================================================

  // Authoritative User Quota Status
  app.get('/api/video/quota', requireAuth, (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const email = req.user!.email || '';
    const quota = ensureUserQuota(uid, email);
    res.json({
      ...quota,
      dailyResetHourIST: ledger.dailyResetHourIST,
      models: MODEL_CAPABILITIES,
      qualityEnabled: ledger.qualityEnabled,
      modelEnabled: ledger.modelEnabled,
      featureTextToVideo: ledger.featureTextToVideo,
      featureImageToVideo: ledger.featureImageToVideo,
      plans: ledger.plans,
    });
  });

  // Step 1: Real AI Scene & Script Planner for Long Videos (10s - 20m)
  app.post('/api/video/plan-scenes', requireAuth, rateLimit(15, 60_000), async (req: AuthenticatedRequest, res) => {
    try {
      const {
        prompt,
        mode = 'text_to_video',
        style = 'Cinematic',
        durationSec = 10,
        voiceOption = 'none',
        model = 'gemini-omni-1.2-flash',
      } = req.body ?? {};

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: 'Video prompt is required to plan scenes.' });
      }
      const dur = Number(durationSec);
      if (![10, 60, 120, 300, 600, 1200].includes(dur)) {
        return res.status(400).json({ error: 'Invalid duration. Allowed: 10s, 1m, 2m, 5m, 10m, 20m.' });
      }

      const spec = MODEL_CAPABILITIES[model] || MODEL_CAPABILITIES['gemini-omni-1.2-flash'];
      const totalScenes = Math.max(1, Math.ceil(dur / spec.maxClipSec));
      const perSceneSec = Math.min(spec.maxClipSec, Math.max(10, Math.round(dur / totalScenes)));

      const ai = getAiClient();
      serverTelemetry.totalAiCalls += 1;

      const voiceLang = voiceOption === 'hi' ? 'Hindi (Devanagari)' : 'English';
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Create a cohesive scene-by-scene video production plan for a ${dur}-second ${style} ${
          mode === 'image_to_video' ? 'Image-to-Video (animating an uploaded character image)' : 'Text-to-Video'
        } project.
Topic/Prompt: ${prompt.trim()}
Required scene count: ${Math.min(totalScenes, 40)} (each scene ~${perSceneSec}s). If totalScenes > 40, generate 40 key chapters covering the full arc.
Narration language: ${voiceOption === 'none' ? 'Concise visual subtitle captions in English/Hindi matching prompt' : voiceLang}.
Maintain strict character appearance, outfit, lighting, and background continuity across every scene.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scriptSummary: { type: Type.STRING },
              characterGuide: { type: Type.STRING },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneIndex: { type: Type.INTEGER },
                    visualPrompt: { type: Type.STRING },
                    cameraMovement: { type: Type.STRING },
                    narrationText: { type: Type.STRING },
                    subtitleText: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim());
      const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      const scenes: ServerVideoScene[] = [];

      // Expand/align to exact requested duration
      for (let i = 0; i < totalScenes; i++) {
        const template = rawScenes[i % Math.max(1, rawScenes.length)] || {};
        const remaining = dur - i * spec.maxClipSec;
        const clipSec = Math.min(spec.maxClipSec, Math.max(10, remaining));
        scenes.push({
          sceneIndex: i + 1,
          durationSec: clipSec,
          visualPrompt: String(template.visualPrompt || prompt.trim()).slice(0, 600),
          cameraMovement: String(template.cameraMovement || 'Smooth tracking shot').slice(0, 140),
          narrationText: String(template.narrationText || '').slice(0, 500),
          subtitleText: String(template.subtitleText || template.narrationText || '').slice(0, 220),
          status: 'pending',
          apiCostInr: 0,
        });
      }

      return res.json({
        scriptSummary: parsed.scriptSummary || prompt.trim(),
        characterGuide: parsed.characterGuide || `${style} visual continuity`,
        scenes,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      recordError('/api/video/plan-scenes', formatted.status, formatted.message);
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  // Step 2: Enqueue Video Generation Job with STRICT Backend Limit Enforcement
  app.post('/api/video/jobs', requireAuth, rateLimit(8, 60_000), async (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const email = req.user!.email || '';
    const userQuota = ensureUserQuota(uid, email);

    if (userQuota.banned) {
      return res.status(403).json({ error: 'Account is suspended.' });
    }

    const {
      jobId,
      mode = 'text_to_video',
      prompt,
      scriptSummary = '',
      characterGuide = '',
      style = 'Cinematic',
      aspectRatio = '16:9',
      quality = '720p',
      model = 'gemini-omni-1.2-flash',
      voiceOption = 'none',
      backgroundMusic = false,
      subtitlesEnabled = true,
      durationSec = 10,
      scenes: inputScenes,
      sourceImageBase64,
      sourceMimeType,
    } = req.body ?? {};

    if (mode === 'text_to_video' && !ledger.featureTextToVideo) {
      return res.status(403).json({ error: 'Text-to-Video is disabled by Admin.' });
    }
    if (mode === 'image_to_video' && !ledger.featureImageToVideo) {
      return res.status(403).json({ error: 'Image-to-Video is disabled by Admin.' });
    }
    if (mode === 'image_to_video' && !sourceImageBase64) {
      return res.status(400).json({ error: 'Please upload a reference image for Image-to-Video mode.' });
    }
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Video prompt is required.' });
    }

    const dur = Number(durationSec);
    if (![10, 60, 120, 300, 600, 1200].includes(dur)) {
      return res.status(400).json({ error: 'Invalid duration. 5-second option is removed; select 10s, 1m, 2m, 5m, 10m, or 20m.' });
    }

    // Backend Subscription & Daily Limit Enforcement
    if (dur > userQuota.singleVideoLimitSec) {
      return res.status(403).json({
        error: `Single video limit exceeded. Your ${userQuota.plan.toUpperCase()} plan allows up to ${userQuota.singleVideoLimitSec}s per video.`,
      });
    }
    if (userQuota.dailySecondsUsed + dur > userQuota.dailyVideoLimitSec) {
      return res.status(403).json({
        error: `Daily video limit reached (${userQuota.dailySecondsUsed}s used of ${userQuota.dailyVideoLimitSec}s IST limit).`,
      });
    }

    const spec = MODEL_CAPABILITIES[model];
    if (!spec) {
      return res.status(400).json({ error: 'Unsupported AI video model.' });
    }
    if (!spec.connected) {
      return res.status(503).json({
        error: `${spec.name} is NOT CONNECTED. Select Gemini Omni Flash or configure external API credentials.`,
        code: 'MODEL_NOT_CONNECTED',
      });
    }
    if (!ledger.modelEnabled[model]) {
      return res.status(403).json({ error: `${spec.name} is turned OFF by Admin.` });
    }
    if (!spec.supportedQualities.includes(quality)) {
      return res.status(400).json({
        error: `${quality} is not supported by ${spec.name}. Supported qualities: ${spec.supportedQualities.join(', ')}.`,
      });
    }
    if (!ledger.qualityEnabled[quality as VideoQuality]) {
      return res.status(403).json({ error: `Quality ${quality} is disabled by Admin.` });
    }

    const id = typeof jobId === 'string' && /^[a-zA-Z0-9_-]+$/.test(jobId) ? jobId : `vjob_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (ledger.jobs[id]) {
      return res.status(409).json({ error: 'Duplicate video job prevented.' });
    }

    const units = Math.max(1, Math.ceil(dur / 10));
    const creditsReserved = units * (spec.creditsPer10Sec[quality as VideoQuality] ?? 1);
    const estimatedApiCostInr = units * (spec.apiCostInrPer10Sec[quality as VideoQuality] ?? 8);

    if (userQuota.videoCredits < creditsReserved) {
      return res.status(403).json({
        error: `Insufficient Video Credits (${userQuota.videoCredits} available, ${creditsReserved} required). Please upgrade your subscription plan.`,
      });
    }

    // Build scenes
    const sceneCount = Math.max(1, Math.ceil(dur / spec.maxClipSec));
    const finalScenes: ServerVideoScene[] = Array.isArray(inputScenes) && inputScenes.length > 0
      ? inputScenes.map((s: Partial<ServerVideoScene>, idx: number) => ({
          sceneIndex: idx + 1,
          durationSec: Math.min(spec.maxClipSec, Math.max(10, Number(s.durationSec) || 10)),
          visualPrompt: String(s.visualPrompt || prompt).slice(0, 600),
          cameraMovement: String(s.cameraMovement || 'Smooth cinematic motion').slice(0, 140),
          narrationText: String(s.narrationText || '').slice(0, 500),
          subtitleText: String(s.subtitleText || s.narrationText || '').slice(0, 220),
          status: 'pending',
          apiCostInr: 0,
        }))
      : Array.from({ length: sceneCount }, (_, i) => ({
          sceneIndex: i + 1,
          durationSec: Math.min(spec.maxClipSec, Math.max(10, dur - i * spec.maxClipSec)),
          visualPrompt: prompt.trim().slice(0, 600),
          cameraMovement: 'Smooth dynamic camera movement',
          narrationText: '',
          subtitleText: prompt.trim().slice(0, 160),
          status: 'pending',
          apiCostInr: 0,
        }));

    // Deduct authoritative IST daily usage & video credits
    userQuota.dailySecondsUsed += dur;
    userQuota.monthlySecondsUsed += dur;
    userQuota.videoCredits = userQuota.videoCredits - creditsReserved;

    const job: ServerVideoJob = {
      id,
      userId: uid,
      mode: mode === 'image_to_video' ? 'image_to_video' : 'text_to_video',
      prompt: prompt.trim().slice(0, 4000),
      scriptSummary: String(scriptSummary || prompt).slice(0, 2000),
      characterGuide: String(characterGuide || '').slice(0, 1000),
      style: String(style),
      aspectRatio: ['16:9', '9:16', '1:1'].includes(aspectRatio) ? aspectRatio : '16:9',
      quality: quality as VideoQuality,
      model,
      voiceOption: ['none', 'hi', 'en'].includes(voiceOption) ? voiceOption : 'none',
      backgroundMusic: Boolean(backgroundMusic),
      subtitlesEnabled: Boolean(subtitlesEnabled),
      durationSec: dur,
      status: 'queued',
      queuePosition: activeQueue.length + 1,
      progressPct: 5,
      etaSeconds: finalScenes.length * 35,
      totalScenes: finalScenes.length,
      completedScenes: 0,
      creditsReserved,
      creditsRefunded: 0,
      estimatedApiCostInr,
      sourceImageBase64: typeof sourceImageBase64 === 'string' ? sourceImageBase64 : undefined,
      sourceMimeType: typeof sourceMimeType === 'string' ? sourceMimeType : undefined,
      scenes: finalScenes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    ledger.jobs[id] = job;
    saveLedger();

    activeQueue.push(id);
    void processVideoQueue();

    return res.status(202).json(job);
  });

  // List User's Video Jobs
  app.get('/api/video/jobs', requireAuth, (req: AuthenticatedRequest, res) => {
    const uid = req.user!.uid;
    const jobs = Object.values(ledger.jobs)
      .filter((j) => j.userId === uid)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(({ sourceImageBase64: _strip, ...rest }) => rest);
    res.json({ jobs });
  });

  // Get Single Video Job Status
  app.get('/api/video/jobs/:jobId', requireAuth, (req: AuthenticatedRequest, res) => {
    const job = ledger.jobs[req.params.jobId];
    if (!job || (job.userId !== req.user!.uid && !isVerifiedAdmin(req.user))) {
      return res.status(404).json({ error: 'Video job not found.' });
    }
    const { sourceImageBase64: _strip, ...rest } = job;
    return res.json(rest);
  });

  // Edit a specific Scene (without regenerating other scenes)
  app.patch('/api/video/jobs/:jobId/scenes/:sceneIndex', requireAuth, (req: AuthenticatedRequest, res) => {
    const job = ledger.jobs[req.params.jobId];
    if (!job || job.userId !== req.user!.uid) {
      return res.status(404).json({ error: 'Video job not found.' });
    }
    const idx = Number(req.params.sceneIndex);
    const scene = job.scenes.find((s) => s.sceneIndex === idx);
    if (!scene) return res.status(404).json({ error: 'Scene not found.' });

    const { visualPrompt, cameraMovement, narrationText, subtitleText } = req.body ?? {};
    if (typeof visualPrompt === 'string') scene.visualPrompt = visualPrompt.slice(0, 600);
    if (typeof cameraMovement === 'string') scene.cameraMovement = cameraMovement.slice(0, 140);
    if (typeof narrationText === 'string') scene.narrationText = narrationText.slice(0, 500);
    if (typeof subtitleText === 'string') scene.subtitleText = subtitleText.slice(0, 220);
    job.updatedAt = new Date().toISOString();
    saveLedger();
    return res.json({ ok: true, scene });
  });

  // Retry ONLY the failed/edited Scene (Never regenerates full video without permission!)
  app.post('/api/video/jobs/:jobId/scenes/:sceneIndex/retry', requireAuth, async (req: AuthenticatedRequest, res) => {
    const job = ledger.jobs[req.params.jobId];
    if (!job || job.userId !== req.user!.uid) {
      return res.status(404).json({ error: 'Video job not found.' });
    }
    const idx = Number(req.params.sceneIndex);
    const scene = job.scenes.find((s) => s.sceneIndex === idx);
    if (!scene) return res.status(404).json({ error: 'Scene not found.' });

    scene.status = 'pending';
    scene.errorMessage = undefined;
    job.status = 'processing';
    saveLedger();

    await generateSceneVideoClip(job, scene);
    job.completedScenes = job.scenes.filter((s) => s.status === 'completed').length;
    await assembleFinalJob(job);

    const { sourceImageBase64: _strip, ...rest } = job;
    return res.json(rest);
  });

  // =========================================================================
  // REAL PAYMENT SYSTEM (UPI / RAZORPAY GATEWAY VERIFICATION)
  // =========================================================================

  app.get('/api/payments/config', requireAuth, (req: AuthenticatedRequest, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';
    const upiVpa = process.env.CHHOTU_UPI_VPA?.trim() || '';
    const connected = Boolean(keyId && keySecret);
    const userPayments = Object.values(ledger.payments)
      .filter((p) => p.userId === req.user!.uid)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    res.json({
      gateway: 'razorpay',
      connected,
      keyId: connected ? keyId : null,
      upiVpa: upiVpa || null,
      plans: ledger.plans,
      payments: userPayments,
    });
  });

  app.post('/api/payments/create-order', requireAuth, rateLimit(10, 60_000), async (req: AuthenticatedRequest, res) => {
    const { planId } = req.body ?? {};
    const plan = ledger.plans[planId as PlanId];
    if (!plan || plan.id === 'free' || !plan.enabled) {
      return res.status(400).json({ error: 'Invalid or disabled subscription plan.' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      return res.status(503).json({
        connected: false,
        error: 'Payment Gateway NOT CONNECTED. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Settings > Secrets to accept real UPI/Card payments.',
      });
    }

    try {
      const amountPaise = Math.round(plan.priceInr * 100);
      const receipt = `rcpt_${Date.now()}_${req.user!.uid.slice(0, 6)}`;
      const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

      const resp = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt,
          notes: { userId: req.user!.uid, planId: plan.id },
        }),
      });

      const data = await resp.json();
      if (!resp.ok || !data.id) {
        return res.status(502).json({ error: data?.error?.description || 'Failed to create Razorpay order.' });
      }

      const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const payment: ServerPayment = {
        id,
        userId: req.user!.uid,
        userEmail: req.user!.email || '',
        planId: plan.id as Exclude<PlanId, 'free'>,
        amountInr: plan.priceInr,
        gateway: 'razorpay_upi',
        orderId: data.id,
        invoiceNumber: `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${id.slice(-4).toUpperCase()}`,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      ledger.payments[id] = payment;
      saveLedger();

      return res.json({ orderId: data.id, amountPaise, currency: 'INR', keyId, paymentRecordId: id });
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'Payment order creation failed.' });
    }
  });

  app.post('/api/payments/verify', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keySecret) {
      return res.status(503).json({ error: 'Payment gateway secret is not configured.' });
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields.' });
    }

    const payment = Object.values(ledger.payments).find((p) => p.orderId === razorpay_order_id && p.userId === req.user!.uid);
    if (!payment) {
      return res.status(404).json({ error: 'Payment order not found.' });
    }
    if (payment.status === 'paid') {
      return res.status(409).json({ error: 'Duplicate payment verification prevented. Subscription already activated.' });
    }

    const expected = crypto.createHmac('sha256', keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(razorpay_signature));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      payment.status = 'failed';
      payment.errorMessage = 'Cryptographic signature verification failed.';
      payment.updatedAt = new Date().toISOString();
      saveLedger();
      return res.status(400).json({ error: 'Payment verification failed (invalid signature).' });
    }

    // Activate Subscription for 30 days
    const plan = ledger.plans[payment.planId];
    const expiresAt = new Date(Date.now() + plan.durationDays * 86400 * 1000).toISOString();
    const u = ensureUserQuota(req.user!.uid, req.user!.email || '');
    u.plan = plan.id;
    u.subscriptionStatus = 'active';
    u.subscriptionExpiresAt = expiresAt;
    u.singleVideoLimitSec = plan.singleVideoLimitSec;
    u.dailyVideoLimitSec = plan.dailyVideoLimitSec;
    u.monthlyVideoLimitSec = plan.monthlyVideoLimitSec;
    u.videoCredits += plan.includedVideoCredits;

    payment.paymentId = String(razorpay_payment_id);
    payment.status = 'paid';
    payment.updatedAt = new Date().toISOString();
    saveLedger();

    return res.json({ ok: true, payment, quota: u });
  });

  app.post('/api/payments/mark-failed', requireAuth, (req: AuthenticatedRequest, res) => {
    const { razorpay_order_id, reason } = req.body ?? {};
    const payment = Object.values(ledger.payments).find(
      (p) => p.orderId === razorpay_order_id && p.userId === req.user!.uid
    );
    if (!payment) return res.status(404).json({ error: 'Payment record not found.' });
    if (payment.status === 'paid') return res.status(409).json({ error: 'Payment already completed.' });
    payment.status = 'failed';
    payment.errorMessage = String(reason || 'Payment cancelled or declined at gateway').slice(0, 400);
    payment.updatedAt = new Date().toISOString();
    saveLedger();
    return res.json({ ok: true, payment });
  });

  app.post('/api/payments/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
    const u = ensureUserQuota(req.user!.uid, req.user!.email || '');
    u.subscriptionStatus = 'cancelled';
    u.plan = 'free';
    u.singleVideoLimitSec = ledger.plans.free.singleVideoLimitSec;
    u.dailyVideoLimitSec = ledger.plans.free.dailyVideoLimitSec;
    u.monthlyVideoLimitSec = ledger.plans.free.monthlyVideoLimitSec;
    saveLedger();
    return res.json({ ok: true, quota: u });
  });

  // =========================================================================
  // ADMIN CONFIG, USER QUOTA OVERRIDES, REFUNDS & PROFIT/LOSS REPORTS
  // =========================================================================

  app.post('/api/admin/sync-config', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!isVerifiedAdmin(req.user)) return res.status(403).json({ error: 'Admin access required.' });
    const {
      dailyResetHourIST,
      costAlertThresholdInr,
      featureTextToVideo,
      featureImageToVideo,
      qualityEnabled,
      modelEnabled,
      plans,
    } = req.body ?? {};

    if (typeof dailyResetHourIST === 'number') ledger.dailyResetHourIST = Math.max(0, Math.min(23, dailyResetHourIST));
    if (typeof costAlertThresholdInr === 'number') ledger.costAlertThresholdInr = Math.max(0, costAlertThresholdInr);
    if (typeof featureTextToVideo === 'boolean') ledger.featureTextToVideo = featureTextToVideo;
    if (typeof featureImageToVideo === 'boolean') ledger.featureImageToVideo = featureImageToVideo;
    if (qualityEnabled && typeof qualityEnabled === 'object') ledger.qualityEnabled = { ...ledger.qualityEnabled, ...qualityEnabled };
    if (modelEnabled && typeof modelEnabled === 'object') ledger.modelEnabled = { ...ledger.modelEnabled, ...modelEnabled };
    if (plans && typeof plans === 'object') ledger.plans = { ...ledger.plans, ...plans };
    saveLedger();
    return res.json({ ok: true });
  });

  app.post('/api/admin/sync-user', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!isVerifiedAdmin(req.user)) return res.status(403).json({ error: 'Admin access required.' });
    const { uid, email = '', plan, singleVideoLimitSec, dailyVideoLimitSec, monthlyVideoLimitSec, videoCredits, banned, subscriptionExpiresAt } = req.body ?? {};
    if (!uid) return res.status(400).json({ error: 'uid is required.' });
    const u = ensureUserQuota(uid, email);
    if (plan && ledger.plans[plan as PlanId]) u.plan = plan;
    if (typeof singleVideoLimitSec === 'number') u.singleVideoLimitSec = singleVideoLimitSec;
    if (typeof dailyVideoLimitSec === 'number') u.dailyVideoLimitSec = dailyVideoLimitSec;
    if (typeof monthlyVideoLimitSec === 'number') u.monthlyVideoLimitSec = monthlyVideoLimitSec;
    if (typeof videoCredits === 'number') u.videoCredits = videoCredits;
    if (typeof banned === 'boolean') u.banned = banned;
    if (typeof subscriptionExpiresAt === 'string') u.subscriptionExpiresAt = subscriptionExpiresAt;
    saveLedger();
    return res.json({ ok: true, quota: u });
  });

  app.post('/api/admin/payments/:paymentId/refund', requireAuth, async (req: AuthenticatedRequest, res) => {
    if (!isVerifiedAdmin(req.user)) return res.status(403).json({ error: 'Admin access required.' });
    const payment = ledger.payments[req.params.paymentId];
    if (!payment || payment.status !== 'paid' || !payment.paymentId) {
      return res.status(400).json({ error: 'Only paid transactions with a paymentId can be refunded.' });
    }
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret) {
      return res.status(503).json({ error: 'Payment gateway keys are not configured.' });
    }
    try {
      const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const resp = await fetch(`https://api.razorpay.com/v1/payments/${payment.paymentId}/refund`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return res.status(502).json({ error: data?.error?.description || 'Gateway refund failed.' });
      }
      payment.status = 'refunded';
      payment.updatedAt = new Date().toISOString();
      saveLedger();
      return res.json({ ok: true, payment });
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'Refund error.' });
    }
  });

  app.get('/api/admin/finance-report', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!isVerifiedAdmin(req.user)) return res.status(403).json({ error: 'Admin access required.' });
    const allPayments = Object.values(ledger.payments);
    const totalRevenueInr = allPayments
      .filter((p) => p.status === 'paid')
      .reduce((acc, p) => acc + p.amountInr, 0);
    const totalRefundedInr = allPayments
      .filter((p) => p.status === 'refunded')
      .reduce((acc, p) => acc + p.amountInr, 0);
    const totalApiCostInr = ledger.costLogs.reduce((acc, c) => acc + c.costInr, 0);
    const failedApiCostInr = ledger.costLogs
      .filter((c) => c.status === 'failed')
      .reduce((acc, c) => acc + c.costInr, 0);
    const netProfitInr = totalRevenueInr - totalApiCostInr;
    const costAlertTriggered = totalApiCostInr >= ledger.costAlertThresholdInr;

    res.json({
      totalRevenueInr,
      totalRefundedInr,
      totalApiCostInr,
      failedApiCostInr,
      netProfitInr,
      costAlertTriggered,
      costAlertThresholdInr: ledger.costAlertThresholdInr,
      payments: allPayments,
      costLogs: ledger.costLogs.slice(0, 100),
      videoJobs: Object.values(ledger.jobs)
        .map(({ sourceImageBase64: _s, ...rest }) => rest)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 100),
    });
  });

  // 7. BharatTube App Testing Assistant & Secure Integration Diagnostics (PRESERVED)
  app.post('/api/bharattube/test', requireAuth, rateLimit(15, 60_000), async (req, res) => {
    const { targetUrl } = req.body ?? {};
    const configuredUrl = process.env.BHARATTUBE_API_URL?.trim();
    const configuredSecret = process.env.BHARATTUBE_BRIDGE_SECRET?.trim();
    const effectiveUrl = (typeof targetUrl === 'string' && targetUrl.trim()) || configuredUrl || '';

    if (!effectiveUrl) {
      return res.json({
        connected: false,
        status: 'not_connected',
        targetUrl: 'Not Configured',
        serverStatus: 'Not Connected (BHARATTUBE_API_URL not set)',
        dbStatus: 'Not Connected',
        uploadTestStatus: 'Not Connected',
        playbackTestStatus: 'Not Connected',
        admobStatus: 'Not Connected',
        bridgeAuthConfigured: Boolean(configuredSecret),
        errorReport: 'BharatTube backend URL is not connected. Configure BHARATTUBE_API_URL & BHARATTUBE_BRIDGE_SECRET or enter a live HTTPS BharatTube endpoint URL to run a real probe.',
      });
    }

    let parsed: URL;
    try {
      parsed = new URL(effectiveUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return res.status(400).json({ error: 'Only http/https URLs are allowed.' });
      }
      if (isPrivateOrLoopbackHost(parsed.hostname)) {
        return res.status(400).json({ error: 'Private, loopback, or internal metadata hostnames are blocked for security.' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid BharatTube endpoint URL.' });
    }

    const probeResults: Record<string, string> = {
      serverStatus: 'Unreachable',
      dbStatus: 'Unknown',
      uploadTestStatus: 'Not Checked',
      playbackTestStatus: 'Not Checked',
      admobStatus: 'Not Checked',
    };
    const errors: string[] = [];

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const healthUrl = new URL('/health', parsed.origin).toString();
      const resp = await fetch(healthUrl, {
        method: 'GET',
        headers: configuredSecret ? { Authorization: `Bearer ${configuredSecret}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);

      probeResults.serverStatus = `HTTP ${resp.status} ${resp.statusText}`;
      if (resp.ok) {
        const body = await resp.json().catch(() => null);
        if (body && typeof body === 'object') {
          probeResults.dbStatus = String(body.database || body.dbStatus || 'Reported OK');
          probeResults.uploadTestStatus = String(body.uploadStatus || 'Endpoint Reachable');
          probeResults.playbackTestStatus = String(body.playbackStatus || 'Endpoint Reachable');
          probeResults.admobStatus = String(body.admobStatus || 'Not Reported');
        }
      } else {
        errors.push(`Health probe returned HTTP ${resp.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      probeResults.serverStatus = 'Connection Failed';
      errors.push(`Probe error: ${msg}`);
    }

    return res.json({
      connected: errors.length === 0,
      status: errors.length === 0 ? 'connected' : 'error',
      targetUrl: parsed.origin,
      ...probeResults,
      bridgeAuthConfigured: Boolean(configuredSecret),
      errorReport: errors.length ? errors.join(' | ') : 'Live health probe completed cleanly.',
    });
  });

  app.post('/api/bharattube/bridge', rateLimit(60, 60_000), async (req, res) => {
    const secret = process.env.BHARATTUBE_BRIDGE_SECRET;
    if (!secret) {
      return res.status(503).json({
        status: 'not_connected',
        error: 'BharatTube Bridge is not connected (BHARATTUBE_BRIDGE_SECRET is unset).',
      });
    }

    const authHeader = req.headers.authorization || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid BharatTube bridge credentials.' });
    }

    const { action, payload } = req.body ?? {};
    if (action === 'ping') {
      return res.json({
        ok: true,
        service: 'Chhotu AI Bridge',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      });
    }

    if (action === 'analyze_error') {
      try {
        const ai = getAiClient();
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Analyze this BharatTube production error log and suggest root cause + fix:\n${JSON.stringify(payload).slice(0, 8000)}`,
        });
        return res.json({ ok: true, analysis: response.text || '' });
      } catch (err) {
        const formatted = formatGeminiError(err);
        return res.status(formatted.status).json({ error: formatted.message });
      }
    }

    return res.status(400).json({ error: 'Unsupported bridge action.' });
  });

  // 8. Admin Server Telemetry Endpoint (PRESERVED)
  app.get('/api/admin/telemetry', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!isVerifiedAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    return res.json({
      startedAt: serverTelemetry.startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      totalRequests: serverTelemetry.totalRequests,
      totalAiCalls: serverTelemetry.totalAiCalls,
      totalErrors: serverTelemetry.totalErrors,
      recentErrors: serverTelemetry.recentErrors,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      paymentGatewayConnected: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      bharatTubeConnected: Boolean(process.env.BHARATTUBE_API_URL && process.env.BHARATTUBE_BRIDGE_SECRET),
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Chhotu AI server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Chhotu AI server:', err);
  process.exit(1);
});
