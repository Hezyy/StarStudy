# 星研 / Star Study

**A quieter path toward your postgraduate exam.**

Star Study is a Chinese-language, self-hostable study-management PWA: plan, work on daily tasks, track time, review mistakes, reflect weekly, and adjust upcoming work. Version **0.4.0** extends the existing local application without replacing its database or interaction design. Licensed under [AGPL-3.0-only](LICENSE). [中文说明](README.md)

## Run locally

Use Node.js 24 LTS and npm:

```sh
npm ci
npm run build
npm start
```

Open [localhost:3000](http://localhost:3000). With `DATABASE_URL` unset, no account or paid AI service is required: data stays in this browser's IndexedDB. The build produces `out/` (static frontend) and `dist/` (compiled server). Static hosting alone does not provide account, sync, admin or AI APIs. The Next development server serves the frontend only; build and run `npm start` for account integration.

## Self-host with accounts

The Linux installer targets Ubuntu 22.04/24.04 or Debian 12/13 on x86_64, with Docker Engine and Compose v2 installed:

```sh
bash scripts/install.sh
```

It generates random database/session/setup secrets and starts PostgreSQL 17, migrations, the application and Caddy. Registration defaults to invitation-only. There is no default administrator password: the owner uses the installation token to create the first administrator. A domain pointing to the server and ports 80/443 are required for HTTPS. Without a domain, explicit test mode binds only to loopback (`127.0.0.1:8080`); public HTTP account service is rejected.

**Docker, clean Linux installation, real iPhone/Android devices and ARM64 have not been fully verified in this Windows environment.** Shell/YAML checks and embedded PostgreSQL tests are not production deployment acceptance. Follow [deployment documentation](docs/DEPLOYMENT.md) on a clean test machine before inviting other people. ARM64 is currently rejected by the installer.

```sh
bash scripts/doctor.sh
bash scripts/backup.sh
bash scripts/update.sh vX.Y.Z
bash scripts/restore.sh /absolute/path/to/backup
bash scripts/uninstall.sh
```

Updates require an actually published stable tag; `vX.Y.Z` is a placeholder. Default uninstall preserves database volumes, backups and configuration. Destructive purge requires two confirmations and creates a backup first.

## Included workflows

- Responsive daily tasks, completion undo, notes, timestamp-based timer and offline PWA.
- Day/week/month calendar, editing, workload warnings and safe task splitting.
- Resources, prerequisites and explicitly assessed knowledge mastery.
- Text/image mistake notebook, due reviews and history.
- Weekly reflections, real-data charts and 7/30-day reports.
- Rule scheduling with preview, approval, revisions and safe undo.
- Excel import, complete JSON backup/restore and privacy-selectable reports.
- Account-scoped records and browser caches, authentication, roles, invitations, onboarding and admin metadata.
- AI plan wizard: goal → prompt → paste/file → validation → preview → confirmation; monthly chunks.
- Server-side DeepSeek provider, optional OpenAI provider, quotas and session-only BYOK.

The full-plan protocol is **StarStudy Plan Schema v1.0.0**. External IDs are references; the server generates internal UUIDs. Invalid dates, missing references, unsafe URLs, dependency problems and workload overflow are reported before import. JSON, fenced JSON and deterministic CSV/Markdown tables are supported; arbitrary prose is not guaranteed to parse, and AI conversion requires configuration. Existing task adjustments use a separate protocol.

No synthetic AI answers are presented as live responses. AI receives explicitly supplied content and never automatically writes study records. Bilibili links open the original website: no video download, rehosting or access bypass.

## Data and sync boundaries

Each account owns its server records. Browser caches are account-scoped; the original local database remains separate. Legacy migration is explicit and previewed. Sync uses complete snapshots with version checks. Concurrent edits remain local and require an explicit conflict decision. Continuous background sync while the application is closed is not implemented.

Images are IndexedDB Blobs locally and encoded in PostgreSQL/backups. Browser cleanup and device failures can lose unsynced work. Export periodic JSON backups; server backups include secrets and must be protected, encrypted and copied off-site. Never commit backups to Git.

Use HTTPS for PWA installation. iPhone: Safari → Share → Add to Home Screen. Android: Chrome → Install. Cache the shell during a prior online visit. Real-device installation and mobile file workflows still need manual acceptance.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run security:check
npx playwright install chromium webkit
npm run test:e2e
npm run test:e2e:platform
```

Account unit tests use PGlite by default. Network PostgreSQL testing requires a dedicated disposable database via `TEST_POSTGRES_URL` and `npm run test:postgres`; never use production. Private source-spreadsheet cases require `STAR_STUDY_SOURCE_XLSX`. Historical reports are version-specific, not current acceptance results.

## Documentation

[Platform](docs/PLATFORM.md) · [Deployment](docs/DEPLOYMENT.md) · [AI protocol](docs/AI_PLAN_IMPORT.md) · [GitHub publication](docs/GITHUB_RELEASE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Conduct](CODE_OF_CONDUCT.md) · [Changes](CHANGELOG.md)

No remote repository has been created, no code pushed, and no public deployment performed on the owner's behalf. Before publication, audit files and history for secrets/private data and provide corresponding source for the version deployed. Third-party dependencies and course materials retain their respective rights.
