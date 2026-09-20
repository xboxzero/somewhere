import { marked } from "marked";
import DOMPurify from "dompurify";
import { HOME_SLUG } from "./config.js";
import { mountGraph, type GraphHandle } from "./graph.js";
import { mountLetterField, type LetterFieldHandle } from "./letters.js";
import { openImageDialog } from "./imageDialog.js";
import {
  applyTemperature,
  autoEnabled,
  daylightTemperature,
  describeDaylight,
  setAutoEnabled,
  storeTemperature,
  storedTemperature,
} from "./temperature.js";
import {
  GitHubError,
  clearToken,
  deletePage,
  getPageSha,
  isLoggedIn,
  listPages,
  loadPage,
  savePage,
  setToken,
  verifyToken,
} from "./github.js";

const app = requireElement<HTMLElement>("app");
const pageNav = requireElement<HTMLElement>("page-nav");
const loginBtn = requireElement<HTMLButtonElement>("login-btn");
const logoutBtn = requireElement<HTMLButtonElement>("logout-btn");
const newPageBtn = requireElement<HTMLButtonElement>("new-page-btn");
const loginDialog = requireElement<HTMLDialogElement>("login-dialog");
const loginForm = requireElement<HTMLFormElement>("login-form");
const tokenInput = requireElement<HTMLInputElement>("token-input");
const loginError = requireElement<HTMLElement>("login-error");
const loginCancel = requireElement<HTMLButtonElement>("login-cancel");
const loginSave = requireElement<HTMLButtonElement>("login-save");
const heroStage = requireElement<HTMLElement>("hero");

let letterField: LetterFieldHandle | null = null;
let graph: GraphHandle | null = null;

/** WebGL can be unavailable or blocked; the wiki must still work without it. */
function setHeroText(text: string): void {
  try {
    letterField ??= mountLetterField(heroStage, text);
    letterField.setText(text);
    heroStage.classList.remove("hidden");
  } catch (error) {
    console.warn("3D hero unavailable", error);
    heroStage.classList.add("hidden");
  }
}

function disposeGraph(): void {
  graph?.dispose();
  graph = null;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleize(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function describeError(error: unknown): string {
  if (error instanceof GitHubError && error.status === 401) {
    return "Your token was rejected. Log out and paste a valid token.";
  }
  if (error instanceof GitHubError && error.status === 403) {
    return "GitHub refused the request. Check the token has Contents: Read and write.";
  }
  if (error instanceof GitHubError && error.status === 409) {
    return "This page changed on GitHub since you opened it. Reload and redo your edit.";
  }
  return error instanceof Error ? error.message : String(error);
}

function renderMarkdown(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown, { async: false }));
}

function clear(element: HTMLElement): void {
  element.replaceChildren();
}

function updateAuthUI(): void {
  const loggedIn = isLoggedIn();
  loginBtn.classList.toggle("hidden", loggedIn);
  logoutBtn.classList.toggle("hidden", !loggedIn);
  newPageBtn.classList.toggle("hidden", !loggedIn);
}

function showMessage(message: string, kind: "error" | "muted" = "muted"): void {
  const paragraph = document.createElement("p");
  paragraph.className = kind;
  paragraph.textContent = message;
  app.replaceChildren(paragraph);
}

async function renderNav(activeSlug: string | null): Promise<void> {
  let slugs: string[] = [];
  try {
    slugs = await listPages();
  } catch (error) {
    console.error("Could not list pages", error);
  }

  clear(pageNav);
  for (const slug of slugs) {
    const link = document.createElement("a");
    link.href = `#/page/${slug}`;
    link.textContent = titleize(slug);
    if (slug === activeSlug) link.classList.add("active");
    pageNav.append(link);
  }
}

function button(label: string, className = ""): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (className) element.className = className;
  return element;
}

async function viewPage(slug: string): Promise<void> {
  showMessage("Loading…");
  setHeroText(titleize(slug));
  void renderNav(slug);

  let content: string;
  try {
    ({ content } = await loadPage(slug));
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      renderMissingPage(slug);
      return;
    }
    showMessage(describeError(error), "error");
    return;
  }

  const header = document.createElement("div");
  header.className = "page-header";
  header.append(document.createElement("div"));

  if (isLoggedIn()) {
    const actions = document.createElement("div");
    actions.className = "page-actions";

    const editBtn = button("Edit");
    editBtn.addEventListener("click", () => {
      location.hash = `#/edit/${slug}`;
    });

    const removeBtn = button("Delete", "danger");
    removeBtn.addEventListener("click", () => void confirmDelete(slug));

    actions.append(editBtn, removeBtn);
    header.append(actions);
  }

  const article = document.createElement("div");
  article.className = "content";
  article.innerHTML = renderMarkdown(content);

  app.replaceChildren(header, article);
}

function renderMissingPage(slug: string): void {
  const message = document.createElement("p");
  message.className = "muted";
  message.textContent = `The page "${slug}" doesn't exist yet.`;
  app.replaceChildren(message);

  if (isLoggedIn()) {
    const createBtn = button(`Create "${slug}"`, "primary");
    createBtn.addEventListener("click", () => {
      location.hash = `#/edit/${slug}`;
    });
    app.append(createBtn);
  }
}

async function confirmDelete(slug: string): Promise<void> {
  if (!confirm(`Delete the page "${slug}"? This commits the deletion to GitHub.`)) return;
  try {
    const sha = await getPageSha(slug);
    if (!sha) {
      showMessage(`"${slug}" no longer exists on GitHub.`, "error");
      return;
    }
    await deletePage(slug, sha);
    location.hash = "#/";
    await router();
  } catch (error) {
    showMessage(describeError(error), "error");
  }
}

async function editPage(slug: string | null): Promise<void> {
  if (!isLoggedIn()) {
    showMessage("Log in with a GitHub token to edit pages.", "error");
    return;
  }

  showMessage("Loading…");
  setHeroText(slug ? titleize(slug) : "new page");
  void renderNav(slug);

  let content = "";
  let sha: string | null = null;
  let exists = false;

  if (slug) {
    try {
      const page = await loadPage(slug);
      content = page.content;
      sha = page.sha;
      exists = true;
    } catch (error) {
      if (!(error instanceof GitHubError && error.status === 404)) {
        showMessage(describeError(error), "error");
        return;
      }
    }
  }

  const editor = document.createElement("div");
  editor.className = "editor";

  let slugInput: HTMLInputElement | null = null;
  if (slug) {
    const heading = document.createElement("h2");
    heading.textContent = exists ? `Editing: ${titleize(slug)}` : `Creating: ${titleize(slug)}`;
    editor.append(heading);
  } else {
    slugInput = document.createElement("input");
    slugInput.type = "text";
    slugInput.placeholder = "Page name (e.g. Project Notes)";
    editor.append(slugInput);
  }

  // Controls sit above the text box: below it they fall past the fold on a
  // phone, where the tall textarea pushes them off screen entirely.
  const toolbar = document.createElement("div");
  toolbar.className = "editor-toolbar";
  editor.append(toolbar);

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.placeholder = "# Page title\n\nWrite your page in Markdown…";
  editor.append(textarea);

  /** Inserts Markdown at the caret so an image lands where the writer is typing. */
  function insertAtCaret(markdown: string): void {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const padded = `${before.endsWith("\n") || before === "" ? "" : "\n\n"}${markdown}\n`;
    textarea.value = before + padded + after;
    const caret = before.length + padded.length;
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
  }

  async function handleImageFile(file: File): Promise<void> {
    const result = await openImageDialog(file);
    if (result) insertAtCaret(result.markdown);
  }

  const imageInput = document.createElement("input");
  imageInput.type = "file";
  imageInput.accept = "image/*";
  imageInput.className = "hidden";
  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (file) void handleImageFile(file);
    imageInput.value = "";
  });

  const imageBtn = button("Add image", "primary");
  imageBtn.addEventListener("click", () => imageInput.click());

  const toolbarHint = document.createElement("span");
  toolbarHint.className = "muted toolbar-hint";
  toolbarHint.textContent = "or drop / paste a photo into the box below";

  toolbar.append(imageBtn, toolbarHint);
  editor.append(imageInput);

  textarea.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
      textarea.classList.add("is-dropping");
    }
  });

  textarea.addEventListener("dragleave", () => textarea.classList.remove("is-dropping"));

  textarea.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    textarea.classList.remove("is-dropping");
    if (!file?.type.startsWith("image/")) return;
    event.preventDefault();
    void handleImageFile(file);
  });

  textarea.addEventListener("paste", (event) => {
    const file = Array.from(event.clipboardData?.items ?? [])
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void handleImageFile(file);
  });

  const status = document.createElement("p");
  status.className = "muted";

  const actions = document.createElement("div");
  actions.className = "editor-actions";
  const saveBtn = button("Save", "primary");
  const cancelBtn = button("Cancel");
  actions.append(saveBtn, cancelBtn);
  editor.append(actions, status);

  cancelBtn.addEventListener("click", () => {
    location.hash = slug ? `#/page/${slug}` : "#/";
  });

  saveBtn.addEventListener("click", () => {
    void (async () => {
      const targetSlug = slug ?? slugify(slugInput?.value ?? "");
      if (!targetSlug) {
        status.className = "error";
        status.textContent = "Give the page a name first.";
        return;
      }

      saveBtn.disabled = true;
      status.className = "muted";
      status.textContent = "Saving…";

      try {
        // A page reached via "create" may already exist; fetch its sha so we update it.
        const currentSha = sha ?? (await getPageSha(targetSlug));
        await savePage(targetSlug, textarea.value, currentSha);
        location.hash = `#/page/${targetSlug}`;
        await router();
      } catch (error) {
        saveBtn.disabled = false;
        status.className = "error";
        status.textContent = describeError(error);
      }
    })();
  });

  app.replaceChildren(editor);
}

async function viewGraph(): Promise<void> {
  disposeGraph();
  setHeroText("network");
  void renderNav(null);

  const stage = document.createElement("div");
  stage.className = "graph-stage";
  const hint = document.createElement("p");
  hint.className = "muted graph-hint";
  hint.textContent = "Drag to rotate · scroll to zoom · click a node to open it";
  app.replaceChildren(stage, hint);

  try {
    graph = await mountGraph(stage, (slug) => {
      location.hash = `#/page/${slug}`;
    });
  } catch (error) {
    showMessage(describeError(error), "error");
  }
}

async function router(): Promise<void> {
  const segments = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, param] = segments;

  if (route !== "graph") disposeGraph();

  if (route === "graph") return viewGraph();
  if (route === "edit") return editPage(param ?? null);
  if (route === "new") return editPage(null);
  if (route === "page" && param) return viewPage(param);
  return viewPage(HOME_SLUG);
}

loginBtn.addEventListener("click", () => {
  tokenInput.value = "";
  loginError.textContent = "";
  loginDialog.showModal();
});

loginCancel.addEventListener("click", () => loginDialog.close());

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    const token = tokenInput.value.trim();
    if (!token) return;

    loginSave.disabled = true;
    loginError.textContent = "";
    setToken(token);

    try {
      await verifyToken();
      loginDialog.close();
      updateAuthUI();
      await router();
    } catch (error) {
      clearToken();
      loginError.textContent = describeError(error);
    } finally {
      loginSave.disabled = false;
    }
  })();
});

logoutBtn.addEventListener("click", () => {
  clearToken();
  updateAuthUI();
  void router();
});

newPageBtn.addEventListener("click", () => {
  location.hash = "#/new";
});

window.addEventListener("hashchange", () => void router());

const tempSlider = requireElement<HTMLInputElement>("temp-slider");
const tempReadout = requireElement<HTMLElement>("temp-readout");
const tempAutoBtn = requireElement<HTMLButtonElement>("temp-auto");

let autoTimer = 0;

function paintTemperature(kelvin: number, auto: boolean): void {
  const palette = applyTemperature(kelvin);
  tempSlider.value = String(palette.kelvin);
  tempReadout.textContent = auto
    ? `${describeDaylight(new Date().getHours() + new Date().getMinutes() / 60)} · ${palette.kelvin}K`
    : `${palette.kelvin}K / ${palette.mirrorKelvin}K`;
  tempAutoBtn.classList.toggle("active", auto);
}

function tickAuto(): void {
  if (!autoEnabled()) return;
  paintTemperature(daylightTemperature(), true);
}

function startAuto(): void {
  setAutoEnabled(true);
  tickAuto();
  window.clearInterval(autoTimer);
  // A minute is finer than the curve moves, and cheap enough to leave running.
  autoTimer = window.setInterval(tickAuto, 60_000);
}

function stopAuto(kelvin: number): void {
  setAutoEnabled(false);
  window.clearInterval(autoTimer);
  autoTimer = 0;
  storeTemperature(kelvin);
  paintTemperature(kelvin, false);
}

// Dragging the slider is an explicit override, so it leaves automatic mode.
tempSlider.addEventListener("input", () => stopAuto(Number(tempSlider.value)));

tempAutoBtn.addEventListener("click", () => {
  if (autoEnabled()) stopAuto(Number(tempSlider.value));
  else startAuto();
});

// A sleeping laptop stops timers, so re-sync whenever the tab becomes visible.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tickAuto();
});

if (autoEnabled()) startAuto();
else paintTemperature(storedTemperature(), false);
updateAuthUI();
void router();
