import { OWNER, REPO, BRANCH, PAGES_DIR } from "./config.js";

const API = "https://api.github.com";
const TOKEN_KEY = "wiki_gh_token";

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GitHubError";
  }
}

export interface Page {
  slug: string;
  content: string;
  /** Present only when loaded through the API; required to update the file. */
  sha: string | null;
}

interface ContentsFile {
  type: string;
  name: string;
  content: string;
  sha: string;
}

interface ContentsEntry {
  type: string;
  name: string;
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isLoggedIn(): boolean {
  return getToken() !== "";
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");

  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API}${path}`, { ...init, headers });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // response had no JSON body; keep the status text
    }
    throw new GitHubError(response.status, detail);
  }

  return (await response.json()) as T;
}

function pagePath(slug: string): string {
  return `/repos/${OWNER}/${REPO}/contents/${PAGES_DIR}/${slug}.md`;
}

/** Lists pages via the API — reflects edits immediately, needs a token for a useful rate limit. */
async function listPagesFromApi(): Promise<string[]> {
  const entries = await apiFetch<ContentsEntry[]>(
    `/repos/${OWNER}/${REPO}/contents/${PAGES_DIR}?ref=${BRANCH}`,
  );
  return entries
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
}

/** Lists pages from the index emitted at build time — instant, no rate limit. */
async function listPagesFromSite(): Promise<string[]> {
  const response = await fetch(`${PAGES_DIR}/index.json`, { cache: "no-cache" });
  if (!response.ok) throw new GitHubError(response.status, "Could not load page index");
  return (await response.json()) as string[];
}

export async function listPages(): Promise<string[]> {
  if (isLoggedIn()) {
    try {
      return await listPagesFromApi();
    } catch (error) {
      // A rate limit or expired token shouldn't blank the navigation.
      console.warn("Falling back to the published page index", error);
    }
  }

  try {
    return await listPagesFromSite();
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return [];
    throw error;
  }
}

async function loadPageFromApi(slug: string): Promise<Page> {
  const file = await apiFetch<ContentsFile>(`${pagePath(slug)}?ref=${BRANCH}`);
  return { slug, content: decodeBase64(file.content), sha: file.sha };
}

async function loadPageFromSite(slug: string): Promise<Page> {
  const response = await fetch(`${PAGES_DIR}/${slug}.md`, { cache: "no-cache" });
  if (!response.ok) throw new GitHubError(response.status, `Page "${slug}" not found`);
  return { slug, content: await response.text(), sha: null };
}

/**
 * Editors read through the API so a page they just saved is current; the published
 * copy only refreshes once the deploy workflow finishes.
 */
export async function loadPage(slug: string): Promise<Page> {
  if (!isLoggedIn()) return loadPageFromSite(slug);

  try {
    return await loadPageFromApi(slug);
  } catch (error) {
    // A 404 is a real answer: the page does not exist. Anything else is transient,
    // so show the published copy rather than an error. Saving re-reads the sha,
    // so editing from a fallback copy still commits correctly.
    if (error instanceof GitHubError && error.status === 404) throw error;
    console.warn("Falling back to the published copy", error);
    return loadPageFromSite(slug);
  }
}

/** Looks up the blob sha of an existing page, or null when it does not exist yet. */
export async function getPageSha(slug: string): Promise<string | null> {
  try {
    const file = await apiFetch<ContentsFile>(`${pagePath(slug)}?ref=${BRANCH}`);
    return file.sha;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

export async function savePage(
  slug: string,
  content: string,
  sha: string | null,
): Promise<void> {
  await apiFetch(pagePath(slug), {
    method: "PUT",
    body: JSON.stringify({
      message: sha ? `Edit page: ${slug}` : `Create page: ${slug}`,
      content: encodeBase64(content),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function deletePage(slug: string, sha: string): Promise<void> {
  await apiFetch(pagePath(slug), {
    method: "DELETE",
    body: JSON.stringify({
      message: `Delete page: ${slug}`,
      sha,
      branch: BRANCH,
    }),
  });
}

/** Verifies a token works and returns the account it belongs to. */
export async function verifyToken(): Promise<string> {
  const user = await apiFetch<{ login: string }>("/user");
  return user.login;
}
