# Security Policy

Report suspected vulnerabilities privately to the repository owner. Do not put
health data, meal photos, OAuth material, bot tokens, database URLs, signing
keys, or deployment details in a public issue.

This project processes sensitive health information. Production deployments
must use scoped signed tokens, exact identity allowlists, encrypted provider
secret storage, TLS, audit logging, and documented data export/deletion paths.
See `docs/SECURITY_THREAT_MODEL.md` for the system-specific controls and gaps.
