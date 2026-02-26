# План внедрения: переключение режима прокси (Rule / Global / Direct) — production-ready

## 1. Цель и принципы

### Цель
Добавить полноценный runtime/persistent режим прокси (`rule`, `global`, `direct`) с прозрачным UX и без регрессий в текущий pipeline.

### Принципы внедрения
1. Переключение режима не должно требовать рестарта `sing-box`.
2. Режим должен сохраняться даже при остановленном сервисе.
3. Переключение режима не должно запускать побочные операции (например, пересборку unsupported-нод).
4. Редактирование правил в UI остаётся доступным при любом режиме (режим влияет на применение, а не на возможность редактировать).

## 2. Подтверждённый текущий срез

1. Миграции сейчас до `v4`; новая миграция должна быть `v5`.
2. В `Settings` отсутствует `proxy_mode`.
3. В builder `experimental.clash_api.default_mode` захардкожен в `"rule"`.
4. Есть Clash proxy-эндпоинты `/api/proxy/groups` и `/api/proxy/delay`, но нет `/api/proxy/mode`.
5. `PUT /api/settings` выполняет full-replace (не partial update).

## 3. Data model и нормализация

### `internal/storage/models.go`
1. Добавить в `Settings` поле:
   - `ProxyMode string \`json:"proxy_mode"\``
2. В `DefaultSettings()` добавить:
   - `ProxyMode: "rule"`
3. Добавить единые helpers:
   - `const ProxyModeRule = "rule"`
   - `const ProxyModeGlobal = "global"`
   - `const ProxyModeDirect = "direct"`
   - `func NormalizeProxyMode(mode string) string` (trim+lower; fallback: `rule`)
   - `func IsValidProxyMode(mode string) bool` (strict check raw значения после trim/lower)

Важно: для API `PUT /proxy/mode` использовать strict validation (`IsValidProxyMode`), а не молчаещее приведение неизвестного значения к `rule`.

## 4. Миграции SQLite

### `internal/storage/sqlite_migrations.go`
1. Добавить `s.migrateV5` в список миграций.
2. Реализовать `migrateV5()`:
   - если столбец `proxy_mode` уже есть, ничего не делать;
   - иначе `ALTER TABLE settings ADD COLUMN proxy_mode TEXT NOT NULL DEFAULT 'rule'`.
3. Проверку столбца сделать через `PRAGMA table_info(settings)`.

### Обновление базовой схемы (`migrateV1`)
Рекомендуется также добавить `proxy_mode` в `CREATE TABLE settings` внутри `migrateV1`.
Причина: новые инсталляции сразу получают полную схему, а `migrateV5` остаётся защитой для апгрейдов.

## 5. Storage слой

### `internal/storage/store.go`
Добавить в интерфейс:
- `UpdateProxyMode(mode string) error`

### `internal/storage/sqlite_settings.go`
1. `GetSettings()`:
   - добавить `proxy_mode` в `SELECT/Scan`,
   - после `Scan` всегда применять `NormalizeProxyMode`.
2. `UpdateSettings()`:
   - добавить `proxy_mode` в `INSERT OR REPLACE`,
   - записывать `NormalizeProxyMode(settings.ProxyMode)`.
3. `UpdateProxyMode(mode string) error`:
   - нормализовать mode;
   - обновлять точечно: `UPDATE settings SET proxy_mode=? WHERE id=1`;
   - если `RowsAffected=0`, создать defaults безопасно (`DefaultSettings()` + mode) через `UpdateSettings()`.

Такой подход избегает рискованного partial upsert, который может создать `settings`-строку с дефолтами при случайном отсутствии `id=1`.

## 6. Builder

### `internal/builder/singbox.go`
В `buildExperimental()` заменить:
- `DefaultMode: "rule"`
на
- `DefaultMode: storage.NormalizeProxyMode(b.settings.ProxyMode)`

## 7. API backend

### Роуты (`internal/api/router.go`)
Добавить:
1. `GET /api/proxy/mode`
2. `PUT /api/proxy/mode`

### Общий helper для запросов в Clash API
Вынести повторяющуюся логику (`http client`, `Authorization`, timeout) в приватные функции, чтобы не дублировать код между `/proxy/groups`, `/proxy/delay`, `/proxy/mode`.

### `GET /api/proxy/mode`
Алгоритм:
1. `settingsMode := NormalizeProxyMode(store.GetSettings().ProxyMode)`
2. `running := processManager.IsRunning()`
3. Если `running=false`, вернуть settings-mode (`source: "settings"`).
4. Если `running=true`, попытаться прочитать runtime mode из `GET /configs`.
5. Если runtime mode успешно прочитан и валиден, вернуть его (`source: "runtime"`).
6. При любой ошибке Clash API вернуть `200` c `settingsMode`, `source: "settings"`, `warning`.

### `PUT /api/proxy/mode`
Алгоритм:
1. Принять `{ "mode": "rule|global|direct" }`.
2. Strict-валидация входа; при invalid вернуть `400`.
3. Сохранить в БД через `UpdateProxyMode`.
4. Перегенерировать конфиг и сохранить в `settings.ConfigPath` без тяжёлых побочных шагов:
   - использовать `buildConfig()` + `saveConfigFile()`;
   - не использовать `buildAndValidateConfig()` в этом endpoint.
5. Если `running=true`, отправить `PATCH /configs` с `{ "mode": "<mode>" }`.
6. Если PATCH failed, вернуть `200` + `warning`, `runtime_applied=false`.
7. Если всё успешно, вернуть `runtime_applied=true`.

### Hardening для `PUT /api/settings`
Текущий контракт остаётся full-update. Для backward compatibility:
1. Если входящий `proxy_mode` пустой, брать текущее значение из `store.GetSettings().ProxyMode` (а не сбрасывать в `rule`).
2. После этого нормализовать через `NormalizeProxyMode`.

Важно: это не делает `/settings` partial-safe; это только защита поля `proxy_mode`.

## 8. API-контракт

### `GET /api/proxy/mode`
Response:
```json
{
  "data": {
    "mode": "rule|global|direct",
    "running": true,
    "source": "runtime|settings"
  },
  "warning": "optional"
}
```

### `PUT /api/proxy/mode`
Request:
```json
{ "mode": "rule|global|direct" }
```

Response:
```json
{
  "data": {
    "mode": "rule|global|direct",
    "running": true,
    "runtime_applied": true
  },
  "warning": "optional"
}
```

## 9. Frontend

### `web/src/api/index.ts`
Добавить `proxyModeApi`:
1. `get(): GET /proxy/mode`
2. `set(mode): PUT /proxy/mode`

### `web/src/store/index.ts`
1. Добавить тип:
   - `type ProxyMode = 'rule' | 'global' | 'direct'`
2. Расширить `Settings`:
   - `proxy_mode: ProxyMode`
3. Расширить `AppState`:
   - `proxyMode: ProxyMode`
   - `proxyModeRunning: boolean`
   - `proxyModeSource: 'runtime' | 'settings'`
   - `proxyModeSwitching: boolean`
   - `fetchProxyMode(): Promise<void>`
   - `setProxyMode(mode: ProxyMode): Promise<void>`
4. Поведение:
   - `fetchProxyMode` не спамит toast-ами warning на каждом refresh;
   - `setProxyMode` показывает success/warning один раз по факту ответа;
   - после `fetchSettings()` fallback-обновляет `proxyMode` из `settings.proxy_mode`, если runtime-данные ещё не пришли.

### `web/src/pages/Rules.tsx`
1. Добавить карточку `Proxy Mode` над блоком `Preset Rule Groups`.
2. Кнопки `Rule / Global / Direct`:
   - disabled только при `proxyModeSwitching`;
   - если сервис остановлен, переключение доступно (с подсказкой "применится при запуске").
3. При `proxyMode !== 'rule'` показывать warning-баннер, что правила сейчас обходятся.
4. Не блокировать UI редактирования правил (`no pointer-events-none`).

## 10. Порядок внедрения

1. `models.go` (поле + константы + normalize/validate).
2. `sqlite_migrations.go` (`v5` + idempotent check + update `migrateV1` schema).
3. `store.go` + `sqlite_settings.go`.
4. `builder/singbox.go`.
5. `api/router.go` (`/proxy/mode`, helper Clash API, settings hardening).
6. `web/src/api/index.ts`.
7. `web/src/store/index.ts`.
8. `web/src/pages/Rules.tsx`.
9. Smoke + regression + ручной runtime-check.

## 11. Проверки

### Backend smoke
1. Миграция `v5` применяется на старой БД без падения.
2. `GET /api/proxy/mode` при остановленном сервисе: `source=settings`.
3. `PUT /api/proxy/mode` при остановленном сервисе: mode сохраняется, конфиг обновлён.
4. При запущенном сервисе: `PUT /api/proxy/mode` меняет runtime через `PATCH /configs`.
5. Если Clash API недоступен: endpoint возвращает `200 + warning`, а не `500`.

### Frontend smoke
1. Карточка `Proxy Mode` отображается на Rules.
2. Переключение работает и при `running=false` (режим сохраняется).
3. При `global/direct` есть warning, но редактор правил доступен.
4. Состояния loading/disabled корректны во время запроса.

### Regression
1. `go test ./...`
2. `cd web && pnpm -s tsc --noEmit` (или `pnpm build`)
3. Проверка сохранения Settings (особенно `AllowLAN`/`clash_api_secret`, scheduler restart).

## 12. Риски и контроль

1. Неверный номер миграции (`v4` вместо `v5`) — контроль: migration checklist перед merge.
2. Нормализация/валидация режима размазана по слоям — контроль: единые helpers в storage.
3. Побочные эффекты от `buildAndValidateConfig` в mode endpoint — контроль: использовать только `buildConfig`.
4. UX-противоречие (нельзя переключить при stop) — контроль: разрешить сохранение offline.
5. Тихий сброс `proxy_mode` при старом UI — контроль: fallback на текущее значение в `updateSettings`.

## 13. Минимальный список файлов к изменению

1. `internal/storage/models.go`
2. `internal/storage/store.go`
3. `internal/storage/sqlite_migrations.go`
4. `internal/storage/sqlite_settings.go`
5. `internal/builder/singbox.go`
6. `internal/api/router.go`
7. `web/src/api/index.ts`
8. `web/src/store/index.ts`
9. `web/src/pages/Rules.tsx`
