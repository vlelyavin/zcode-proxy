# zcode-proxy

[README in English](README.md)

у тебя есть триальные кредиты ZCode (старт-план). твои инструменты хотят api-ключ. вот прослойка: локальный релей, который гонит запросы OpenAI/Anthropic через родной модельный эндпоинт ZCode на твоём аккаунте, чтобы hermes / opencode / curl ехали на триальном бакете, а не на счётчике за токены.

## что делает

- спереди говорит по OpenAI (`/v1/chat/completions`, стриминг, инструменты) и отдаёт пасс-through `/v1/messages` для anthropic-клиентов
- ходит на `zcode.z.ai` тем же anthropic-путём, что и официальный клиент
- читает локальные креды ZCode на старте и повторно на `401` — токена в репозитории нет
- стримит вызовы инструментов и reasoning назад OpenAI-дельтами
- один ретрай на `429`/`5xx`, обновление токена на `401`
- ноль npm-зависимостей. только node stdlib.

## что это не

- не продукт z.ai, с ними не связан
- не хостинг — крутится у тебя, на твоих кредах
- не пачка ключей — ничего приватного в репозитории нет

## прямой разговор

он пользуется триальным релеем в обход официального клиента. шлюз проверяет, что запрос похож на настоящий харнесс, и иначе отвечает `405 code 3012 unusual activity`. в репозитории лежит системная преамбула харнесса, а твой системный промпт вливается в её последний блок — так проверка проходит. z.ai может поменять правила в любой день. если долбить один аккаунт параллельно, шанс флага растёт — по умолчанию релей держит 2 запроса в полёте. заблокированные вызовы ничего не списывают, но повторять в момент флага бесполезно.

промо-бакеты истекают. смотри остаток заранее: `curl -sS http://127.0.0.1:18960/status -H "authorization: Bearer <localKey>"`.

## требования

- node 20+ (лучше 24+)
- залогиненный клиент ZCode на этой машине: `~/.zcode/v2/credentials.json` должен существовать. нет файла — нет релея.
- триальные кредиты на аккаунте. платные ключи open-platform этот релей не требуют.

## установка

```bash
git clone https://github.com/vlelyavin/zcode-proxy.git
cd zcode-proxy
npm i -g zcode-app-cli     # рантайм официального клиента, нужен только для логина
./bin/zcode-login          # печатает ссылку, открой на любом устройстве, где залогинен в chat.z.ai
node src/cli.js setup      # пишет config.json со случайным локальным ключом
node src/cli.js check      # креды, эндпоинт, остаток кредитов
node src/cli.js run
```

в самом репозитории `npm install` не нужен. слушает `127.0.0.1:18960`.

```bash
curl -sS http://127.0.0.1:18960/health
```

## использование

```bash
# любой openai-совместимый клиент
curl -sS http://127.0.0.1:18960/v1/chat/completions \
  -H "authorization: Bearer $(jq -r .localKey config.json)" \
  -H "content-type: application/json" \
  -d '{"model":"zcode","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```

модели: `zcode` (GLM-5.3-Flash) и `zcode-5.3` (GLM-5.3). алиасы `glm-5.3-flash` / `glm-5.3` тоже работают.

hermes: заведи custom-провайдера на `http://127.0.0.1:18960/v1` с `localKey` и зови модель `zcode` или `zcode-5.3`.

## конфиг

не обязателен. форма — в `config.example.json`.

```bash
ZCODE_PROXY_CONFIG=./config.json node src/cli.js run
```

| ключ | смысл |
| --- | --- |
| `bind` / `port` | адрес прослушивания, по умолчанию `127.0.0.1:18960` |
| `localKey` | общий секрет на входе; неверный или пустой → 401 |
| `models` | алиас → id модели апстрима |
| `maxInflight` | одновременных запросов к апстриму (по умолчанию 2) |
| `effort` | дефолтный `output_config.effort`, если вызывающий не прислал `reasoning_effort` |
| `credentialsPath` / `telemetryPath` | где клиент держит токены и device id |
| `appVersion` | версия в заголовках отпечатка |

env: `ZCODE_PROXY_BIND`, `ZCODE_PROXY_PORT`, `ZCODE_PROXY_KEY`, `ZCODE_PROXY_EFFORT`, `ZCODE_PROXY_MAX_INFLIGHT`, `ZCODE_PROXY_CONFIG`.

## systemd

```bash
./scripts/install-systemd.sh     # пользовательский юнит, linger включён
```

детали — [docs/systemd.md](docs/systemd.md).

## когда ломается

| симптом | причина |
| --- | --- |
| `405 {"code":3012}` | запрос не похож на харнесс. не ломай 3 системных блока, чужой текст вливай в третий (см. `docs/architecture.md`) |
| `502 Bad Gateway` | сбой шлюза на валидном запросе; один ретрай уже сделан, обычно проходит |
| `401 VERIFY_*` | JWT умер — `./bin/zcode-login`, перезапуск |
| `cannot read ZCode credentials` | не залогинен, либо файл зашифрован под другого пользователя/секрет |
| пустые ответы | мало `max_tokens`, модель сначала тратит их на reasoning |

`401` от самого релея — не совпал `localKey`.

## документация

- [архитектура](docs/architecture.md) — wire, авторизация, правило системных блоков, учёт
- [systemd](docs/systemd.md)

## лицензия

MIT.
