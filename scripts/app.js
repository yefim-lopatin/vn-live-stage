import { MODULE_ID, allPortraits, speakingIds } from "./core.js";

const ApplicationV2 = foundry.applications.api.ApplicationV2;
const HandlebarsApplicationMixin = foundry.applications.api.HandlebarsApplicationMixin;

function notifyError(error) {
  ui.notifications?.error?.(error?.message ?? String(error));
}

export class StageDirectorApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-director`,
    classes: [MODULE_ID, "vn-live-stage-director"],
    window: { title: "VN Live Stage · Режиссёр", resizable: true },
    position: { width: 720, height: 690 }
  };

  static PARTS = {
    director: {
      template: `modules/${MODULE_ID}/templates/director.hbs`,
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
    const portraits = [...state.scene.portraits]
      .sort((a, b) => a.slot - b.slot)
      .map((portrait) => ({ ...portrait, isLeft: portrait.side === "left" }));
    return {
      state,
      active: Boolean(state.stage?.active),
      portraits,
      hasPortraits: portraits.length > 0
    };
  }

  _onRender() {
    const root = this.element;
    if (!root) return;

    root.querySelector("[data-action='toggle-stage']")?.addEventListener("click", () => this.session.toggleStage().catch(notifyError));
    root.querySelector("[data-action='save']")?.addEventListener("click", () => this.session.saveScene().catch(notifyError));
    root.querySelector("[data-action='undo']")?.addEventListener("click", () => this.session.undo().catch(notifyError));
    root.querySelector("[data-action='redo']")?.addEventListener("click", () => this.session.redo().catch(notifyError));

    root.querySelector("[data-action='browse-background']")?.addEventListener("click", () => this._browse("background"));
    root.querySelector("[data-action='browse-portrait']")?.addEventListener("click", () => this._browse("portrait-image"));

    root.querySelector("[data-action='set-background']")?.addEventListener("click", () => {
      const background = root.querySelector("[name='background']")?.value?.trim() ?? "";
      this.session.dispatch({ type: "setBackground", payload: { background } }).catch(notifyError);
    });

    root.querySelector("[data-action='set-environment']")?.addEventListener("click", () => {
      const time = root.querySelector("[name='scene-time']")?.value?.trim() ?? "";
      const weather = root.querySelector("[name='scene-weather']")?.value?.trim() ?? "";
      this.session.dispatch({ type: "setEnvironment", payload: { time, weather } }).catch(notifyError);
    });

    root.querySelector("[data-action='add-portrait']")?.addEventListener("click", async () => {
      const name = root.querySelector("[name='portrait-name']")?.value?.trim() ?? "";
      const image = root.querySelector("[name='portrait-image']")?.value?.trim() ?? "";
      const side = root.querySelector("[name='portrait-side']")?.value === "left" ? "left" : "right";
      try {
        await this.session.dispatch({ type: "addPortrait", payload: { name, image, side } });
      } catch (error) {
        notifyError(error);
      }
    });

    root.querySelector("[data-action='load-scene']")?.addEventListener("click", () => {
      const sceneId = root.querySelector("[name='scene-id']")?.value?.trim();
      if (sceneId) this.session.loadScene(sceneId).catch(notifyError);
    });

    root.querySelectorAll("[data-action='remove-portrait']").forEach((button) => button.addEventListener("click", () => {
      this.session.dispatch({ type: "removePortrait", payload: { portraitId: button.dataset.portraitId } }).catch(notifyError);
    }));

    root.querySelectorAll("[data-action='switch-side']").forEach((button) => button.addEventListener("click", () => {
      this.session.dispatch({
        type: "updatePortrait",
        payload: { portraitId: button.dataset.portraitId, side: button.dataset.side }
      }).catch(notifyError);
    }));
  }

  _browse(inputName) {
    const input = this.element?.querySelector(`[name='${inputName}']`);
    if (!input) return;
    const Picker = foundry.applications.apps.FilePicker.implementation;
    new Picker({
      type: "image",
      current: input.value,
      callback: (path) => { input.value = path; }
    }).render(true);
  }

  async close(options) {
    this.unsubscribe?.();
    return super.close(options);
  }
}

export class StageOverlayController {
  constructor(session, { openDirector } = {}) {
    this.session = session;
    this.openDirector = openDirector;
    this.element = null;
    this.signature = null;
    this.renderToken = 0;
    this.unsubscribe = session.onChange((state) => this.sync(state));
    this.sync(session.getState());
  }

  async sync(state) {
    if (!state.stage?.active) {
      this.unmount();
      return;
    }

    const signature = JSON.stringify({
      scene: state.scene,
      overflow: state.overflow,
      speaking: Object.values(state.speaking).map(({ userId, portraitId }) => ({ userId, portraitId })),
      hideUi: game.settings.get(MODULE_ID, "hideFoundryUi")
    });
    if (signature === this.signature && this.element?.isConnected) return;
    this.signature = signature;

    const activeSpeaking = speakingIds(state);
    const decorate = (portrait) => ({
      ...portrait,
      hasImage: Boolean(portrait.image),
      speaking: activeSpeaking.has(portrait.id),
      dimmed: activeSpeaking.size > 0 && !activeSpeaking.has(portrait.id)
    });
    const portraits = allPortraits(state).map(decorate).sort((a, b) => a.slot - b.slot);
    const context = {
      state,
      background: state.scene.background,
      leftPortraits: portraits.filter((portrait) => portrait.side !== "right"),
      rightPortraits: portraits.filter((portrait) => portrait.side === "right"),
      isGM: Boolean(game.user.isGM),
      isSpeaking: Boolean(state.speaking[game.user.id]),
      canSpeak: !game.user.isGM && this.session.canCurrentUserSpeak()
    };

    const token = ++this.renderToken;
    const html = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/overlay.hbs`, context);
    if (token !== this.renderToken || !this.session.getState().stage?.active) return;
    const holder = document.createElement("div");
    holder.innerHTML = html.trim();
    const next = holder.firstElementChild;
    if (!next) return;
    this.element?.replaceWith(next);
    if (!this.element) document.body.append(next);
    this.element = next;
    document.body.classList.add("vn-live-stage-active");
    document.body.classList.toggle("vn-live-stage-hide-ui", Boolean(game.settings.get(MODULE_ID, "hideFoundryUi")));
    this._bind();
  }

  _bind() {
    const button = this.element?.querySelector("[data-action='speak']");
    button?.addEventListener("contextmenu", (event) => event.preventDefault());
    button?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this._armSpeechRelease();
      this.session.startSpeaking().catch((error) => {
        this._disarmSpeechRelease();
        notifyError(error);
      });
    });
    this.element?.querySelector("[data-action='end-stage']")?.addEventListener("click", () => {
      this.session.deactivateStage().catch(notifyError);
    });
    this.element?.querySelector("[data-action='open-director']")?.addEventListener("click", () => this.openDirector?.());
  }

  _armSpeechRelease() {
    this._disarmSpeechRelease();
    this.releaseSpeech = () => {
      this._disarmSpeechRelease();
      this.session.stopSpeaking().catch(notifyError);
    };
    window.addEventListener("pointerup", this.releaseSpeech, true);
    window.addEventListener("pointercancel", this.releaseSpeech, true);
    window.addEventListener("blur", this.releaseSpeech, true);
  }

  _disarmSpeechRelease() {
    if (!this.releaseSpeech) return;
    window.removeEventListener("pointerup", this.releaseSpeech, true);
    window.removeEventListener("pointercancel", this.releaseSpeech, true);
    window.removeEventListener("blur", this.releaseSpeech, true);
    this.releaseSpeech = null;
  }

  unmount() {
    this.renderToken += 1;
    this.signature = null;
    this._disarmSpeechRelease();
    this.element?.remove();
    this.element = null;
    document.body.classList.remove("vn-live-stage-active", "vn-live-stage-hide-ui");
  }

  destroy() {
    this.unsubscribe?.();
    this.unmount();
  }
}
