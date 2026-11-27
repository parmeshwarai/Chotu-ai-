import React, { useState } from 'react';
import {
  AlertCircle,
  Download,
  Film,
  Image as ImageIcon,
  Info,
  Loader2,
  Music,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  createJobId,
  deductCreditsAtomic,
  recordMediaHistory,
  refundCreditsAtomic,
} from '../lib/credits';
import { AppTab, MediaHistoryItem, SystemConfig, UserProfile } from '../types';
import { VideoStudio } from './VideoStudio';

interface Props {
  activeStudio: 'image' | 'video' | 'music';
  profile: UserProfile;
  config: SystemConfig;
  mediaHistory: MediaHistoryItem[];
  initialVideoMode?: 'text_to_video' | 'image_to_video';
  initialVideoSection?: 'create' | 'history';
  onSwitchStudio: (studio: 'image' | 'video' | 'music') => void;
  onNavigate?: (tab: AppTab) => void;
}

export function MediaStudios({
  activeStudio,
  profile,
  config,
  mediaHistory,
  initialVideoMode = 'text_to_video',
  initialVideoSection = 'create',
  onSwitchStudio,
  onNavigate,
}: Props) {
  // Shared states
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Image states
  const [imageStyle, setImageStyle] = useState('Realistic');
  const [imageRatio, setImageRatio] = useState('1:1');
  const [imageQuality, setImageQuality] = useState('1K');
  const [sourceImage, setSourceImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null);

  // Music states
  const [musicStyle, setMusicStyle] = useState('Cinematic Orchestral');
  const [musicMode, setMusicMode] = useState<'clip' | 'pro'>('clip');
  const [instrumental, setInstrumental] = useState(false);

  const filteredHistory = mediaHistory.filter((m) => m.type === activeStudio);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError('Reference image must be under 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const base64 = res.includes(',') ? res.split(',')[1] : '';
      setSourceImage({ base64, mimeType: file.type || 'image/png', name: file.name });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleGenerateImage = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);
    if (!config.featureImage || !config.modelImage) {
      setError('AI Image Studio is currently disabled by Admin.');
      return;
    }
    if (!prompt.trim()) {
      setError('Please enter an image prompt.');
      return;
    }

    const cost = imageQuality === '4K' ? 3 : imageQuality === '2K' ? 2 : 1;
    const jobId = createJobId();
    setLoading(true);
    setStatusMessage(`Reserving ${cost} Image Credit(s)...`);

    try {
      await deductCreditsAtomic({
        uid: profile.uid,
        creditType: 'image',
        cost,
        jobId,
        reason: `Image generation (${imageStyle}, ${imageQuality})`,
      });

      setStatusMessage('Calling Gemini Image Engine...');
      const res = await apiFetch<{ mediaUrl: string; mimeType: string; model: string }>('/api/ai/image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          style: imageStyle,
          aspectRatio: imageRatio,
          quality: imageQuality,
          sourceImageBase64: sourceImage?.base64,
          sourceMimeType: sourceImage?.mimeType,
        }),
      });

      await recordMediaHistory({
        id: jobId,
        userId: profile.uid,
        type: 'image',
        prompt: prompt.trim(),
        style: imageStyle,
        model: res.model,
        aspectRatio: imageRatio,
        quality: imageQuality,
        status: 'completed',
        creditsCost: cost,
        refunded: false,
        mediaUrl: res.mediaUrl,
        mimeType: res.mimeType,
      });

      setStatusMessage('Image generated and saved to your history.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Image generation failed.';
      await refundCreditsAtomic({
        uid: profile.uid,
        creditType: 'image',
        cost,
        jobId,
        reason: `Refund: ${msg}`,
      }).catch(() => {});

      await recordMediaHistory({
        id: jobId,
        userId: profile.uid,
        type: 'image',
        prompt: prompt.trim(),
        style: imageStyle,
        model: imageQuality === '1K' ? 'gemini-3.1-flash-lite-image' : 'gemini-nano-banana-2.1',
        aspectRatio: imageRatio,
        quality: imageQuality,
        status: 'failed',
        creditsCost: cost,
        refunded: true,
        errorMessage: msg.slice(0, 580),
      }).catch(() => {});

      setError(`${msg} (Any deducted credits were automatically refunded.)`);
      setStatusMessage(null);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);
    if (!config.featureMusic || !config.modelMusic) {
      setError('AI Music Studio is currently disabled by Admin.');
      return;
    }
    if (!prompt.trim()) {
      setError('Please describe the music track you want to compose.');
      return;
    }

    const cost = musicMode === 'pro' ? 2 : 1;
    const jobId = createJobId();
    setLoading(true);
    setStatusMessage(`Reserving ${cost} Music Credit(s)...`);

    try {
      await deductCreditsAtomic({
        uid: profile.uid,
        creditType: 'music',
        cost,
        jobId,
        reason: `Music generation (${musicStyle}, ${musicMode})`,
      });

      setStatusMessage('Composing track with Lyria...');
      const res = await apiFetch<{
        mediaUrl: string;
        mimeType: string;
        model: string;
        lyrics: string;
      }>('/api/ai/music', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt.trim(),
          style: musicStyle,
          mode: musicMode,
          instrumental,
        }),
      });

      await recordMediaHistory({
        id: jobId,
        userId: profile.uid,
        type: 'music',
        prompt: prompt.trim(),
        style: musicStyle,
        model: res.model,
        duration: musicMode === 'clip' ? '30s' : 'Full',
        status: 'completed',
        creditsCost: cost,
        refunded: false,
        mediaUrl: res.mediaUrl,
        mimeType: res.mimeType,
        lyrics: res.lyrics,
      });

      setStatusMessage('Music track generated cleanly.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Music generation failed.';
      await refundCreditsAtomic({
        uid: profile.uid,
        creditType: 'music',
        cost,
        jobId,
        reason: `Refund: ${msg}`,
      }).catch(() => {});

      await recordMediaHistory({
        id: jobId,
        userId: profile.uid,
        type: 'music',
        prompt: prompt.trim(),
        style: musicStyle,
        model: musicMode === 'pro' ? 'lyria-3-pro-preview' : 'lyria-3-clip-preview',
        status: 'failed',
        creditsCost: cost,
        refunded: true,
        errorMessage: msg.slice(0, 580),
      }).catch(() => {});

      setError(`${msg} (Deducted music credit was automatically refunded.)`);
      setStatusMessage(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Studio Tabs & Real Credit Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
          <button
            type="button"
            onClick={() => {
              onSwitchStudio('image');
              setError(null);
              setStatusMessage(null);
            }}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeStudio === 'image'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            AI Image
          </button>
          <button
            type="button"
            onClick={() => {
              onSwitchStudio('video');
              setError(null);
              setStatusMessage(null);
            }}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeStudio === 'video'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            AI Video
          </button>
          <button
            type="button"
            onClick={() => {
              onSwitchStudio('music');
              setError(null);
              setStatusMessage(null);
            }}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeStudio === 'music'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            AI Music
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
          <span>
            Image Credits: <strong className="font-mono text-slate-900 dark:text-white">{profile.imageCredits}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Video Credits: <strong className="font-mono text-slate-900 dark:text-white">{profile.videoCredits}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Music Credits: <strong className="font-mono text-slate-900 dark:text-white">{profile.musicCredits}</strong>
          </span>
        </div>
      </div>

      {activeStudio === 'video' ? (
        <VideoStudio
          profile={profile}
          config={config}
          mediaHistory={mediaHistory}
          initialMode={initialVideoMode}
          initialSection={initialVideoSection}
          onNavigate={onNavigate || (() => {})}
        />
      ) : (
        <>

      {/* Paid API Key Clarity Notice */}
      <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold">Real API Execution & Automatic Credit Refund Policy</div>
          <p className="leading-relaxed">
            Image, Video (Gemini Omni Flash), and Music (Lyria) generators call real Gemini paid-tier endpoints on the server.
            If your Settings &gt; Secrets key is on the free tier, the API returns a real quota/billing error and Chhotu AI
            immediately refunds 100% of deducted credits &amp; video quota counts. Zero fake media is ever generated.
          </p>
        </div>
      </div>

      {/* Generator Form */}
      <form
        onSubmit={activeStudio === 'image' ? handleGenerateImage : handleGenerateMusic}
        className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">
            {activeStudio === 'image' ? 'AI Image Generator & Editor' : 'AI Music & Instrumental Studio'}
          </h2>
        </div>

        {/* Options Grid */}
        {activeStudio === 'image' && (
          <div className="grid sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Image Style</label>
              <select
                value={imageStyle}
                onChange={(e) => setImageStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              >
                <option value="Realistic">Realistic</option>
                <option value="Cartoon">Cartoon</option>
                <option value="3D Render">3D Render</option>
                <option value="Thumbnail">YouTube Thumbnail</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Aspect Ratio</label>
              <select
                value={imageRatio}
                onChange={(e) => setImageRatio(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              >
                <option value="1:1">1:1 Square</option>
                <option value="16:9">16:9 Landscape</option>
                <option value="9:16">9:16 Portrait</option>
                <option value="4:3">4:3 Standard</option>
                <option value="3:4">3:4 Vertical</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Resolution</label>
              <select
                value={imageQuality}
                onChange={(e) => setImageQuality(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              >
                <option value="1K">1K Standard (1 Credit)</option>
                <option value="2K">2K High (2 Credits)</option>
                <option value="4K">4K Ultra (3 Credits)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-500">Optional Image Edit Source</label>
              <label className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs flex items-center justify-between cursor-pointer">
                <span className="truncate">{sourceImage ? sourceImage.name : 'Upload Image to Edit'}</span>
                <Upload className="w-3.5 h-3.5 shrink-0" />
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>
          </div>
        )}

        {activeStudio === 'music' && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Music Style</label>
                <select
                  value={musicStyle}
                  onChange={(e) => setMusicStyle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  <option value="Cinematic Orchestral">Cinematic Orchestral</option>
                  <option value="Lo-Fi Chill Beat">Lo-Fi Chill Beat</option>
                  <option value="Bhojpuri Folk Fusion">Bhojpuri Folk Fusion</option>
                  <option value="Indian Classical Instrumental">Indian Classical Instrumental</option>
                  <option value="Corporate Background">Corporate Background</option>
                  <option value="Electronic Synthwave">Electronic Synthwave</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Track Length</label>
                <select
                  value={musicMode}
                  onChange={(e) => setMusicMode(e.target.value as 'clip' | 'pro')}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
                >
                  <option value="clip">30s Clip (1 Credit)</option>
                  <option value="pro">Full Pro Track (2 Credits)</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setInstrumental((v) => !v)}
                  className={`w-full px-3 py-2 rounded-xl border text-xs font-medium ${
                    instrumental
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {instrumental ? 'Instrumental Only (No Vocals)' : 'Vocals / Full Mix Allowed'}
                </button>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <strong>Copyright & Commercial Usage Disclosure:</strong> Tracks generated through Lyria are AI-synthesized for your
              creative projects. Commercial distribution rights depend on your Gemini API billing plan terms; avoid referencing
              copyrighted artist names, trademarked songs, or protected lyrics in prompts.
            </div>
          </div>
        )}

        {sourceImage && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
            <span>Reference image attached: {sourceImage.name}</span>
            <button type="button" onClick={() => setSourceImage(null)} className="text-rose-600 hover:underline">
              Clear
            </button>
          </div>
        )}

        {/* Prompt Input */}
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            activeStudio === 'image'
              ? 'Describe the image or edit you want to create...'
              : 'Describe the mood, tempo, instruments, or theme for your track...'
          }
          className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        />

        {error && (
          <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {statusMessage && (
          <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 flex items-center gap-2.5 text-xs text-blue-700 dark:text-blue-300">
            {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
            <span>{statusMessage}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {activeStudio === 'image'
              ? `Cost: ${imageQuality === '4K' ? 3 : imageQuality === '2K' ? 2 : 1} Image Credit`
              : `Cost: ${musicMode === 'pro' ? 2 : 1} Music Credit`}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading
              ? 'Processing...'
              : activeStudio === 'image'
                ? sourceImage
                  ? 'Edit Image'
                  : 'Generate Image'
                : 'Generate Music'}
          </button>
        </div>
      </form>

      {/* Media History */}
      <section className="space-y-4">
        <h3 className="font-display text-base font-semibold">
          Generated {activeStudio === 'image' ? 'Images' : 'Music'} History ({filteredHistory.length})
        </h3>
        {filteredHistory.length === 0 ? (
          <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-center text-sm text-slate-500 dark:text-slate-400">
            No {activeStudio} generations recorded yet.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredHistory.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden flex flex-col justify-between"
              >
                {item.status === 'completed' && item.mediaUrl ? (
                  item.type === 'image' ? (
                    <img
                      src={item.mediaUrl}
                      alt={item.prompt}
                      referrerPolicy="no-referrer"
                      className="w-full h-52 object-cover bg-slate-900"
                    />
                  ) : item.type === 'video' ? (
                    <video
                      src={item.mediaUrl}
                      controls
                      className="w-full h-52 bg-black object-contain"
                    />
                  ) : (
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/70 space-y-2">
                      <audio src={item.mediaUrl} controls className="w-full" />
                      {item.lyrics && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-3 whitespace-pre-wrap">
                          {item.lyrics}
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  <div className="p-5 bg-rose-50/70 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300 space-y-1">
                    <div className="font-semibold">
                      Failed · {item.refunded ? 'Credits Refunded' : 'No Refund'}
                    </div>
                    <p className="line-clamp-3">{item.errorMessage || 'Generation failed'}</p>
                  </div>
                )}

                <div className="p-4 space-y-2">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {item.style} · {item.model} · {item.creditsCost} cr
                  </div>
                  <p className="text-xs text-slate-900 dark:text-slate-100 line-clamp-2">{item.prompt}</p>
                  {item.status === 'completed' && item.mediaUrl && (
                    <a
                      href={item.mediaUrl}
                      download
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline pt-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download File
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
