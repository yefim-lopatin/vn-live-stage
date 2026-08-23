import {
  MODULE_ID,
  allPortraits,
  getStagePhase,
  makeId,
  overlayStructureSignature,
  shouldDisplayStage,
  speakingIds
} from "./core.js";
import { listLibrary, listScenes, saveLibraryRecord } from "./storage.js";

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
    position: { width: 780, height: 820 }
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
    const phase = getStagePhase(state.stage);
    const portraits = [...state.scene.portraits]
      .sort((a, b) => a.slot - b.slot)
      .map((portrait) => ({
        ...portrait,
        isLeft: portrait.side === "left"
      }));
    const scenes = listScenes().map((scene) => ({
      ...scene,
      portraitCount: scene.portraits?.length ?? 0,
      hasBackground: Boolean(scene.background)
    }));
    const groups = listLibrary("group").map((group) => ({
      ...group,
      portraitCount: group.portraits?.length ?? 0
    }));
    const playerAvatarCount = game.users.filter((user) => !user.isGM && user.character).length;
    return {
      state,
      phase,
      isInactive: phase === "inactive",
      isPreparing: phase === "preparing",
      isLive: phase === "live",
      portraits,
      hasPortraits: portraits.length > 0,
      scenes,
      hasScenes: scenes.length > 0,
      groups,
      hasGroups: groups.length > 0,
      playerAvatarCount
    };
  }

  _onRender() {
    const root = this.element;
    if (!root) return;
    const run = (promise) => promise.catch(notifyError);

    root.querySelector("[data-action='prepare-stage']")?.addEventListener("click", () => run(this.session.prepareStage()));
    root.querySelector("[data-action='publish-stage']")?.addEventListener("click", () => run(this.session.publishStage()));
    root.querySelector("[data-action='return-to-preparation']")?.addEventListener("click", () => run(this.session.returnToPreparation()));
    root.querySelector("[data-action='end-stage']")?.addEventListener("click", () => run(this.session.deactivateStage()));
    root.querySelector("[data-action='save']")?.addEventListener("click", () => run(this.session.saveScene()));
    root.querySelector("[data-action='undo']")?.addEventListener("click", () => run(this.session.undo()));
    root.querySelector("[data-action='redo']")?.addEventListener("click", () => run(this.session.redo()));
    root.querySelector("[data-action='new-scene']")?.addEventListener("click", () => run(this.session.newScene()));
    root.querySelector("[data-action='add-player-avatars']")?.addEventListener("click", () => run(this.session.addPlayerAvatars()));

    root.querySelector("[data-action='browse-background']")?.addEventListener("click", () => this._browse("background"));
    root.querySelector("[data-action='browse-portrait']")?.addEventListener("click", () => this._browse("portrait-image"));

    root.querySelector("[data-action='set-background']")?.addEventListener("click", () => {
      const background = root.querySelector("[name='background']")?.value?.trim() ?? "";
      run(this.session.dispatch({ type: "setBackground", payload: { background } }));
    });

    root.querySelector("[data-action='set-scene-details']")?.addEventListener("click", () => {
      run(this._setSceneDetails(root));
    });

    root.querySelector("[data-action='add-portrait']")?.addEventListener("click", () => {
      const name = root.querySelector("[name='portrait-name']")?.value?.trim() ?? "";
      const image = root.querySelector("[name='portrait-image']")?.value?.trim() ?? "";
      const side = root.querySelector("[name='portrait-side']")?.value === "left" ? "left" : "right";
      run(this.session.dispatch({ type: "addPortrait", payload: { name, image, side } }));
    });

    root.querySelector("[data-action='save-preset']")?.addEventListener("click", () => run(this._savePreset(root)));
    root.querySelector("[data-action='save-group']")?.addEventListener("click", () => run(this._saveGroup(root)));

    root.querySelectorAll("[data-action='load-preset']").forEach((button) => button.addEventListener("click", () => {
      run(this.session.loadScene(button.dataset.sceneId));
    }));

    root.querySelectorAll("[data-action='apply-group']").forEach((button) => button.addEventListener("click", () => {
      const group = listLibrary("group").find((item) => item.id === button.dataset.groupId);
      if (group) run(this.session.addPortraits(group.portraits ?? []));
    }));

    root.querySelectorAll("[data-action='remove-portrait']").forEach((button) => button.addEventListener("click", () => {
      run(this.session.dispatch({ type: "removePortrait", payload: { portraitId: button.dataset.portraitId } }));
    }));

    root.querySelectorAll("[data-action='switch-side']").forEach((button) => button.addEventListener("click", () => {
      run(this.session.dispatch({
        type: "updatePortrait",
        payload: { portraitId: button.dataset.portraitId, side: button.dataset.side }
      }));
    }));

    root.querySelectorAll("[data-action='flip-portrait']").forEach((button) => button.addEventListener("click", () => {
      run(this.session.dispatch({
        type: "updatePortrait",
        payload: { portraitId: button.dataset.portraitId, flipped: button.dataset.flipped !== "true" }
      }));
    }));

  }

  async _setSceneDetails(root) {
    const name = root.querySelector("[name='scene-name']")?.value?.trim() || "Новая сцена";
    const time = root.querySelector("[name='scene-time']")?.value?.trim() ?? "";
    const weather = root.querySelector("[name='scene-weather']")?.value?.trim() ?? "";
    return this.session.dispatch({ type: "setSceneDetails", payload: { name, time, weather } });
  }

  async _savePreset(root) {
    const name = root.querySelector("[name='preset-name']")?.value?.trim()
      || root.querySelector("[name='scene-name']")?.value?.trim()
      || this.session.getState().scene.name;
    await this._setSceneDetails(root);
    await this.session.saveScene({ sceneId: makeId("scene"), name });
    ui.notifications?.info?.(`Сцена «${name}» добавлена в библиотеку`);
    this.render();
  }

  async _saveGroup(root) {
    const name = root.querySelector("[name='group-name']")?.value?.trim();
    const portraits = this.session.getState().scene.portraits;
    if (!name) throw new Error("Укажите название группы");
    if (!portraits.length) throw new Error("На сцене нет участников для группы");
    await saveLibraryRecord("group", {
      id: makeId("group"),
      name,
      portraits,
      createdAt: Date.now()
    });
    ui.notifications?.info?.(`Группа «${name}» сохранена`);
    this.render();
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
    const phase = getStagePhase(state.stage);
    const shouldShow = shouldDisplayStage(state.stage, game.user.isGM);
    if (!shouldShow) {
      this.unmount();
      return;
    }

    const signature = overlayStructureSignature(state, {
      hideUi: game.settings.get(MODULE_ID, "hideFoundryUi")
    });
    if (signature === this.signature && this.element?.isConnected) {
      this._updateSpeechState(state);
      return;
    }
    this.signature = signature;

    const activeSpeaking = speakingIds(state);
    const decorate = (portrait) => ({
      ...portrait,
      hasImage: Boolean(portrait.image),
      speaking: activeSpeaking.has(portrait.id)
    });
    const portraits = allPortraits(state).map(decorate).sort((a, b) => a.slot - b.slot);
    const context = {
      state,
      background: state.scene.background,
      leftPortraits: portraits.filter((portrait) => portrait.side !== "right"),
      rightPortraits: portraits.filter((portrait) => portrait.side === "right"),
      isGM: Boolean(game.user.isGM),
      isPreparing: phase === "preparing",
      isLive: phase === "live",
      isSpeaking: Boolean(state.speaking[game.user.id]),
      canSpeak: !game.user.isGM && this.session.canCurrentUserSpeak()
    };

    const token = ++this.renderToken;
    const html = await foundry.applications.handlebars.renderTemplate(
      `modules/${MODULE_ID}/templates/overlay.hbs`,
      context
    );
    const currentState = this.session.getState();
    const stillVisible = shouldDisplayStage(currentState.stage, game.user.isGM);
    if (token !== this.renderToken || !stillVisible) return;
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
    this._updateSpeechState(this.session.getState());
  }

  _bind() {
    const button = this.element?.querySelector("[data-action='speak']");
    if (button) this._bindHoldButton(button);
    this.element?.querySelectorAll("[data-action='portrait-speak']").forEach((portraitButton) => {
      this._bindHoldButton(portraitButton, portraitButton.dataset.portraitId);
    });
    this.element?.querySelector("[data-action='publish-stage']")?.addEventListener("click", () => {
      this.session.publishStage().catch(notifyError);
    });
    this.element?.querySelector("[data-action='return-to-preparation']")?.addEventListener("click", () => {
      this.session.returnToPreparation().catch(notifyError);
    });
    this.element?.querySelector("[data-action='end-stage']")?.addEventListener("click", () => {
      this.session.deactivateStage().catch(notifyError);
    });
    this.element?.querySelector("[data-action='open-director']")?.addEventListener("click", () => this.openDirector?.());
  }

  _bindHoldButton(button, portraitId = null) {
    button?.addEventListener("contextmenu", (event) => event.preventDefault());
    button?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this._armSpeechRelease();
      this.session.startSpeaking(portraitId).catch((error) => {
        this._disarmSpeechRelease();
        notifyError(error);
      });
    });
  }

  _updateSpeechState(state) {
    if (!this.element) return;
    const activePortraits = speakingIds(state);
    this.element.querySelectorAll("[data-portrait-id]").forEach((element) => {
      const portraitId = element.dataset.portraitId;
      if (element.matches(".vn-cinematic-portrait")) {
        element.classList.toggle("is-speaking", activePortraits.has(portraitId));
      }
      if (element.matches("[data-action='portrait-speak']")) {
        const active = activePortraits.has(portraitId);
        element.classList.toggle("is-active", active);
        const label = element.querySelector("span");
        if (label) label.textContent = active ? "Говорю…" : "Говорить";
      }
    });
    const playerButton = this.element.querySelector("[data-action='speak']");
    if (playerButton) {
      const active = Boolean(state.speaking[game.user.id]);
      playerButton.classList.toggle("is-active", active);
      const label = playerButton.querySelector("span");
      if (label) label.textContent = active ? "Говорю…" : "Удерживайте, чтобы говорить";
    }
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
