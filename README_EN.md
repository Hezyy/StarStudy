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

From an interactive SSH terminal on your own Linux server, use the single management entry point:

```sh
curl -fsSL https://raw.githubusercontent.com/Hezyy/StarStudy/main/starstudy.sh | sudo bash
```

After installation, run:

```sh
sudo starstudy
```

The numbered menu covers installation, updates, uninstall, status, logs, restart, backup, restore, diagnosis and exit. It reads every prompt from the controlling terminal, including when launched through a pipe. Missing project dependencies, Git, Docker Engine and the Compose plugin are prepared automatically; no Node.js installation or manual environment editing is required on the server.

The wizard requires a domain. **ACME contact email is optional: press Enter to skip.** An empty email does not block issuance or renewal, but certificate notifications may be unavailable. The HTTPS port is optional; an unused port is selected from 20000–60000 by default. The access prefix and credentials are securely generated once and retained across updates/restarts. Registration defaults to invitations; the owner uses the generated setup token to create the first administrator.

You must control the domain and correctly configure its A/AAAA records. HTTP-01 requires externally reachable **TCP 80**, and the selected HTTPS port must also be allowed through the firewall/cloud security group. The manager does not change DNS, disable firewalls, open an entire port range or alter SSH. The random path is an additional entry point, not a replacement for authentication.

Supported hosts remain Ubuntu 22.04/24.04 and Debian 12/13 on x86_64, with at least 2GB memory and 5GB free disk; 4GB+ memory is recommended for builds. ARM64 is not validated. The initial command itself requires working curl, sudo and Bash; minimal OS images missing these basic tools need their package manager or provider console first.

Application updates require a real, non-prerelease stable release. If none exists, the manager says so; first installation of a pinned development snapshot requires explicit acceptance. It does not invent a stable release or unconditionally update from main. Default uninstall retains data; destructive removal lists owned resources, requires a verified backup and two confirmations. Unknown directories, local source changes and unrelated Docker resources are protected.

**Public ACME issuance and actual iPhone/Android devices require independent acceptance.** See the [manager test report](docs/MANAGER_DELIVERY.md) for checks actually run locally and in Linux CI, then follow the [deployment documentation](docs/DEPLOYMENT.md) on an independent test machine.

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

The source repository is public at [Hezyy/StarStudy](https://github.com/Hezyy/StarStudy). Public source availability does not mean a production service has been deployed or validated. Continue auditing every release for secrets/private data and provide corresponding source for the deployed version. Third-party dependencies and course materials retain their respective rights.
