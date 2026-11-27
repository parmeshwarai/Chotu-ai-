import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { Activity, CheckCircle2, Database, Play, Server, ShieldAlert, Smartphone } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { BharatTubeCheck, UserProfile } from '../types';

interface Props {
  profile: UserProfile;
}

interface ProbeResponse {
  connected: boolean;
  status: string;
  targetUrl: string;
  serverStatus: string;
  dbStatus: string;
  uploadTestStatus: string;
  playbackTestStatus: string;
  admobStatus: string;
  bridgeAuthConfigured: boolean;
  errorReport: string;
}

export function AppTestingAssistant({ profile }: Props) {
  const [targetUrl, setTargetUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [latestResult, setLatestResult] = useState<ProbeResponse | null>(null);
  const [history, setHistory] = useState<BharatTubeCheck[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'bharatTubeChecks'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => setHistory(snap.docs.map((d) => d.data() as BharatTubeCheck)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'bharatTubeChecks')
    );
    return () => unsub();
  }, [profile.uid]);

  const runProbe = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setRunning(true);
    try {
      const res = await apiFetch<ProbeResponse>('/api/bharattube/test', {
        method: 'POST',
        body: JSON.stringify({ targetUrl: targetUrl.trim() }),
      });
      setLatestResult(res);

      const id = `bt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'bharatTubeChecks', id), {
        id,
        userId: profile.uid,
        targetUrl: res.targetUrl.slice(0, 300),
        serverStatus: res.serverStatus.slice(0, 80),
        dbStatus: res.dbStatus.slice(0, 80),
        uploadTestStatus: res.uploadTestStatus.slice(0, 80),
        playbackTestStatus: res.playbackTestStatus.slice(0, 80),
        admobStatus: res.admobStatus.slice(0, 80),
        errorReport: res.errorReport.slice(0, 2000),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h1 className="font-display text-xl font-semibold">BharatTube Integration & Testing Assistant</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real HTTP health probing, database checks, upload/playback verification, AdMob inspection, and Admin Bridge diagnostics.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            Bridge Status: {latestResult?.connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        <form onSubmit={runProbe} className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://api.bharattube.example.com (leave empty to test server BHARATTUBE_API_URL)"
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
          />
          <button
            type="submit"
            disabled={running}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {running ? 'Running Probe...' : 'Run Live Diagnostic'}
          </button>
        </form>

        {error && (
          <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>

      {latestResult && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Server Status', val: latestResult.serverStatus, icon: Server },
            { label: 'Database Status', val: latestResult.dbStatus, icon: Database },
            { label: 'Upload Endpoint', val: latestResult.uploadTestStatus, icon: CheckCircle2 },
            { label: 'Playback Stream', val: latestResult.playbackTestStatus, icon: Play },
            { label: 'AdMob Config', val: latestResult.admobStatus, icon: Smartphone },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2"
              >
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{card.label}</span>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="font-mono text-xs font-semibold text-slate-900 dark:text-white break-words">
                  {card.val}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {latestResult && (
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            Diagnostic Error & Integration Report
          </div>
          <p className="text-xs font-mono text-slate-600 dark:text-slate-300 leading-relaxed">
            {latestResult.errorReport}
          </p>
        </div>
      )}

      {/* Secure Bridge Contract Documentation */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-3">
        <h2 className="font-display text-base font-semibold">BharatTube Secure Backend Bridge Architecture</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Configure <code className="font-mono">BHARATTUBE_API_URL</code> and{' '}
          <code className="font-mono">BHARATTUBE_BRIDGE_SECRET</code> in Settings &gt; Secrets to connect BharatTube&apos;s
          Admin Panel directly to Chhotu AI&apos;s authenticated machine-to-machine endpoint:
        </p>
        <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono overflow-x-auto">
{`POST /api/bharattube/bridge
Authorization: Bearer <BHARATTUBE_BRIDGE_SECRET>
Content-Type: application/json

{ "action": "ping" | "analyze_error", "payload": { "service": "upload-worker", "error": "..." } }`}
        </pre>
      </div>

      {/* Diagnostic History */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
          Diagnostic Probe History ({history.length})
        </div>
        {history.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No diagnostic runs saved yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Target</th>
                  <th className="py-2.5 px-4">Server</th>
                  <th className="py-2.5 px-4">Database</th>
                  <th className="py-2.5 px-4">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2.5 px-4 font-mono">{h.targetUrl}</td>
                    <td className="py-2.5 px-4">{h.serverStatus}</td>
                    <td className="py-2.5 px-4">{h.dbStatus}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{h.errorReport}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
