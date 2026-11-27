import React, { useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  BookmarkPlus,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Globe,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Send,
  Share2,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ChatMessage,
  ChatMode,
  ChatSession,
  GroundingSource,
  SystemConfig,
  UserMemory,
  UserProfile,
} from '../types';

interface Props {
  profile: UserProfile;
  config: SystemConfig;
  initialMode: ChatMode;
  voiceFocus?: boolean;
  memories: UserMemory[];
}

const SCRIPT_PRESETS = [
  { label: 'YouTube Video Script', prompt: 'Write a complete engaging YouTube video script with Hook, Intro, Main Points, Title, Description, Tags, Thumbnail Text Suggestions, and Scene-by-Scene visual prompts on: ' },
  { label: 'Short / Reels Script', prompt: 'Write a 45-second high-retention YouTube Shorts / Reels script with Scene-by-Scene timestamps, Title, Hashtags, and Thumbnail Text on: ' },
  { label: 'Cartoon Story', prompt: 'Create a colorful kids Cartoon Story script with character dialogues, Scene-by-Scene image/video prompts, Title, Description, and Tags about: ' },
  { label: 'Bhojpuri Story / Song', prompt: 'Write a creative Bhojpuri Story & Song concept with catchy chorus, verses, Title, Description, Tags, Thumbnail Text, and Scene-by-Scene prompts about: ' },
  { label: 'Hindi Story', prompt: 'Write an emotional and engaging Hindi Kahani with Scene-by-Scene prompts, Title, Description, Tags, and Thumbnail Text about: ' },
];

export function ChatWorkspace({ profile, config, initialMode, voiceFocus, memories }: Props) {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [language, setLanguage] = useState<'auto' | 'hi' | 'en' | 'bho'>(profile.preferredLanguage || 'auto');
  const [model, setModel] = useState<string>('gemini-4-hydrogen');
  const [useSearch, setUseSearch] = useState<boolean>(initialMode === 'search');
  const [voiceOn, setVoiceOn] = useState<boolean>(voiceFocus || profile.voiceEnabled);
  const [voiceName, setVoiceName] = useState<string>('Kore');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; mimeType: string; data: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMode(initialMode);
    if (initialMode === 'search') setUseSearch(true);
  }, [initialMode]);

  useEffect(() => {
    if (voiceFocus) setVoiceOn(true);
  }, [voiceFocus]);

  // Listen to user's saved chats
  useEffect(() => {
    const q = query(
      collection(db, 'chats'),
      where('userId', '==', profile.uid),
      orderBy('updatedAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ChatSession);
        setChats(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'chats')
    );
    return () => unsub();
  }, [profile.uid]);

  // Listen to messages of active chat
  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'chats', activeChatId, 'messages'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map((d) => d.data() as ChatMessage));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `chats/${activeChatId}/messages`)
    );
    return () => unsub();
  }, [activeChatId, profile.uid]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be under 10 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : '';
      setAttachment({
        name: file.name,
        mimeType: file.type || 'text/plain',
        data: base64,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const speakText = async (text: string, msgId: string) => {
    if (!voiceOn) return;
    try {
      setSpeakingId(msgId);
      const data = await apiFetch<{ audioBase64: string; mimeType: string }>('/api/ai/tts', {
        method: 'POST',
        body: JSON.stringify({ text: text.slice(0, 1800), voiceName }),
      });
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      const audio = new Audio(`data:${data.mimeType};base64,${data.audioBase64}`);
      audioPlayerRef.current = audio;
      audio.onended = () => setSpeakingId(null);
      audio.onerror = () => setSpeakingId(null);
      await audio.play();
    } catch {
      setSpeakingId(null);
    }
  };

  const toggleRecording = async () => {
    setError(null);
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const result = String(reader.result || '');
          const base64 = result.includes(',') ? result.split(',')[1] : '';
          if (!base64) return;
          setTranscribing(true);
          try {
            const res = await apiFetch<{ text: string }>('/api/ai/transcribe', {
              method: 'POST',
              body: JSON.stringify({
                audioBase64: base64,
                mimeType: blob.type || 'audio/webm',
                languageHint: language === 'hi' ? 'Hindi' : language === 'en' ? 'English' : 'Hindi or English',
              }),
            });
            if (res.text) {
              setInput((prev) => (prev ? `${prev} ${res.text}` : res.text));
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Voice transcription failed.');
          } finally {
            setTranscribing(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone permission is required for Voice Input.');
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() && !attachment) return;
    if (profile.banned) {
      setError('Your account is suspended.');
      return;
    }
    if (model === 'gemini-4-hydrogen' && !config.modelHydrogen) {
      setError('Gemini 4 Hydrogen is currently disabled by Admin.');
      return;
    }
    if (model === 'gemini-4-neon' && !config.modelNeon) {
      setError('Gemini 4 Neon is currently disabled by Admin.');
      return;
    }

    const promptText = input.trim() || `Analyze attached document: ${attachment?.name}`;
    setInput('');
    setError(null);
    setSending(true);

    let chatId = activeChatId;
    try {
      const batch = writeBatch(db);
      if (!chatId) {
        chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const chatRef = doc(db, 'chats', chatId);
        batch.set(chatRef, {
          id: chatId,
          userId: profile.uid,
          title: promptText.slice(0, 64),
          mode,
          language,
          model,
          messageCount: 1,
          lastMessagePreview: promptText.slice(0, 200),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setActiveChatId(chatId);
      } else {
        batch.update(doc(db, 'chats', chatId), {
          messageCount: messages.length + 1,
          lastMessagePreview: promptText.slice(0, 200),
          model,
          language,
          updatedAt: serverTimestamp(),
        });
      }

      const userMsgId = `msg_${Date.now()}_u`;
      const userMsgData: Record<string, unknown> = {
        id: userMsgId,
        chatId,
        userId: profile.uid,
        role: 'user',
        content: promptText,
        model,
        createdAt: serverTimestamp(),
      };
      if (attachment?.name) {
        userMsgData.attachmentName = attachment.name.slice(0, 200);
      }
      batch.set(doc(db, 'chats', chatId, 'messages', userMsgId), userMsgData);
      await batch.commit();

      const activeMemories = memories.filter((m) => m.active).map((m) => m.content);
      const historyPayload = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));

      const currentAttachment = attachment;
      setAttachment(null);

      const aiRes = await apiFetch<{
        text: string;
        model: string;
        sources: GroundingSource[];
      }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptText,
          history: historyPayload,
          mode,
          language,
          model,
          memories: activeMemories,
          useSearch: useSearch || mode === 'search',
          attachment: currentAttachment
            ? { mimeType: currentAttachment.mimeType, data: currentAttachment.data }
            : undefined,
        }),
      });

      const assistantMsgId = `msg_${Date.now()}_a`;
      const assistantText = aiRes.text || 'No response generated.';
      const msgBatch = writeBatch(db);
      msgBatch.set(doc(db, 'chats', chatId, 'messages', assistantMsgId), {
        id: assistantMsgId,
        chatId,
        userId: profile.uid,
        role: 'assistant',
        content: assistantText.slice(0, 49500),
        model: aiRes.model || model,
        sourcesCount: aiRes.sources?.length || 0,
        createdAt: serverTimestamp(),
      });
      msgBatch.update(doc(db, 'chats', chatId), {
        messageCount: messages.length + 2,
        lastMessagePreview: assistantText.slice(0, 200),
        updatedAt: serverTimestamp(),
      });
      await msgBatch.commit();

      // Store sources locally in state for immediate display
      if (aiRes.sources?.length) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, sources: aiRes.sources } : m))
        );
      }

      if (voiceOn) {
        void speakText(assistantText, assistantMsgId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate AI response.');
    } finally {
      setSending(false);
    }
  };

  const handleRenameChat = async (chatId: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      await updateDoc(doc(db, 'chats', chatId), {
        title: renameValue.trim().slice(0, 140),
        updatedAt: serverTimestamp(),
      });
      setRenamingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${chatId}`);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await deleteDoc(doc(db, 'chats', chatId));
      if (activeChatId === chatId) setActiveChatId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${chatId}`);
    }
  };

  const handleSaveMemory = async (content: string) => {
    try {
      const memId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'memories', memId), {
        id: memId,
        userId: profile.uid,
        content: content.slice(0, 950),
        category: 'fact',
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'memories');
    }
  };

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleShare = async (text: string, id: string) => {
    if (navigator.share) {
      await navigator.share({ title: 'Chhotu AI Response', text }).catch(() => {});
    } else {
      await handleCopy(text, id);
    }
  };

  const handleDownloadText = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid lg:grid-cols-12 gap-4 h-[calc(100vh-140px)] min-h-[600px]">
      {/* Chat History Sidebar */}
      <aside className="lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <span className="font-display text-sm font-semibold">Saved Chats</span>
          <button
            type="button"
            onClick={() => {
              setActiveChatId(null);
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {chats.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
              No saved chats yet. Start a conversation to keep your history synced.
            </div>
          ) : (
            chats.map((c) => (
              <div
                key={c.id}
                className={`group rounded-lg p-2.5 text-xs transition-colors ${
                  activeChatId === c.id
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-100'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-300'
                }`}
              >
                {renamingId === c.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void handleRenameChat(c.id)}
                      autoFocus
                      className="flex-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRenameChat(c.id)}
                      className="px-2 py-1 rounded bg-blue-600 text-white text-[11px]"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveChatId(c.id);
                        setMode(c.mode);
                      }}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="font-medium truncate">{c.title}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {c.mode} · {c.messageCount} msgs
                      </div>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        aria-label="Rename chat"
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenameValue(c.title);
                        }}
                        className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete chat"
                        onClick={() => void handleDeleteChat(c.id)}
                        className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Conversation Pane */}
      <section className="lg:col-span-9 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col overflow-hidden">
        {/* Workspace Toolbar */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {(['chat', 'search', 'coding', 'script', 'document'] as ChatMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  if (m === 'search') setUseSearch(true);
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                  mode === m
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {m === 'script' ? 'Script Writer' : m === 'document' ? 'Document AI' : m}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'auto' | 'hi' | 'en' | 'bho')}
              aria-label="Language"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
            >
              <option value="auto">Auto (Hi/En/Bho)</option>
              <option value="hi">Hindi (हिन्दी)</option>
              <option value="en">English</option>
              <option value="bho">Bhojpuri (भोजपुरी)</option>
            </select>

            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="AI Model"
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
            >
              <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
              <option value="gemini-4-neon">Gemini 4 Neon (Paid Key)</option>
            </select>

            <button
              type="button"
              onClick={() => setUseSearch((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                useSearch
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Web Search {useSearch ? 'ON' : 'OFF'}
            </button>

            <button
              type="button"
              onClick={() => setVoiceOn((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                voiceOn
                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {voiceOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              Voice {voiceOn ? 'ON' : 'OFF'}
            </button>

            {voiceOn && (
              <select
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                aria-label="TTS Voice"
                className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              >
                <option value="Kore">Kore</option>
                <option value="Puck">Puck</option>
                <option value="Zephyr">Zephyr</option>
                <option value="Charon">Charon</option>
              </select>
            )}
          </div>
        </div>

        {/* Script Writer Quick Presets */}
        {mode === 'script' && (
          <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 flex items-center gap-2 overflow-x-auto">
            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Templates:</span>
            {SCRIPT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setInput(preset.prompt)}
                className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-3">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {mode === 'coding'
                  ? 'Chhotu AI Coding Assistant'
                  : mode === 'script'
                    ? 'Chhotu AI Script Writer'
                    : mode === 'document'
                      ? 'Chhotu AI Document Analyst'
                      : mode === 'search'
                        ? 'Chhotu AI Internet Search'
                        : 'Start a New Conversation'}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {mode === 'document'
                  ? 'Upload any PDF or text file below to summarize it, ask targeted questions, or export a structured report.'
                  : mode === 'search'
                    ? 'Ask about current news, live releases, or recent updates with verified web citations.'
                    : 'Ask in Hindi, English, or Bhojpuri. Active AI memories are applied automatically.'}
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {msg.attachmentName && (
                    <div className="text-xs opacity-80 mb-1.5 font-mono">
                      Attached: {msg.attachmentName}
                    </div>
                  )}
                  {msg.content}

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Verified Web Sources:
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {msg.sources.map((src, idx) => (
                          <a
                            key={idx}
                            href={src.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <span>{src.title}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {msg.role === 'assistant' && (
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 px-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>{msg.model}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(msg.content, msg.id)}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      {copiedId === msg.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === msg.id ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShare(msg.content, msg.id)}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadText(
                          msg.content,
                          `chhotu-ai-${mode}-${msg.id.slice(-6)}.${mode === 'coding' ? 'txt' : 'md'}`
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => void speakText(msg.content, msg.id)}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      {speakingId === msg.id ? 'Speaking...' : 'Speak'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveMemory(msg.content.slice(0, 300))}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      Save Memory
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
          {sending && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Chhotu AI is thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer */}
        <form onSubmit={handleSend} className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          {error && (
            <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          {attachment && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
              <span className="font-mono truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-rose-600 hover:underline ml-2"
              >
                Remove
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <label className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0" title="Upload PDF or Text document">
              <FileUp className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <input
                type="file"
                accept=".pdf,.txt,.md,.csv,.json,.html,.js,.ts,.py,image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => void toggleRecording()}
              disabled={transcribing}
              className={`p-2.5 rounded-xl border transition-colors shrink-0 ${
                recording
                  ? 'border-rose-600 bg-rose-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
              title="Voice Input (Hindi & English)"
            >
              {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                transcribing
                  ? 'Transcribing voice...'
                  : mode === 'coding'
                    ? 'Paste code to debug or ask to build a feature...'
                    : mode === 'document'
                      ? 'Attach a PDF/TXT file and ask for a summary or report...'
                      : 'Ask Chhotu AI in Hindi, English, or Bhojpuri...'
              }
              className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            <button
              type="submit"
              disabled={sending || transcribing}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
