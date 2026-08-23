import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SLOTS,
  applySceneCommand,
  applyTransientCommand,
  createCommand,
  createInitialState,
  expireSpeaking,
  overlayStructureSignature,
  shouldDisplayStage
} from "../scripts/core.js";

test("scene commands change only the scene and increment revision", () => {
  const initial = createInitialState();
  const result = applySceneCommand(initial, createCommand("addPortrait", {
    name: "Ави",
    image: "avatars/avi.webp"
  }, { userId: "gm", revision: 0 }));

  assert.equal(initial.revision, 0);
  assert.equal(result.state.revision, 1);
  assert.equal(result.state.scene.portraits[0].name, "Ави");
  assert.equal(result.state.scene.portraits[0].slot, 0);
  assert.equal(result.state.scene.portraits[0].side, "right");
  assert.equal(result.event.after.portraits.length, 1);
});

test("stage starts inactive and portrait side can be changed", () => {
  const initial = createInitialState();
  assert.equal(initial.stage.phase, "inactive");
  assert.equal(initial.stage.active, false);

  const added = applySceneCommand(initial, createCommand("addPortrait", {
    name: "NPC",
    image: "npc.webp",
    side: "right"
  }, { userId: "gm", revision: 0 })).state;
  const portraitId = added.scene.portraits[0].id;
  const updated = applySceneCommand(added, createCommand("updatePortrait", {
    portraitId,
    side: "left",
    flipped: true
  }, { userId: "gm", revision: 1 })).state;

  assert.equal(updated.scene.portraits[0].side, "left");
  assert.equal(updated.scene.portraits[0].flipped, true);
  assert.equal(updated.revision, 2);
});

test("portrait batches add groups without duplicates and refresh avatar images", () => {
  let state = createInitialState();
  state = applySceneCommand(state, createCommand("addPortraits", {
    portraits: [
      { id: "user-a", profileId: "user-a", sourceUserId: "a", name: "А", image: "a-old.webp", side: "left" },
      { id: "npc-b", profileId: "npc-b", name: "Б", image: "b.webp", side: "right" }
    ]
  }, { userId: "gm", revision: 0 })).state;
  state = applySceneCommand(state, createCommand("addPortraits", {
    portraits: [
      { id: "user-a", profileId: "user-a", sourceUserId: "a", name: "А новый", image: "a-new.webp", side: "left" }
    ]
  }, { userId: "gm", revision: 1 })).state;

  assert.equal(state.scene.portraits.length, 2);
  assert.equal(state.scene.portraits.find((portrait) => portrait.id === "user-a").image, "a-new.webp");
});

test("new scene clears composition without changing stage phase", () => {
  let state = createInitialState();
  state = applySceneCommand(state, createCommand("addPortrait", {
    id: "npc",
    name: "NPC",
    image: "npc.webp"
  }, { userId: "gm", revision: 0 })).state;
  state.stage.phase = "preparing";
  state = applySceneCommand(state, createCommand("newScene", {
    name: "Поле"
  }, { userId: "gm", revision: 1 })).state;

  assert.equal(state.scene.name, "Поле");
  assert.equal(state.scene.portraits.length, 0);
  assert.equal(state.stage.phase, "preparing");
});

test("all main slots are bounded and overflow is transient", () => {
  let state = createInitialState();
  for (let index = 0; index < MAX_SLOTS; index += 1) {
    state = applyTransientCommand(state, createCommand("speechStart", {}, { userId: `user-${index}` }), {
      userId: `user-${index}`,
      portrait: { id: `portrait-${index}`, profileId: `user-${index}`, name: `Игрок ${index}`, image: "" }
    });
  }
  assert.equal(state.scene.portraits.length, MAX_SLOTS);

  state = applyTransientCommand(state, createCommand("speechStart", {}, { userId: "overflow-user" }), {
    userId: "overflow-user",
    portrait: { id: "portrait-overflow", profileId: "overflow-user", name: "Overflow", image: "" }
  });
  assert.equal(state.scene.portraits.length, MAX_SLOTS);
  assert.equal(state.overflow.length, 1);
});

test("multiple speaking users can coexist and heartbeat expiry clears stale state", () => {
  let state = createInitialState();
  for (const userId of ["alice", "bob"]) {
    state = applyTransientCommand(state, createCommand("speechStart", {}, { userId }), {
      userId,
      portrait: { id: `portrait-${userId}`, profileId: userId, name: userId, image: "" }
    });
  }
  assert.deepEqual(new Set(Object.keys(state.speaking)), new Set(["alice", "bob"]));
  assert.equal(Object.keys(expireSpeaking({ ...state, speaking: {
    alice: { ...state.speaking.alice, heartbeatAt: 0 },
    bob: state.speaking.bob
  } }, 1000).speaking).includes("alice"), false);
  assert.equal(Object.keys(expireSpeaking(state, 0).speaking).length, 0);
});

test("preparation is visible only to GM and live stage is visible to everyone", () => {
  assert.equal(shouldDisplayStage({ phase: "inactive" }, true), false);
  assert.equal(shouldDisplayStage({ phase: "preparing" }, false), false);
  assert.equal(shouldDisplayStage({ phase: "preparing" }, true), true);
  assert.equal(shouldDisplayStage({ phase: "live" }, false), true);
});

test("speech changes do not change the overlay structure signature", () => {
  let state = createInitialState();
  state.stage.phase = "live";
  state.stage.active = true;
  state = applySceneCommand(state, createCommand("addPortrait", {
    id: "speaker",
    profileId: "speaker",
    name: "Говорящий",
    image: "speaker.webp",
    side: "left"
  }, { userId: "gm", revision: 0 })).state;
  const before = overlayStructureSignature(state, { hideUi: true });
  const speaking = applyTransientCommand(state, createCommand("speechStart", {}, { userId: "player" }), {
    userId: "player",
    portrait: state.scene.portraits[0]
  });

  assert.equal(overlayStructureSignature(speaking, { hideUi: true }), before);
});
