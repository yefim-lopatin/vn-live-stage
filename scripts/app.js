import { MODULE_ID, allPortraits, speakingIds } from "./core.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

export class LiveStageApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-app`,
    classes: [MODULE_ID],
    window: { title: "VN Live Stage", resizable: true },
    position: { width: 1100, height: 720 }
  };

  static PARTS = {
    stage: {
      template: `modules/${MODULE_ID}/templates/stage.hbs`,
      root: true
    }
  };

  constructor(session, options = {}) {
    super(options);
    this.session = session;
    this.unsubscribe = session.onChange(() => this.render());
  }

  async _prepareContext() {
    const state = this.session.getState();
    const activeSpeaking = speakingIds(state);
    const portraits = allPortraits(state).map((portrait) => ({
      ...portrait,
      speaking: activeSpeaking.has(portrait.id),
      dimmed: activeSpeaking.size > 0 && !activeSpeaking.has(portrait.id)
    }));
    return {
      state,
      portraits,
      isGM: Boolean(game.user.isGM),
      isSpeaking: Boolean(state.speaking[game.user.id]),
      requests: state.requests
        .filter((request) => game.user.isGM || request.userId === game.user.id)
        .map((request) => ({ ...request, pending: request.status === "pending" }))
    };
  }

  _onRender() {
    const root = this.element;
    if (!root) return;
    root.querySelector("[data-action='speak']")?.addEventListener("pointerdown", () => this.session.startSpeaking().catch(this._notifyError));
    root.querySelector("[data-action='speak']")?.addEventListener("pointerup", () => this.session.stopSpeaking().catch(this._notifyError));
    root.querySelector("[data-action='speak']")?.addEventListener("pointercancel", () => this.session.stopSpeaking().catch(this._notifyError));
    root.querySelector("[data-action='stop-speaking']")?.addEventListener("click", () => this.session.stopSpeaking().catch(this._notifyError));
    root.querySelector("[data-action='save']")?.addEventListener("click", () => this.session.saveScene().catch(this._notifyError));
    root.querySelector("[data-action='undo']")?.addEventListener("click", () => this.session.undo().catch(this._notifyError));
    root.querySelector("[data-action='redo']")?.addEventListener("click", () => this.session.redo().catch(this._notifyError));
    root.querySelector("[data-action='add-portrait']")?.addEventListener("click", () => {
      const name = root.querySelector("[name='portrait-name']")?.value?.trim();
      const image = root.querySelector("[name='portrait-image']")?.value?.trim();
      this.session.dispatch({ type: "addPortrait", payload: { name, image } }).catch(this._notifyError);
    });
    root.querySelector("[data-action='set-background']")?.addEventListener("click", () => {
      const background = root.querySelector("[name='background']")?.value?.trim();
      this.session.dispatch({ type: "setBackground", payload: { background } }).catch(this._notifyError);
    });
    root.querySelector("[data-action='load-scene']")?.addEventListener("click", () => {
      const sceneId = root.querySelector("[name='scene-id']")?.value?.trim();
      if (sceneId) this.session.loadScene(sceneId).catch(this._notifyError);
    });
    root.querySelectorAll("[data-action='remove-portrait']").forEach((button) => button.addEventListener("click", () => this.session.dispatch({
      type: "removePortrait",
      payload: { portraitId: button.dataset.portraitId }
    }).catch(this._notifyError)));
    root.querySelector("[data-action='request']")?.addEventListener("click", () => this._sendRequest(root));
    root.querySelectorAll("[data-action='resolve-request']").forEach((button) => button.addEventListener("click", () => this.session.dispatch({
      type: "resolveRequest",
      payload: { requestId: button.dataset.requestId, status: button.dataset.status }
    }).catch(this._notifyError)));
  }

  async _sendRequest(root) {
    const input = root.querySelector("[name='request']");
    const text = input?.value?.trim();
    if (!text) return;
    await this.session.dispatch({ type: "createRequest", payload: { text } });
    input.value = "";
    ui.notifications?.info?.("Заявка отправлена");
  }

  _notifyError = (error) => ui.notifications?.error?.(error.message ?? String(error));

  async close(options) {
    this.unsubscribe?.();
    return super.close(options);
  }
}
