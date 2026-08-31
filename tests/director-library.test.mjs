import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deleteLibraryRecord, FLAGS } from "../scripts/storage.js";

const overlay = readFileSync(new URL("../templates/overlay.hbs", import.meta.url), "utf8");
const director = readFileSync(new URL("../templates/director.hbs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");

test("GM overlay contains a left-side quick library for scenes and participant groups", () => {
  assert.match(overlay, /class="vn-cinematic-library"/);
  assert.match(overlay, /data-action="quick-load-scene"/);
  assert.match(overlay, /data-action="quick-apply-group"/);
  assert.match(styles, /\.vn-cinematic-library\s*\{[\s\S]*?left:\s*18px;/);
  assert.doesNotMatch(styles, /\.vn-cinematic-library\s*\{\s*right:\s*6px;/);
  assert.match(styles, /\.vn-cinematic-library-list\s*\{[\s\S]*?display:\s*grid;/);
});

test("both director views expose deletion for saved scenes and groups", () => {
  for (const action of ["delete-scene", "delete-group"]) assert.match(director, new RegExp(`data-action="${action}"`));
  for (const action of ["quick-delete-scene", "quick-delete-group"]) assert.match(overlay, new RegExp(`data-action="${action}"`));
});

test("library deletion removes the exact GM-owned record and rejects players", async () => {
  const originalGame = globalThis.game;
  const deleted = [];
  const scene = { id: "scene-saved", name: "Сохранённая сцена" };
  const group = { id: "group-saved", name: "Сохранённая группа" };
  const entries = [
    {
      getFlag: (_moduleId, flag) => flag === FLAGS.scene ? scene : null,
      delete: async () => { deleted.push(scene.id); }
    },
    {
      getFlag: (_moduleId, flag) => flag === FLAGS.group ? group : null,
      delete: async () => { deleted.push(group.id); }
    }
  ];
  globalThis.game = { user: { isGM: true }, journal: { contents: entries } };
  try {
    assert.equal(await deleteLibraryRecord("scene", scene.id), true);
    assert.equal(await deleteLibraryRecord("group", group.id), true);
    assert.deepEqual(deleted, [scene.id, group.id]);
    game.user.isGM = false;
    await assert.rejects(() => deleteLibraryRecord("scene", scene.id), /только GM/);
    assert.deepEqual(deleted, [scene.id, group.id]);
  } finally {
    if (originalGame === undefined) delete globalThis.game;
    else globalThis.game = originalGame;
  }
});
