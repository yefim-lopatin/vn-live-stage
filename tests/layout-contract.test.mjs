import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = readFileSync(new URL("../templates/overlay.hbs", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/module.css", import.meta.url), "utf8");
const application = readFileSync(new URL("../scripts/app.js", import.meta.url), "utf8");

test("left and right portrait grids use the same automatic column count", () => {
  assert.equal((template.match(/--vn-side-columns: \{\{sideColumns\}\}/g) ?? []).length, 2);
  assert.doesNotMatch(template, /\{\{leftColumns\}\}|\{\{rightColumns\}\}/);
  assert.match(styles, /\.vn-cinematic-left\s*\{[\s\S]*?left:\s*0;/);
  assert.match(styles, /\.vn-cinematic-right\s*\{[\s\S]*?right:\s*0;[\s\S]*?direction:\s*rtl;/);
  assert.match(styles, /\.vn-cinematic-right \.vn-cinematic-portrait\s*\{[\s\S]*?direction:\s*ltr;/);
  assert.match(application, /sideColumns:\s*Math\.max\(leftPortraits\.length,\s*rightPortraits\.length,\s*1\)/);
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

test("GM portraits have side controls and side changes are applied without replacing the overlay", () => {
  assert.equal((template.match(/data-action="toggle-portrait-side"/g) ?? []).length, 2);
  assert.match(application, /querySelectorAll\("\[data-action='toggle-portrait-side'\]"\)/);
  assert.match(application, /targetSide\.append\(element\)/);
  assert.match(application, /classList\.toggle\("is-flipped",\s*Boolean\(portrait\.flipped\)\)/);
});

test("background has a separate dimming layer", () => {
  assert.match(styles, /\.vn-cinematic-background::after\s*\{[\s\S]*?background:\s*rgba\(5, 6, 10, \.28\);/);
});
