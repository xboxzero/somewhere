export const BRANCH = "master";
export const PAGES_DIR = "pages";
export const HOME_SLUG = "home";

/** Used when the site isn't served from github.io, e.g. a local preview. */
const FALLBACK_OWNER = "xboxzero";
const FALLBACK_REPO = "xero-wiki";

/**
 * Derived from the URL so renaming the repository needs no code change:
 * a project site lives at owner.github.io/repo, and a user site at
 * owner.github.io is served by the repo named after the host itself.
 */
function detectRepository(): { owner: string; repo: string } {
  const { hostname, pathname } = location;
  if (!hostname.endsWith(".github.io")) {
    return { owner: FALLBACK_OWNER, repo: FALLBACK_REPO };
  }

  const owner = hostname.replace(/\.github\.io$/, "");
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return { owner, repo: firstSegment ?? hostname };
}

export const { owner: OWNER, repo: REPO } = detectRepository();

export const IMAGES_DIR = "images";
