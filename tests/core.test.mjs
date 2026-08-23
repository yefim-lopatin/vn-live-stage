import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SLOTS,
  applySceneCommand,
  applyTransientCommand,
  createCommand,
  createInitialState,
  expireSpeaking
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
  assert.equal(initial.stage.active, false);

  const added = applySceneCommand(initial, createCommand("addPortrait", {
    name: "NPC",
    image: "npc.webp",
    side: "right"
  }, { userId: "gm", revision: 0 })).state;
  const portraitId = added.scene.portraits[0].id;
  const updated = applySceneCommand(added, createCommand("updatePortrait", {
    portraitId,
    side: "left"
  }, { userId: "gm", revision: 1 })).state;

  assert.equal(updated.scene.portraits[0].side, "left");
  assert.equal(updated.revision, 2);
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
