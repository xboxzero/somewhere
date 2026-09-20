# Somewhere Wiki

An interactive wiki built with [Quartz](https://quartz.jzhao.xyz), deployed to GitHub Pages.

Features out of the box: full-text search, a graph view of how pages link together, automatic backlinks, dark/light mode, tags, and folder-based navigation.

## Adding content

Pages live as Markdown files under `content/`. See [`content/guides/getting-started.md`](content/guides/getting-started.md) for how to add pages, link them together, and organize sections.

## Local development

```bash
npm ci
npx quartz build --serve
```

This starts a live-reloading preview at `http://localhost:8080`.

## Deployment

Pushing to `master` triggers `.github/workflows/deploy.yml`, which builds the site and publishes it to GitHub Pages.

**One-time setup**: in the repo's Settings → Pages, set the source to "GitHub Actions".

The site will be served at `https://xboxzero.github.io/somewhere`.
