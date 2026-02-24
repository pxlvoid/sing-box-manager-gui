# Debug API

Debug API предназначен для удалённой отладки. По умолчанию **выключен**. Включается через тоггл в **Settings → Debug API**.

Пока debug API выключен, все эндпоинты возвращают `403 Forbidden`.

---

## Эндпоинты

### `GET /api/debug/dump`

Полный дамп всех данных приложения.

**Ответ:**

| Поле | Тип | Описание |
|------|-----|----------|
| `timestamp` | string | UTC timestamp ответа |
| `runtime` | object | Информация о среде выполнения |
| `service` | object | Статус sing-box (running, pid) |
| `probe` | object | Статус probe sing-box (healthcheck-процесс) |
| `settings` | object | Все настройки приложения |
| `subscriptions` | array | Подписки с нодами, трафиком, датами |
| `manual_nodes` | array | Вручную добавленные ноды |
| `filters` | array | Фильтры нод |
| `rules` | array | Кастомные правила маршрутизации |
| `rule_groups` | array | Группы правил (Ad Block, AI Services и т.д.) |
| `country_groups` | array | Группировка нод по странам |
| `unsupported_nodes` | array | Ноды, не прошедшие валидацию |

**`probe` содержит:**
- `running` — запущен ли probe-процесс
- `port` — порт Clash API probe-инстанса (0 если не запущен)
- `pid` — PID probe-процесса
- `node_count` — количество нод, загруженных в probe
- `started_at` — время запуска (UTC, null если не запущен)

**`runtime` содержит:**
- `version` — версия sbm
- `go_version` — версия Go
- `os`, `arch` — ОС и архитектура
- `goroutines` — количество горутин
- `mem_alloc_mb` — выделенная память (MB)
- `mem_sys_mb` — системная память (MB)

**Пример:**

```bash
curl http://<host>:9090/api/debug/dump | jq .
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
