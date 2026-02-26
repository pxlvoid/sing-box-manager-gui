# План внедрения: переключение режима прокси (Rule / Global / Direct)

## 1. Актуальный срез проекта (после ваших изменений)

1. Хранилище теперь только SQLite (`internal/storage/*`), `JSONStore` и JSON-импорт отсутствуют.
2. Версия миграций уже дошла до `v4` (pipeline activity logs), поэтому новая миграция для `proxy_mode` должна быть `v5`, а не `v4`.
3. В `Settings` пока нет поля `ProxyMode`, а `buildExperimental()` по-прежнему хардкодит `DefaultMode: "rule"`.
4. В API уже есть Clash-прокси-эндпоинты `/api/proxy/groups` и `/api/proxy/delay`, но нет `/api/proxy/mode`.
5. Во фронтенде `Rules`-страница не знает о режиме `rule/global/direct`, и не запрашивает `serviceStatus`.

## 2. Целевое поведение

1. Режим прокси хранится в БД (`settings.proxy_mode`) и используется при генерации `sing-box` конфига (`experimental.clash_api.default_mode`).
2. Если sing-box запущен, режим меняется на лету через Clash API `PATCH /configs` без рестарта.
3. Если sing-box не запущен, режим всё равно сохраняется и попадёт в конфиг для следующего запуска.
4. На вкладке Rules появляется сегментированный переключатель Rule / Global / Direct с корректными disabled/active/warning состояниями.

## 3. Backend: детальный план

## 3.1 `internal/storage/models.go`

1. Добавить в `Settings` поле:
   - `ProxyMode string \`json:"proxy_mode"\``
   - логически разместить рядом с `FinalOutbound` (оба относятся к route/traffic policy).
2. В `DefaultSettings()` добавить:
   - `ProxyMode: "rule",`
3. Добавить единый helper нормализации (чтобы не дублировать в builder/API/storage), например:
   - `NormalizeProxyMode(mode string) string`
   - `IsValidProxyMode(mode string) bool`
   - допустимые значения: `rule`, `global`, `direct`.

## 3.2 `internal/storage/sqlite_migrations.go`

1. В список миграций добавить `s.migrateV5`.
2. Реализовать `migrateV5()`:
   - добавить колонку `proxy_mode` в `settings`:
   - `ALTER TABLE settings ADD COLUMN proxy_mode TEXT NOT NULL DEFAULT 'rule'`
3. Сделать миграцию идемпотентной через проверку `pragma_table_info('settings')`, чтобы не падать в нестандартных БД.

## 3.3 `internal/storage/store.go`

1. В интерфейс `Store` добавить метод:
   - `UpdateProxyMode(mode string) error`

## 3.4 `internal/storage/sqlite_settings.go`

1. `GetSettings()`:
   - добавить `proxy_mode` в `SELECT` (после `archive_threshold` либо рядом с route-полями),
   - добавить сканирование в `&settings.ProxyMode`,
   - после `Scan` нормализовать `settings.ProxyMode = NormalizeProxyMode(settings.ProxyMode)`.
2. `UpdateSettings()`:
   - добавить `proxy_mode` в список колонок `INSERT OR REPLACE`,
   - добавить плейсхолдер и аргумент `NormalizeProxyMode(settings.ProxyMode)`.
3. Новый метод `UpdateProxyMode(mode string) error`:
   - mode нормализовать,
   - сделать точечный upsert:
   - `INSERT INTO settings(id, proxy_mode) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET proxy_mode=excluded.proxy_mode`

## 3.5 `internal/builder/singbox.go`

1. В `buildExperimental()` заменить:
   - `DefaultMode: "rule"`
   - на `DefaultMode: storage.NormalizeProxyMode(b.settings.ProxyMode)`
2. Таким образом config-generation всегда использует сохранённый режим и безопасный fallback.

## 3.6 `internal/api/router.go`

## Регистрация маршрутов

1. Добавить маршруты рядом с proxy-group блоком:
   - `GET /api/proxy/mode`
   - `PUT /api/proxy/mode`

## `updateSettings` hardening

1. Перед `s.store.UpdateSettings(&settings)` добавить:
   - `settings.ProxyMode = storage.NormalizeProxyMode(settings.ProxyMode)`
2. Это защищает от старых/частичных клиентов и пустого значения.

## `getProxyMode` handler

1. Базово взять mode из settings (normalized), `running := s.processManager.IsRunning()`.
2. Если `running == false`: вернуть mode из БД и `running:false`.
3. Если `running == true` и Clash API доступен:
   - `GET http://127.0.0.1:{port}/configs`
   - опционально `Authorization: Bearer ...`.
4. Если runtime mode успешно прочитан, вернуть его как effective mode.
5. Если Clash API недоступен/ошибка парсинга:
   - вернуть mode из settings + `warning`,
   - не падать 500 (для UI важнее graceful fallback).

## `setProxyMode` handler

1. Принять JSON `{ "mode": "rule|global|direct" }`.
2. Валидировать только 3 допустимых значения (после trim/lower).
3. Сохранить mode в БД через `s.store.UpdateProxyMode(mode)`.
4. Обновить сгенерированный config-файл без рестарта (для персистентности после stop/start):
   - собрать config (`buildAndValidateConfig` либо безопасный эквивалент),
   - записать в `settings.ConfigPath`.
5. Если sing-box запущен:
   - отправить `PATCH /configs` c body `{ "mode": "..." }`.
6. Если PATCH не удался:
   - вернуть `200` + `warning` (mode сохранён в БД/конфиге, но runtime не применился).
7. Возвращать в ответе единый формат в стиле проекта:
   - `{"data": {"mode": "...", "running": bool, "runtime_applied": bool}, "warning"?: "..."}`

## 4. Frontend: детальный план

## 4.1 `web/src/api/index.ts`

1. Добавить `proxyModeApi`:
   - `get(): GET /proxy/mode`
   - `set(mode): PUT /proxy/mode`
2. Сохранять текущий паттерн с `res.data.data`.

## 4.2 `web/src/store/index.ts`

1. Добавить тип:
   - `type ProxyMode = 'rule' | 'global' | 'direct'`
2. Расширить `Settings`:
   - `proxy_mode: ProxyMode`
3. Расширить `AppState`:
   - `proxyMode: ProxyMode`
   - `proxyModeRunning: boolean`
   - `proxyModeSwitching: boolean`
   - `fetchProxyMode(): Promise<void>`
   - `setProxyMode(mode: ProxyMode): Promise<void>`
4. Начальное состояние:
   - `proxyMode: 'rule'`
   - `proxyModeRunning: false`
   - `proxyModeSwitching: false`
5. `fetchProxyMode`:
   - вызвать `proxyModeApi.get()`
   - обновить `proxyMode` и `proxyModeRunning`
   - warning не тостить агрессивно (иначе spam на каждом refresh).
6. `setProxyMode`:
   - выставить `proxyModeSwitching=true`
   - вызвать API
   - обновить `proxyMode`, `proxyModeRunning`
   - при `warning` -> `toast.info`
   - при успехе -> `toast.success`
   - в `finally` сбросить `proxyModeSwitching`.
7. Синхронизация с settings:
   - после `fetchSettings()` можно fallback-обновить `proxyMode` из `settings.proxy_mode`, если runtime mode ещё не запрошен.

## 4.3 `web/src/pages/Rules.tsx`

1. Подключить из store:
   - `serviceStatus`, `fetchServiceStatus`
   - `proxyMode`, `proxyModeSwitching`, `proxyModeRunning`
   - `fetchProxyMode`, `setProxyMode`
2. В mount `useEffect` добавить:
   - `fetchServiceStatus()`
   - `fetchProxyMode()`
3. Перед карточкой `Preset Rule Groups` добавить новую карточку `Proxy Mode`:
   - три кнопки `Rule / Global / Direct`
   - активная подсветка: `Rule=primary`, `Global=warning`, `Direct=secondary`
   - disabled: если `serviceStatus?.running === false` или `proxyModeSwitching`
   - текст текущего режима.
4. При `proxyMode !== 'rule'` показать warning-блок:
   - жёлтая рамка/баннер: «Правила обходятся в текущем режиме».
5. Секции с правилами (preset/custom) оборачивать в контейнер:
   - `opacity-50 pointer-events-none` когда `proxyMode !== 'rule'`.

## 5. API-контракт (рекомендуемый)

## GET `/api/proxy/mode`

1. Response:
   - `data.mode`: `rule|global|direct`
   - `data.running`: boolean
   - `data.source`: `runtime|settings`
   - `warning` (optional)

## PUT `/api/proxy/mode`

1. Request:
   - `{ "mode": "rule|global|direct" }`
2. Response:
   - `data.mode`
   - `data.running`
   - `data.runtime_applied`
   - `warning` (optional)

## 6. Порядок внедрения (рекомендуемая последовательность)

1. Storage model + normalization helpers (`models.go`).
2. Migration `v5` (`sqlite_migrations.go`).
3. Persistence (`store.go`, `sqlite_settings.go`).
4. Builder (`singbox.go`).
5. API backend (`router.go`: routes + handlers + hardening in `updateSettings`).
6. Frontend API client (`web/src/api/index.ts`).
7. Frontend store (`web/src/store/index.ts`).
8. Rules UI (`web/src/pages/Rules.tsx`).
9. Smoke + regression checks.

## 7. Проверка и валидация

## Backend smoke

1. Запустить приложение и убедиться, что миграция `v5` применилась.
2. `GET /api/proxy/mode` при остановленном sing-box:
   - `running=false`, `mode` из БД.
3. Запустить sing-box и повторить `GET`:
   - `running=true`, `mode` из `/configs`.
4. `PUT /api/proxy/mode {"mode":"global"}`:
   - mode сохранён,
   - при running отправлен PATCH в Clash API.
5. Остановить/запустить sing-box:
   - mode должен остаться выбранным (персистентность через config).

## Frontend smoke

1. На вкладке Rules отображается карточка Proxy Mode.
2. Переключение меняет активную кнопку и показывает уведомления.
3. При `global/direct` отображается warning и блокируется взаимодействие с rule-карточками.
4. При остановке sing-box кнопки режима disabled.

## Regression

1. `go test ./...`
2. `cd web && pnpm -s tsc --noEmit` (или `pnpm build`)
3. Проверить, что `Settings` сохранение по-прежнему корректно работает (особенно `AllowLAN`/secret и scheduler restart).

## 8. Критичные риски и как закрыть

1. Ошибка версии миграции (`v4` вместо `v5`) сломает rollout.
2. Отсутствие нормализации `ProxyMode` приведёт к пустому `default_mode` при старых клиентах.
3. Сохранение только в БД без обновления config-файла нарушит персистентность после stop/start.
4. PATCH-failure без warning в ответе даст UI «ложно успешный» сценарий.
5. Дублирование валидаторов mode в разных файлах приведёт к расхождению поведения; нужен единый helper.

## 9. Минимальный список файлов к изменению

1. `internal/storage/models.go`
2. `internal/storage/store.go`
3. `internal/storage/sqlite_migrations.go`
4. `internal/storage/sqlite_settings.go`
5. `internal/builder/singbox.go`
6. `internal/api/router.go`
7. `web/src/api/index.ts`
8. `web/src/store/index.ts`
9. `web/src/pages/Rules.tsx`
