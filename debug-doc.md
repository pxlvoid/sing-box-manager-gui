# Debug API

Debug API предназначен для удалённой отладки. По умолчанию **выключен**. Включается через тоггл в **Settings → Debug API**.

Пока debug API выключен, все эндпоинты возвращают `403 Forbidden`.

---

## Эндпоинты

### `GET /api/debug/dump`

Полный дамп всех данных приложения.

**Параметры:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `nodes` | string | — | Передать `true` для включения списков нод в ответ. Без этого параметра возвращается только `node_counts`. |

**Ответ:**

| Поле | Тип | Описание |
|------|-----|----------|
| `timestamp` | string | UTC timestamp ответа |
| `runtime` | object | Информация о среде выполнения |
| `service` | object | Статус sing-box (running, pid) |
| `probe` | object | Статус probe sing-box (healthcheck-процесс) |
| `scheduler` | object | Статус scheduler (подписки + верификация) |
| `settings` | object | Все настройки приложения |
| `subscriptions` | array | Подписки с трафиком, датами |
| `node_counts` | object | Количество нод по статусам (pending, verified, archived) |
| `pending_nodes` | array | Ноды в статусе pending (**только при `?nodes=true`**, иначе `null`) |
| `verified_nodes` | array | Ноды в статусе verified (**только при `?nodes=true`**, иначе `null`) |
| `archived_nodes` | array | Ноды в статусе archived (**только при `?nodes=true`**, иначе `null`) |
| `filters` | array | Фильтры нод |
| `rules` | array | Кастомные правила маршрутизации |
| `rule_groups` | array | Группы правил (Ad Block, AI Services и т.д.) |
| `country_groups` | array | Группировка нод по странам |
| `unsupported_nodes` | array | Ноды, не прошедшие валидацию |
| `verification_logs` | array | Последние 20 записей логов верификации |

**`probe` содержит:**
- `running` — запущен ли probe-процесс
- `port` — порт Clash API probe-инстанса (0 если не запущен)
- `pid` — PID probe-процесса
- `node_count` — количество нод, загруженных в probe
- `started_at` — время запуска (UTC, null если не запущен)

**`scheduler` содержит:**
- `running` — запущен ли scheduler
- `sub_update_enabled` — включено ли автообновление подписок
- `sub_update_interval_min` — интервал обновления подписок (минуты)
- `sub_next_update_at` — следующее обновление подписок (UTC, null если не запущен)
- `verify_enabled` — включена ли верификация
- `verify_interval_min` — интервал верификации (минуты)
- `last_verify_at` — последний запуск верификации (UTC, null если не было)
- `next_verify_at` — следующий запуск верификации (UTC, null если не запущен)

**`runtime` содержит:**
- `version` — версия sbm
- `go_version` — версия Go
- `os`, `arch` — ОС и архитектура
- `goroutines` — количество горутин
- `mem_alloc_mb` — выделенная память (MB)
- `mem_sys_mb` — системная память (MB)

**Каждая нода (`pending_nodes`, `verified_nodes`, `archived_nodes`) содержит:**
- `id` — ID ноды в БД
- `tag` — тег ноды
- `type` — тип протокола (shadowsocks, vmess, vless и т.д.)
- `server`, `server_port` — адрес и порт
- `country`, `country_emoji` — страна
- `status` — статус (pending/verified/archived)
- `source` — источник (manual или ID подписки)
- `consecutive_failures` — количество последовательных провалов
- `last_checked_at` — последняя проверка (UTC)
- `created_at` — время создания
- `promoted_at` — время промоции в verified (UTC)
- `archived_at` — время архивации (UTC)

**Каждая запись `verification_logs` содержит:**
- `id` — ID записи
- `timestamp` — время запуска верификации
- `pending_checked` — проверено pending-нод
- `pending_promoted` — промотировано в verified
- `pending_archived` — заархивировано
- `verified_checked` — проверено verified-нод
- `verified_demoted` — понижено обратно в pending
- `duration_ms` — длительность (мс)
- `error` — ошибка (если была)

**Пример:**

```bash
# Только статистика (без нод)
curl http://<host>:9090/api/debug/dump | jq .

# С полным списком нод
curl "http://<host>:9090/api/debug/dump?nodes=true" | jq .
```

---

### `GET /api/debug/logs/singbox`

Логи sing-box.

**Параметры:**

| Параметр | Тип | По умолчанию | Макс | Описание |
|----------|-----|-------------|------|----------|
| `lines` | int | 500 | 5000 | Количество строк |

**Пример:**

```bash
curl "http://<host>:9090/api/debug/logs/singbox?lines=1000" | jq .
```

---

### `GET /api/debug/logs/app`

Логи приложения sbm.

**Параметры:**

| Параметр | Тип | По умолчанию | Макс | Описание |
|----------|-----|-------------|------|----------|
| `lines` | int | 500 | 5000 | Количество строк |

**Пример:**

```bash
curl "http://<host>:9090/api/debug/logs/app?lines=1000" | jq .
```

---

### `GET /api/debug/logs/probe`

Логи probe sing-box (отдельный процесс для healthcheck/site-check).

**Параметры:**

| Параметр | Тип | По умолчанию | Макс | Описание |
|----------|-----|-------------|------|----------|
| `lines` | int | 500 | 5000 | Количество строк |

**Пример:**

```bash
curl "http://<host>:9090/api/debug/logs/probe?lines=1000" | jq .
```

---

## Probe API

Probe API управляет отдельным sing-box процессом, который используется для healthcheck и site-check. Эти эндпоинты **не требуют** включения Debug API — работают всегда.

### `GET /api/probe/status`

Текущий статус probe-процесса.

**Ответ:**

| Поле | Тип | Описание |
|------|-----|----------|
| `running` | bool | Запущен ли probe |
| `port` | int | Порт Clash API (0 если не запущен) |
| `pid` | int | PID процесса |
| `node_count` | int | Количество загруженных нод |
| `started_at` | string\|null | Время запуска (UTC) |

**Пример:**

```bash
curl http://<host>:9090/api/probe/status | jq .
```

---

### `POST /api/probe/stop`

Останавливает probe-процесс. Полезно для освобождения ресурсов после диагностики.

**Пример:**

```bash
curl -X POST http://<host>:9090/api/probe/stop
```

---

## Базовый домен

Текущий базовый домен для проверок: `https://sing.basegrid.tech/`

Все эндпоинты доступны по этому адресу, например:

```bash
curl https://sing.basegrid.tech/api/debug/dump | jq .
curl https://sing.basegrid.tech/api/probe/status | jq .
```

---

## Включение

1. Открыть веб-интерфейс → **Settings**
2. Найти секцию **Debug API**
3. Включить тоггл **Enable Debug API**
4. Нажать **Save**

После включения на странице отображается предупреждение с полным URL для доступа.

## Безопасность

- Debug API отдаёт **все** данные приложения, включая пароли и URL подписок
- Рекомендуется включать только на время отладки
- Если `allow_lan` выключен, доступ возможен только с localhost
