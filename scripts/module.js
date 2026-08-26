import { MODULE_ID, clone } from "./core.js";
import { DEFAULT_POLICY } from "./permissions.js";
import { LiveStageSession } from "./session.js";
import { StageDirectorApplication, StageOverlayController } from "./app.js";

let session;
let directorApplication;
let overlayController;

function openDirector() {
  if (!session) {
    ui.notifications?.warn?.(game.i18n.localize("VNLiveStage.notifications.notReady"));
    return null;
  }
  if (!game.user.isGM) {
    ui.notifications?.warn?.(game.i18n.localize("VNLiveStage.gmOnly"));
    return null;
  }
  if (directorApplication?.rendered) {
    directorApplication.bringToFront?.();
    return directorApplication;
  }
  directorApplication = new StageDirectorApplication(session);
  directorApplication.render(true);
  return directorApplication;
}

async function openPreparation() {
  if (!session) {
    ui.notifications?.warn?.(game.i18n.localize("VNLiveStage.notifications.notReady"));
    return null;
  }
  if (!game.user.isGM) {
    ui.notifications?.warn?.(game.i18n.localize("VNLiveStage.gmOnly"));
    return null;
  }
  if ((session.getState().stage?.phase ?? "inactive") === "inactive") await session.prepareStage();
  return openDirector();
}

function registerSettings() {
  game.settings.register(MODULE_ID, "liveState", {
    name: "VN Live Stage: live state",
    scope: "world",
    config: false,
    type: Object,
    default: null
  });
  game.settings.register(MODULE_ID, "permissionPolicy", {
    name: "VN Live Stage: permission policy",
    scope: "world",
    config: false,
    type: Object,
    default: clone(DEFAULT_POLICY)
  });
  game.settings.register(MODULE_ID, "showSceneControlButton", {
    name: "VNLiveStage.settings.showSceneControlButton.name",
    hint: "VNLiveStage.settings.showSceneControlButton.hint",
    scope: "client",
    config: true,
    requiresReload: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, "hideFoundryUi", {
    name: "VNLiveStage.settings.hideFoundryUi.name",
    hint: "VNLiveStage.settings.hideFoundryUi.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => overlayController?.sync(session.getState())
  });
  game.settings.register(MODULE_ID, "allowPlayerJoin", {
    name: "VNLiveStage.settings.allowPlayerJoin.name",
    hint: "VNLiveStage.settings.allowPlayerJoin.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => overlayController?.sync(session.getState())
  });
}

function registerKeybindings() {
  const { SHIFT } = foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS;
  game.keybindings.register(MODULE_ID, "toggleStage", {
    name: "VNLiveStage.keybindings.toggleStage.name",
    hint: "VNLiveStage.keybindings.toggleStage.hint",
    restricted: true,
    editable: [{ key: "KeyV", modifiers: [SHIFT] }],
    onDown: () => {
      if (!game.user.isGM) return false;
      openPreparation().catch((error) => ui.notifications?.error?.(error.message));
      return true;
    }
  });
}

function registerSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM || !game.settings.get(MODULE_ID, "showSceneControlButton")) return;
    controls[MODULE_ID] = {
      name: MODULE_ID,
      order: 95,
      title: "VNLiveStage.controls.stage.title",
      icon: "fa-solid fa-masks-theater",
      onChange: (_event, active) => {
        if (active) openDirector();
      },
      tools: {
        director: {
          name: "director",
          order: 0,
          title: "VNLiveStage.controls.director.title",
          icon: "fa-solid fa-sliders",
          button: true,
          onChange: openDirector
        },
        toggleStage: {
          name: "toggleStage",
          order: 1,
          title: "VNLiveStage.controls.toggleStage.title",
          icon: "fa-solid fa-clapperboard",
          button: true,
          onChange: () => openPreparation().catch((error) => ui.notifications?.error?.(error.message))
        }
      }
    };
  });
}

function exposeApi() {
  const module = game.modules.get(MODULE_ID);
  module.api = {
    open: openDirector,
    openDirector,
    close: () => directorApplication?.close(),
    prepare: () => session.prepareStage(),
    activate: () => session.publishStage(),
    publish: () => session.publishStage(),
    returnToPreparation: () => session.returnToPreparation(),
    deactivate: () => session.deactivateStage(),
    toggle: () => session.toggleStage(),
    newScene: (name) => session.newScene(name),
    addPlayerAvatars: () => session.addPlayerAvatars(),
    joinStage: () => session.joinStage(),
    getState: () => session?.getState() ?? null,
    dispatch: (command) => session.dispatch(command),
    startSpeaking: (portraitId) => session.startSpeaking(portraitId),
    stopSpeaking: () => session.stopSpeaking(),
    saveScene: (options) => session.saveScene(options),
    loadScene: (sceneId) => session.loadScene(sceneId),
    undo: () => session.undo(),
    redo: () => session.redo(),
    getSession: () => session,
    adapters: {},
    registerAdapter: (systemId, adapter) => {
      if (!systemId || !adapter) throw new Error("Нужны systemId и adapter");
      module.api.adapters[systemId] = adapter;
      return adapter;
    }
  };
}

Hooks.once("init", () => {
  registerSettings();
  registerKeybindings();
  registerSceneControls();
});

Hooks.once("ready", async () => {
  session = await new LiveStageSession().initialize();
  overlayController = new StageOverlayController(session, { openDirector });
  exposeApi();
  console.info(`${MODULE_ID} | готов к работе`);
});
