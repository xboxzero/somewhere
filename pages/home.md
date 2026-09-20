# Welcome

This is a wiki you can edit directly in the browser — no local setup, no git commands.

## How to edit

1. Click **Login** in the top right and paste a GitHub personal access token.
2. Open any page and click **Edit**, or click **+ New page** to add one.
3. Click **Save** — your change is committed to the repository on GitHub.

Saved edits appear on the published site once the deploy finishes, usually under a minute. While you're logged in you always see the current version straight from GitHub.

## Getting a token

In GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- **Repository access**: only the `somewhere` repository
- **Permissions**: Contents → **Read and write**
- Set an expiration date you're comfortable with

The token is stored only in your own browser and is sent only to `api.github.com`. Click **Logout** to remove it.

## Pages

Every page is a Markdown file in the `pages/` folder. See [Formatting](#/page/formatting) for what you can write.
