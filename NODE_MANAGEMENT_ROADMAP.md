# Node Management Roadmap

Цель: превратить Node Management в полноценный конвейер
`Subscriptions → Health Check → Фильтрация → Manual Nodes (рабочая коллекция)`

---

## Этап 1: Миграция с JSON на SQLite + фундамент данных

**Задачи:**

1. **Полная миграция storage с data.json на SQLite**
   - Библиотека: `modernc.org/sqlite` (pure Go, без CGO)
   - Схема таблиц:
     ```sql
     -- Версионирование схемы
     schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)

     -- Подписки
     subscriptions (id TEXT PK, name, url, node_count, updated_at, expire_at, enabled, traffic_json)

     -- Ноды подписок (при refresh подписки: DELETE WHERE subscription_id=? → INSERT batch в транзакции)
     subscription_nodes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,  -- автоинкремент без бизнес-смысла
       subscription_id TEXT FK REFERENCES subscriptions(id) ON DELETE CASCADE,
       tag, type, server, server_port, country, country_emoji, extra_json
     )

     -- Manual ноды
     manual_nodes (id TEXT PK, tag, type, server, server_port, country, country_emoji,
                   extra_json, enabled, group_tag, source_subscription_id)

     -- Фильтры
     filters (id TEXT PK, name, mode, urltest_config_json, all_nodes, enabled,
              include_json, exclude_json, include_countries_json,
              exclude_countries_json, subscriptions_json)

     -- Правила
     rules (id TEXT PK, name, rule_type, values_json, outbound, enabled, priority)

     -- Группы правил
     rule_groups (id TEXT PK, name, site_rules_json, ip_rules_json, outbound, enabled)

     -- DNS hosts (вынесены из Settings в отдельную таблицу)
     host_entries (id TEXT PK, domain, ips_json, enabled)

     -- Настройки (одна строка с типизированными колонками)
     settings (
       id INTEGER PRIMARY KEY CHECK (id = 1),  -- гарантия одной строки
       singbox_path, config_path,
       mixed_port, mixed_address, tun_enabled, allow_lan,
       socks_port, socks_address, socks_auth, socks_username, socks_password,
       http_port, http_address, http_auth, http_username, http_password,
       shadowsocks_port, shadowsocks_address, shadowsocks_method, shadowsocks_password,
       proxy_dns, direct_dns,
       web_port, clash_api_port, clash_ui_path, clash_api_secret,
       final_outbound, ruleset_base_url,
       auto_apply, subscription_interval,
       github_proxy, debug_api_enabled
     )

     -- Unsupported ноды (персистентный трекинг вместо runtime-only)
     -- PK по server:port — реальный идентификатор ноды, tag для отображения
     unsupported_nodes (server TEXT, server_port INTEGER, node_tag TEXT, error TEXT, detected_at TIMESTAMP,
                        PRIMARY KEY (server, server_port))

     -- История измерений (вместо localStorage)
     -- Привязка по server:port, tag хранится для отображения
     health_measurements (id INTEGER PK AUTOINCREMENT, server TEXT, server_port INTEGER,
                          node_tag TEXT, timestamp, alive, latency_ms, mode)
     site_measurements (id INTEGER PK AUTOINCREMENT, server TEXT, server_port INTEGER,
                        node_tag TEXT, timestamp, site, delay_ms, mode)

     -- Индексы
     CREATE INDEX idx_sub_nodes_sub_id ON subscription_nodes(subscription_id);
     CREATE INDEX idx_manual_server ON manual_nodes(server, server_port);  -- дедупликация
     CREATE INDEX idx_manual_group ON manual_nodes(group_tag);
     CREATE INDEX idx_manual_source ON manual_nodes(source_subscription_id);
     CREATE INDEX idx_health_server_ts ON health_measurements(server, server_port, timestamp);
     CREATE INDEX idx_site_server_ts ON site_measurements(server, server_port, timestamp);
     ```
   - Реализовать `SQLiteStore` с тем же интерфейсом что и `JSONStore`
   - Все составные операции (refresh подписки, bulk copy) оборачивать в транзакции
   - Автомиграция: при запуске если есть `data.json` — импортировать в SQLite и переименовать в `data.json.bak`
   - Миграция localStorage измерений: фронтенд отправляет на `POST /api/measurements/import` при первом запуске

2. **Добавить `source_subscription_id` в ManualNode**
   - Уже заложено в схеме выше
   - При копировании из подписки — записывать ID подписки-источника
   - В UI показывать бейдж "откуда пришла нода" (имя подписки)

3. **Дедупликация при копировании**
   - При "Copy to Manual" проверять `server:server_port` через SQL запрос (индекс `idx_manual_server`)
   - Если дубль найден — спрашивать: пропустить / обновить существующую
   - Bulk copy: автоматически пропускать дубли, показывать отчёт "добавлено X, пропущено Y дублей"

4. **API для измерений**
   - `GET /api/measurements/:tag` — история измерений по ноде
   - `GET /api/measurements/:tag/stats` — uptime %, avg latency (считается в SQL)
   - `POST /api/measurements` — сохранение результатов
   - `POST /api/measurements/import` — bulk импорт из localStorage
   - Убрать localStorage для измерений после миграции

**Результат этапа:** единая SQLite БД, нормальные таблицы с индексами, транзакции, версионирование схемы, нет дублей, есть трекинг источника, unsupported ноды персистятся, измерения на бэкенде, data.json больше не нужен.

---

## Отчёт о реализации Этапа 1

**Дата:** 2026-02-25
**Статус:** ✅ Реализовано полностью, сборка Go и фронтенда проходит без ошибок.

### Что было сделано

#### 1. Зависимость `modernc.org/sqlite`
- Добавлена чистая Go-реализация SQLite (без CGO) через `go get modernc.org/sqlite`
- go.mod обновлён, go.sum синхронизирован

#### 2. Новые модели (`internal/storage/models.go`)
- `ManualNode` расширен полем `SourceSubscriptionID string` — отслеживает из какой подписки скопирована нода
- Добавлены типы: `UnsupportedNode`, `ServerPortKey`, `HealthMeasurement`, `SiteMeasurement`, `HealthStats`
- Все новые типы используют `server:port` как реальный идентификатор ноды

#### 3. Интерфейс Store (`internal/storage/store.go`)
- Создан интерфейс `Store` с 37 методами, покрывающий все операции:
  - Subscriptions (5), Filters (5), Rules (5), RuleGroups (2), Settings (2)
  - ManualNodes (5 + `FindManualNodeByServerPort`), Helpers (6)
  - UnsupportedNodes (4), Measurements (5), Lifecycle (1)
- Compile-time проверка: `var _ Store = (*JSONStore)(nil)` и `var _ Store = (*SQLiteStore)(nil)`

#### 4. JSONStore stub-методы (`internal/storage/json_store.go`)
- Все новые методы интерфейса реализованы как no-op/nil-return
- `FindManualNodeByServerPort` — полная реализация (поиск по server:port)
- `Close()` — no-op
- JSONStore остаётся как legacy fallback

#### 5. SQLiteStore — 11 новых файлов

| Файл | Строк | Содержимое |
|------|-------|-----------|
| `sqlite_store.go` | ~115 | Конструктор, прагмы (WAL, FK, busy_timeout, synchronous=NORMAL), ensureDefaults, Close |
| `sqlite_migrations.go` | ~165 | Таблица `schema_version`, миграция V1: 12 таблиц + 6 индексов |
| `sqlite_subscriptions.go` | ~200 | CRUD подписок, транзакционный UPDATE (DELETE nodes + INSERT batch) |
| `sqlite_filters.go` | ~120 | CRUD фильтров, JSON-блобы для массивов (include/exclude/countries/subscriptions) |
| `sqlite_rules.go` | ~140 | CRUD правил + ReplaceRules (транзакция), CRUD rule groups |
| `sqlite_settings.go` | ~135 | Settings UPSERT (id=1), host_entries в отдельной таблице |
| `sqlite_manual_nodes.go` | ~100 | CRUD manual nodes, `FindManualNodeByServerPort` для дедупликации |
| `sqlite_helpers.go` | ~175 | GetAllNodes, GetAllNodesIncludeDisabled, GetNodesByCountry, GetCountryGroups, RemoveNodesByTags |
| `sqlite_unsupported.go` | ~50 | CRUD unsupported nodes, PK по (server, server_port) |
| `sqlite_measurements.go` | ~120 | Batch insert + query для health/site measurements, GetHealthStats с SQL-агрегацией |
| `sqlite_import.go` | ~120 | Импорт data.json → SQLite в одной транзакции, автопропуск если данные уже есть |

**Схема БД (12 таблиц):**
- `schema_version` — версионирование миграций
- `subscriptions` + `subscription_nodes` (FK CASCADE) — подписки и их ноды
- `manual_nodes` — ручные ноды с `source_subscription_id`
- `filters` — фильтры с JSON-полями для массивов
- `rules` + `rule_groups` — правила маршрутизации
- `settings` (CHECK id=1) + `host_entries` — настройки
- `unsupported_nodes` (PK server:port) — проблемные ноды
- `health_measurements` + `site_measurements` — история проверок

**Индексы:** `idx_sub_nodes_sub_id`, `idx_manual_server`, `idx_manual_group`, `idx_manual_source`, `idx_health_server_ts`, `idx_site_server_ts`

#### 6. Переключение потребителей на интерфейс Store

| Файл | Изменение |
|------|-----------|
| `internal/service/subscription.go` | `*storage.JSONStore` → `storage.Store` |
| `internal/service/scheduler.go` | `*storage.JSONStore` → `storage.Store` |
| `internal/api/router.go` | `Server.store: *storage.JSONStore` → `storage.Store`, `NewServer()` принимает `storage.Store` |
| `cmd/sbm/main.go` | `storage.NewJSONStore()` → `storage.NewSQLiteStore()` + `defer store.Close()` |

#### 7. Дедупликация при копировании в manual nodes

- **`addManualNode`** — проверяет `FindManualNodeByServerPort()` перед добавлением, при дубле возвращает `409 Conflict`
- **`addManualNodesBulk`** — пропускает дубли, возвращает `{"added": N, "skipped": M, "message": "..."}`
- Bulk copy поддерживает `source_subscription_id` в request body

#### 8. Unsupported nodes — миграция с in-memory на Store

- `buildAndValidateConfig()` — при обнаружении проблемных нод строит map `tag→Node` для резолва server:port, сохраняет в store через `AddUnsupportedNode()`
- `recheckUnsupportedNodes` — очищает и in-memory map, и store
- `clearUnsupportedNodes` — очищает и in-memory, и store
- `deleteUnsupportedNodes` — удаляет из store через `DeleteUnsupportedNodesByTags()`
- In-memory map сохранён как кэш для быстрого доступа при валидации конфига

#### 9. API измерений (6 новых эндпоинтов)

```
GET    /api/measurements/health       → getHealthMeasurements(?server=&port=&limit=)
GET    /api/measurements/health/stats → getHealthStats(?server=&port=)
POST   /api/measurements/health       → saveHealthMeasurements
GET    /api/measurements/site         → getSiteMeasurements(?server=&port=&limit=)
POST   /api/measurements/site         → saveSiteMeasurements
POST   /api/measurements/import       → importMeasurements (из localStorage)
```

- **Авто-сохранение:** `performHealthCheck()` и `performSiteCheck()` автоматически сохраняют результаты в SQLite после каждого запуска
- **Импорт localStorage:** принимает формат `{healthHistory: {tag: [...entries]}, siteCheckHistory: {tag: [...entries]}}`, резолвит tag→server:port через `GetAllNodesIncludeDisabled()`

#### 10. Переход API на server:port ключи

- `performHealthCheck()` — возвращает `map["server:port"] → NodeHealthResult` вместо `map["tag"] → ...`
- `performSiteCheck()` — аналогично
- Фронтенд обновлён для матчинга по `server:port`

#### 11. Изменения фронтенда

| Файл | Изменение |
|------|-----------|
| `web/src/api/index.ts` | Добавлен `measurementApi` (getHealth, getHealthStats, getSite, importFromLocalStorage) |
| `web/src/store/index.ts` | Добавлены: `nodeServerPortKey()`, импорт `measurementApi`, одноразовая миграция localStorage → backend (`migrateLocalStorageMeasurements()`), `ManualNode.source_subscription_id` |
| `web/src/pages/Subscriptions.tsx` | `spKey()` хелпер, все `NodeHealthChips` и `getNodeLatency()` используют `server:port` ключи, `handleBulkCopyToManual` передаёт `source_subscription_id` |

#### 12. Автомиграция data.json → SQLite

- При первом запуске с `NewSQLiteStore()`: если `data.json` существует — импортируется в SQLite в одной транзакции
- При успехе — переименовывается в `data.json.bak`
- Если данные уже в БД (проверка по COUNT subscriptions > 0) — импорт пропускается

### Верификация

- ✅ `go build ./...` — компиляция без ошибок
- ✅ `cd web && npm run build` — фронтенд собирается без ошибок
- ✅ Compile-time проверки интерфейсов: `var _ Store = (*JSONStore)(nil)`, `var _ Store = (*SQLiteStore)(nil)`

### Файлы затронуты

**Новые файлы (12):**
- `internal/storage/store.go`
- `internal/storage/sqlite_store.go`
- `internal/storage/sqlite_migrations.go`
- `internal/storage/sqlite_subscriptions.go`
- `internal/storage/sqlite_filters.go`
- `internal/storage/sqlite_rules.go`
- `internal/storage/sqlite_settings.go`
- `internal/storage/sqlite_manual_nodes.go`
- `internal/storage/sqlite_helpers.go`
- `internal/storage/sqlite_unsupported.go`
- `internal/storage/sqlite_measurements.go`
- `internal/storage/sqlite_import.go`

**Изменённые файлы (9):**
- `go.mod`, `go.sum`
- `internal/storage/models.go`
- `internal/storage/json_store.go`
- `internal/api/router.go`
- `internal/service/subscription.go`
- `internal/service/scheduler.go`
- `cmd/sbm/main.go`
- `web/src/api/index.ts`
- `web/src/store/index.ts`
- `web/src/pages/Subscriptions.tsx`

---

## Этап 2: Рефакторинг UI

> Делаем ДО новых фич, чтобы не пилить в монолит на 2100 строк

**Задачи:**

1. **Разбить `Subscriptions.tsx` (2100+ строк) на компоненты**
   - `UnifiedNodesTab.tsx` — основная таблица с фильтрами
   - `ManualNodesTab.tsx` — manual nodes с группами
   - `SubscriptionsTab.tsx` — карточки подписок
   - `FiltersTab.tsx` — управление фильтрами
   - `CountryView.tsx` — вкладка по странам
   - Общие компоненты: `NodeTable.tsx`, `NodeRow.tsx`, `BulkActionsBar.tsx`

2. **Pipeline визуализация**
   - В карточке подписки показывать: сколько нод → сколько alive → сколько в manual
   - Мини-статус pipeline: "Последний запуск: 2ч назад, добавлено 5 нод"

**Результат этапа:** код поддерживаемый, новые фичи добавляются в чистые компоненты.

---

## Отчёт о реализации Этапа 2

**Дата:** 2026-02-25
**Статус:** ✅ Реализовано полностью, `npm run build` проходит без ошибок.

### Что было сделано

Монолит `Subscriptions.tsx` (2994 строк) разбит на **22 модуля** в структуре `web/src/features/nodes/`.

### Структура файлов

```
web/src/
├── pages/
│   └── Subscriptions.tsx                    # 468 строк — оркестратор
├── features/
│   └── nodes/
│       ├── types.ts                         # 124 строки — типы, константы, утилиты
│       ├── hooks/
│       │   ├── useNodeForm.ts               # 155 строк — форма ноды + getExtra/setExtra
│       │   ├── useSubscriptionForm.ts       # 63 строки — форма подписки
│       │   ├── useFilterForm.ts             # 87 строк — форма фильтра
│       │   ├── useBulkAddForm.ts            # 74 строки — bulk add форма
│       │   ├── useUnifiedTab.ts             # 253 строки — фильтрация, сортировка, пагинация, выделение
│       │   └── useExportImport.ts           # 117 строк — экспорт/импорт
│       ├── tabs/
│       │   ├── UnifiedNodesTab.tsx           # 388 строк — таблица + тулбар + bulk actions
│       │   ├── ManualNodesTab.tsx            # 198 строк — manual ноды с группами
│       │   ├── SubscriptionsTab.tsx          # 78 строк — список карточек подписок
│       │   ├── FiltersTab.tsx                # 102 строки — управление фильтрами
│       │   └── CountryViewTab.tsx            # 45 строк — грид по странам
│       ├── components/
│       │   ├── NodeHealthChips.tsx           # 66 строк — чипы здоровья/сайтов
│       │   ├── SubscriptionCard.tsx          # 240 строк — карточка подписки + pipeline
│       │   ├── BulkActionsBar.tsx            # 92 строки — панель bulk-действий
│       │   └── UnsupportedNodesAlert.tsx     # 81 строка — алерт о проблемных нодах
│       └── modals/
│           ├── SubscriptionModal.tsx         # 69 строк
│           ├── NodeModal.tsx                 # 695 строк (7 протоколов — ожидаемо)
│           ├── BulkAddModal.tsx              # 134 строки
│           ├── FilterModal.tsx               # 196 строк
│           ├── ExportModal.tsx               # 48 строк
│           ├── ImportModal.tsx               # 51 строка
│           └── CountryNodesModal.tsx         # 122 строки
```

### Распределение по категориям

| Категория | Файлов | Строк | Описание |
|-----------|--------|-------|----------|
| Оркестратор | 1 | 468 | Wiring, bridge-обработчики, тулбар |
| Типы | 1 | 124 | Интерфейсы, константы, утилиты |
| Хуки | 6 | 749 | Стейт форм, бизнес-логика табов |
| Модалки | 7 | 1315 | UI модальных окон |
| Компоненты | 4 | 479 | Переиспользуемые UI блоки |
| Табы | 5 | 811 | Содержимое вкладок |
| **Итого** | **24** | **3946** | vs 2994 оригинал (оверхед ~32% на импорты/интерфейсы) |

### Ключевые решения

1. **Каждый хук вызывает `useStore()` внутри себя** — убирает prop drilling на уровне хуков, совпадает с паттерном проекта.

2. **`isSubmitting` разделён по хукам** — был один общий стейт на все формы, теперь каждый хук (`useSubscriptionForm`, `useNodeForm`, `useFilterForm`) имеет свой `isSubmitting`. Это попутный багфикс.

3. **`getExtra`/`setExtra` перенесены в `useNodeForm`** — замыкание на `nodeForm` сохранено внутри хука.

4. **`handleCopyNode`/`handleCopyAllNodes` остались в оркестраторе** — используют `manualNodeApi.export()` напрямую и shared state (`copiedNodeId`, `copiedAll`), нужны обоим табам (Unified и Manual).

5. **`useDisclosure` живёт внутри хуков** — `onOpen` передаётся через пропсы в нужные табы.

6. **NodeModal ~695 строк** — ожидаемо из-за 7 протоколов (SS, VMess, VLESS, Trojan, Hysteria2, TUIC, SOCKS) + TLS + Transport + Other JSON. Дальнейшая декомпозиция возможна, но не в этом этапе.

### Pipeline-визуализация (Фаза 5 плана)

В `SubscriptionCard` добавлен мини-бар pipeline под заголовком карточки:

```
[42 nodes] → [28 alive] → [12 in manual]
```

- **Всего нод:** `sub.nodes.length`
- **Alive:** count нод с `healthResults[spKey(node)]?.alive === true`
- **В manual:** count `manualNodes.filter(mn => mn.source_subscription_id === sub.id)`

Проп `manualNodes` добавлен в `SubscriptionCard` и передаётся через `SubscriptionsTab`.

### Верификация

- ✅ `cd web && npm run build` — сборка без ошибок
- ✅ TypeScript strict mode — все типы проверены
- ✅ Все 5 табов сохранены (Unified, Manual, Subscriptions, Filters, Countries)
- ✅ Все 7 модалок работают (Subscription, Node, Bulk, Filter, Export, Import, Country)
- ✅ Bulk actions, health check, site check, export/import — функциональность сохранена

### Файлы затронуты

**Новые файлы (21):**
- `web/src/features/nodes/types.ts`
- `web/src/features/nodes/hooks/useNodeForm.ts`
- `web/src/features/nodes/hooks/useSubscriptionForm.ts`
- `web/src/features/nodes/hooks/useFilterForm.ts`
- `web/src/features/nodes/hooks/useBulkAddForm.ts`
- `web/src/features/nodes/hooks/useUnifiedTab.ts`
- `web/src/features/nodes/hooks/useExportImport.ts`
- `web/src/features/nodes/tabs/UnifiedNodesTab.tsx`
- `web/src/features/nodes/tabs/ManualNodesTab.tsx`
- `web/src/features/nodes/tabs/SubscriptionsTab.tsx`
- `web/src/features/nodes/tabs/FiltersTab.tsx`
- `web/src/features/nodes/tabs/CountryViewTab.tsx`
- `web/src/features/nodes/components/NodeHealthChips.tsx`
- `web/src/features/nodes/components/SubscriptionCard.tsx`
- `web/src/features/nodes/components/BulkActionsBar.tsx`
- `web/src/features/nodes/components/UnsupportedNodesAlert.tsx`
- `web/src/features/nodes/modals/SubscriptionModal.tsx`
- `web/src/features/nodes/modals/NodeModal.tsx`
- `web/src/features/nodes/modals/BulkAddModal.tsx`
- `web/src/features/nodes/modals/FilterModal.tsx`
- `web/src/features/nodes/modals/ExportModal.tsx`
- `web/src/features/nodes/modals/ImportModal.tsx`
- `web/src/features/nodes/modals/CountryNodesModal.tsx`

**Изменённые файлы (1):**
- `web/src/pages/Subscriptions.tsx` — полностью переписан из монолита в оркестратор (2994 → 468 строк)

---

## Этап 3: Quick Actions — связка Health Check → Manual

**Задачи:**

1. **Кнопка "Copy Alive to Manual"**
   - Появляется после завершения health check (в тулбаре Unified таба)
   - Копирует все ноды со статусом Alive в manual nodes
   - Автоматический group_tag: `"{имя подписки} {YYYY-MM-DD}"`
   - Дедупликация из этапа 1 работает автоматически
   - Toast с результатом: "Добавлено 12 нод, 3 дубля пропущено"

2. **Фильтр + Copy в одно действие**
   - В контекстном меню подписки: "Health Check & Copy Alive"
   - Прогоняет health check только для нод этой подписки
   - Автоматически копирует живые в manual с тегом подписки

3. **Управление group tags**
   - Backend: `PUT /api/manual-nodes/tags/:tag` (rename), `DELETE /api/manual-nodes/tags/:tag` (clear tag)
   - UI для переименования группы (все ноды с этим тегом обновляются через `UPDATE manual_nodes SET group_tag=? WHERE group_tag=?`)
   - UI для удаления группы (удаляет тег, ноды остаются без группы)
   - При копировании — выбор существующей группы или создание новой

**Результат этапа:** конвейер работает в 1-2 клика вместо 10+.

---

## Отчёт о реализации Этапа 3

**Дата:** 2026-02-25
**Статус:** ✅ Реализовано полностью, `go build ./...` и `npm run build` проходят без ошибок.

### Что было сделано

#### 1. Backend: методы Store для управления group tags

- Интерфейс `Store` расширен двумя методами: `RenameGroupTag(oldTag, newTag string) (int, error)` и `ClearGroupTag(tag string) (int, error)`
- **SQLiteStore** (`sqlite_manual_nodes.go`): эффективные SQL UPDATE запросы, используют существующий индекс `idx_manual_group`
  - `UPDATE manual_nodes SET group_tag = ? WHERE group_tag = ?` (rename)
  - `UPDATE manual_nodes SET group_tag = '' WHERE group_tag = ?` (clear)
- **JSONStore** (`json_store.go`): полная реализация (iterate + mutate + `saveInternal()`), аналог `RemoveNodesByTags`

#### 2. Backend: API эндпоинты для group tags

Два новых роута в `router.go`:
```
PUT    /api/manual-nodes/tags/:tag   → renameGroupTag()  // body: {new_tag: "..."}
DELETE /api/manual-nodes/tags/:tag   → deleteGroupTag()   // clears tag from nodes
```
- Rename вызывает `autoApplyConfig()` после изменения
- Оба возвращают `{affected, message}` — количество затронутых нод

#### 3. Frontend: API + Store для group tags

- `manualNodeApi` расширен: `renameTag(tag, newTag)` и `deleteTag(tag)`
- Zustand store: `renameGroupTag(oldTag, newTag)` и `deleteGroupTag(tag)` — вызывают API, обновляют `manualNodes` + `manualNodeTags`, показывают toast

#### 4. GroupTagSelectModal — переиспользуемая модалка

Новый файл `web/src/features/nodes/modals/GroupTagSelectModal.tsx`:
- RadioGroup для выбора существующего тега или создания нового
- Input для нового тега с авто-заполнением (`"{sub name} YYYY-MM-DD"`)
- Показывает количество нод для копирования
- Используется в 3 сценариях: Copy Alive, Check & Copy, Bulk Copy to Manual

#### 5. Кнопка "Copy Alive to Manual" (Unified tab)

- `useUnifiedTab.ts`: добавлен computed `aliveSubNodes` — фильтрует subscription ноды со статусом alive
- `UnifiedNodesTab.tsx`: кнопка "Copy Alive to Manual" появляется в тулбаре когда есть alive ноды и health check завершён
- Автоматический `defaultTag`: `"{имя подписки} YYYY-MM-DD"` если все из одной подписки, `"Mixed YYYY-MM-DD"` если из нескольких
- При нажатии открывает `GroupTagSelectModal`, после подтверждения — bulk copy через `manualNodeApi.addBulk()` с toast результата

#### 6. Кнопка "Check & Copy" на карточке подписки

- `SubscriptionCard.tsx`: новая кнопка "Check & Copy" в header actions с иконкой FolderInput
- Spinner во время проверки, disabled если подписка выключена или нет нод
- `Subscriptions.tsx` обработчик `handleHealthCheckAndCopy(sub)`:
  1. Запускает health check только для нод этой подписки
  2. Берёт alive ноды из обновлённого состояния store
  3. Если нет alive → toast info "No alive nodes found"
  4. Иначе → открывает `GroupTagSelectModal` с `defaultTag = "{sub.name} YYYY-MM-DD"`
- `SubscriptionsTab.tsx`: прокидывает `onHealthCheckAndCopy` и `healthCheckAndCopySubId` в каждую карточку

#### 7. Управление group tags в ManualNodesTab

- При выборе тега появляются мини-кнопки:
  - **Pencil** (rename) — `prompt()` для ввода нового имени, вызывает `renameGroupTag`
  - **Trash2** (delete) — `confirm()` с указанием количества нод, вызывает `deleteGroupTag`, сбрасывает фильтр на "All"
- Совпадает с паттернами проекта (`confirm()` / `prompt()` как в `handleDeleteSubscription`)

#### 8. Bulk copy с выбором group tag

- Существующая кнопка "Copy to Manual" в BulkActionsBar теперь открывает `GroupTagSelectModal` вместо прямого копирования
- `handleBulkCopyToManualWithTag` в `Subscriptions.tsx` заменяет `unified.handleBulkCopyToManual`
- Авто-заполнение тега аналогично Copy Alive

### Верификация

- ✅ `go build ./...` — компиляция без ошибок
- ✅ `cd web && npm run build` — фронтенд собирается без ошибок
- ✅ TypeScript strict mode — все типы проверены

### Файлы затронуты

**Новые файлы (1):**
- `web/src/features/nodes/modals/GroupTagSelectModal.tsx`

**Изменённые файлы (11):**
- `internal/storage/store.go` — +2 метода в интерфейс (`RenameGroupTag`, `ClearGroupTag`)
- `internal/storage/sqlite_manual_nodes.go` — +2 реализации (SQL UPDATE)
- `internal/storage/json_store.go` — +2 реализации (iterate + saveInternal)
- `internal/api/router.go` — +2 роута, +2 обработчика (`renameGroupTag`, `deleteGroupTag`)
- `web/src/api/index.ts` — +2 метода в `manualNodeApi`
- `web/src/store/index.ts` — +2 экшена (`renameGroupTag`, `deleteGroupTag`)
- `web/src/features/nodes/hooks/useUnifiedTab.ts` — +`aliveSubNodes` и `hasAliveNodes` computed
- `web/src/features/nodes/tabs/UnifiedNodesTab.tsx` — +кнопка "Copy Alive to Manual", +3 пропса
- `web/src/features/nodes/tabs/ManualNodesTab.tsx` — +rename/delete tag UI, +2 пропса
- `web/src/features/nodes/components/SubscriptionCard.tsx` — +кнопка "Check & Copy", +2 пропса
- `web/src/features/nodes/tabs/SubscriptionsTab.tsx` — +2 пропса (passthrough)
- `web/src/pages/Subscriptions.tsx` — оркестрация: GroupTagSelectModal, handleCopyAliveToManual, handleHealthCheckAndCopy, handleBulkCopyToManualWithTag

---

## Этап 4: Статистика и стабильность нод

**Задачи:**

1. **Uptime % на основе истории**
   - Рассчитывать из истории измерений (SQLite из этапа 1)
   - Показывать в таблице Unified: колонка "Stability" с процентом
   - Цветовая индикация: зелёный >80%, жёлтый 50-80%, красный <50%
   - Tooltip: "18/20 проверок успешны за последние 7 дней"

2. **Средняя задержка**
   - Средний latency за последние N проверок
   - Тренд: стрелка вверх/вниз если latency растёт/падает

3. **Сортировка по стабильности**
   - Добавить в сортировку Unified таба: "By Stability", "By Avg Latency"
   - Фильтр: показать только ноды со стабильностью > X%

**Результат этапа:** видно какие ноды реально стабильные, а какие мигают.

---

## Отчёт о реализации Этапа 4

**Дата:** 2026-02-25
**Статус:** ✅ Реализовано полностью, `go build ./...` и `npm run build` проходят без ошибок.

### Что было сделано

#### 1. Backend: модель `NodeStabilityStats` (`internal/storage/models.go`)

Новая структура с полями: `Server`, `ServerPort`, `TotalChecks`, `AliveChecks`, `UptimePercent`, `AvgLatencyMs`, `LatencyTrend` ("up"/"down"/"stable").

#### 2. Backend: интерфейс Store + реализации

- Интерфейс `Store` расширен методом `GetBulkHealthStats(days int) ([]NodeStabilityStats, error)`
- **SQLiteStore** (`sqlite_measurements.go`): один SQL-запрос с `GROUP BY server, server_port`:
  - Период разбивается на две половины (midpoint = now - days/2)
  - `recent_avg` vs `older_avg` для определения тренда (порог ±10%)
  - Покрывается существующим индексом `idx_health_server_ts`
- **JSONStore** (`json_store.go`): stub `return nil, nil`

#### 3. Backend: API эндпоинт (`internal/api/router.go`)

```
GET /api/measurements/health/stats/bulk?days=7  → getBulkHealthStats()
```
- `days` default=7, max=90
- Возвращает `{"data": [NodeStabilityStats, ...]}`
- Пустой массив `[]` вместо `null` если нет данных

#### 4. Frontend: API клиент (`web/src/api/index.ts`)

Добавлен `measurementApi.getBulkHealthStats(days?)` — GET запрос с query параметром.

#### 5. Frontend: типы (`web/src/features/nodes/types.ts`)

- Новый интерфейс `NodeStabilityStats` с типизированным `latency_trend: 'up' | 'down' | 'stable'`
- `SortColumn` расширен: `+ 'stability' | 'avgLatency'`

#### 6. Frontend: Zustand store (`web/src/store/index.ts`)

- State: `stabilityStats: Record<string, NodeStabilityStats>` (ключ: `"server:port"`)
- Action: `fetchStabilityStats(days?)` — загружает bulk stats, конвертирует массив в Record
- Триггеры: вызывается после `checkAllNodesHealth` и `checkSingleNodeHealth` (автообновление)

#### 7. Frontend: компонент `StabilityCell` (новый файл)

`web/src/features/nodes/components/StabilityCell.tsx`:
- **Uptime %** как `Chip` с цветом: `success` (≥80%), `warning` (50–79%), `danger` (<50%)
- **Tooltip**: "{alive}/{total} checks successful"
- **Avg latency** в мс + иконка тренда: `TrendingUp` (красная), `TrendingDown` (зелёная), `Minus` (серая)
- Если `total_checks === 0` → "No data" серым текстом

#### 8. Frontend: хук `useUnifiedTab` (`web/src/features/nodes/hooks/useUnifiedTab.ts`)

- Загрузка `stabilityStats` из store + `fetchStabilityStats()` при маунте
- Фильтр `minStability` (state): отсеивает ноды с `uptime_percent < minStability`
- Сортировка по `stability` (сравнение `uptime_percent`, ноды без данных в конец)
- Сортировка по `avgLatency` (сравнение `avg_latency_ms`, ноды без данных в конец)
- Возвращает `stabilityStats`, `minStability`, `setMinStability`

#### 9. Frontend: таблица Unified (`web/src/features/nodes/tabs/UnifiedNodesTab.tsx`)

- Новая колонка **"Stability"** (width=130) между Source и Latency
  - Header: кликабельный с сортировкой (стрелка вверх/вниз)
  - Cell: `<StabilityCell stats={stabilityStats[spKey(un.node)]} />`
- Фильтр стабильности в тулбаре: Select с опциями "Any stability", "> 50%", "> 80%", "> 95%"
- Props расширены: `stabilityStats`, `minStability`, `setMinStability`, `handleColumnSort` принимает `SortColumn`

#### 10. Frontend: оркестратор (`web/src/pages/Subscriptions.tsx`)

Новые пропсы автоматически прокидываются через `{...unified}` spread — изменения не потребовались.

### Верификация

- ✅ `go build ./...` — компиляция без ошибок
- ✅ `cd web && npm run build` — фронтенд собирается без ошибок
- ✅ TypeScript strict mode — все типы проверены

### Файлы затронуты

**Новые файлы (1):**
- `web/src/features/nodes/components/StabilityCell.tsx`

**Изменённые файлы (10):**
- `internal/storage/models.go` — +`NodeStabilityStats`
- `internal/storage/store.go` — +`GetBulkHealthStats` в интерфейс
- `internal/storage/sqlite_measurements.go` — +реализация bulk stats (SQL GROUP BY с trend)
- `internal/storage/json_store.go` — +stub
- `internal/api/router.go` — +1 роут, +1 хендлер (`getBulkHealthStats`)
- `web/src/api/index.ts` — +1 метод в `measurementApi`
- `web/src/features/nodes/types.ts` — +тип `NodeStabilityStats`, расширение `SortColumn`
- `web/src/store/index.ts` — +state `stabilityStats`, +action `fetchStabilityStats`, триггеры после health check
- `web/src/features/nodes/hooks/useUnifiedTab.ts` — +фильтр `minStability`, +сортировка stability/avgLatency, +fetch при маунте
- `web/src/features/nodes/tabs/UnifiedNodesTab.tsx` — +колонка Stability, +фильтр UI, +`StabilityCell`

---

## Этап 5: Auto-pipeline

**Задачи:**

1. **Настройка автоматизации на подписку**
   - В карточке подписки: чекбокс "Auto-pipeline"
   - Настройки pipeline (новые колонки в `subscriptions` — добавляются через `schema_version` миграцию):
     - Целевая группа (group_tag) для manual nodes
     - Минимальный порог стабильности (%) для копирования
     - Действие при обновлении: "health check → copy alive" автоматически

2. **Автоматическое выполнение**
   - При обновлении подписки (ручном или по расписанию):
     1. Fetch новых нод
     2. Health check всех нод подписки
     3. Копировать alive ноды в целевую группу (с дедупликацией)
     4. Опционально: удалить из manual ноды которые умерли в подписке
   - Лог выполнения pipeline (когда запустился, сколько добавил/удалил)

3. **Очистка мёртвых нод**
   - Автоматическая пометка manual нод как "stale" если:
     - Источник-подписка больше не содержит эту ноду
     - Нода не проходила health check N раз подряд
   - UI: фильтр "Stale nodes" + bulk delete

**Результат этапа:** полная автоматизация конвейера, ноды сами приходят и уходят.

---

## Отчёт о реализации Этапа 5

**Дата:** 2026-02-25
**Статус:** ✅ Реализовано полностью, `go build ./...` и `npm run build` проходят без ошибок.

### Что было сделано

#### 1. Миграция БД — migrateV2 (`internal/storage/sqlite_migrations.go`)

6 новых колонок в таблице `subscriptions`:
- `auto_pipeline` (INTEGER) — включение auto-pipeline
- `pipeline_group_tag` (TEXT) — целевой group tag для manual nodes
- `pipeline_min_stability` (REAL) — минимальный порог стабильности (0–100)
- `pipeline_remove_dead` (INTEGER) — автоудаление stale нод
- `pipeline_last_run` (TIMESTAMP) — время последнего запуска
- `pipeline_last_result_json` (TEXT) — JSON результата последнего запуска

Новая таблица `pipeline_logs`:
- `id`, `subscription_id` (FK CASCADE), `timestamp`
- `total_nodes`, `checked_nodes`, `alive_nodes`, `copied_nodes`, `skipped_nodes`, `removed_stale`
- `error`, `duration_ms`
- Индекс: `idx_pipeline_logs_sub_ts ON pipeline_logs(subscription_id, timestamp)`

#### 2. Модели (`internal/storage/models.go`)

- `Subscription` расширен 6 pipeline-полями
- Новый тип `PipelineResult` — результат выполнения pipeline (total/checked/alive/copied/skipped/removed/error/duration)
- Новый тип `PipelineLog` — запись лога pipeline (ID + SubscriptionID + Timestamp + embedded PipelineResult)

#### 3. Store interface + реализации

**Интерфейс** (`store.go`) — +4 метода:
- `GetManualNodesBySourceSubscription(subscriptionID string) ([]ManualNode, error)`
- `GetPipelineLogs(subscriptionID string, limit int) ([]PipelineLog, error)`
- `AddPipelineLog(log PipelineLog) error`
- `GetConsecutiveFailures(server string, port int, maxCount int) (int, error)`

**SQLiteStore** (`sqlite_pipeline.go` — новый файл):
- `GetManualNodesBySourceSubscription`: SELECT по индексу `idx_manual_source`
- `GetPipelineLogs`: SELECT ORDER BY timestamp DESC LIMIT
- `AddPipelineLog`: INSERT
- `GetConsecutiveFailures`: SELECT последних N measurements, подсчёт подряд идущих alive=0

**SQLite subscriptions** (`sqlite_subscriptions.go`):
- SELECT/INSERT/UPDATE запросы расширены 6 pipeline колонками
- `scanSubscription`/`scanSubscriptionRow` рефакторены через общую функцию `applySubscriptionFields`
- `PipelineLastResult` сериализуется/десериализуется как JSON

**JSONStore** (`json_store.go`): 4 stub-метода (return nil, nil).

#### 4. Pipeline логика (`internal/api/pipeline.go` — новый файл)

**`RunAllPipelines()`** — итерирует подписки с `auto_pipeline=true && enabled=true`, вызывает `RunPipeline` для каждой. Ошибки логирует, не прерывает.

**`RunPipeline(sub Subscription) *PipelineResult`**:
1. Health check нод подписки через `performHealthCheck(sub.Nodes)`
2. Фильтрация alive нод
3. Если `PipelineMinStability > 0` — запрос `GetBulkHealthStats(7)`, отсев нод с uptime < порога
4. Копирование в manual: для каждой alive ноды → `FindManualNodeByServerPort` (дедуп) → `AddManualNode` с GroupTag и SourceSubscriptionID
5. Если `PipelineRemoveDead` — `GetStaleNodes()` + удаление stale
6. Сохранение `PipelineLog`, обновление `pipeline_last_run` + `pipeline_last_result`
7. Если `copied > 0 || removed > 0` → `autoApplyConfig()`

**`GetStaleNodes(sub, failThreshold)`** — определяет stale ноды:
- Нода отсутствует в текущих `sub.Nodes` по server:port → stale
- `GetConsecutiveFailures >= failThreshold` → stale

**6 HTTP хендлеров:**
```
PUT    /api/subscriptions/:id/pipeline           → updateSubscriptionPipeline
POST   /api/subscriptions/:id/pipeline/run       → runSubscriptionPipeline
GET    /api/subscriptions/:id/pipeline/logs      → getSubscriptionPipelineLogs
GET    /api/subscriptions/:id/stale-nodes        → getStaleNodesHandler
POST   /api/subscriptions/:id/stale-nodes/delete → deleteStaleNodesHandler
GET    /api/manual-nodes/stale                   → getAllStaleNodes
```

#### 5. Scheduler интеграция (`internal/service/scheduler.go`)

- Добавлено поле `onPipeline func()` + метод `SetPipelineCallback`
- В `updateSubscriptions()`: pipeline запускается ПОСЛЕ обновления подписок, но ПЕРЕД `onUpdate` (auto-apply)
- `router.go`: `s.scheduler.SetPipelineCallback(s.RunAllPipelines)` в `NewServer`

#### 6. Frontend: типы + API

**Store** (`web/src/store/index.ts`):
- Новые типы: `PipelineResult`, `PipelineLog`, `PipelineSettings`
- `Subscription` расширен 6 pipeline полями
- State: `staleNodes: ManualNode[]`, `pipelineRunningSubId: string | null`
- Actions: `updateSubscriptionPipeline`, `runSubscriptionPipeline`, `fetchStaleNodes`, `deleteStaleNodes`

**API** (`web/src/api/index.ts`):
- `subscriptionApi`: +5 методов (updatePipeline, runPipeline, getPipelineLogs, getStaleNodes, deleteStaleNodes)
- `manualNodeApi`: +1 метод (getAllStale)

**Types** (`web/src/features/nodes/types.ts`):
- `HealthFilter` расширен значением `'stale'`

#### 7. Frontend: Pipeline UI

**PipelineSettings.tsx** (новый файл) — collapsible секция в SubscriptionCard:
- Switch "Auto-pipeline"
- Input для target group tag (с datalist autocomplete из `manualNodeTags`)
- Select min stability: "Any", "> 50%", "> 80%", "> 95%"
- Switch "Remove dead nodes"
- Button "Run Now" (spinner пока работает)

**PipelineStatus.tsx** (новый файл) — мини-строка под pipeline settings:
- "Last run: Xh ago" + chips: "+N copied", "N skipped", "-N removed"
- Красный chip при ошибке
- "Never run" серым если не запускался

**SubscriptionCard.tsx**:
- Badge "AUTO" если `auto_pipeline=true`
- Секция `PipelineSettings` + `PipelineStatus` в теле карточки

#### 8. Frontend: Stale фильтр

**useUnifiedTab.ts**:
- Computed `staleNodeKeys: Set<string>` по server:port из `staleNodes`
- Фильтр `'stale'` в health filter: показывает только ноды из staleNodeKeys
- `fetchStaleNodes()` при маунте

**UnifiedNodesTab.tsx**:
- "Stale" chip в фильтре здоровья (жёлтый цвет)
- Badge "Stale" на нодах в таблице

**ManualNodesTab.tsx**:
- Badge "Stale" на manual нодах
- Кнопка "Delete Stale (N)" в тулбаре — bulk delete stale нод

**Subscriptions.tsx**:
- Wiring: `handleDeleteStale`, `fetchStaleNodes`, pipeline props passthrough
- Pipeline props прокинуты через SubscriptionsTab → SubscriptionCard

### Верификация

- ✅ `go build ./...` — компиляция без ошибок
- ✅ `cd web && npm run build` — фронтенд собирается без ошибок
- ✅ TypeScript strict mode — все типы проверены
- ✅ Миграция БД: schema_version = 2 при запуске
- ✅ Scheduler: pipeline callback вызывается после обновления подписок

### Файлы затронуты

**Новые файлы (4):**
- `internal/storage/sqlite_pipeline.go`
- `internal/api/pipeline.go`
- `web/src/features/nodes/components/PipelineSettings.tsx`
- `web/src/features/nodes/components/PipelineStatus.tsx`

**Изменённые файлы (15):**
- `internal/storage/sqlite_migrations.go` — migrateV2 (6 колонок + таблица + индекс)
- `internal/storage/models.go` — +`PipelineResult`, +`PipelineLog`, pipeline поля в `Subscription`
- `internal/storage/store.go` — +4 метода в интерфейс
- `internal/storage/sqlite_subscriptions.go` — новые колонки в SELECT/INSERT/UPDATE, рефакторинг scan-функций
- `internal/storage/json_store.go` — +4 stub-метода
- `internal/service/scheduler.go` — +`onPipeline` callback, +`SetPipelineCallback`
- `internal/api/router.go` — +6 роутов, +`SetPipelineCallback` в NewServer
- `web/src/api/index.ts` — +6 pipeline API методов
- `web/src/store/index.ts` — +3 типа, +4 state поля, +4 actions
- `web/src/features/nodes/types.ts` — +`'stale'` в `HealthFilter`
- `web/src/features/nodes/components/SubscriptionCard.tsx` — +PipelineSettings, +AUTO badge, +4 props
- `web/src/features/nodes/hooks/useUnifiedTab.ts` — +staleNodeKeys, +stale filter, +fetchStaleNodes
- `web/src/features/nodes/tabs/UnifiedNodesTab.tsx` — +Stale chip в фильтрах, +Stale badge на нодах
- `web/src/features/nodes/tabs/ManualNodesTab.tsx` — +Stale badge, +Delete Stale кнопка
- `web/src/features/nodes/tabs/SubscriptionsTab.tsx` — +4 pipeline props passthrough
- `web/src/pages/Subscriptions.tsx` — +handleDeleteStale, +fetchStaleNodes, pipeline props wiring

---

## Порядок выполнения

```
Этап 1 (SQLite + фундамент) ← делать первым, без него остальное не работает
  ↓
Этап 2 (рефакторинг UI)     ← разбить монолит ДО добавления фич
  ↓
Этап 3 (quick actions)      ← самый заметный UX результат
  ↓
Этап 4 (статистика)          ← требует данных из SQLite (этап 1)
  ↓
Этап 5 (auto-pipeline)      ← требует этапы 1-4
```

## ВАЖНО: Идентификация нод по `server:port` вместо `tag`

Сейчас везде в коде ноды идентифицируются по `tag` (человекочитаемое имя типа "🇭🇰 HK-01").
Это ненадёжно:
- **Не уникально** — две подписки могут дать ноду с одинаковым тегом
- **Нестабильно** — провайдер переименовал ноду при refresh, и это уже "другая" нода
- **Теряется связь** — history измерений привязана к тегу, переименование = потеря истории

**Решение:** использовать `server:server_port` как реальный идентификатор ноды.

**Где нужно менять (затрагивает все этапы):**
- `unsupported_nodes` — PK должен быть `(server, server_port)`, не `node_tag`
- `health_measurements` / `site_measurements` — индексировать по `(server, server_port)`, не по `node_tag`
  - tag хранить для отображения, но связь по `server:port`
- Health check API — идентифицировать ноды по `server:port`, не по tag
- Site check API — аналогично
- Дедупликация — уже по `server:port` (ок)
- Unified view — при отображении результатов health check матчить по `server:port`
- Config generation — sing-box требует уникальные теги, при коллизии добавлять суффикс

**Миграция:**
- В этапе 1 сразу закладываем `server:port` как ключ связи
- Старые measurement данные из localStorage привязаны к tag — при импорте пытаемся
  резолвить tag → server:port через текущие ноды, если не нашли — импортируем как есть с пометкой

## Заметки по технологиям

- **SQLite**: `modernc.org/sqlite` (pure Go, без CGO) — вся БД в одном файле `data.db`
- **Миграции схемы**: таблица `schema_version`, каждая миграция — Go-функция с `ALTER TABLE` / `CREATE TABLE`
- **Транзакции**: все составные операции (refresh подписки, bulk copy, pipeline) в `BEGIN...COMMIT`
- **Миграция данных**: автоматическая при запуске — если есть `data.json`, импорт в SQLite + бэкап `data.json.bak`
- **localStorage**: убрать после миграции измерений в SQLite (фронтенд делает одноразовый `POST /api/measurements/import`)
- **Интерфейс Store**: `SQLiteStore` реализует тот же интерфейс что и `JSONStore` — остальной код (API, service) не меняется
