# Chhotu AI Firestore Security Specification

## 1. Data Invariants
1. A user profile `/users/{userId}` can only be read by its owner (`request.auth.uid == userId`) or a verified admin (`isAdmin()`).
2. A regular user creating their own `/users/{userId}` document cannot self-assign `plan: 'premium'`, `banned: true`, inflated credits, or custom `dailyVideoLimit`/`monthlyVideoLimit`.
3. A regular user cannot modify `plan`, `banned`, `dailyVideoLimit`, `monthlyVideoLimit`, `uid`, `email`, or `createdAt` on update.
4. A banned user (`existing().banned == true`) cannot create chats, messages, memories, media history, or update credits.
5. Every `/chats/{chatId}/messages/{messageId}` write verifies ownership of the parent `/chats/{chatId}` via `get()`.
6. `creditTransactions` and `auditLogs` are append-only immutable ledgers (`allow update, delete: if false`).
7. `systemConfig` and `admins` can only be mutated by verified admins (`email_verified == true` for bootstrapped admin email or `/admins/{uid}` existence).
8. All document IDs match `^[a-zA-Z0-9_\\-]+$` (`<= 128` chars) and all timestamps match `request.time`.

## 2. Dirty Dozen Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/users/user123`.
2. Non-owner reading `/users/otherUser123` (PII leak attempt).
3. Self-escalation on `/users/user123` create with `plan: "premium"` and `imageCredits: 99999`.
4. Self-escalation on `/users/user123` update changing `dailyVideoLimit` from `2` to `100` without Admin role.
5. Unverified email spoofing admin email `cchotumarapo@gmail.com` with `email_verified: false`.
6. Ghost field injection (`isAdmin: true`) in `/users/user123` or `/chats/chat1`.
7. Client-forged timestamp (`createdAt: "2020-01-01T00:00:00Z"`) instead of `request.time`.
8. Oversized ID injection (`1500`-char document ID) on `/chats/{chatId}`.
9. Orphaned message creation under `/chats/otherUserChat/messages/msg1`.
10. Blanket list query on `/chats` or `/memories` without filtering `userId == request.auth.uid`.
11. Mutating or deleting an existing `/creditTransactions/{txId}` record to replay deductions/refunds.
12. Non-admin updating `/systemConfig/global` to disable/enable models or alter plan limits.
