# Splint — тестовая версия Stage A

Telegram Mini App: бесплатный каталог авторских демонстрационных картин, раскрашивание по номерам, подтвержденный прогресс и личная коллекция. Это новый тестовый репозиторий, без переноса прежних пользователей и покупок.

Полный контракт — [IMPLEMENTATION_CONTRACT.md](IMPLEMENTATION_CONTRACT.md). Границы и условия запуска — [infra/STAGE_A_LIMITS.md](infra/STAGE_A_LIMITS.md). Развертывание — [infra/DEPLOYMENT.md](infra/DEPLOYMENT.md).

## Локальный запуск без Docker

Нужен Node.js 24 и npm. Настоящий PostgreSQL 18 скачивается в игнорируемую `.local/`; глобальная установка PostgreSQL, Homebrew и облачная БД не нужны. Инструмент предназначен только для локальной разработки.

```sh
npm ci
cp .env.example .env
node scripts/local-postgres.mjs setup
node scripts/local-postgres.mjs start
```

Последнюю команду оставить работающей в отдельном терминале. Она поднимает PostgreSQL только на `127.0.0.1:55432`, создает отдельные `splint_dev` и `splint_test`, записывает случайные локальные учетные данные в `.local/postgres.env` с правами `600`. Значения не выводятся в терминал. Повторный запуск сохраняет данные; помощник не создает пользователей операционной системы.

В другом терминале, из корня репозитория:

```sh
node scripts/with-local-env.mjs npm run db:migrate
node scripts/with-local-env.mjs npm run db:seed
node scripts/with-local-env.mjs npm run dev
```

Открыть [http://127.0.0.1:5173](http://127.0.0.1:5173). API работает на порту `3000`, Vite проксирует API. Локальная демонстрационная авторизация работает только при `ALLOW_DEV_AUTH=true` вне `production`; Telegram-токен для нее не нужен. Не выставляйте этот режим в интернет.

`with-local-env.mjs` читает `.env` и `.local/postgres.env`, не меняет package scripts и сохраняет приоритет явно переданных переменных окружения. В `.env.example` строки адресов БД закомментированы: для embedded PostgreSQL оставьте их так. Для своей локальной БД задайте оба адреса в `.env`. `TEST_DATABASE_URL` должен указывать только на выделенную тестовую базу: интеграционные тесты могут изменять ее данные.

Проверка и остановка локальной БД:

```sh
node scripts/local-postgres.mjs status
node scripts/local-postgres.mjs stop
```

Удалять `.local/postgres-data` для перезапуска не требуется. Если порт занят, не останавливайте неизвестный процесс: сначала проверьте, не работает ли уже другой экземпляр. Вариант с Docker PostgreSQL 18 описан в [infra/DEPLOYMENT.md](infra/DEPLOYMENT.md).

## Проверки

Фактические результаты локальной проверки — [infra/VERIFICATION.md](infra/VERIFICATION.md).

```sh
npm run typecheck
node scripts/with-local-env.mjs npm test
npm run build
```

CI запускает интеграционные тесты на PostgreSQL 17 и 18, собирает frontend/API и Docker image; он не развертывает приложение и не использует облачные секреты. Само наличие workflow не означает успешный запуск CI.

После сборки можно проверить единый сервер с готовым интерфейсом:

```sh
APP_ORIGIN=http://127.0.0.1:3000 node scripts/with-local-env.mjs npm start
```

Миграция и seed запускаются явно. Обычный старт приложения не изменяет схему, не перезаписывает каталог и не переключает webhook.

## Что входит в этот этап

- Три вкладки: каталог, будущий раздел создания, профиль.
- Бесплатный доступ к демонстрационным работам, выбор цвета, масштабирование, сохранение прогресса.
- Коллекция только после подтвержденного завершения; повторное прохождение не добавляет второй экземпляр.
- Сохранение и отправка результата по явному действию пользователя; работа без Telegram использует локальную выгрузку изображения.
- Telegram-вход, поддержка и запрос удаления данных в рамках тестового процесса.

Редактор, фотообработка, продажи, Creator, публикации пользователей, выплаты, Canvas и физические картины не включены. Демонстрационные тексты согласия не заменяют утвержденные условия публичного продукта.

## Проверенность окружения

Во время подготовки репозитория локально поднят **настоящий PostgreSQL 18.4 на macOS ARM64** через `embedded-postgres@18.4.0-beta.17`; это не PGlite и не имитация PostgreSQL. Данные и runtime находятся в `.local/` и не коммитятся.

Docker runtime в исходном рабочем окружении отсутствовал: наличие Dockerfile и Compose не является отчетом об успешной контейнерной сборке. Фактические результаты сборки, тестов и браузерной проверки фиксируются отдельно при передаче версии. Render, облачная БД, R2 и Telegram webhook этим набором файлов не изменены.

Источники конфигурации: [embedded-postgres](https://github.com/leinelissen/embedded-postgres), [официальный PostgreSQL image](https://hub.docker.com/_/postgres), [Docker multi-stage build](https://docs.docker.com/build/building/multi-stage/), [Render Blueprint](https://render.com/docs/blueprint-spec).
