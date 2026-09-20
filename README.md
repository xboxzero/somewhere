# Xero Wiki

A wiki hosted on GitHub Pages that you can log into and edit directly in the browser. Edits are committed to this repository through the GitHub API — there is no server and no database.

## How it works

- **Pages** are Markdown files in [`pages/`](pages).
- **Reading** is served from the static files published to GitHub Pages, so visitors hit no API rate limits.
- **Logging in** means pasting a GitHub personal access token, which is kept in your browser's local storage and sent only to `api.github.com`.
- **Saving** commits the file to this repo via the GitHub Contents API, which triggers the deploy workflow and republishes the site.

While you are logged in, pages are read through the API instead, so you always see the current version rather than waiting for the deploy to finish.

## Setup

### 1. Enable GitHub Pages

Repo **Settings → Pages → Source: GitHub Actions**. Pushes to `master` then build and publish automatically via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

The site is served at `https://xboxzero.github.io/xero-wiki`.

### 2. Create a token

**Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- **Repository access**: only this repository
- **Permissions**: Contents → **Read and write**
- Set an expiration you're comfortable with

Open the site, click **Login**, and paste the token. It is validated against GitHub before being saved, and **Logout** removes it.

> [!NOTE]
> Anyone holding that token can write to this repository, so treat it like a password. Scope it to this repo only, give it an expiry, and revoke it in GitHub settings if it leaks.

## Local development

```bash
npm install
npm run dev     # rebuild on change into dist/
npm run build   # production build
npm run typecheck
```

Then serve the build:

```bash
cd dist && python3 -m http.server 8081
```

Editing requires the deployed site (or any origin you've allowed); reading works locally as-is.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app.ts` | UI, router, and editor |
| `src/github.ts` | Typed GitHub API client and auth |
| `src/config.ts` | Branch and paths; owner/repo are derived from the URL |
| `scripts/build.mjs` | esbuild bundle + static copy + page index |
| `pages/` | Wiki content (Markdown) |

The owner and repository are read from the site's own URL, so renaming the repository on GitHub needs no code change. The fallback values in `src/config.ts` apply only when the site isn't served from `github.io`, such as a local preview.
