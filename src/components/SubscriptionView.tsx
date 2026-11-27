import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CreditCard,
  Crown,
  Download,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { apiFetch } from '../lib/api';
import { db } from '../lib/firebase';
import {
  formatDurationSec,
  formatISTDateTime,
  getEffectiveLimits,
  parsePlansFromConfig,
} from '../lib/plans';
import {
  PaymentRecord,
  PlanDefinition,
  PlanId,
  SystemConfig,
  UserProfile,
} from '../types';

interface Props {
  profile: UserProfile;
  config: SystemConfig;
}

interface PaymentConfigResponse {
  gateway: string;
  connected: boolean;
  keyId: string | null;
  upiVpa: string | null;
  plans: Record<PlanId, PlanDefinition>;
  payments: PaymentRecord[];
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (resp: Record<string, unknown>) => void) => void;
    };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function SubscriptionView({ profile, config }: Props) {
  const [payConfig, setPayConfig] = useState<PaymentConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingPlan, setProcessingPlan] = useState<PlanId | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPaymentConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PaymentConfigResponse>('/api/payments/config');
      setPayConfig(data);
    } catch {
      // Fallback safely to Firestore config
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPaymentConfig();
  }, [loadPaymentConfig]);

  const effective = getEffectiveLimits(profile, config);
  const plansMap = payConfig?.plans || parsePlansFromConfig(config);
  const orderedPlans: PlanDefinition[] = (['free', 'basic', 'standard', 'pro', 'premium', 'ultra'] as PlanId[]).map(
    (id) => ({
      ...parsePlansFromConfig(config)[id],
      ...(plansMap[id] || {}),
    })
  );

  const handleSubscribe = async (plan: PlanDefinition) => {
    setError(null);
    setNotice(null);

    if (!plan.enabled) {
      setError(`${plan.name} is currently disabled by Admin.`);
      return;
    }
    if (plan.id === 'free') {
      setNotice('You already have access to the Free Plan.');
      return;
    }
    if (!payConfig?.connected) {
      setError(
        'Payment Gateway NOT CONNECTED. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Settings > Secrets to accept real UPI & Card payments.'
      );
      return;
    }

    setProcessingPlan(plan.id);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        throw new Error('Could not load Razorpay Checkout SDK.');
      }

      const order = await apiFetch<{
        orderId: string;
        amountPaise: number;
        currency: string;
        keyId: string;
        paymentRecordId: string;
      }>('/api/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({ planId: plan.id }),
      });

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Chhotu AI Studio',
        description: `${plan.name} — 30 Days Video Subscription`,
        order_id: order.orderId,
        prefill: {
          name: profile.displayName,
          email: profile.email,
        },
        theme: { color: '#2563EB' },
        handler: async (response: {
          razorpay_order_id?: string;
          razorpay_payment_id?: string;
          razorpay_signature?: string;
        }) => {
          try {
            const verified = await apiFetch<{
              ok: boolean;
              payment: PaymentRecord;
              quota: {
                plan: PlanId;
                subscriptionExpiresAt: string;
                singleVideoLimitSec: number;
                dailyVideoLimitSec: number;
                monthlyVideoLimitSec: number;
                videoCredits: number;
              };
            }>('/api/payments/verify', {
              method: 'POST',
              body: JSON.stringify(response),
            });

            // Sync payment record & quota to Firestore
            await setDoc(doc(db, 'payments', verified.payment.id), {
              ...verified.payment,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }).catch(() => {});

            await updateDoc(doc(db, 'users', profile.uid), {
              plan: verified.quota.plan,
              subscriptionStatus: 'active',
              subscriptionExpiresAt: verified.quota.subscriptionExpiresAt,
              singleVideoLimitSec: verified.quota.singleVideoLimitSec,
              dailyVideoLimitSec: verified.quota.dailyVideoLimitSec,
              monthlyVideoLimitSec: verified.quota.monthlyVideoLimitSec,
              videoCredits: verified.quota.videoCredits,
              updatedAt: serverTimestamp(),
            }).catch(() => {});

            setNotice(
              `${plan.name} activated for 30 days! Invoice ${verified.payment.invoiceNumber} generated.`
            );
            void loadPaymentConfig();
          } catch (verifyErr) {
            setError(
              verifyErr instanceof Error ? verifyErr.message : 'Payment signature verification failed.'
            );
          } finally {
            setProcessingPlan(null);
          }
        },
        modal: {
          ondismiss: () => {
            setProcessingPlan(null);
          },
        },
      });

      rzp.on('payment.failed', (failResp) => {
        const desc =
          (failResp?.error as { description?: string } | undefined)?.description ||
          'Payment failed at gateway';
        void apiFetch('/api/payments/mark-failed', {
          method: 'POST',
          body: JSON.stringify({ razorpay_order_id: order.orderId, reason: desc }),
        }).catch(() => {});
        setError(`Payment failed: ${desc}`);
        setProcessingPlan(null);
        void loadPaymentConfig();
      });

      rzp.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start payment.');
      setProcessingPlan(null);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/api/payments/cancel', { method: 'POST' });
      await updateDoc(doc(db, 'users', profile.uid), {
        subscriptionStatus: 'cancelled',
        plan: 'free',
        singleVideoLimitSec: 10,
        dailyVideoLimitSec: 10,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      setNotice('Subscription cancelled. Account reverted to Free Plan (10s single / 10s daily).');
      void loadPaymentConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel subscription.');
    } finally {
      setCancelling(false);
    }
  };

  const handleDownloadInvoice = (p: PaymentRecord) => {
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice ${p.invoiceNumber}</title>
<style>body{font-family:sans-serif;max-width:680px;margin:40px auto;color:#111}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #ddd;padding:10px;text-align:left}</style>
</head><body>
<h2>Chhotu AI — Subscription Tax Invoice</h2>
<p><strong>Invoice No:</strong> ${p.invoiceNumber}<br>
<strong>Customer:</strong> ${p.userEmail}<br>
<strong>Status:</strong> ${p.status.toUpperCase()}<br>
<strong>Order ID:</strong> ${p.orderId}<br>
<strong>Payment ID:</strong> ${p.paymentId || 'N/A'}</p>
<table><thead><tr><th>Plan</th><th>Validity</th><th>Amount (INR)</th></tr></thead>
<tbody><tr><td style="text-transform:capitalize">${p.planId} Plan</td><td>30 Days</td><td>₹${p.amountInr}</td></tr></tbody></table>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.invoiceNumber}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Active Subscription & Quota Summary */}
      <section className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Crown className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <div>
              <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
                Video Subscription Plans &amp; Billing
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real 30-day subscriptions with backend IST daily limits, invoices, and instant verification.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPaymentConfig()}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Status
            </button>
            {effective.activePlanId !== 'free' && (
              <button
                type="button"
                disabled={cancelling}
                onClick={() => void handleCancelSubscription()}
                className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <XCircle className="w-3.5 h-3.5" />
                {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs tabular-nums">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Current Plan</div>
            <div className="font-semibold capitalize text-blue-600 dark:text-blue-400 mt-0.5">
              {effective.activePlanId} ({effective.expired ? 'Expired' : profile.subscriptionStatus || 'Active'})
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Expiry Date (IST)</div>
            <div className="font-medium mt-0.5 truncate">{formatISTDateTime(profile.subscriptionExpiresAt)}</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Single Video Limit</div>
            <div className="font-mono font-semibold mt-0.5">{formatDurationSec(effective.singleVideoLimitSec)}</div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Daily Used / Limit</div>
            <div className="font-mono font-semibold mt-0.5">
              {formatDurationSec(effective.dailySecondsUsed)} / {formatDurationSec(effective.dailyVideoLimitSec)}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
            <div className="text-[11px] text-slate-500">Available Video Credits</div>
            <div className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {profile.videoCredits}
            </div>
          </div>
        </div>

        {/* Payment Gateway Connection Status */}
        {!loading && (
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs ${
              payConfig?.connected
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
            }`}
          >
            {payConfig?.connected ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-semibold">
                {payConfig?.connected
                  ? 'Razorpay UPI & Card Gateway: CONNECTED'
                  : 'Payment Gateway: NOT CONNECTED'}
              </div>
              <p>
                {payConfig?.connected
                  ? `Real Razorpay payments enabled${payConfig.upiVpa ? ` (UPI VPA: ${payConfig.upiVpa})` : ''}. Every verified payment generates an invoice and activates your plan for 30 days.`
                  : 'Fake payments are strictly disabled. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Settings > Secrets to activate live UPI / Card subscriptions.'}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}
      </section>

      {/* 6 Subscription Plans Grid */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {orderedPlans.map((plan) => {
          const isCurrent = effective.activePlanId === plan.id && !effective.expired;
          const isBusy = processingPlan === plan.id;
          return (
            <div
              key={plan.id}
              className={`p-5 rounded-2xl border flex flex-col justify-between space-y-5 bg-white dark:bg-[#111827] ${
                isCurrent
                  ? 'border-blue-600 dark:border-blue-500'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {plan.name}
                  </h2>
                  {isCurrent && (
                    <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                      Current Plan
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-1.5 tabular-nums">
                  <span className="font-display text-3xl font-bold text-slate-900 dark:text-white">
                    ₹{plan.priceInr.toLocaleString('en-IN')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {plan.durationDays > 0 ? `/ ${plan.durationDays} Days` : 'Forever Free'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 text-xs tabular-nums">
                  <div>
                    <div className="text-[10px] text-slate-500">Single Video</div>
                    <div className="font-mono font-semibold">{formatDurationSec(plan.singleVideoLimitSec)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500">Daily Limit</div>
                    <div className="font-mono font-semibold">{formatDurationSec(plan.dailyVideoLimitSec)}</div>
                  </div>
                </div>

                <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  <li className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>Includes {plan.includedVideoCredits} Video Credits</span>
                  </li>
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                disabled={
                  !plan.enabled ||
                  isBusy ||
                  (plan.id === 'free' && isCurrent) ||
                  (plan.id !== 'free' && !payConfig?.connected)
                }
                onClick={() => void handleSubscribe(plan)}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${
                  isCurrent && plan.id === 'free'
                    ? 'border border-slate-200 dark:border-slate-700 text-slate-500'
                    : !plan.enabled
                      ? 'border border-slate-200 dark:border-slate-800 text-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {isBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CreditCard className="w-3.5 h-3.5" />
                )}
                {!plan.enabled
                  ? 'Disabled by Admin'
                  : plan.id === 'free'
                    ? isCurrent
                      ? 'Active Free Plan'
                      : 'Free Tier'
                    : !payConfig?.connected
                      ? 'Gateway Not Connected'
                      : isCurrent
                        ? 'Renew for 30 Days'
                        : `Pay ₹${plan.priceInr.toLocaleString('en-IN')} via UPI / Card`}
              </button>
            </div>
          );
        })}
      </section>

      {/* Invoices & Payment History */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display text-sm font-semibold">
          Payment History &amp; Invoices ({payConfig?.payments.length ?? 0})
        </div>
        {!payConfig?.payments.length ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No subscription payments recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Invoice</th>
                  <th className="py-2.5 px-4">Plan</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Order ID</th>
                  <th className="py-2.5 px-4 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                {payConfig.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-4 font-mono">{p.invoiceNumber}</td>
                    <td className="py-2.5 px-4 capitalize font-medium">{p.planId} Plan</td>
                    <td className="py-2.5 px-4 text-right font-mono">₹{p.amountInr}</td>
                    <td className="py-2.5 px-4 capitalize">
                      <span
                        className={
                          p.status === 'paid'
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : p.status === 'refunded'
                              ? 'text-amber-600 font-medium'
                              : 'text-rose-600 font-medium'
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">{p.orderId}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDownloadInvoice(p)}
                        className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Invoice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
