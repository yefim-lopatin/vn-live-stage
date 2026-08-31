import test from "node:test";
import assert from "node:assert/strict";
import { parseStageChecks, stageRollPresentation } from "../scripts/checks.js";

test("PF2e prompt checks become separate stage cards", () => {
  const checks = parseStageChecks("<p>@Check[athletics|dc:18]</p><p>@Check[will|dc:21|name:Не поддаться страху]</p>", {
    messageId: "prompt-1",
    createdAt: 123
  });

  assert.equal(checks.length, 2);
  assert.equal(checks[0].messageId, "prompt-1");
  assert.equal(checks[0].formula, "@Check[athletics|dc:18]");
  assert.match(checks[0].label, /Athletics.*18/);
  assert.equal(checks[1].label, "Не поддаться страху");
});

test("PF2e chat roll is prepared for the cinematic result window", () => {
  const result = stageRollPresentation({
    flavor: "<strong>Проверка Атлетики</strong>",
    speaker: { alias: "Эльф" },
    rolls: [{ total: 26, dice: [{ faces: 20, results: [{ result: 18, active: true }] }] }],
    flags: { pf2e: { context: { outcome: "criticalSuccess" } } }
  }, { name: "Эльф", img: "elf.webp" });

  assert.equal(result.total, 26);
  assert.equal(result.die, 18);
  assert.equal(result.actorName, "Эльф");
  assert.equal(result.outcomeLabel, "Критический успех");
});
