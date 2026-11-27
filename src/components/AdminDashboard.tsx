import React, { useCallback, useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  Crown,
  IndianRupee,
  RefreshCw,
  RotateCcw,
  Shield,
  Sliders,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  DEFAULT_PLANS,
  formatDurationSec,
  formatISTDateTime,
  parsePlansFromConfig,
} from '../lib/plans';
import {
  AuditLog,
  MediaHistoryItem,
  PaymentRecord,
  PlanDefinition,
  PlanId,
  SystemConfig,
  UserProfile,
  VideoJobRecord,
  VideoQuality,
} from '../types';

interface Props {
  adminProfile: UserProfile;
  config: SystemConfig;
}

interface TelemetryData {
  startedAt: string;
  uptimeSeconds: number;
  nodeVersion: string;
  memoryMb: number;
  totalRequests: number;
  totalAiCalls: number;
  totalErrors: number;
  recentErrors: Array<{
    id: string;
    timestamp: string;
    endpoint: string;
    statusCode: number;
    message: string;
  }>;
  geminiConfigured: boolean;
  paymentGatewayConnected?: boolean;
  bharatTubeConnected: boolean;
}

interface FinanceReport {
  totalRevenueInr: number;
  totalRefundedInr: number;
  totalApiCostInr: number;
  failedApiCostInr: number;
  netProfitInr: number;
  costAlertTriggered: boolean;
  costAlertThresholdInr: number;
  payments: PaymentRecord[];
  videoJobs: VideoJobRecord[];
}

export function AdminDashboard({ adminProfile, config }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [totalChats, setTotalChats] = useState(0);
  const [allMedia, setAllMedia] = useState<MediaHistoryItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [finance, setFinance] = useState<FinanceReport | null>(null);
  const [search, setSearch] = useState('');
  const [localConfig, setLocalConfig] = useState<SystemConfig>(config);
  const [plansState, setPlansState] = useState<Record<PlanId, PlanDefinition>>(() =>
    parsePlansFromConfig(config)
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);

  // Selected user credit/limit modal state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userPlan, setUserPlan] = useState<PlanId>('free');
  const [imgDelta, setImgDelta] = useState(0);
  const [vidDelta, setVidDelta] = useState(0);
  const [musDelta, setMusDelta] = useState(0);
  const [singleLimitSec, setSingleLimitSec] = useState(10);
  const [dailyLimitSec, setDailyLimitSec] = useState(10);
  const [monthlyLimitSec, setMonthlyLimitSec] = useState(300);

  useEffect(() => {
    setLocalConfig(config);
    setPlansState(parsePlansFromConfig(config));
  }, [config]);

  const loadBackendReports = useCallback(async () => {
    try {
      const [tel, fin] = await Promise.all([
        apiFetch<TelemetryData>('/api/admin/telemetry'),
        apiFetch<FinanceReport>('/api/admin/finance-report'),
      ]);
      setTelemetry(tel);
      setFinance(fin);
    } catch {
      // Ignore if non-admin or offline
    }
  }, []);

  useEffect(() => {
    void loadBackendReports();

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => setUsers(snap.docs.map((d) => d.data() as UserProfile)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );

    const unsubChats = onSnapshot(
      collection(db, 'chats'),
      (snap) => setTotalChats(snap.size),
      (err) => handleFirestoreError(err, OperationType.LIST, 'chats')
    );

    const unsubMedia = onSnapshot(
      collection(db, 'mediaHistory'),
      (snap) => setAllMedia(snap.docs.map((d) => d.data() as MediaHistoryItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'mediaHistory')
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc')),
      (snap) => setAuditLogs(snap.docs.map((d) => d.data() as AuditLog)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    return () => {
      unsubUsers();
      unsubChats();
      unsubMedia();
      unsubLogs();
    };
  }, [loadBackendReports]);

  const writeAudit = async (action: string, targetId: string, details: string) => {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, 'auditLogs', id), {
      id,
      actorUid: adminProfile.uid,
      actorEmail: adminProfile.email,
      action,
      targetId,
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  };

  const handleSaveSystemConfig = async () => {
    setSavingConfig(true);
    setConfigMsg(null);
    const planConfigsJson = JSON.stringify(plansState);
    try {
      await setDoc(doc(db, 'systemConfig', 'global'), {
        ...localConfig,
        planConfigsJson,
        updatedBy: adminProfile.email,
        updatedAt: serverTimestamp(),
      });

      await apiFetch('/api/admin/sync-config', {
        method: 'POST',
        body: JSON.stringify({
          dailyResetHourIST: localConfig.dailyResetHourIST ?? 0,
          costAlertThresholdInr: localConfig.costAlertThresholdInr ?? 5000,
          featureTextToVideo: localConfig.featureTextToVideo ?? true,
          featureImageToVideo: localConfig.featureImageToVideo ?? true,
          qualityEnabled: {
            '480p': localConfig.quality480p ?? false,
            '720p': localConfig.quality720p ?? true,
            '1080p': localConfig.quality1080p ?? true,
            '4k': localConfig.quality4k ?? true,
          } as Record<VideoQuality, boolean>,
          modelEnabled: {
            'gemini-omni-1.2-flash': localConfig.modelVideo,
          },
          plans: plansState,
        }),
      });

      await writeAudit(
        'UPDATE_SYSTEM_CONFIG',
        'global',
        'Updated global features, 6-tier subscription pricing/limits, quality switches, and cost thresholds'
      );
      setConfigMsg('Global controls & 6-plan governance saved to Firestore and Backend Ledger.');
      void loadBackendReports();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'systemConfig/global');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleBan = async (u: UserProfile) => {
    if (u.uid === adminProfile.uid) return;
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        banned: !u.banned,
        updatedAt: serverTimestamp(),
      });
      await apiFetch('/api/admin/sync-user', {
        method: 'POST',
        body: JSON.stringify({ uid: u.uid, email: u.email, banned: !u.banned }),
      }).catch(() => {});
      await writeAudit(u.banned ? 'UNBAN_USER' : 'BAN_USER', u.uid, `${u.banned ? 'Unbanned' : 'Banned'} ${u.email}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.uid}`);
    }
  };

  const handleSaveUserAdjustments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const batch = writeBatch(db);
    const nextImg = Math.max(0, editingUser.imageCredits + Number(imgDelta));
    const nextVid = Math.max(0, editingUser.videoCredits + Number(vidDelta));
    const nextMus = Math.max(0, editingUser.musicCredits + Number(musDelta));
    const planDef = plansState[userPlan] || DEFAULT_PLANS.free;
    const expiresAt =
      userPlan === 'free'
        ? ''
        : editingUser.subscriptionExpiresAt ||
          new Date(Date.now() + planDef.durationDays * 86400 * 1000).toISOString();

    batch.update(doc(db, 'users', editingUser.uid), {
      plan: userPlan,
      subscriptionStatus: 'active',
      subscriptionExpiresAt: expiresAt,
      imageCredits: nextImg,
      videoCredits: nextVid,
      musicCredits: nextMus,
      singleVideoLimitSec: Math.max(0, Number(singleLimitSec)),
      dailyVideoLimitSec: Math.max(0, Number(dailyLimitSec)),
      monthlyVideoLimitSec: Math.max(0, Number(monthlyLimitSec)),
      updatedAt: serverTimestamp(),
    });

    const jobBase = `adm_${Date.now()}`;
    if (imgDelta !== 0) {
      const id = `${jobBase}_img`;
      batch.set(doc(db, 'creditTransactions', id), {
        id,
        userId: editingUser.uid,
        creditType: 'image',
        action: 'admin_grant',
        delta: Number(imgDelta),
        balanceAfter: nextImg,
        reason: `Admin adjustment by ${adminProfile.email}`,
        jobId: id,
        createdAt: serverTimestamp(),
      });
    }
    if (vidDelta !== 0) {
      const id = `${jobBase}_vid`;
      batch.set(doc(db, 'creditTransactions', id), {
        id,
        userId: editingUser.uid,
        creditType: 'video',
        action: 'admin_grant',
        delta: Number(vidDelta),
        balanceAfter: nextVid,
        reason: `Admin adjustment by ${adminProfile.email}`,
        jobId: id,
        createdAt: serverTimestamp(),
      });
    }
    if (musDelta !== 0) {
      const id = `${jobBase}_mus`;
      batch.set(doc(db, 'creditTransactions', id), {
        id,
        userId: editingUser.uid,
        creditType: 'music',
        action: 'admin_grant',
        delta: Number(musDelta),
        balanceAfter: nextMus,
        reason: `Admin adjustment by ${adminProfile.email}`,
        jobId: id,
        createdAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      await apiFetch('/api/admin/sync-user', {
        method: 'POST',
        body: JSON.stringify({
          uid: editingUser.uid,
          email: editingUser.email,
          plan: userPlan,
          singleVideoLimitSec: Math.max(0, Number(singleLimitSec)),
          dailyVideoLimitSec: Math.max(0, Number(dailyLimitSec)),
          monthlyVideoLimitSec: Math.max(0, Number(monthlyLimitSec)),
          videoCredits: nextVid,
          subscriptionExpiresAt: expiresAt,
        }),
      }).catch(() => {});

      await writeAudit(
        'ADJUST_PLAN_AND_QUOTA',
        editingUser.uid,
        `Updated ${editingUser.email}: plan=${userPlan}, single=${singleLimitSec}s, daily=${dailyLimitSec}s, vidDelta=${vidDelta}`
      );
      setEditingUser(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${editingUser.uid}`);
    }
  };

  const handleAdminRefund = async (paymentId: string) => {
    setRefundingId(paymentId);
    try {
      await apiFetch(`/api/admin/payments/${paymentId}/refund`, { method: 'POST' });
      await writeAudit('PAYMENT_REFUND', paymentId, `Initiated real gateway refund for ${paymentId}`);
      void loadBackendReports();
    } catch (err) {
      setConfigMsg(err instanceof Error ? err.message : 'Refund failed.');
    } finally {
      setRefundingId(null);
    }
  };

  const activeUsers = users.filter((u) => !u.banned).length;
  const totalImages = allMedia.filter((m) => m.type === 'image' && m.status === 'completed').length;
  const totalVideos = allMedia.filter((m) => m.type === 'video' && m.status === 'completed').length;
  const totalMusic = allMedia.filter((m) => m.type === 'music' && m.status === 'completed').length;

  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div>
            <h1 className="font-display text-xl font-semibold">Admin Control &amp; Finance Governance</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Subscription plans, video cost/profit reports, user quotas, quality/model switches, refunds &amp; audit logs.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadBackendReports()}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Telemetry &amp; Finance
        </button>
      </div>

      {/* Cost Alert Threshold Banner */}
      {finance?.costAlertTriggered && (
        <div className="p-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 flex items-center gap-3 text-xs text-rose-800 dark:text-rose-200">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600" />
          <div>
            <strong>API Cost Alert Triggered:</strong> Cumulative API cost (₹{finance.totalApiCostInr}) has crossed your Admin threshold (₹{finance.costAlertThresholdInr}).
          </div>
        </div>
      )}

      {/* Financial Profit/Loss & API Cost Strip */}
      {finance && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <IndianRupee className="w-3 h-3" /> Subscription Revenue
            </div>
            <div className="font-mono text-xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
              ₹{finance.totalRevenueInr.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-[11px] text-slate-500">Total API Expense</div>
            <div className="font-mono text-xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
              ₹{finance.totalApiCostInr.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-[11px] text-slate-500">Failed Gen Waste</div>
            <div className="font-mono text-xl font-semibold text-rose-600 dark:text-rose-400 tabular-nums mt-1">
              ₹{finance.failedApiCostInr.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-[11px] text-slate-500">Total Refunded</div>
            <div className="font-mono text-xl font-semibold text-slate-900 dark:text-white tabular-nums mt-1">
              ₹{finance.totalRefundedInr.toLocaleString('en-IN')}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
            <div className="text-[11px] text-slate-500">Net Profit / Loss</div>
            <div
              className={`font-mono text-xl font-semibold tabular-nums mt-1 ${
                finance.netProfitInr >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {finance.netProfitInr >= 0 ? '+' : '-'}₹{Math.abs(finance.netProfitInr).toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      )}

      {/* Platform KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Total Users', val: users.length },
          { label: 'Active Users', val: activeUsers },
          { label: 'Total Chats', val: totalChats },
          { label: 'Images Gen', val: totalImages },
          { label: 'Videos Gen', val: totalVideos },
          { label: 'Music Gen', val: totalMusic },
          { label: 'AI API Calls', val: telemetry?.totalAiCalls ?? 0 },
          { label: 'API Errors', val: telemetry?.totalErrors ?? 0 },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]"
          >
            <div className="text-[11px] text-slate-500">{kpi.label}</div>
            <div className="font-mono text-xl font-semibold tabular-nums mt-1">{kpi.val}</div>
          </div>
        ))}
      </div>

      {/* Server & Integration Health */}
      {telemetry && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center gap-4 text-xs tabular-nums">
          <span>Server: <strong>Online</strong></span>
          <span aria-hidden="true">·</span>
          <span>Uptime: <strong className="font-mono">{telemetry.uptimeSeconds}s</strong></span>
          <span aria-hidden="true">·</span>
          <span>RSS Memory: <strong className="font-mono">{telemetry.memoryMb} MB</strong></span>
          <span aria-hidden="true">·</span>
          <span>Gemini Key: <strong>{telemetry.geminiConfigured ? 'Configured' : 'Missing'}</strong></span>
          <span aria-hidden="true">·</span>
          <span>Razorpay Payment Gateway: <strong>{telemetry.paymentGatewayConnected ? 'Connected' : 'Not Connected'}</strong></span>
          <span aria-hidden="true">·</span>
          <span>BharatTube Bridge: <strong>{telemetry.bharatTubeConnected ? 'Connected' : 'Not Connected'}</strong></span>
        </div>
      )}

      {/* User Management Table */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold">User, Subscription Plan, Credit &amp; Video Limit Governance</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or name..."
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs w-64"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Plan &amp; Expiry</th>
                <th className="py-2.5 px-4 text-right">Img / Vid / Mus Credits</th>
                <th className="py-2.5 px-4 text-right">Single / Daily Video Limit</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
              {filteredUsers.map((u) => (
                <tr key={u.uid}>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-900 dark:text-white">{u.displayName}</div>
                    <div className="text-[11px] text-slate-500">{u.email}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="capitalize font-medium text-blue-600 dark:text-blue-400">{u.plan}</div>
                    <div className="text-[10px] text-slate-500">{formatISTDateTime(u.subscriptionExpiresAt)}</div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">
                    {u.imageCredits} / {u.videoCredits} / {u.musicCredits}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">
                    {formatDurationSec(u.singleVideoLimitSec ?? 10)} · {formatDurationSec(u.dailyVideoSecondsUsed ?? 0)}/{formatDurationSec(u.dailyVideoLimitSec ?? 10)}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={u.banned ? 'text-rose-600 font-medium' : 'text-emerald-600 font-medium'}>
                      {u.banned ? 'Banned' : 'Active'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingUser(u);
                        setUserPlan(u.plan);
                        setImgDelta(0);
                        setVidDelta(0);
                        setMusDelta(0);
                        setSingleLimitSec(u.singleVideoLimitSec ?? DEFAULT_PLANS[u.plan]?.singleVideoLimitSec ?? 10);
                        setDailyLimitSec(u.dailyVideoLimitSec ?? DEFAULT_PLANS[u.plan]?.dailyVideoLimitSec ?? 10);
                        setMonthlyLimitSec(u.monthlyVideoLimitSec ?? DEFAULT_PLANS[u.plan]?.monthlyVideoLimitSec ?? 300);
                      }}
                      className="px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Edit Plan / Quotas
                    </button>
                    {u.uid !== adminProfile.uid && (
                      <button
                        type="button"
                        onClick={() => void handleToggleBan(u)}
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1"
                      >
                        {u.banned ? <CheckCircle className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                        {u.banned ? 'Unban' : 'Ban'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveUserAdjustments}
            className="max-w-lg w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4"
          >
            <h3 className="font-display text-base font-semibold">
              Manage Plan &amp; Quotas: {editingUser.displayName}
            </h3>

            <div className="text-xs space-y-1">
              <label className="text-slate-500">Assign Subscription Plan</label>
              <select
                value={userPlan}
                onChange={(e) => {
                  const p = e.target.value as PlanId;
                  setUserPlan(p);
                  const def = plansState[p] || DEFAULT_PLANS.free;
                  setSingleLimitSec(def.singleVideoLimitSec);
                  setDailyLimitSec(def.dailyVideoLimitSec);
                  setMonthlyLimitSec(def.monthlyVideoLimitSec);
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 capitalize"
              >
                {(['free', 'basic', 'standard', 'pro', 'premium', 'ultra'] as PlanId[]).map((pid) => (
                  <option key={pid} value={pid}>
                    {plansState[pid].name} (₹{plansState[pid].priceInr} · {formatDurationSec(plansState[pid].singleVideoLimitSec)} single / {formatDurationSec(plansState[pid].dailyVideoLimitSec)} daily)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-slate-500">Image Delta (+/-)</label>
                <input
                  type="number"
                  value={imgDelta}
                  onChange={(e) => setImgDelta(Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-500">Video Delta (+/-)</label>
                <input
                  type="number"
                  value={vidDelta}
                  onChange={(e) => setVidDelta(Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-500">Music Delta (+/-)</label>
                <input
                  type="number"
                  value={musDelta}
                  onChange={(e) => setMusDelta(Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-slate-500">Single Limit (sec)</label>
                <input
                  type="number"
                  min={0}
                  value={singleLimitSec}
                  onChange={(e) => setSingleLimitSec(Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-500">Daily Limit (sec)</label>
                <input
                  type="number"
                  min={0}
                  value={dailyLimitSec}
                  onChange={(e) => setDailyLimitSec(Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
              <div>
                <label className="text-slate-500">Monthly Limit (sec)</label>
                <input
                  type="number"
                  min={0}
                  value={monthlyLimitSec}
                  onChange={(e) => setMonthlyLimitSec(Number(e.target.value))}
                  className="w-full mt-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium"
              >
                Apply Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 6 Subscription Plans Editor + Features, Qualities & Models Governance */}
      <section className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-display text-sm font-semibold">
            <Sliders className="w-4 h-4 text-blue-600" />
            Subscription Plans, Video Modes, Qualities, IST Reset &amp; Cost Alert Controls
          </div>
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveSystemConfig()}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
          >
            {savingConfig ? 'Saving...' : 'Save Global Governance'}
          </button>
        </div>

        {configMsg && (
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-700 dark:text-blue-300">
            {configMsg}
          </div>
        )}

        {/* Global Cost Alert & IST Reset */}
        <div className="grid sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-500">Daily Limit Reset Hour (IST 0–23)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={localConfig.dailyResetHourIST ?? 0}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, dailyResetHourIST: Math.min(23, Math.max(0, Number(e.target.value))) })
              }
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
            />
          </div>
          <div>
            <label className="text-slate-500">API Cost Alert Threshold (INR)</label>
            <input
              type="number"
              min={0}
              value={localConfig.costAlertThresholdInr ?? 5000}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, costAlertThresholdInr: Math.max(0, Number(e.target.value)) })
              }
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
            />
          </div>
        </div>

        {/* 6 Plan Pricing & Limits Editor Table */}
        <div className="space-y-2">
          <div className="text-xs font-semibold flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
            <Crown className="w-3.5 h-3.5 text-blue-600" />
            Subscription Plan Pricing, Duration Limits (sec) &amp; ON/OFF
          </div>
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-500">
                <tr>
                  <th className="py-2 px-3">Plan</th>
                  <th className="py-2 px-3">Price (₹)</th>
                  <th className="py-2 px-3">Single Limit (s)</th>
                  <th className="py-2 px-3">Daily Limit (s)</th>
                  <th className="py-2 px-3">Credits Included</th>
                  <th className="py-2 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(['free', 'basic', 'standard', 'pro', 'premium', 'ultra'] as PlanId[]).map((pid) => {
                  const p = plansState[pid];
                  return (
                    <tr key={pid}>
                      <td className="py-2 px-3 font-medium">{p.name}</td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min={0}
                          value={p.priceInr}
                          onChange={(e) =>
                            setPlansState((prev) => ({
                              ...prev,
                              [pid]: { ...prev[pid], priceInr: Math.max(0, Number(e.target.value)) },
                            }))
                          }
                          className="w-24 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min={10}
                          value={p.singleVideoLimitSec}
                          onChange={(e) =>
                            setPlansState((prev) => ({
                              ...prev,
                              [pid]: { ...prev[pid], singleVideoLimitSec: Math.max(10, Number(e.target.value)) },
                            }))
                          }
                          className="w-24 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min={10}
                          value={p.dailyVideoLimitSec}
                          onChange={(e) =>
                            setPlansState((prev) => ({
                              ...prev,
                              [pid]: { ...prev[pid], dailyVideoLimitSec: Math.max(10, Number(e.target.value)) },
                            }))
                          }
                          className="w-24 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min={0}
                          value={p.includedVideoCredits}
                          onChange={(e) =>
                            setPlansState((prev) => ({
                              ...prev,
                              [pid]: { ...prev[pid], includedVideoCredits: Math.max(0, Number(e.target.value)) },
                            }))
                          }
                          className="w-20 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setPlansState((prev) => ({
                              ...prev,
                              [pid]: { ...prev[pid], enabled: !prev[pid].enabled },
                            }))
                          }
                          className={`px-2.5 py-1 rounded font-mono font-semibold ${
                            p.enabled
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-600/40'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}
                        >
                          {p.enabled ? 'ON' : 'OFF'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* All Feature, Video Mode, Quality & Model Switches */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
          {(
            [
              ['featureChat', 'AI Chat'],
              ['featureVoice', 'Voice AI'],
              ['featureMemory', 'AI Memory'],
              ['featureImage', 'Image Generator'],
              ['featureVideo', 'Video Generator'],
              ['featureTextToVideo', 'Mode: Text to Video'],
              ['featureImageToVideo', 'Mode: Image to Video'],
              ['featureMusic', 'Music Generator'],
              ['featureScript', 'Script Writer'],
              ['featureDocument', 'Document AI'],
              ['featureSearch', 'Internet Search'],
              ['featureCoding', 'Coding Assistant'],
              ['featureAppTesting', 'BharatTube Testing'],
              ['modelHydrogen', 'Model: Hydrogen'],
              ['modelNeon', 'Model: Neon'],
              ['modelImage', 'Model: Image Engine'],
              ['modelVideo', 'Model: Omni Video'],
              ['modelMusic', 'Model: Lyria Music'],
              ['quality480p', 'Quality: 480p'],
              ['quality720p', 'Quality: 720p HD'],
              ['quality1080p', 'Quality: 1080p Full HD'],
              ['quality4k', 'Quality: 4K Ultra HD'],
            ] as Array<[keyof SystemConfig, string]>
          ).map(([key, label]) => {
            const val = localConfig[key] ?? true;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setLocalConfig({ ...localConfig, [key]: !val })}
                className={`px-3 py-2 rounded-lg border flex items-center justify-between ${
                  val
                    ? 'border-emerald-600/50 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                    : 'border-slate-200 dark:border-slate-800 text-slate-500'
                }`}
              >
                <span>{label}</span>
                <span className="font-mono font-semibold">{val ? 'ON' : 'OFF'}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Payments, Refunds & Recent Video Jobs */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
            Subscription Payments &amp; Refunds ({finance?.payments.length ?? 0})
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {!finance?.payments.length ? (
              <div className="p-6 text-center text-slate-500">No subscription payment orders yet.</div>
            ) : (
              finance.payments.map((p) => (
                <div key={p.id} className="p-3 flex items-center justify-between gap-2 tabular-nums">
                  <div>
                    <div className="font-medium">
                      {p.invoiceNumber} · <span className="capitalize">{p.planId}</span> (₹{p.amountInr})
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.userEmail} · Status: <span className="uppercase font-semibold">{p.status}</span>
                    </div>
                  </div>
                  {p.status === 'paid' && (
                    <button
                      type="button"
                      disabled={refundingId === p.id}
                      onClick={() => void handleAdminRefund(p.id)}
                      className="px-2.5 py-1 rounded border border-rose-300 dark:border-rose-800 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {refundingId === p.id ? 'Refunding...' : 'Refund'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
            Video Jobs &amp; Failure Refund Log ({finance?.videoJobs.length ?? 0})
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {!finance?.videoJobs.length ? (
              <div className="p-6 text-center text-slate-500">No video jobs queued yet.</div>
            ) : (
              finance.videoJobs.map((j) => (
                <div key={j.id} className="p-3 space-y-1 tabular-nums">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span>
                      {j.mode === 'image_to_video' ? 'I2V' : 'T2V'} · {formatDurationSec(j.durationSec)} · {j.quality}
                    </span>
                    <span
                      className={
                        j.status === 'completed'
                          ? 'text-emerald-600'
                          : j.status === 'failed' || j.status === 'partial_failed'
                            ? 'text-rose-600'
                            : 'text-blue-600'
                      }
                    >
                      {j.status} · API ₹{j.estimatedApiCostInr}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 line-clamp-1">{j.prompt}</p>
                  {j.creditsRefunded > 0 && (
                    <div className="text-[11px] text-amber-600">
                      Auto-refunded {j.creditsRefunded} video credits on failure
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* API Errors & Security Audit Logs */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
            Recent Server API Errors ({telemetry?.recentErrors.length ?? 0})
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {!telemetry || telemetry.recentErrors.length === 0 ? (
              <div className="p-6 text-center text-slate-500">No recent API errors logged.</div>
            ) : (
              telemetry.recentErrors.map((er) => (
                <div key={er.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between font-mono text-[11px] text-rose-600 dark:text-rose-400">
                    <span>{er.endpoint} · HTTP {er.statusCode}</span>
                    <span>{er.timestamp.slice(11, 19)}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 break-words">{er.message}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
            Admin &amp; Security Audit Logs ({auditLogs.length})
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {auditLogs.length === 0 ? (
              <div className="p-6 text-center text-slate-500">No audit entries yet.</div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between font-mono text-[11px] text-blue-600 dark:text-blue-400">
                    <span>{log.action}</span>
                    <span>{log.actorEmail}</span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-300">{log.details}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
