import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../scripts/core.js";
import { LiveStageSession } from "../scripts/session.js";

const originalFoundry = globalThis.foundry;
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {}
    }
  }
};
const { StageOverlayController } = await import("../scripts/app.js");
if (originalFoundry === undefined) delete globalThis.foundry;
else globalThis.foundry = originalFoundry;

class HoldButton extends EventTarget {
  constructor() {
    super();
    this.capturedPointers = new Set();
  }

  setPointerCapture(pointerId) {
    this.capturedPointers.add(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointers.has(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.capturedPointers.delete(pointerId);
  }
}

async function verifyRelease(eventType) {
  const originalWindow = globalThis.window;
  const originalGame = globalThis.game;
  const originalUi = globalThis.ui;
  globalThis.window = new EventTarget();
  const button = new HoldButton();
  const commands = [];
  const player = { id: "player", active: true, isGM: false, character: { id: "actor-player" } };
  const users = [player];
  users.get = (id) => users.find((user) => user.id === id);
  globalThis.game = {
    user: player,
    users,
    settings: { get: () => true },
    socket: {
      emit: (_name, message) => {
        if (message.kind === "command") commands.push(message.command.type);
      }
    }
  };
  globalThis.ui = { notifications: {} };
  const session = new LiveStageSession();
  session.state = createInitialState();
  session.state.stage = { ...session.state.stage, phase: "live", active: true };
  session.state.scene.portraits = [{
    id: "user-player",
    profileId: "user-player",
    sourceUserId: "player",
    sourceActorId: "actor-player",
    name: "Игрок",
    image: "",
    slot: 0,
    side: "left",
    flipped: false,
    hidden: false
  }];
  const controller = Object.create(StageOverlayController.prototype);
  controller.session = session;

  try {
    controller._bindHoldButton(button, "portrait-player");
    const pointerDown = new Event("pointerdown", { cancelable: true });
    Object.defineProperties(pointerDown, {
      button: { value: 0 },
      pointerId: { value: 7 }
    });
    button.dispatchEvent(pointerDown);
    await Promise.resolve();
    assert.deepEqual(commands, ["speechStart"]);
    assert.equal(session.speaking, true);
    assert.equal(button.hasPointerCapture(7), true);

    window.dispatchEvent(new Event(eventType));
    await Promise.resolve();
    assert.deepEqual(commands, ["speechStart", "speechStop"]);
    assert.equal(session.speaking, false);
    assert.equal(button.hasPointerCapture(7), false);
    assert.equal(controller.releaseSpeech, null);
  } finally {
    controller._disarmSpeechRelease();
    session.destroy();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalGame === undefined) delete globalThis.game;
    else globalThis.game = originalGame;
    if (originalUi === undefined) delete globalThis.ui;
    else globalThis.ui = originalUi;
  }
}

test("pointerup stops speaking and releases the portrait highlight", () => verifyRelease("pointerup"));
test("pointercancel stops speaking and releases the portrait highlight", () => verifyRelease("pointercancel"));
test("window blur stops speaking and releases the portrait highlight", () => verifyRelease("blur"));
