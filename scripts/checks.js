import { makeId } from "./core.js";

const OUTCOME_LABELS = Object.freeze({
  criticalSuccess: "Критический успех",
  success: "Успех",
  failure: "Провал",
  criticalFailure: "Критический провал"
});

function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseParameters(formula) {
  const [type = "", ...parts] = formula.split("|");
  const parameters = Object.fromEntries(parts.map((part) => {
    const [key, ...value] = part.split(":");
    return [key, value.join(":")];
  }));
  return { type, parameters };
}

function checkTypeLabel(type) {
  const pf2e = globalThis.CONFIG?.PF2E;
  const key = String(type).toLowerCase();
  const label = pf2e?.skills?.[key] ?? pf2e?.saves?.[key];
  return typeof label === "string" ? label : key.replace(/(^|-)\w/g, (match) => match.toUpperCase());
}

export function parseStageChecks(content, { messageId = "", createdAt = Date.now() } = {}) {
  const text = String(content ?? "");
  const matches = [...text.matchAll(/@Check\[([^\]\n]+)\]/g)];
  return matches.map((match, index) => {
    const formula = `@Check[${match[1]}]`;
    const { type, parameters } = parseParameters(match[1]);
    const customName = plainText(parameters.name);
    const dc = parameters.dc ? ` · СЛ ${parameters.dc}` : "";
    return {
      id: makeId("stage-check"),
      messageId,
      formula,
      label: customName || `${checkTypeLabel(type)}${dc}`,
      createdAt: Number(createdAt) || Date.now(),
      sourceIndex: index
    };
  });
}

function rollDie(roll) {
  const d20 = roll?.dice?.find?.((die) => Number(die.faces) === 20);
  const result = d20?.results?.find?.((item) => item.active !== false);
  return result?.result ?? null;
}

export function stageRollPresentation(message, actor = null) {
  const roll = message?.rolls?.[0] ?? null;
  const context = message?.flags?.pf2e?.context ?? {};
  const outcome = context.outcome ?? context.unadjustedOutcome ?? "";
  const actorName = actor?.name ?? message?.speaker?.alias ?? "Персонаж";
  return {
    actorName: plainText(actorName),
    actorImage: actor?.img ?? "",
    label: plainText(message?.flavor) || "Проверка",
    total: roll?.total ?? roll?._total ?? "—",
    die: rollDie(roll) ?? "d20",
    outcome,
    outcomeLabel: OUTCOME_LABELS[outcome] ?? "Результат проверки",
    outcomeClass: OUTCOME_LABELS[outcome] ? outcome : "unknown"
  };
}
