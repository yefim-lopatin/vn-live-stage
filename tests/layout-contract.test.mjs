import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = readFileSync(new URL("../templates/overlay.hbs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");

test("left and right portrait grids use independent automatic column counts", () => {
  assert.match(template, /vn-cinematic-left[^>]+--vn-side-columns: \{\{leftColumns\}\}/);
  assert.match(template, /vn-cinematic-right[^>]+--vn-side-columns: \{\{rightColumns\}\}/);
  assert.doesNotMatch(template, /\{\{sideColumns\}\}/);
  assert.match(styles, /\.vn-cinematic-left\s*\{[\s\S]*?left:\s*0;/);
  assert.match(styles, /\.vn-cinematic-right\s*\{[\s\S]*?right:\s*0;/);
});

test("portrait names are rendered and positioned below the controls", () => {
  const portraits = template.split('<figure class="vn-cinematic-portrait').slice(1);
  assert.equal(portraits.length, 2);
  for (const portrait of portraits) {
    assert.ok(portrait.indexOf("vn-cinematic-portrait-actions") < portrait.indexOf("<figcaption"));
  }
  assert.match(styles, /\.vn-cinematic-portrait figcaption\s*\{[\s\S]*?bottom:\s*1\.1vh;/);
  assert.match(styles, /\.vn-cinematic-portrait-actions\s*\{[\s\S]*?bottom:\s*4\.8vh;/);
});
