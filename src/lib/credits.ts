import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { getISTDateKey, getISTMonthKey } from './plans';
import { MediaHistoryItem, UserProfile } from '../types';

export function getTodayKey(resetHourIST = 0): string {
  return getISTDateKey(resetHourIST);
}

export function getMonthKey(): string {
  return getISTMonthKey();
}

export function createJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function deductCreditsAtomic(params: {
  uid: string;
  creditType: 'image' | 'video' | 'music';
  cost: number;
  durationSec?: number;
  resetHourIST?: number;
  jobId: string;
  reason: string;
}): Promise<{ balanceAfter: number }> {
  const { uid, creditType, cost, durationSec = 0, resetHourIST = 0, jobId, reason } = params;
  const userRef = doc(db, 'users', uid);
  const txId = `deduct_${jobId}`;
  const txRef = doc(db, 'creditTransactions', txId);

  try {
    return await runTransaction(db, async (tx) => {
      const existingTx = await tx.get(txRef);
      if (existingTx.exists()) {
        throw new Error('Duplicate credit deduction prevented for this generation job.');
      }

      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('User profile not found.');
      }

      const profile = userSnap.data() as UserProfile;
      if (profile.banned) {
        throw new Error('This account is suspended. Generation is disabled.');
      }

      const today = getISTDateKey(resetHourIST);
      const month = getISTMonthKey();
      let dailyUsed = profile.lastDailyReset === today ? profile.dailyVideosUsed : 0;
      let monthlyUsed = profile.lastMonthlyReset === month ? profile.monthlyVideosUsed : 0;
      let dailySecUsed = profile.lastDailyReset === today ? (profile.dailyVideoSecondsUsed ?? 0) : 0;
      let monthlySecUsed = profile.lastMonthlyReset === month ? (profile.monthlyVideoSecondsUsed ?? 0) : 0;

      if (creditType === 'video') {
        const singleLimitSec = profile.singleVideoLimitSec ?? 10;
        const dailyLimitSec = profile.dailyVideoLimitSec ?? 10;
        if (durationSec > singleLimitSec) {
          throw new Error(
            `Requested duration (${durationSec}s) exceeds your plan's single video limit (${singleLimitSec}s).`
          );
        }
        if (dailySecUsed + durationSec > dailyLimitSec) {
          throw new Error(
            `Daily video limit reached (${dailySecUsed}s / ${dailyLimitSec}s used today in IST).`
          );
        }
        dailyUsed += 1;
        monthlyUsed += 1;
        dailySecUsed += durationSec;
        monthlySecUsed += durationSec;
      }

      const fieldMap = {
        image: 'imageCredits',
        video: 'videoCredits',
        music: 'musicCredits',
      } as const;

      const currentBalance = profile[fieldMap[creditType]];
      if (currentBalance < cost) {
        throw new Error(
          `Insufficient ${creditType} credits (${currentBalance} available, ${cost} required).`
        );
      }

      const balanceAfter = currentBalance - cost;

      tx.update(userRef, {
        [fieldMap[creditType]]: balanceAfter,
        dailyVideosUsed: dailyUsed,
        monthlyVideosUsed: monthlyUsed,
        dailyVideoSecondsUsed: dailySecUsed,
        monthlyVideoSecondsUsed: monthlySecUsed,
        lastDailyReset: today,
        lastMonthlyReset: month,
        lastTxId: txId,
        updatedAt: serverTimestamp(),
      });

      tx.set(txRef, {
        id: txId,
        userId: uid,
        creditType,
        action: 'deduct',
        delta: -cost,
        balanceAfter,
        reason: reason.slice(0, 200),
        jobId,
        createdAt: serverTimestamp(),
      });

      return { balanceAfter };
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('Insufficient') ||
        err.message.includes('limit') ||
        err.message.includes('exceeds') ||
        err.message.includes('Duplicate') ||
        err.message.includes('suspended'))
    ) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}

export async function refundCreditsAtomic(params: {
  uid: string;
  creditType: 'image' | 'video' | 'music';
  cost: number;
  durationSec?: number;
  jobId: string;
  reason: string;
}): Promise<void> {
  const { uid, creditType, cost, durationSec = 0, jobId, reason } = params;
  const userRef = doc(db, 'users', uid);
  const deductRef = doc(db, 'creditTransactions', `deduct_${jobId}`);
  const refundId = `refund_${jobId}`;
  const refundRef = doc(db, 'creditTransactions', refundId);

  try {
    const [deductSnap, refundSnap, userSnap] = await Promise.all([
      getDoc(deductRef),
      getDoc(refundRef),
      getDoc(userRef),
    ]);

    if (!deductSnap.exists() || refundSnap.exists() || !userSnap.exists()) {
      return;
    }

    const profile = userSnap.data() as UserProfile;
    const fieldMap = {
      image: 'imageCredits',
      video: 'videoCredits',
      music: 'musicCredits',
    } as const;

    const newBalance = profile[fieldMap[creditType]] + cost;
    const batch = writeBatch(db);

    batch.set(refundRef, {
      id: refundId,
      userId: uid,
      creditType,
      action: 'refund',
      delta: cost,
      balanceAfter: newBalance,
      reason: reason.slice(0, 200),
      jobId,
      createdAt: serverTimestamp(),
    });

    batch.update(userRef, {
      [fieldMap[creditType]]: newBalance,
      dailyVideosUsed: creditType === 'video' ? Math.max(0, profile.dailyVideosUsed - 1) : profile.dailyVideosUsed,
      monthlyVideosUsed: creditType === 'video' ? Math.max(0, profile.monthlyVideosUsed - 1) : profile.monthlyVideosUsed,
      dailyVideoSecondsUsed:
        creditType === 'video' ? Math.max(0, (profile.dailyVideoSecondsUsed ?? 0) - durationSec) : (profile.dailyVideoSecondsUsed ?? 0),
      monthlyVideoSecondsUsed:
        creditType === 'video' ? Math.max(0, (profile.monthlyVideoSecondsUsed ?? 0) - durationSec) : (profile.monthlyVideoSecondsUsed ?? 0),
      lastTxId: refundId,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `creditTransactions/${refundId}`);
  }
}

export async function recordMediaHistory(item: Omit<MediaHistoryItem, 'createdAt'>): Promise<void> {
  const ref = doc(db, 'mediaHistory', item.id);
  const batch = writeBatch(db);
  batch.set(ref, {
    ...item,
    createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `mediaHistory/${item.id}`);
  }
}
