/**
 * Project vocabulary shared by the server and the browser.
 *
 * These constants used to live in `lib/db/projects.ts` next to the mongoose model. Two
 * client components imported them from there, which dragged mongoose into the browser
 * bundle: mongoose is a server-only library and Next.js replaces it with an empty stub, so
 * `mongoose.models.Project` at module scope threw "Cannot read properties of undefined
 * (reading 'Project')" and took the whole Projects page down before it rendered.
 *
 * Keep this file free of any import. It is the only shape of project data the client is
 * allowed to depend on, and a boundary test enforces that.
 */

export const PROJECT_STATUSES = [
  "idea",
  "building",
  "live",
  "paused",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const LINK_TYPES = ["github", "live", "docs", "other"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
