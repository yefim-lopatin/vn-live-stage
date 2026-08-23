import {
  MODULE_ID,
  SOCKET_NAME,
  MAX_HISTORY,
  MAX_SLOTS,
  SPEECH_TIMEOUT_MS,
  clone,
  createCommand,
  createSceneDefinition,
  createInitialState,
  firstFreeSlot,
  applySceneCommand,
  applyTransientCommand,
  expireSpeaking
} from "./core.js";
import { DEFAULT_POLICY, can, normalizePolicy } from "./permissions.js";
import { getSystemAdapter } from "./adapters.js";
import { getScene, readLiveState, saveScene, writeLiveState } from "./storage.js";

export class LiveStageSession {
  constructor() {
    this.state = createInitialState();
    this.listeners = new Set();
    this.cleanup = [];
    this.speaking = false;
    this.speechTimer = null;
  }

  async initialize() {
    this.state = await readLiveState();
    this.state.connectedUsers = game.users.filter((user) => user.active).map((user) => ({ id: user.id, name: user.name }));
    if (game.user.isGM) this.state = expireSpeaking(this.state, 0);
    game.socket.on(SOCKET_NAME, (message, respond) => this._receive(message, respond));
    this._bindHooks();
    if (game.user.isGM) {
      this._startHeartbeatMonitor();
      await this._broadcast();
    } else {
      await this._requestSnapshot();
    }
    this._emit();
    return this;
  }

  destroy() {
    for (const stop of this.cleanup.splice(0)) stop();
    clearInterval(this.heartbeatMonitor);
    clearInterval(this.speechTimer);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return clone(this.state);
  }

  async dispatch(input) {
    const command = input?.id ? clone(input) : createCommand(input.type, input.payload, {
      userId: game.user.id,
      revision: this.state.revision
    });
    command.userId = game.user.id;
    if (game.user.isGM) return this._apply(command);
    const response = await this._dispatchSocket({ kind: "command", userId: game.user.id, command });
    if (!response?.ok) throw new Error(response?.error ?? "Команда отклонена");
    if (response.state) this.state = clone(response.state);
    this._emit();
    return this.getState();
  }

  async startSpeaking() {
    if (this.speaking) return this.getState();
    if (!this.state.stage?.active) throw new Error("Режим сцены не активен");
    const result = await this.dispatch({ type: "speechStart", payload: {} });
    this.speaking = true;
    this.speechTimer = setInterval(() => {
      if (this.speaking) this.dispatch({ type: "speechHeartbeat", payload: {} }).catch(() => {});
    }, 3000);
    return result;
  }

  async stopSpeaking() {
    if (!this.speaking) return this.getState();
    this.speaking = false;
    clearInterval(this.speechTimer);
    this.speechTimer = null;
    return this.dispatch({ type: "speechStop", payload: {} });
  }

  async activateStage() {
    return this.dispatch({ type: "activateStage", payload: {} });
  }

  async deactivateStage() {
    return this.dispatch({ type: "deactivateStage", payload: {} });
  }

  async toggleStage() {
    return this.state.stage?.active ? this.deactivateStage() : this.activateStage();
  }

  canCurrentUserSpeak() {
    return Boolean(this._portraitFor(game.user.id));
  }

  async saveScene(options = {}) {
    if (!game.user.isGM) return this.dispatch({ type: "saveScene", payload: options });
    await saveScene(this.state, options);
    ui.notifications?.info?.("Сцена сохранена");
    return this.getState();
  }

  async loadScene(sceneId) {
    return this.dispatch({ type: "loadScene", payload: { sceneId } });
  }

  async undo() {
    return this.dispatch({ type: "undo", payload: {} });
  }

  async redo() {
    return this.dispatch({ type: "redo", payload: {} });
  }

  async _apply(command) {
    try {
      const user = game.users.get(command.userId);
      this._authorize(command, user);
      if (command.type === "activateStage") {
        this._seedPlayerPortraits();
        this.state.stage = {
          active: true,
          activatedAt: Date.now(),
          activatedBy: command.userId
        };
      } else if (command.type === "deactivateStage") {
        this.state.stage = { active: false, activatedAt: null, activatedBy: null };
        this.state.speaking = {};
        this.state.overflow = [];
        this._resetLocalSpeaking();
      } else if (["speechStart", "speechStop", "speechHeartbeat"].includes(command.type)) {
        if (command.type !== "speechStop" && !this.state.stage?.active) throw new Error("Режим сцены не активен");
        const portrait = this._portraitFor(command.userId);
        if (command.type === "speechStart" && !portrait) throw new Error("У игрока нет персонажа для портрета");
        this.state = applyTransientCommand(this.state, command, { userId: command.userId, portrait });
      } else if (command.type === "saveScene") {
        await saveScene(this.state, command.payload);
      } else if (command.type === "loadScene") {
        const scene = getScene(command.payload.sceneId);
        if (!scene) throw new Error("Сохранённая сцена не найдена");
        this.state.scene = createSceneDefinition(scene);
        this.state.revision += 1;
        this.state.history = [];
        this.state.redo = [];
      } else if (command.type === "undo") {
        this._undo();
      } else if (command.type === "redo") {
        this._redo();
      } else {
        if (command.revision !== this.state.revision) throw new Error("Конфликт ревизий: требуется свежий snapshot");
        const result = applySceneCommand(this.state, command);
        this.state = result.state;
        this.state.history.unshift(result.event);
        this.state.history = this.state.history.slice(0, MAX_HISTORY);
        this.state.redo = [];
      }
      this.state.updatedAt = Date.now();
      await writeLiveState(this.state);
      await this._broadcast();
      this._emit();
      return this.getState();
    } catch (error) {
      throw new Error(error.message || "Команда отклонена");
    }
  }

  _authorize(command, user) {
    if (!user) throw new Error("Неизвестный пользователь");
    const policy = normalizePolicy(game.settings.get(MODULE_ID, "permissionPolicy") ?? DEFAULT_POLICY);
    if (["speechStart", "speechStop", "speechHeartbeat"].includes(command.type)) return;
    if (["activateStage", "deactivateStage"].includes(command.type) && user.isGM) return;
    if (command.type === "createRequest" && user.active !== false) return;
    if (["resolveRequest"].includes(command.type) && can(user, "requestReview", policy)) return;
    if (["saveScene"].includes(command.type) && can(user, "saveScene", policy)) return;
    if (["undo", "redo"].includes(command.type) && can(user, "undo", policy)) return;
    if (["loadScene"].includes(command.type) && can(user, "sceneControl", policy)) return;
    if (["addPortrait", "removePortrait", "movePortrait", "updatePortrait", "setLocation", "setBackground", "setEnvironment"].includes(command.type) && can(user, "sceneControl", policy)) return;
    throw new Error("Недостаточно прав для этой команды");
  }

  _portraitFor(userId) {
    const active = this.state.speaking[userId];
    const existing = active && [...this.state.scene.portraits, ...this.state.overflow].find((item) => item.id === active.portraitId);
    if (existing) return existing;
    const profileId = `user-${userId}`;
    const known = [...this.state.scene.portraits, ...this.state.overflow].find((item) => item.profileId === profileId);
    if (known) return known;
    return getSystemAdapter().getPortrait(game.users.get(userId));
  }

  _seedPlayerPortraits() {
    const knownProfiles = new Set([...this.state.scene.portraits, ...this.state.overflow].map((item) => item.profileId));
    for (const user of game.users.filter((item) => item.active && !item.isGM)) {
      const portrait = getSystemAdapter().getPortrait(user);
      if (!portrait || knownProfiles.has(portrait.profileId)) continue;
      if (this.state.scene.portraits.length < MAX_SLOTS) {
        this.state.scene.portraits.push({
          ...portrait,
          side: "left",
          slot: firstFreeSlot(this.state.scene.portraits)
        });
      } else {
        this.state.overflow.push({ ...portrait, side: "left", overflow: true });
      }
      knownProfiles.add(portrait.profileId);
    }
  }

  _resetLocalSpeaking() {
    this.speaking = false;
    clearInterval(this.speechTimer);
    this.speechTimer = null;
  }

  _undo() {
    const event = this.state.history.shift();
    if (!event) throw new Error("Нет действий для отмены");
    this.state.redo.unshift(event);
    this.state.scene = clone(event.beforeState?.scene ?? event.before);
    if (event.beforeState) {
      this.state.requests = clone(event.beforeState.requests);
      this.state.overflow = clone(event.beforeState.overflow);
    }
    this.state.revision += 1;
  }

  _redo() {
    const event = this.state.redo.shift();
    if (!event) throw new Error("Нет действий для повтора");
    this.state.history.unshift(event);
    this.state.scene = clone(event.afterState?.scene ?? event.after);
    if (event.afterState) {
      this.state.requests = clone(event.afterState.requests);
      this.state.overflow = clone(event.afterState.overflow);
    }
    this.state.revision += 1;
  }

  async _receive(message, respond) {
    if (!message?.kind) return;
    if (message.kind === "snapshot") {
      if (!game.user.isGM && message.state) {
        this.state = clone(message.state);
        if (!this.state.stage?.active || !this.state.speaking?.[game.user.id]) this._resetLocalSpeaking();
        this._emit();
      }
      return;
    }
    if (message.kind === "sync") {
      if (game.user.isGM) respond?.({ ok: true, state: this.getState() });
      return;
    }
    if (message.kind !== "command" || !game.user.isGM) return;
    try {
      const state = await this._apply({ ...message.command, userId: message.userId, payload: clone(message.command?.payload) });
      respond?.({ ok: true, state });
    } catch (error) {
      respond?.({ ok: false, error: error.message, state: this.getState() });
    }
  }

  async _requestSnapshot() {
    const response = await this._dispatchSocket({ kind: "sync", userId: game.user.id });
    if (response?.state) {
      this.state = clone(response.state);
      if (!this.state.stage?.active || !this.state.speaking?.[game.user.id]) this._resetLocalSpeaking();
    }
  }

  async _dispatchSocket(message) {
    const dispatch = globalThis.foundry?.helpers?.SocketInterface?.dispatch;
    if (dispatch) return dispatch(SOCKET_NAME, message);
    return new Promise((resolve, reject) => game.socket.emit(SOCKET_NAME, message, (response) => response?.ok ? resolve(response) : reject(new Error(response?.error ?? "Socket error"))));
  }

  async _broadcast() {
    game.socket.emit(SOCKET_NAME, { kind: "snapshot", state: this.getState() });
  }

  _startHeartbeatMonitor() {
    this.heartbeatMonitor = setInterval(async () => {
      const next = expireSpeaking(this.state, SPEECH_TIMEOUT_MS);
      if (JSON.stringify(next.speaking) !== JSON.stringify(this.state.speaking)) {
        this.state = next;
        await writeLiveState(this.state);
        await this._broadcast();
        this._emit();
      }
    }, 3000);
  }

  _bindHooks() {
    const onUser = () => {
      this.state.connectedUsers = game.users.filter((user) => user.active).map((user) => ({ id: user.id, name: user.name }));
      this._broadcast().catch(() => {});
      this._emit();
    };
    const hookId = Hooks.on("updateUser", onUser);
    this.cleanup.push(() => Hooks.off("updateUser", hookId));
    const onBlur = () => this.speaking && this.stopSpeaking().catch(() => {});
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);
    window.addEventListener("pagehide", onBlur);
    this.cleanup.push(() => window.removeEventListener("blur", onBlur));
    this.cleanup.push(() => document.removeEventListener("visibilitychange", onBlur));
    this.cleanup.push(() => window.removeEventListener("pagehide", onBlur));
  }

  _emit() {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}
