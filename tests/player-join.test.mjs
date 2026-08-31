import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canUserJoinStage, canUserLeaveStage, createInitialState } from "../scripts/core.js";
import { LiveStageSession } from "../scripts/session.js";

function liveState() {
  const state = createInitialState();
  state.stage = { ...state.stage, phase: "live", active: true };
  return state;
}

const player = {
  id: "player",
  name: "Игрок",
  active: true,
  isGM: false,
  role: 1,
  character: { id: "actor-player", name: "Алиса", img: "alice.webp" }
};
const overlayTemplate = readFileSync(new URL("../templates/overlay.hbs", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../scripts/app.js", import.meta.url), "utf8");

test("player with an assigned character can join a live stage", () => {
  assert.equal(canUserJoinStage(liveState(), player, { enabled: true }), true);
  assert.equal(canUserLeaveStage(liveState(), player), false);
  assert.match(appSource, /canJoinStage:\s*this\.session\.canCurrentUserJoin\(\)/);
  const moduleSource = readFileSync(new URL("../scripts/module.js", import.meta.url), "utf8");
  assert.match(moduleSource, /controls\.tokens\.tools\[PLAYER_JOIN_CONTROL\]/);
  assert.match(moduleSource, /button:\s*true/);
  assert.match(moduleSource, /title:\s*"VNLiveStage\.controls\.playerJoin\.title"/);
  assert.match(moduleSource, /session\.joinStage\(\)\.catch/);
  assert.doesNotMatch(overlayTemplate, /data-action="join-stage"/);
  assert.match(overlayTemplate, /\{\{#if canLeaveStage\}\}[\s\S]*?data-action="leave-stage"/);
  assert.match(appSource, /canLeaveStage:\s*this\.session\.canCurrentUserLeave\(\)/);
});

test("world setting fully disables player joining", () => {
  assert.equal(canUserJoinStage(liveState(), player, { enabled: false }), false);
  const moduleSource = readFileSync(new URL("../scripts/module.js", import.meta.url), "utf8");
  const localization = JSON.parse(readFileSync(new URL("../language/ru.json", import.meta.url), "utf8"));
  assert.match(moduleSource, /register\(MODULE_ID, "allowPlayerJoin"/);
  assert.match(appSource, /overlayStructureSignature\(state,\s*\{[\s\S]*?allowPlayerJoin,[\s\S]*?librarySignature/);
  assert.equal(localization.VNLiveStage.settings.allowPlayerJoin.name, "Разрешить игрокам присоединяться к сцене");
});

test("player commands add and remove only their reserved portrait", async () => {
  const originals = new Map([["game", globalThis.game], ["ui", globalThis.ui]]);
  const gm = { id: "gm", name: "Ведущий", active: true, isGM: true, role: 4 };
  const users = [gm, player];
  users.get = (id) => users.find((user) => user.id === id);
  const emitted = [];
  globalThis.game = {
    user: player,
    users,
    system: { id: "pf2e" },
    modules: new Map(),
    settings: {
      get: (_moduleId, key) => key === "allowPlayerJoin",
      set: async () => true
    },
    socket: { emit: (_name, message) => emitted.push(structuredClone(message)) }
  };
  globalThis.ui = { notifications: {} };
  const session = new LiveStageSession();
  session.state = liveState();

  try {
    await session.joinStage();
    const request = emitted.find((message) => message.kind === "command");
    assert.equal(request.command.type, "joinStage");

    game.user = gm;
    await session._apply(request.command);
    const portrait = session.getState().scene.portraits[0];
    assert.equal(portrait.sourceUserId, player.id);
    assert.equal(portrait.sourceActorId, player.character.id);
    assert.equal(portrait.side, "left");

    session.state.scene.portraits.push({
      id: "user-other",
      profileId: "user-other",
      sourceUserId: "other-player",
      sourceActorId: "actor-other",
      name: "Другой игрок",
      image: "other.webp",
      slot: 1,
      side: "left",
      flipped: false,
      hidden: false
    });
    game.user = player;
    assert.equal(session.canCurrentUserLeave(), true);
    await session.leaveStage();
    const leaveRequest = emitted.filter((message) => message.kind === "command").at(-1);
    assert.equal(leaveRequest.command.type, "leaveStage");

    game.user = gm;
    await session._apply(leaveRequest.command);
    assert.equal(session.getState().scene.portraits.some((item) => item.sourceUserId === player.id), false);
    assert.equal(session.getState().scene.portraits.some((item) => item.sourceUserId === "other-player"), true);
  } finally {
    session.destroy();
    for (const [key, value] of originals) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
