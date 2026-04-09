# ELESTET Logistics MVP

MVP веб-приложения для логистики поставок до Wildberries на стеке `React + Vite + Tailwind CSS + Supabase`.

## Что уже есть

- SaaS-структура данных: `profiles`, `accounts`, `account_members`, `stores`, `shipments`, `shipment_status_history`
- Supabase Auth: регистрация, вход, выход и блокировка интерфейса без сессии
- Company flow:
  - создание компании
  - список компаний текущего пользователя в switcher
  - выбор активной компании
  - сохранение активной компании в `localStorage`
  - удаление компании с подтверждением
- Русский операционный интерфейс в компактном SaaS-стиле
- Левый сайдбар, верхний topbar, страницы `Фулфилмент`, `Логистика`, `Магазины`, `Роли`
- Страница логистики с action bar, таблицей и модалкой создания
- Страница магазинов со списком и модалкой создания
- Supabase client и SQL-схема с историей статусов, логикой `tracking_number` и автогенерацией `store_code`
- Приложение работает в Supabase-only режиме

## Структура

```text
src/
  components/
    layout/
    shipments/
    stores/
    ui/
  hooks/
  lib/
  pages/
  services/
  types/
supabase/
  schema.sql
  bootstrap.sql
  dev_access.sql
  disable_rls_dev.sql
  delete_account.sql
memory-bank/
```

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env` на основе `.env.example`:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

3. Выполнить SQL в Supabase SQL Editor по порядку:

```sql
-- 1
supabase/schema.sql

-- 2
supabase/bootstrap.sql

-- 3
supabase/dev_access.sql

-- 4
-- auth / onboarding patch (если еще не применен)
-- вставить SQL patch из текущей документации / чата

-- 5
supabase/delete_account.sql
```

Если возникает ошибка из-за RLS recursion на этапе разработки без auth, временно выполнить:

```sql
supabase/disable_rls_dev.sql
```

4. Запустить dev-сервер:

```bash
npm run dev
```

## Supabase

- SQL-схема лежит в `supabase/schema.sql`
- Bootstrap для первого аккаунта лежит в `supabase/bootstrap.sql`
- Временный dev-доступ для браузера без auth лежит в `supabase/dev_access.sql`
- Временное отключение проблемного RLS для dev лежит в `supabase/disable_rls_dev.sql`
- Удаление компании owner-ом лежит в `supabase/delete_account.sql`
- Приложение работает только через Supabase
- Локальная mock-база больше не используется как основной runtime
- Auth уже подключен на фронте, но production RLS / onboarding еще нужно дотянуть до финального вида

## Следующие шаги

- Дотянуть production-ready onboarding и SQL patch под auth / profiles / memberships
- Добавить нормальный выбор компании и управление несколькими компаниями без хардкода на одну active company
- Добавить фильтры, поиск и страницу деталей поставки
- Дошлифовать UI плотность и поведение элементов
- Подготовить проект к удаленному тестированию и деплою
