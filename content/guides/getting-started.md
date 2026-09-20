---
title: Getting Started
description: How to add, edit, and organize pages in this wiki.
tags:
  - guide
---

This wiki is just Markdown files in a git repository. There's no separate CMS or database — you edit files, commit, and push.

## Adding a new page

1. Create a `.md` file anywhere under `content/` (subfolders become sections in the sidebar).
2. Add frontmatter at the top:

```yaml
---
title: My Page Title
description: One-line summary shown in search results and previews.
tags:
  - some-tag
---
```

3. Write the page in Markdown below the frontmatter.
4. Commit and push to the repo's default branch — GitHub Actions rebuilds and deploys the site automatically.

## Linking pages together

Use double-bracket wikilinks to link to another page by its path (without the `.md` extension):

```
[[guides/writing-pages|Writing Pages]]
```

This renders as: [[guides/writing-pages|Writing Pages]]

Every link you create shows up as a **backlink** on the page it points to, and as an edge in the **graph view** — that's what makes this a wiki rather than a stack of disconnected documents.

## Tags

Add `tags:` in frontmatter to group related pages. Tags get their own browsable page automatically (see the [tag index](/tags)).

## Local preview

```bash
npm i
npx quartz build --serve
```

Opens a live-reloading preview at `http://localhost:8080`.

See also: [[notes/example-note|Example Note]] · [[index|Home]]
