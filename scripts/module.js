import { MODULE_ID, clone } from "./core.js";
import { DEFAULT_POLICY } from "./permissions.js";
import { LiveStageSession } from "./session.js";
import { LiveStageApplication } from "./app.js";

let session;

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
}

function exposeApi() {
  const module = game.modules.get(MODULE_ID);
  module.api = {
    open: () => {
      const app = new LiveStageApplication(session);
      return app.render(true);
    },
    getState: () => session?.getState() ?? null,
    dispatch: (command) => session.dispatch(command),
    startSpeaking: () => session.startSpeaking(),
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
  Hooks.on("getSceneNavigationContext", (_app, context) => {
    context.controls ??= [];
  });
});

Hooks.once("ready", async () => {
  session = await new LiveStageSession().initialize();
  exposeApi();
  console.info(`${MODULE_ID} | готов к работе`);
});
