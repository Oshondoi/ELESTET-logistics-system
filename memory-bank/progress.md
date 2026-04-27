# Progress

## Current Status
MVP в активной разработке. Деплой на Vercel активен.

## What Works

- Project scaffolding is complete
- Dev server runs successfully
- Tailwind styling is active
- Left sidebar navigation (зафиксирован по высоте — `h-screen sticky`)
- Company switcher + редактирование названия компании
- Auth page: вход / регистрация (Имя обязательно, JS-валидация)
- Session-gated app shell
- Company creation / switching / deletion (FK-безопасное) flow
- Supabase client bootstrap

### RBAC — Ролевой контроль доступа (завершено)
- `useMyPermissions` хук: owner/admin → FULL_PERMISSIONS, остальные → запрос в `roles` по `assigned_user_id`
- Sidebar: фильтрация пунктов меню по `permKey` из `RolePermissions`
- App.tsx: `pagePermKey` map + useEffect редирект на home при недоступной странице
- Все страницы получают `canManage` prop и скрывают action-кнопки при `canManage=false`:
  - ShipmentsPage + TripTable: чекбоксы, bulk-операции, дропдауны статусов, фото накладных
  - StoresPage + StoreList: sync/edit/delete магазина
  - DirectoriesPage + DirectoryPanel: форма добавления, кнопки редактировать/удалить
  - StickersPage: создать стикер/набор, кнопки редактировать/удалить
  - RolesPage + RoleRow: создать роль, кнопки редактировать/удалить

### Роли (завершено)
- Таблица `roles` с RLS, `assigned_user_id`
- Короткие ID пользователей: U1, U2, U3 (`profiles.short_id`)
- RPC `resolve_account_user` — поиск по email, UUID, U{n}
- Страница Ролей: создание, редактирование, удаление, клонирование в другую компанию
- Назначение роли пользователю: email или U{n} с автоподтягиванием второго поля
- Список ролей показывает имя и U{n} пользователя

### Магазины (завершено)
- Список магазинов + создание / редактирование / удаление
- API-ключ: маска в edit-режиме, кнопка «Изменить»
- store_code редактируем
- Колонки: API ключ (зелёный badge), Поставщик, Адрес, Создан
- Кнопка синка с WB API → подтягивает название поставщика (`data.name`)

### Рейсы / Логистика (завершено)
- Таблицы `trips` и `trip_lines`, RPC, UI
- Редактирование рейса и поставки
- Добавление поставки в рейс
- Фото накладных (лайтбокс-карусель, контекстное меню)
- Дропдауны статусов
- `draft_number` / `trip_number`: черновик получает «Черновик-N», по статусу «Отправлен» присваивается `trip_number`
- Колонки поставки: Магазин, Поставка, Объём (коробов+единиц+вес), Дата приёма, Статус, Прибыл, Отгружено, Дата МП, Оплата, Комментарий
- Поле **Вес (кг)** в поставке — отображается в колонке «Объём» (напр. `120 единиц · 40 кг`)
- Автозаполнение дат: `arrival_date` при статусе «Прибыл», `shipped_date` при «Отгружен» (если не заданы вручную)
- Массовое «Прибыл» для рейса: все не-«Отгружен» строки получают `arrival_date = today`
- Глобальная нумерация поставок по `account_id` (вместо `store_id`)
- Сортировка поставок: новые сверху (по `shipment_number DESC`)
- Режим фокуса: тёмный оверлей снаружи таблицы + соседние рейсы `opacity-10`
- Настройка колонок: показ/скрытие builtin и custom колонок через `columnConfigService`
- SQL патч `patch_all_in_one.sql` — применяет все новые колонки и обновлённую функцию за один раз
- Перевозчики и склады, CRUD
- ⚠️ Системные склады WB: требуется `patch_system_warehouses.sql` в продакшн

### Стикеры WB (завершено)
- CRUD шаблонов, PDF-генерация
- Иконки ухода, EAC
- Наборы стикеров
- Вкладка Импорт WB: аккордеон с фото, превью по наведению, чекбоксы, «Создать набор» со skip дублей
- Вкладка Кастомная: массовое удаление через кнопку-корзину в шапке колонки

### Деплой (завершено)
- Vercel: env переменные настроены
- Supabase: Site URL и Redirect URLs → Vercel-домен
- Email-подтверждение при регистрации работает
- Продакшн БД: все 19 SQL-патчей применены, RLS политики восстановлены
- account_members заполнен, данные видны на Vercel

### Товары — ProductsPage (завершено)
- Аккордеон с анимацией (grid-template-rows trick)
- Вложенная таблица размеров (Размер badge + Баркод)
- Сортировка размеров по убыванию (2XL→XL→L→M→S)

### Отзывы WB — Claude API фикс + isAiConfigured (завершено, 26.04.2026)
- Старые модели deprecated → заменены на `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` / `claude-opus-4-7`
- `isAiConfigured` в `ReviewsPage.tsx` — проверяет ключ активного провайдера (не всегда openai_key)
- Все 7 мест с `aiSettings?.openai_key` заменены на `isAiConfigured`
- SQL: `patch_ai_providers.sql` обновлён (добавлен UPDATE для миграции старых model ID)

### Отзывы WB — мульти-провайдер ИИ (завершено, 26.04.2026)
- `AiProvider`: `openai` | `claude`; `ClaudeModel`: Sonnet/Haiku/Opus — все поддерживают Vision
- `callClaudeDirect`: Anthropic API напрямую с заголовком `anthropic-dangerous-direct-browser-access`
- `buildAiPromptParts`: системный + промпт магазина (append, читается вторым)
- `saveStorePrompt`: сохраняет `ai_prompt` в `stores` (принадлежит магазину)
- `Store` тип: `ai_prompt?: string | null`
- `AiTone`: добавлен `professional` (строго формальный)
- `AiSettingsModal`: табы Claude/OpenAI, оба блока в grid-ячейке (без прыжков), кнопка «Активировать», 2 промпт-модалки, удаление ключа
- `ReviewsPage`: активный таб в localStorage, `storePrompt` в `callOpenAi`
- `tailwind.config.js`: `zIndex { 60 }` для PromptModal
- ⚠️ SQL: `patch_ai_providers.sql` + `patch_store_ai_prompt.sql` — применить в Supabase

### Отзывы WB — ИИ-ответы (завершено, 26.04.2026)
- Таблица `account_ai_settings`: `openai_key`, `model`, `tone`, `system_prompt` с RLS по `account_members`
- Поля `ai_reply`, `ai_reply_status` (`none`/`generated`/`sent`), `reply_sent_at` в `wb_feedbacks`
- `WbFeedbackRow` тип — полная строка из БД (включая ai_reply поля)
- `callOpenAi`: toneMap, дефолтный system prompt на русском, max_tokens=400, обработка 401/429
- `AiSettingsModal`: password-поле с show/hide, radio модель, dropdown тон, textarea system prompt
- `NegativeSendModal`: amber-предупреждение для 1–3★ перед отправкой
- Кнопка «⚙ Настройки ИИ»: фиолетовая при настроенном ключе, серая — нет
- Вкладка «🧪 Тест ИИ-ответа»: dry-run, ничего не сохраняется и не отправляется
- UI стабильность: кнопки в header всегда рендерятся (не `&&`), видимость через `disabled`/`invisible`
- При смене магазина: `loadFromDb` вызывается сразу в reset-эффекте
- ⚠️ SQL-патч `patch_ai_reviews.sql` нужно применить в Supabase вручную

### Отзывы WB — ReviewsPage (завершено)
- Таблица `review_templates` в Supabase с RLS
- Таблица `wb_feedbacks` в Supabase для кэширования (patch_wb_feedbacks.sql)
- pagePermKey: `reviews: null` (доступно всем)

### Серверная автоматизация ответов WB (завершено, 27.04.2026)
- **Edge Function** `auto-reply` — Deno, запускается через pg_cron каждые 30 минут
- **pg_cron + pg_net**: `cron.job` = `auto-reply-every-30min`, расписание `*/30 * * * *`
- **Настройки** хранятся в таблице `automation_settings` (account_id PK) — управляются с фронта
  - `is_enabled` — включить/выключить серверную автоматизацию
  - `source`: `ai` | `templates` | `ai_with_fallback`
  - `daily_limit` — 0 = без лимита
  - `target_ratings[]` — какие оценки отвечать
  - `require_text` — только отзывы с текстом
  - `delay_seconds` — пауза между ответами (мин 32с на фронте), делится пополам до и после отправки
  - `store_ids[]` — какие магазины обрабатывать
- **Логи** хранятся в таблице `automation_logs` (run_at, sent_count, log[], error)
- **Фронт** (`ReviewsPage.tsx`, вкладка Автоматизация):
  - Все настройки сохраняются в DB при изменении через `saveAutomationSettings`
  - Загружаются из DB при входе/смене аккаунта
  - Блок «Серверная автоматизация»: чекбокс включить/выключить, последние 3 запуска с логами, кнопка обновить
  - Ручная кнопка «Запустить» убрана — всё через сервер
- **SQL патчи**: `patch_automation_settings.sql`, `patch_auto_reply_cron.sql`
- **Сервис**: `src/services/automationService.ts`

### Баг-фикс: новый пользователь видит только Главную (завершено)
- **Причина:** `createAccountWithOwnerInSupabase` возвращала account без `my_role`
- `useMyPermissions` получал `myRole = undefined` → `DEFAULT_PERMISSIONS` (все false) → Sidebar скрывал всё
- **Фикс:** в `useAccounts.ts` `createAccount` добавить `my_role: 'owner' as const` к возвращаемому объекту
- Кнопка «Развернуть/Свернуть все» (двойная стрелка)
- Поиск по артикулу, названию, бренду
- Колонка фото (36×36, плейсхолдер если нет)
- Превью по наведению 288×384px, умное позиционирование — не выходит за края экрана
- Синхронизация через Edge Function `sync-store-products`

### Тарифы логистики — Справочники (завершено, 28.04.2026)
- **carrier_tariffs**: тарифы перевозчика до склада назначения — `price_per_box` (за короб) и `price_per_kg` (за кг), ключ `(carrier_id, warehouse_id)`
- **wb_unload_tariffs**: тарифы отгрузки на склады ВБ — `price_per_box` за короб, ключ `(account_id, warehouse_id)`
- Обе таблицы с RLS по `account_members`
- SQL патч: `supabase/patch_carrier_tariffs.sql`
- Типы: `CarrierTariff`, `WbUnloadTariff` в `src/types/index.ts`
- Сервис: `fetchCarrierTariffs`, `upsertCarrierTariff`, `fetchWbUnloadTariffs`, `upsertWbUnloadTariff` в `directoriesService.ts`
- **UI**: кнопка `₽` у каждого перевозчика → `CarrierTariffModal` (фикс-высота `100vh-2rem`, `max-w-3xl`) — таблица всех складов с чекбоксами (выбрать/снять все) и инпутами за короб/кг, автосохранение при blur
- **WbUnloadTariffsPanel**: панель ниже сетки, системные склады (WB), инпут за короб, автосохранение при blur
- `DirectoriesPage` получает `accountId` пропом

## What's Left
- Функциональность фото товаров (клик/просмотр полного набора фото)
- Участники компании (Members) — приглашение по email
- Мобильное приложение React Native + Expo
- Поиск и фильтры на странице Логистика
