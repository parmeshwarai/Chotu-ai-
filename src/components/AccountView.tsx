import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Check, LogOut, Save, UserCheck } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { formatDurationSec, formatISTDateTime, getEffectiveLimits } from '../lib/plans';
import { CreditTransaction, MediaHistoryItem, UserProfile } from '../types';

interface Props {
  profile: UserProfile;
  mediaHistory: MediaHistoryItem[];
  chatsCount: number;
}

export function AccountView({ profile, mediaHistory, chatsCount }: Props) {
  const effective = getEffectiveLimits(profile);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [preferredLanguage, setPreferredLanguage] = useState(profile.preferredLanguage);
  const [voiceEnabled, setVoiceEnabled] = useState(profile.voiceEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [avatarErr, setAvatarErr] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'creditTransactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => setTransactions(snap.docs.map((d) => d.data() as CreditTransaction)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'creditTransactions')
    );
    return () => unsub();
  }, [profile.uid]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: displayName.trim().slice(0, 100),
        preferredLanguage,
        voiceEnabled,
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Profile Header */}
      <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img
            src={
              !avatarErr && profile.photoURL
                ? profile.photoURL
                : '/src/assets/images/avatar_user_default_1795758199622.jpg'
            }
            alt={profile.displayName}
            referrerPolicy="no-referrer"
            onError={() => setAvatarErr(true)}
            className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700"
          />
          <div className="space-y-1">
            <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              {profile.displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{profile.email}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize font-medium text-blue-600 dark:text-blue-400">{profile.plan} Plan</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{chatsCount} Chats</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{mediaHistory.length} Media Items</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOut(auth)}
          className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium inline-flex items-center gap-2"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>

      {/* Credit & Quota Summary */}
      <div className="grid sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Image Credits</div>
          <div className="font-mono text-2xl font-semibold tabular-nums mt-1">{profile.imageCredits}</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Video Credits</div>
          <div className="font-mono text-2xl font-semibold tabular-nums mt-1">{profile.videoCredits}</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Music Credits</div>
          <div className="font-mono text-2xl font-semibold tabular-nums mt-1">{profile.musicCredits}</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
          <div className="text-xs text-slate-500">Daily Video Limit (IST) &amp; Expiry</div>
          <div className="font-mono text-xl font-semibold tabular-nums mt-1">
            {formatDurationSec(effective.dailySecondsUsed)} / {formatDurationSec(effective.dailyVideoLimitSec)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
            {formatISTDateTime(profile.subscriptionExpiresAt)}
          </div>
        </div>
      </div>

      {/* Account Settings */}
      <form
        onSubmit={handleSave}
        className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4"
      >
        <div className="flex items-center gap-2 font-display text-base font-semibold">
          <UserCheck className="w-4 h-4 text-blue-600" />
          Account Settings
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Preferred Language</label>
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value as UserProfile['preferredLanguage'])}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            >
              <option value="auto">Auto Detect (Hi/En/Bho)</option>
              <option value="hi">Hindi</option>
              <option value="en">English</option>
              <option value="bho">Bhojpuri</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Voice Response Default</label>
            <button
              type="button"
              onClick={() => setVoiceEnabled((v) => !v)}
              className={`w-full px-3.5 py-2 rounded-xl border text-sm font-medium ${
                voiceEnabled
                  ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {voiceEnabled ? 'Voice ON by Default' : 'Voice OFF by Default'}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saved ? 'Saved' : 'Save Settings'}
        </button>
      </form>

      {/* Immutable Credit Ledger */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
          Credit History Ledger ({transactions.length})
        </div>
        {transactions.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">No credit transactions recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4 text-right">Delta</th>
                  <th className="py-2.5 px-4 text-right">Balance After</th>
                  <th className="py-2.5 px-4">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="py-2.5 px-4 capitalize font-medium">{tx.action.replace('_', ' ')}</td>
                    <td className="py-2.5 px-4 capitalize">{tx.creditType}</td>
                    <td className={`py-2.5 px-4 text-right font-mono ${tx.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {tx.delta >= 0 ? `+${tx.delta}` : tx.delta}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">{tx.balanceAfter}</td>
                    <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{tx.reason}</td>
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
