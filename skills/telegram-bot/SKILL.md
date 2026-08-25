---
name: telegram-bot
description: Use when building Telegram bot account linking, reminders, meal text/photo logging, check-ins, coaching conversations, webhooks, or bot safety.
---

# Telegram Bot

## Mission

Make the bot a low-friction daily coach without becoming noisy, unsafe, or over-authorized.

## Responsibilities

- Link Telegram accounts through a signed `/link` flow and backend account session.
- Store Telegram user IDs only after successful account authorization.
- Use short-lived internal service tokens or server-side sessions; do not reuse ChatGPT connector tokens.
- Keep reminders configurable and respectful.
- Accept meal text/photos, ask concise follow-ups only when needed, and record confidence.
- Allow corrections for calories, protein, carbs, fat, and meal timing.
- Keep writeback to Apple Health as an explicit confirmation flow.
- Avoid medical claims and route concerning symptoms to human/medical advice.

## Checklist

1. Verify webhook authenticity and configured bot token handling.
2. Test unlinked users, relinking, account mismatch, revoked auth, and duplicate messages.
3. Make bot commands discoverable: `/start`, `/link`, `/log`, `/checkin`, `/report`, `/settings`, `/unlink`.
4. Keep image handling private, size-limited, and deletion-aware.
5. Add audit logs for bot-originated writes and approvals.
