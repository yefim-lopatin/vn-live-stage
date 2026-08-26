export const MODULE_ID = "vn-live-stage";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const MAX_HISTORY = 100;
export const MAX_REQUESTS = 100;
export const MAX_SLOTS = 6;
export const SPEECH_TIMEOUT_MS = 9000;

export const COMMANDS = Object.freeze([
  "prepareStage",
  "publishStage",
  "returnToPreparation",
  "deactivateStage",
  "joinStage",
  "newScene",
  "addPortrait",
  "addPortraits",
  "removePortrait",
  "movePortrait",
  "updatePortrait",
  "setSceneDetails",
  "setLocation",
  "setBackground",
  "setBackgroundVisibility",
  "setEnvironment",
  "createRequest",
  "resolveRequest",
  "saveScene",
  "loadScene",
  "undo",
  "redo",
  "speechStart",
  "speechStop",
  "speechHeartbeat"
]);

export const now = () => Date.now();

export function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function makeId(prefix = "id") {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function normalizePortrait(portrait = {}, index = 0) {
  const isPlayerPortrait = Boolean(
    portrait.sourceUserId || String(portrait.profileId ?? "").startsWith("user-")
  );
  const defaultSide = isPlayerPortrait ? "left" : "right";
  return {
    id: portrait.id ?? makeId("portrait"),
    profileId: portrait.profileId ?? null,
    sourceUserId: portrait.sourceUserId ?? null,
    sourceActorId: portrait.sourceActorId ?? null,
    name: String(portrait.name ?? "Безымянный персонаж"),
    image: portrait.image ?? "",
    slot: Number.isInteger(portrait.slot) ? portrait.slot : index,
    side: isPlayerPortrait ? "left" : (["left", "right"].includes(portrait.side) ? portrait.side : defaultSide),
    flipped: Boolean(portrait.flipped),
    position: portrait.position ?? null,
    hidden: Boolean(portrait.hidden)
  };
}

export function createSceneDefinition(input = {}) {
  const portraits = Array.isArray(input.portraits) ? input.portraits : [];
  const background = input.background ?? null;
  return {
    id: input.id ?? makeId("scene"),
    name: String(input.name ?? "Новая сцена"),
    locationId: input.locationId ?? null,
    background,
    backgroundVisible: input.backgroundVisible === undefined
      ? Boolean(background)
      : Boolean(input.backgroundVisible && background),
    time: String(input.time ?? ""),
    weather: String(input.weather ?? ""),
    portraits: portraits.map(normalizePortrait)
  };
}

export function createInitialState() {
  return {
    revision: 0,
    stage: {
      phase: "inactive",
      active: false,
      activatedAt: null,
      activatedBy: null
    },
    scene: createSceneDefinition(),
    overflow: [],
    speaking: {},
    requests: [],
    connectedUsers: [],
    history: [],
    redo: [],
    updatedAt: now()
  };
}

export function createCommand(type, payload = {}, { userId = null, revision = 0 } = {}) {
  if (!COMMANDS.includes(type)) throw new Error(`Неизвестная команда: ${type}`);
  return {
    id: makeId("command"),
    type,
    revision: Number.isInteger(revision) ? revision : 0,
    userId,
    payload: clone(payload),
    createdAt: now()
  };
}

function requirePortrait(scene, portraitId) {
  const portrait = scene.portraits.find((item) => item.id === portraitId);
  if (!portrait) throw new Error("Портрет не найден на сцене");
  return portrait;
}

function sceneEvent(command, before, after) {
  return {
    id: makeId("event"),
    commandId: command.id,
    type: command.type,
    userId: command.userId ?? null,
    revision: after.revision,
    before: clone(before.scene),
    after: clone(after.scene),
    beforeState: { scene: clone(before.scene), requests: clone(before.requests), overflow: clone(before.overflow) },
    afterState: { scene: clone(after.scene), requests: clone(after.requests), overflow: clone(after.overflow) },
    createdAt: now()
  };
}

export function applySceneCommand(inputState, command) {
  const state = clone(inputState);
  const before = clone(state);
  const payload = command.payload ?? {};

  switch (command.type) {
    case "newScene":
      state.scene = createSceneDefinition({ name: payload.name || "Новая сцена" });
      state.overflow = [];
      state.speaking = {};
      break;
    case "addPortrait": {
      if (state.scene.portraits.length >= MAX_SLOTS) throw new Error("Все основные слоты заняты");
      if (!payload.name && !payload.image) throw new Error("Портрет должен иметь имя или изображение");
      state.scene.portraits.push(normalizePortrait({
        ...payload,
        slot: Number.isInteger(payload.slot) ? payload.slot : firstFreeSlot(state.scene.portraits)
      }));
      break;
    }
    case "addPortraits": {
      const portraits = Array.isArray(payload.portraits) ? payload.portraits : [];
      const known = new Set(state.scene.portraits.flatMap((portrait) => [portrait.id, portrait.profileId]).filter(Boolean));
      for (const portrait of portraits) {
        if (!portrait?.name && !portrait?.image) continue;
        const existing = state.scene.portraits.find((item) => (
          (portrait.id && item.id === portrait.id)
          || (portrait.profileId && item.profileId === portrait.profileId)
        ));
        if (existing) {
          existing.name = String(portrait.name ?? existing.name);
          existing.image = portrait.image ?? existing.image;
          existing.sourceUserId = portrait.sourceUserId ?? existing.sourceUserId ?? null;
          existing.sourceActorId = portrait.sourceActorId ?? existing.sourceActorId ?? null;
          const isPlayerPortrait = existing.sourceUserId || String(existing.profileId ?? "").startsWith("user-");
          if (isPlayerPortrait) existing.side = "left";
          else if (["left", "right"].includes(portrait.side)) existing.side = portrait.side;
          continue;
        }
        if (state.scene.portraits.length >= MAX_SLOTS) break;
        const normalized = normalizePortrait({
          ...portrait,
          slot: firstFreeSlot(state.scene.portraits)
        });
        state.scene.portraits.push(normalized);
        if (normalized.id) known.add(normalized.id);
        if (normalized.profileId) known.add(normalized.profileId);
      }
      break;
    }
    case "removePortrait": {
      state.scene.portraits = state.scene.portraits.filter((portrait) => portrait.id !== payload.portraitId);
      state.overflow = state.overflow.filter((portrait) => portrait.id !== payload.portraitId);
      if (state.scene.portraits.length === before.scene.portraits.length && state.overflow.length === before.overflow.length) {
        throw new Error("Портрет не найден");
      }
      break;
    }
    case "movePortrait": {
      const portrait = requirePortrait(state.scene, payload.portraitId);
      if (!Number.isInteger(payload.slot) || payload.slot < 0 || payload.slot >= MAX_SLOTS) throw new Error("Некорректный слот");
      const occupied = state.scene.portraits.find((item) => item.slot === payload.slot && item.id !== portrait.id);
      if (occupied) occupied.slot = portrait.slot;
      portrait.slot = payload.slot;
      break;
    }
    case "updatePortrait": {
      const portrait = requirePortrait(state.scene, payload.portraitId);
      if (payload.name !== undefined) portrait.name = String(payload.name || "Безымянный персонаж");
      if (payload.image !== undefined) portrait.image = payload.image ?? "";
      const isPlayerPortrait = portrait.sourceUserId || String(portrait.profileId ?? "").startsWith("user-");
      if (isPlayerPortrait) portrait.side = "left";
      else if (["left", "right"].includes(payload.side)) portrait.side = payload.side;
      if (payload.flipped !== undefined) portrait.flipped = Boolean(payload.flipped);
      break;
    }
    case "setSceneDetails":
      state.scene.name = String(payload.name ?? state.scene.name ?? "Новая сцена");
      state.scene.time = String(payload.time ?? state.scene.time ?? "");
      state.scene.weather = String(payload.weather ?? state.scene.weather ?? "");
      break;
    case "setLocation":
      state.scene.locationId = payload.locationId ?? null;
      break;
    case "setBackground":
      state.scene.background = payload.background ?? null;
      state.scene.backgroundVisible = payload.backgroundVisible === undefined
        ? Boolean(state.scene.background)
        : Boolean(payload.backgroundVisible && state.scene.background);
      break;
    case "setBackgroundVisibility":
      state.scene.backgroundVisible = Boolean(payload.visible && state.scene.background);
      break;
    case "setEnvironment":
      state.scene.time = String(payload.time ?? state.scene.time ?? "");
      state.scene.weather = String(payload.weather ?? state.scene.weather ?? "");
      break;
    case "resolveRequest": {
      const request = state.requests.find((item) => item.id === payload.requestId);
      if (!request) throw new Error("Заявка не найдена");
      request.status = payload.status === "rejected" ? "rejected" : "resolved";
      request.resolvedBy = command.userId ?? null;
      request.resolvedAt = now();
      break;
    }
    case "createRequest": {
      const text = String(payload.text ?? "").trim();
      if (!text) throw new Error("Текст заявки пуст");
      state.requests.unshift({
        id: payload.id ?? makeId("request"),
        userId: command.userId ?? payload.userId ?? null,
        text,
        status: "pending",
        createdAt: now()
      });
      state.requests = state.requests.slice(0, MAX_REQUESTS);
      break;
    }
    default:
      throw new Error(`Команда не изменяет сцену: ${command.type}`);
  }

  state.revision += 1;
  state.updatedAt = now();
  return { state, event: sceneEvent(command, before, state) };
}

export function applyTransientCommand(inputState, command, { userId, portrait } = {}) {
  const state = clone(inputState);
  const actorId = userId ?? command.userId;
  if (!actorId) throw new Error("Не указан пользователь");

  if (command.type === "speechStart") {
    if (!portrait?.id) throw new Error("Для speechStart нужен портрет");
    state.speaking[actorId] = {
      userId: actorId,
      portraitId: portrait.id,
      startedAt: state.speaking[actorId]?.startedAt ?? now(),
      heartbeatAt: now()
    };
    if (!state.scene.portraits.some((item) => item.id === portrait.id) && !state.overflow.some((item) => item.id === portrait.id)) {
      if (state.scene.portraits.length < MAX_SLOTS) state.scene.portraits.push({
        ...clone(portrait),
        side: portrait.side === "right" ? "right" : "left",
        slot: firstFreeSlot(state.scene.portraits)
      });
      else state.overflow.push({ ...clone(portrait), overflow: true });
    }
  } else if (command.type === "speechHeartbeat") {
    if (state.speaking[actorId]) state.speaking[actorId].heartbeatAt = now();
  } else if (command.type === "speechStop") {
    delete state.speaking[actorId];
    state.overflow = state.overflow.filter((item) => !(item.overflow && item.profileId === portrait?.profileId));
  } else {
    throw new Error(`Неизвестная временная команда: ${command.type}`);
  }

  state.updatedAt = now();
  return state;
}

export function expireSpeaking(inputState, timeoutMs = SPEECH_TIMEOUT_MS) {
  const state = clone(inputState);
  const cutoff = now() - timeoutMs;
  const expired = Object.values(state.speaking).filter((item) => item.heartbeatAt <= cutoff);
  for (const item of expired) {
    delete state.speaking[item.userId];
    state.overflow = state.overflow.filter((portrait) => !(portrait.overflow && portrait.id === item.portraitId));
  }
  return state;
}

export function firstFreeSlot(portraits) {
  const occupied = new Set(portraits.map((portrait) => portrait.slot));
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) if (!occupied.has(slot)) return slot;
  return MAX_SLOTS - 1;
}

export function allPortraits(state) {
  return [...state.scene.portraits, ...state.overflow];
}

export function speakingIds(state) {
  return new Set(Object.values(state.speaking).map((item) => item.portraitId));
}

export function getStagePhase(stage = {}) {
  if (["preparing", "live"].includes(stage.phase)) return stage.phase;
  return stage.active ? "live" : "inactive";
}

export function shouldDisplayStage(stage, isGM = false) {
  const phase = getStagePhase(stage);
  return phase === "live" || (isGM && phase === "preparing");
}

export function hasUserPortrait(state, userId) {
  const profileId = `user-${userId}`;
  return allPortraits(state).some((portrait) => (
    portrait.sourceUserId === userId || portrait.profileId === profileId
  ));
}

export function canUserJoinStage(state, user, { enabled = true } = {}) {
  return Boolean(
    enabled
    && user
    && !user.isGM
    && user.active !== false
    && user.character
    && getStagePhase(state.stage) === "live"
    && !hasUserPortrait(state, user.id)
  );
}

export function overlayStructureSignature(state, {
  hideUi = false,
  allowPlayerJoin = false,
  librarySignature = ""
} = {}) {
  const scene = {
    id: state.scene.id,
    background: state.scene.background,
    portraits: state.scene.portraits.map((portrait) => ({
      id: portrait.id,
      profileId: portrait.profileId,
      sourceUserId: portrait.sourceUserId,
      image: portrait.image,
      slot: portrait.slot,
      side: portrait.side,
      flipped: portrait.flipped,
      hidden: portrait.hidden
    }))
  };
  const overflow = state.overflow.map((portrait) => ({
    id: portrait.id,
    profileId: portrait.profileId,
    sourceUserId: portrait.sourceUserId,
    image: portrait.image,
    slot: portrait.slot,
    side: portrait.side,
    flipped: portrait.flipped,
    hidden: portrait.hidden,
    overflow: portrait.overflow
  }));
  return JSON.stringify({
    scene,
    overflow,
    phase: getStagePhase(state.stage),
    hideUi: Boolean(hideUi),
    allowPlayerJoin: Boolean(allowPlayerJoin),
    librarySignature: String(librarySignature)
  });
}
