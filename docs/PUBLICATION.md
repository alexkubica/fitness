# Publication Checklist

The public repository may contain source code, schemas, migrations, synthetic
fixtures, architecture documents, and generic deployment instructions. It must
not contain real health samples, Apple Health exports, meal photos, personal
check-ins, production database dumps, OAuth grants, bot updates, or secrets.

The pre-publication development history is preserved only in the private
`alexkubica/fitness-history-private` archive. The repository intended for
publication was recreated from the sanitized tree with one parentless initial
commit on 2026-08-25. Keep the archive private.

Before changing visibility:

- verify `.env*`, `.vercel/`, `.worktrees/`, logs, build output, and local health
  exports remain ignored and untracked;
- keep the real allowlisted email, user-specific tokens, signing JWK, database
  URL, Google secret, Telegram token, OpenRouter key, and reminder secrets only
  in provider secret stores or local files with owner-only permissions;
- scan the current tree and every Git ref for secrets and personal health data;
- run `npm run verify` and a production dependency audit;
- verify production still rejects fake tokens and fails closed on incomplete
  Google, OAuth, JWKS, or database configuration;
- review public deployment and bot URLs as intentional attack-surface
  disclosures, and rate-limit or remove unused surfaces;
- choose an open-source license only if reuse rights should be granted.

Changing Git visibility does not publish the Neon database or Apple Health
store. Data is exposed only if it was copied into Git, logs, build artifacts,
fixtures, or documentation.
