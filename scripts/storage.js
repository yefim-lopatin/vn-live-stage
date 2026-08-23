import { MODULE_ID, clone, createInitialState, createSceneDefinition } from "./core.js";

export const FLAGS = Object.freeze({
  scene: "scene",
  portrait: "portraitProfile",
  location: "locationPreset"
});

export async function readLiveState() {
  const stored = game.settings.get(MODULE_ID, "liveState");
  if (!stored) return createInitialState();
  const initial = createInitialState();
  const value = clone(stored);
  return {
    ...initial,
    ...value,
    stage: { ...initial.stage, ...(value.stage ?? {}) },
    scene: createSceneDefinition(value.scene)
  };
}

export async function writeLiveState(state) {
  return game.settings.set(MODULE_ID, "liveState", clone(state));
}

export async function saveScene(state, { sceneId = state.scene.id, name = state.scene.name } = {}) {
  if (!game.user.isGM) throw new Error("Сохранять сцены может только GM");
  let entry = game.journal.contents.find((journal) => journal.getFlag(MODULE_ID, FLAGS.scene)?.id === sceneId);
  const scene = { ...clone(state.scene), id: sceneId, name };
  if (entry) await entry.update({ [`flags.${MODULE_ID}.${FLAGS.scene}`]: scene });
  else entry = await JournalEntry.create({ name, pages: [], [`flags.${MODULE_ID}.${FLAGS.scene}`]: scene });
  return entry;
}

export function listScenes() {
  return game.journal.contents
    .map((journal) => journal.getFlag(MODULE_ID, FLAGS.scene))
    .filter(Boolean)
    .map(clone);
}

export function getScene(sceneId) {
  return listScenes().find((scene) => scene.id === sceneId) ?? null;
}

export async function saveLibraryRecord(kind, value) {
  if (!game.user.isGM) throw new Error("Библиотекой может управлять только GM");
  const flag = FLAGS[kind];
  if (!flag) throw new Error(`Неизвестный тип библиотеки: ${kind}`);
  let entry = game.journal.contents.find((journal) => journal.getFlag(MODULE_ID, flag)?.id === value.id);
  if (entry) await entry.update({ [`flags.${MODULE_ID}.${flag}`]: clone(value) });
  else entry = await JournalEntry.create({ name: value.name ?? value.id, pages: [], [`flags.${MODULE_ID}.${flag}`]: clone(value) });
  return entry;
}

export function listLibrary(kind) {
  const flag = FLAGS[kind];
  return game.journal.contents.map((journal) => journal.getFlag(MODULE_ID, flag)).filter(Boolean).map(clone);
}
