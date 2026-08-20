import { clone } from "./core.js";

export const DEFAULT_POLICY = Object.freeze({
  sceneControl: ["gamemaster"],
  libraryControl: ["gamemaster"],
  requestReview: ["gamemaster", "assistant"],
  saveScene: ["gamemaster"],
  undo: ["gamemaster"]
});

function roleForUser(user) {
  if (user?.isGM) return "gamemaster";
  if (user?.role >= globalThis.CONST?.USER_ROLES?.ASSISTANT) return "assistant";
  return "player";
}

export function can(user, action, policy = DEFAULT_POLICY) {
  if (!user) return false;
  if (user.isGM) return true;
  return (policy[action] ?? []).includes(roleForUser(user));
}

export function normalizePolicy(policy) {
  const value = clone(policy ?? {});
  return Object.fromEntries(Object.entries(DEFAULT_POLICY).map(([key, defaults]) => [
    key,
    Array.isArray(value[key]) ? [...new Set(value[key])] : [...defaults]
  ]));
}
