# автозапуск на macOS

на linux релей живёт под systemd - см. [systemd.md](systemd.md). на маке systemd нет, вместо него launchd: `scripts/install-launchd.sh` пишет пользовательский LaunchAgent и сразу его загружает.

```bash
node src/cli.js setup                    # если конфига ещё нет
./scripts/install-launchd.sh             # запускает релей и включает автозапуск
curl -sS http://127.0.0.1:18960/health
```

скрипт берёт путь к node из `command -v node`. если node поставлен через nvm и в неинтерактивной оболочке не виден, путь передаётся явно:

```bash
./scripts/install-launchd.sh --node "$HOME/.nvm/versions/node/v22.23.4/bin/node"
```

## что создаётся

`~/Library/LaunchAgents/com.github.vlelyavin.zcode-proxy.plist` - описание агента: команда запуска, рабочий каталог, переменная `ZCODE_PROXY_CONFIG` с путём к вашему `config.json`. логи идут в `~/Library/Logs/zcode-proxy.log`.

## остановка и снятие

```bash
launchctl unload ~/Library/LaunchAgents/com.github.vlelyavin.zcode-proxy.plist   # остановить
rm ~/Library/LaunchAgents/com.github.vlelyavin.zcode-proxy.plist                 # снять автозапуск
```

## если не поднимается

- `launchctl list | grep zcode` - агент вообще загружен;
- `tail -20 ~/Library/Logs/zcode-proxy.log` - причина падения;
- `node src/cli.js check` из каталога репозитория - видны ли креды и эндпоинт.

на маке не нужен обход проверки ОС из `bin/zcode-login`: клиент официально поддерживает macOS, device flow проходит штатно.
