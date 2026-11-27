import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  Activity,
  Brain,
  Code2,
  Crown,
  FileText,
  Film,
  Globe,
  Home,
  Image as ImageIcon,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  Music,
  PenTool,
  Shield,
  Sun,
  UserCircle,
  X,
} from 'lucide-react';
import { AccountView } from './components/AccountView';
import { AdminDashboard } from './components/AdminDashboard';
import { AppTestingAssistant } from './components/AppTestingAssistant';
import { AuthView } from './components/AuthView';
import { ChatWorkspace } from './components/ChatWorkspace';
import { HomeView } from './components/HomeView';
import { MediaStudios } from './components/MediaStudios';
import { MemoryManager } from './components/MemoryManager';
import { SubscriptionView } from './components/SubscriptionView';
import { getMonthKey, getTodayKey } from './lib/credits';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { AppTab, MediaHistoryItem, SystemConfig, UserMemory, UserProfile } from './types';

const DEFAULT_CONFIG: SystemConfig = {
  freeDailyVideoLimit: 2,
  freeMonthlyVideoLimit: 10,
  premiumDailyVideoLimit: 20,
  premiumMonthlyVideoLimit: 200,
  dailyResetHourIST: 0,
  costAlertThresholdInr: 5000,
  featureChat: true,
  featureVoice: true,
  featureMemory: true,
  featureImage: true,
  featureVideo: true,
  featureTextToVideo: true,
  featureImageToVideo: true,
  featureMusic: true,
  featureScript: true,
  featureDocument: true,
  featureSearch: true,
  featureCoding: true,
  featureAppTesting: true,
  modelHydrogen: true,
  modelNeon: true,
  modelImage: true,
  modelVideo: true,
  modelMusic: true,
  quality480p: false,
  quality720p: true,
  quality1080p: true,
  quality4k: true,
  planConfigsJson: '',
  updatedBy: 'system',
  updatedAt: null,
};

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [mediaHistory, setMediaHistory] = useState<MediaHistoryItem[]>([]);
  const [chatsCount, setChatsCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [videoIntent, setVideoIntent] = useState<{
    mode: 'text_to_video' | 'image_to_video';
    section: 'create' | 'history';
  }>({ mode: 'text_to_video', section: 'create' });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('chhotu_theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('chhotu_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('chhotu_theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setAuthReady(true);

      if (!user) {
        setProfile(null);
        setIsAdmin(false);
        return;
      }

      // Check Admin status
      let adminFlag = Boolean(user.emailVerified && user.email === 'cchotumarapo@gmail.com');
      if (!adminFlag) {
        try {
          const adminSnap = await getDoc(doc(db, 'admins', user.uid));
          adminFlag = adminSnap.exists() && Boolean(user.emailVerified);
        } catch {
          adminFlag = false;
        }
      }
      setIsAdmin(adminFlag);

      // Ensure user profile exists
      const userRef = doc(db, 'users', user.uid);
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const starter: Record<string, unknown> = {
            uid: user.uid,
            email: user.email || '',
            displayName: (user.displayName || user.email?.split('@')[0] || 'Chhotu User').slice(0, 100),
            plan: 'free',
            subscriptionStatus: 'active',
            subscriptionExpiresAt: '',
            banned: false,
            imageCredits: 25,
            videoCredits: 5,
            musicCredits: 10,
            dailyVideoLimit: 2,
            monthlyVideoLimit: 10,
            dailyVideosUsed: 0,
            monthlyVideosUsed: 0,
            singleVideoLimitSec: 10,
            dailyVideoLimitSec: 10,
            monthlyVideoLimitSec: 300,
            dailyVideoSecondsUsed: 0,
            monthlyVideoSecondsUsed: 0,
            lastDailyReset: getTodayKey(),
            lastMonthlyReset: getMonthKey(),
            preferredLanguage: 'auto',
            voiceEnabled: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (user.photoURL) {
            starter.photoURL = user.photoURL.slice(0, 500);
          }
          await setDoc(userRef, starter);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }
    });
    return () => unsub();
  }, []);

  // Firestore real-time subscriptions only when signed in
  useEffect(() => {
    if (!authUser) return;

    const unsubProfile = onSnapshot(
      doc(db, 'users', authUser.uid),
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${authUser.uid}`)
    );

    const unsubConfig = onSnapshot(
      doc(db, 'systemConfig', 'global'),
      (snap) => {
        if (snap.exists()) {
          setConfig(snap.data() as SystemConfig);
        }
      },
      () => {
        // Fallback to default config if not created yet
      }
    );

    const unsubMemories = onSnapshot(
      query(collection(db, 'memories'), where('userId', '==', authUser.uid), orderBy('updatedAt', 'desc')),
      (snap) => setMemories(snap.docs.map((d) => d.data() as UserMemory)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'memories')
    );

    const unsubMedia = onSnapshot(
      query(collection(db, 'mediaHistory'), where('userId', '==', authUser.uid), orderBy('createdAt', 'desc')),
      (snap) => setMediaHistory(snap.docs.map((d) => d.data() as MediaHistoryItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'mediaHistory')
    );

    const unsubChats = onSnapshot(
      query(collection(db, 'chats'), where('userId', '==', authUser.uid)),
      (snap) => setChatsCount(snap.size),
      (err) => handleFirestoreError(err, OperationType.LIST, 'chats')
    );

    return () => {
      unsubProfile();
      unsubConfig();
      unsubMemories();
      unsubMedia();
      unsubChats();
    };
  }, [authUser]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] text-sm text-slate-500">
        Initializing Chhotu AI...
      </div>
    );
  }

  if (!authUser) {
    return <AuthView />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] text-sm text-slate-500">
        Loading your Chhotu AI profile...
      </div>
    );
  }

  if (profile.banned) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] p-6">
        <div className="max-w-md w-full rounded-2xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-[#111827] p-8 space-y-4 text-center">
          <h1 className="font-display text-xl font-semibold text-rose-600 dark:text-rose-400">
            Account Suspended
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Your account has been restricted by an administrator. Contact support if you believe this is an error.
          </p>
          <button
            type="button"
            onClick={() => void auth.signOut()}
            className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const navItems: Array<{
    id: AppTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    { id: 'home', label: 'Home', icon: Home, visible: true },
    { id: 'chat', label: 'AI Chat', icon: MessageSquare, visible: config.featureChat },
    { id: 'voice', label: 'Voice AI', icon: Mic, visible: config.featureVoice },
    { id: 'memory', label: 'AI Memory', icon: Brain, visible: config.featureMemory },
    { id: 'image', label: 'Image Studio', icon: ImageIcon, visible: config.featureImage },
    { id: 'video', label: 'Video Studio', icon: Film, visible: config.featureVideo },
    { id: 'music', label: 'Music Studio', icon: Music, visible: config.featureMusic },
    { id: 'script', label: 'Script Writer', icon: PenTool, visible: config.featureScript },
    { id: 'document', label: 'Document AI', icon: FileText, visible: config.featureDocument },
    { id: 'search', label: 'Web Search', icon: Globe, visible: config.featureSearch },
    { id: 'coding', label: 'Coding AI', icon: Code2, visible: config.featureCoding },
    { id: 'testing', label: 'BharatTube Test', icon: Activity, visible: config.featureAppTesting },
    { id: 'subscription', label: 'Plans & Billing', icon: Crown, visible: true },
    { id: 'account', label: 'Account', icon: UserCircle, visible: true },
    { id: 'admin', label: 'Admin Panel', icon: Shield, visible: isAdmin },
  ];

  const navigate = (tab: AppTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const launchVideo = (mode: 'text_to_video' | 'image_to_video', section: 'create' | 'history' = 'create') => {
    setVideoIntent({ mode, section });
    setActiveTab('video');
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1521]">
        <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
          <img
            src="/src/assets/images/chhotu_brand_emblem_1795758198640.jpg"
            alt="Chhotu AI"
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-lg object-cover"
          />
          <span className="font-display text-base font-semibold tracking-tight whitespace-nowrap">
            Chhotu AI
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems
            .filter((n) => n.visible)
            .map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 tabular-nums">
            <span>Credits</span>
            <span className="font-mono text-slate-900 dark:text-white">
              {profile.imageCredits}I · {profile.videoCredits}V · {profile.musicCredits}M
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between"
          >
            <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar (Clean 3-Zone Contract) */}
        <header className="h-14 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1521] flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="font-display text-sm font-semibold text-slate-900 dark:text-white whitespace-nowrap shrink-0">
              {navItems.find((n) => n.id === activeTab)?.label || 'Chhotu AI'}
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => navigate('home')}
              className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => navigate('chat')}
              className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              AI Chat
            </button>
            <button
              type="button"
              onClick={() => navigate('image')}
              className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              Studios
            </button>
            <button
              type="button"
              onClick={() => navigate('video')}
              className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              Video Studio
            </button>
            <button
              type="button"
              onClick={() => navigate('subscription')}
              className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              Plans
            </button>
            <button
              type="button"
              onClick={() => navigate('account')}
              className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
            >
              Account
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate('chat')}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
            >
              New Chat
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative w-64 max-w-[80vw] bg-white dark:bg-[#0F1521] h-full flex flex-col p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold">Chhotu AI</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1">
                {navItems
                  .filter((n) => n.visible)
                  .map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(item.id)}
                        className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2.5 ${
                          activeTab === item.id
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
              </div>
              <button
                type="button"
                onClick={() => setDarkMode((d) => !d)}
                className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between"
              >
                <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'home' && (
            <HomeView
              profile={profile}
              config={config}
              isAdmin={isAdmin}
              onNavigate={navigate}
              onLaunchVideo={launchVideo}
              stats={{
                chats: chatsCount,
                memories: memories.length,
                media: mediaHistory.length,
              }}
            />
          )}

          {(activeTab === 'chat' ||
            activeTab === 'voice' ||
            activeTab === 'script' ||
            activeTab === 'document' ||
            activeTab === 'search' ||
            activeTab === 'coding') && (
            <ChatWorkspace
              profile={profile}
              config={config}
              initialMode={
                activeTab === 'voice'
                  ? 'chat'
                  : (activeTab as 'chat' | 'coding' | 'script' | 'search' | 'document')
              }
              voiceFocus={activeTab === 'voice'}
              memories={memories}
            />
          )}

          {activeTab === 'memory' && <MemoryManager profile={profile} memories={memories} />}

          {(activeTab === 'image' || activeTab === 'video' || activeTab === 'music') && (
            <MediaStudios
              activeStudio={activeTab}
              profile={profile}
              config={config}
              mediaHistory={mediaHistory}
              initialVideoMode={videoIntent.mode}
              initialVideoSection={videoIntent.section}
              onSwitchStudio={(s) => navigate(s)}
              onNavigate={navigate}
            />
          )}

          {activeTab === 'testing' && <AppTestingAssistant profile={profile} />}

          {activeTab === 'subscription' && <SubscriptionView profile={profile} config={config} />}

          {activeTab === 'account' && (
            <AccountView profile={profile} mediaHistory={mediaHistory} chatsCount={chatsCount} />
          )}

          {activeTab === 'admin' && isAdmin && (
            <AdminDashboard adminProfile={profile} config={config} />
          )}
        </main>
      </div>
    </div>
  );
}
