# VN Live Stage

Независимый модуль для Foundry VTT 14.366, предназначенный для живого визуального ведения диалоговых сцен.

## Установка в Foundry VTT

В разделе **Add-on Modules → Install Module** вставьте ссылку:

```text
https://raw.githubusercontent.com/yefim-lopatin/vn-live-stage/main/module.json
```

После установки активируйте `VN Live Stage` в настройках нужного мира. Открыть интерфейс можно из консоли или макроса:

```js
game.modules.get("vn-live-stage").api.open();
```

## Архитектура

- `scripts/core.js` — чистые модели, команды и редукторы без зависимости от Foundry.
- `scripts/session.js` — GM-авторитетная сессия, ревизии, история, откат, heartbeat и socket-обмен.
- `scripts/storage.js` — live snapshot в world setting и сохранённые сцены/библиотеки в `JournalEntry` flags.
- `scripts/adapters.js` — системно-независимое получение имени, изображения и персонажа игрока.
- `scripts/app.js` — интерфейс `ApplicationV2` с Handlebars part.

Модуль не импортирует код и ассеты `Visual Novel Dialogues`, а внешние интеграции не регистрирует.

## Публичный API

```js
const vn = game.modules.get("vn-live-stage").api;
vn.open();
vn.getState();
vn.dispatch({ type: "setBackground", payload: { background: "path/to/image.webp" } });
vn.startSpeaking();
vn.stopSpeaking();
vn.saveScene();
vn.loadScene("scene-id");
vn.undo();
```

## Проверки

```bash
npm test
node --check scripts/core.js
node --check scripts/session.js
node --check scripts/app.js
```
