import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, shouldDisplayStage } from "../scripts/core.js";
import { LiveStageSession } from "../scripts/session.js";

function installPlayerEnvironment(liveState) {
  const originals = new Map([
    ["game", globalThis.game],
    ["Hooks", globalThis.Hooks],
    ["window", globalThis.window],
    ["document", globalThis.document],
    ["ui", globalThis.ui],
    ["foundry", globalThis.foundry]
  ]);
  const emitted = [];
  let socketHandler = null;
  const player = { id: "player", name: "Игрок", active: true, isGM: false, role: 1 };
  const users = [player];
  users.get = (id) => users.find((user) => user.id === id);

  globalThis.game = {
    user: player,
    users,
    system: { id: "pf2e" },
    modules: new Map(),
    settings: {
      get: (_moduleId, key) => key === "liveState" ? structuredClone(liveState) : null
    },
    socket: {
      on: (_name, handler) => { socketHandler = handler; },
      emit: (_name, message) => { emitted.push(structuredClone(message)); }
    }
  };
  globalThis.Hooks = { on: () => 1, off: () => {} };
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.ui = { notifications: {} };
  delete globalThis.foundry;

  return {
    emitted,
    getSocketHandler: () => socketHandler,
    restore: () => {
      for (const [key, value] of originals) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  };
}

async function resolvesPromptly(promise) {
  return Promise.race([
    promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50))
  ]);
}

test("connected player receives stage-show and applies the live stage", async () => {
  const environment = installPlayerEnvironment(createInitialState());
  const session = new LiveStageSession();
  let notifiedPhase = null;
  const unsubscribe = session.onChange((state) => { notifiedPhase = state.stage.phase; });
  try {
    assert.equal(await resolvesPromptly(session.initialize()), true);
    const liveState = createInitialState();
    liveState.stage = { ...liveState.stage, phase: "live", active: true };
    session.state = liveState;
    await session._broadcast();
    const stageShow = environment.emitted.at(-1);
    assert.equal(stageShow.kind, "stage-show");
    await environment.getSocketHandler()(stageShow);

    assert.equal(session.getState().stage.phase, "live");
    assert.equal(shouldDisplayStage(session.getState().stage, false), true);
    assert.equal(notifiedPhase, "live");
  } finally {
    unsubscribe();
    session.destroy();
    environment.restore();
  }
});

test("player joining after publication initializes from the stored live stage", async () => {
  const liveState = createInitialState();
  liveState.stage = { ...liveState.stage, phase: "live", active: true };
  const environment = installPlayerEnvironment(liveState);
  const session = new LiveStageSession();
  try {
    assert.equal(await resolvesPromptly(session.initialize()), true);
    assert.equal(session.getState().stage.phase, "live");
    assert.equal(shouldDisplayStage(session.getState().stage, false), true);
    assert.equal(environment.emitted.some((message) => message.kind === "sync"), true);
  } finally {
    session.destroy();
    environment.restore();
  }
});
