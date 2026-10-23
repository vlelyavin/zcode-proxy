# systemd

Релей — обычный локальный сервис; автозапуск не обязателен, но с ним удобнее.

## Пользовательский юнит (по умолчанию)

```bash
./scripts/install-systemd.sh
```

Кладёт `~/.config/systemd/user/zcode-proxy.service`, включает его, включает linger
(сервис живёт после логаута) и печатает health-ссылку.

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
--node PATH     явный путь к node (если в PATH нет)
--config PATH   путь к config.json
--name NAME     другое имя юнита
UNIT_DIR        каталог юнитов для пользовательского режима
```

## Замечания

- сервис стартует `node src/cli.js run`; `WorkingDirectory` — каталог репо, потому что
  `assets/harness-system.json` читается относительно него
- в конфиге путь к кредам по умолчанию `~/.zcode/v2/credentials.json`; при системном
  юните `HOME` выставляется в домашний каталог владельца, чтобы креды нашлись
- если сервис падает с `cannot read ZCode credentials`, значит логин не сделан или
  сработал `ZCODE_CREDENTIAL_SECRET` из окружения другого пользователя
