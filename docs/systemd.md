# systemd

Релей работает как обычный локальный сервис. Настраивать автозапуск необязательно, но с ним удобнее.

## Пользовательский юнит (по умолчанию)

```bash
./scripts/install-systemd.sh
```

Скрипт создаёт юнит `~/.config/systemd/user/zcode-proxy.service`, включает его, активирует linger (чтобы процесс продолжал работать после логаута) и выводит health-ссылку.

```bash
systemctl --user status zcode-proxy
journalctl --user -u zcode-proxy -f
systemctl --user restart zcode-proxy
```

## Системный юнит

```bash
sudo ./scripts/install-systemd.sh --system
```

## Опции

```
--node PATH     явный путь к node (если его нет в PATH)
--config PATH   путь к config.json
--name NAME     другое имя юнита
UNIT_DIR        каталог юнитов для пользовательского режима
```

## Замечания

- Сервис запускает команду `node src/cli.js run`. В `WorkingDirectory` задаётся корень репозитория, так как `assets/harness-system.json` читается относительно него.
- Путь к учётным данным в конфиге по умолчанию — `~/.zcode/v2/credentials.json`. При использовании системного юнита переменная `HOME` указывает на домашний каталог владельца, чтобы сервис мог найти credentials.
- Если сервис завершается с ошибкой `cannot read ZCode credentials`, значит вход не выполнен либо подставился `ZCODE_CREDENTIAL_SECRET` из окружения другого пользователя.
