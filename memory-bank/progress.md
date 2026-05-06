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
- **Колонки поставки**: Магазин, Поставка, Объём (коробов + единиц + кг), Статус, **Даты** (динамические колонки), Стикеры, Оплата, Комментарий
- **Колонка "Даты" — динамическая (02.05.2026)**: фиксированный порядок 6 дат (Приём → Отправлен → Прибыл → Отгружен → Запланирован → Приём ВБ), max 3 строки в подстолбце (w-[148px]). Видимые даты автоматически распределяются по чанкам 3 штуки — никакого жёсткого лево/право деления. При скрытии любых дат оставшиеся заполняют колонки по порядку без пропусков.
- **Поля `transit_at` и `wb_acceptance_date`**: добавлены в БД через SQL-патчи (⚠️ применить вручную)
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

### История изменений этапа Маркировка (04.05.2026)
Реализован полный аудит-журнал для этапа Маркировки — полный паритет с ОТК.

**DB:**
- Таблица `fulfillment_marking_log_history` (id, log_id→marking_logs, user_id, user_email, user_name, action, old_values jsonb, new_values jsonb, created_at)
- RLS: SELECT USING true; INSERT WITH CHECK auth.uid()=user_id

**Типы и сервисы:**
- `FulfillmentMarkingLog = FulfillmentOtkLog` (type alias), `FulfillmentMarkingLogHistory` интерфейс
- `addMarkingLogHistory`, `fetchMarkingLogHistory`, `patchMarkingLogHistoryUserName`, `deleteMarkingLog` (soft-delete)

**FulfillmentPage.tsx:**
- `markingHistoryTabId`, `markingLogHistories`, `markingHistoryLoadingIds` (useRef<Set>)
- История пишется в `handleSaveMarkingAll` и `handleMarkingAndAdvance` (created/updated/deleted)
- IIFE-блок истории маркировки — точная копия OTK, только [M]-переменные заменены
- Тарифы `MARKING_TARIFFS`: Стандарт / Срочная / Перемаркировка / Другое
- **Баг-фикс:** pending-deleted логи показываются красными табами сразу (без сохранения) через `pendingDeletedLogs = markingLogs.filter(markingDeletedIds)` + `allDeletedLogs = [...markingDeletedLogs, ...pendingDeletedLogs]`

### Фулфилмент — UX-полировка форм партий (03.05.2026)
- **EditBatchModal**: редактирование партии (название, магазин, 4 этапа), иконка карандаша в строке таблицы
- **Кастомный picker магазина**: searchable modal (z-[60]) с поиском по имени/коду; вложенная модалка «Создать магазин» (z-[70]); stopPropagation на всех слоях
- **Удалён «— без магазина —»** из picker'а
- **Кнопки**: «Создать и закрыть» (`bg-slate-700`, слева) + «Далее» (синяя, справа)
- **Confirmation modal**: при нажатии любой кнопки без выбранного магазина — попап «Продолжить без магазина?»
- **Дефолтные этапы**: все `false` (берутся из `settings`)
- **Маркетплейс**: только `Wildberries` в `constants.ts`

### Иконки оплаты — визуальная полировка (02.05.2026)
- `StatusDropdown`: добавлен `iconToneClasses` — отдельная палитра для иконочного режима (`bg-100 text-500 hover:bg-200`)
- При наличии `iconMap` используются `iconToneClasses` вместо `toneClasses`, hover меняет `bg` а не `opacity`
- Иконки оплаты стали заметнее (дефолт = бывший hover у стикеров)

### Стикеры 2в1 + UI-полировка TripLineStickerCell (завершено, 01.05.2026)
- **`supabase/patch_combined_stickers.sql`**: `ALTER TABLE trip_lines ADD COLUMN IF NOT EXISTS combined_sticker_urls text[] DEFAULT '{}'` — применено ✅
- **`types/index.ts`**: `combined_sticker_urls: string[]` добавлено в `TripLine`
- **`tripService.ts`**: `uploadCombinedStickerFile` + `updateTripLineCombinedStickerFiles`
- **`useAppData.ts`**: `addCombinedStickerFile` / `removeCombinedStickerFile` + геттер/сеттер состояния
- **`TripTable.tsx`** → **`ShipmentsPage.tsx`** → **`App.tsx`**: props-цепочка для combined sticker
- **`TripLineStickerCell.tsx`**: фиолетовая группа «2в1» (view + upload), badge счётчик, dropdown-меню, snapshot (меню не закрывается при удалении), удаление по URL (не по индексу), сброс позиции -9999 перед открытием, viewport clamping, badge центрирование, hover-цвета унифицированы

### Стикеры QR-кодов поставки WB (завершено, 30.04.2026)
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

### Фикс TS-ошибок Vercel + UI ProductsPage (завершено, 29.04.2026)
- **`StickersPage.tsx`**: явный тип `globalIcons`, добавлено `country: ''` при импорте из WB
- **`tripService.ts`**: `as any` cast для `sticker_file_urls` в `.update()`
- **`ProductsPage.tsx`**: счётчики → «Артикулы N · Баркоды N» (баркоды = сумма всех `product.barcodes`)

### UI-полировка StickersPage + ReviewsPage (завершено, 29.04.2026)
- **`StickersPage.tsx`**: кастомная кнопка даты (`showPicker()`, placeholder `дд.мм.гггг`, `bg-[#F3F6FD]`, `w-[5.5rem]`); новый порядок тулбара; пре-принт модалка для любого кол-ва стикеров
- **`stickerPdf.ts`**: иконки ухода фиксированы внизу (`iconsY = H_PX - PAD - iconSize`)
- **`ReviewsPage.tsx`**: карточки отзывов показывают Плюсы/Минусы из WB; ИИ получает pros/cons; блок «Автоматизация ответов» (переименован), кнопки на строку ниже заголовка, кнопка логов справа по контенту; звёзды в «Тест ИИ-ответа» — amber-стиль
- **`AiSettingsModal.tsx`**: `PromptListModal` закрывается кликом по фону

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

### Стикеры QR-кодов поставки WB + кнопка пропуска (30.04.2026)

- **Edge Function `wb-supply`**: `GET /api/v1/supplies/{ID}/package` → 1 страница/коробка QR PDF (58×40мм)
  - `qrcode-generator@1.4.4` + `pdf-lib@1.17.1`; коробки сортируются по числовому суффиксу кода
  - Русскоязычные ошибки: 401 → «Неверный API-ключ WB», 403 → «Поставка принадлежит другому магазину», 404 → «Поставка не найдена»
  - `/passes` — НЕ существует в WB API (404); логика пропусков через загрузку файла вручную
- **Кнопка «WB» в ячейке стикеров**: фиолетовая (wb_supply_id задан) / серая (нет), попап ID → вызов EF
- **Кнопка «Пропуск»** в ячейке стикеров:
  - Серая (нет файла) → file picker PDF → загрузка
  - Зелёная (есть файл) → открывает в новой вкладке + кнопка замены
  - Хранится в `trip-stickers` бакете (суффикс `_pass`), поле `wb_pass_url` в `trip_lines`
- **SQL**: `supabase/patch_wb_pass_url.sql` — применён ✅
- **Файлы**: `supabase/functions/wb-supply/index.ts` (переписан), `src/services/tripService.ts`, `src/hooks/useAppData.ts`, `src/components/ui/TripLineStickerCell.tsx`, `src/types/index.ts`, `src/components/trips/TripTable.tsx`, `src/pages/ShipmentsPage.tsx`, `src/App.tsx`
- **Меню стикеров**: дата/время из timestamp в имени файла `DD.MM.YYYY HH:MM GMT+N`; badge с 1 файла; кнопка скачивания → всегда меню

## What's Left
- Функциональность фото товаров (клик/просмотр полного набора фото)
- Участники компании (Members) — приглашение по email
- Мобильное приложение React Native + Expo

## Что сделано за сессию 05–06.05.2026

### Дневник ELESTET — AI-настройки и UI (05.05.2026)
- Модальное окно AI-настроек теперь с 3 вкладками в шапке: «Выбор модели» / «Цены на текст» / «Цены на фото»
- Убраны всплывающие i-подсказки (popovers)
- `Modal.tsx`: добавлен prop `headerContent?: ReactNode` — под заголовком рендерится дополнительный блок (вкладки)
- `ClaudeModel` тип расширен до 6 моделей: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-7`, `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`
- `CLAUDE_MODEL_OPTIONS` в `AiSettingsModal.tsx` — 6 записей с ценами
- «Тарифы» кнопка в ReviewsPage + встроенный модал с таблицами цен (текст + фото)
- `Button.tsx`: `py-2.5` → `py-1.5` (компактнее)

### Дневник — взаимодействие с календарём (05.05.2026)
- `openDate(date)` — теперь только `setSelectedDate(date)`, без перехода
- `openEntry(date)` — `setSelectedDate` + `setView('entry')` (переход к записи)
- Кнопка «+ Запись»: SVG-плюс + текст «Запись», вызывает `openEntry(selectedDate)`
- `openToday()` → `openEntry(todayISO())`

### Topbar — рефакторинг (05.05.2026)
- Убран prop `onBack`, добавлен `onHomeClick`
- «Домой» стоит в правом блоке слева от «Дневник / Словарь / Админ»
- Три кнопки всегда видны, не зависят от страницы
- Сайдбар скрывается на `admin`, `glossary`, `diary`
- «Домой» показывается только на этих трёх страницах

### Дневник — кнопка перенесена в Topbar (05.05.2026)
- Кнопка «Дневник» убрана из Sidebar
- Добавлена в Topbar (`onDiaryClick` prop), только для `my_role === 'owner'`
- Стиль идентичен «Словарь» и «Админ»

### API-ключи — защита от браузерного сохранения (05.05.2026)
- Все поля API-ключей: `autoComplete="new-password"` + `data-lpignore="true"` + `data-1p-ignore`
- Файлы: `DiaryPage.tsx`, `AiSettingsModal.tsx`, `StoreFormModal.tsx`

### Компании — автосоздание и защита (05.05.2026)
- App.tsx: `useEffect` — если `accounts.length === 0` после загрузки, создаётся «Основная компания»
- `useAccounts.deleteAccount`: проверка `accounts.length - удаляемый <= 0` → ошибка «Нельзя удалить последнюю компанию»
- Кнопка удаления в сайдбаре: `disabled` + `opacity-40` при `accounts.length <= 1`
- `supabase/cleanup_archived_accounts.sql` — скрипт для очистки архивных компаний

### Дропдаун компаний — Portal + архивная модалка (06.05.2026)
- Дропдаун через `createPortal(…, document.body)`, `position:fixed`, `z-9999`, без ограничения шириной сайдбара
- `dropdownRef` на portal-div — click-outside проверяет оба: `companyRef` и `dropdownRef` (фикс: без этого клик по пункту списка закрывал dropdown до срабатывания `onClick`)
- Архивные компании **убраны** из дропдауна → отдельная модалка (Portal, z-10000)
- В конце дропдауна кнопка «Архив» (с иконкой коробки) — видна только при наличии архивных

### Переключение компании до удаления (06.05.2026)
- **Проблема**: при удалении активной компании ставился `activeAccountId = null` → `useAppData(null)` сбрасывал все данные
- **Фикс**: `handleConfirmDeleteActiveCompany` теперь сначала переключается на следующую компанию (oldest по `created_at`), затем вызывает `deleteAccount`

### TypeScript / Vercel build (06.05.2026)
- Ошибка `TS2552: Cannot find name 'SpeechRecognition'` — объявлен интерфейс в `src/vite-env.d.ts`

### Дропдаун компаний — Portal (05–06.05.2026)
- Рендерится через `createPortal(\u2026, document.body)` с `position:fixed`
- Координаты берутся из `triggerRef.getBoundingClientRect()` при открытии и на scroll
- Не ограничен шириной сайдбара, `z-index: 9999`, `max-h-[50vh]`
- Поиск и фильтры на странице Логистика
- Страница Ролей: добавить группу «Фулфилмент» (`fulfillment_view` / `fulfillment_manage`) в UI тогглов

### Фулфилмент — FulfillmentPage (завершено, 03.05.2026)
Полноценный модуль обработки товарных партий для производственных/фулфилментных компаний.

**Этапы (любой можно отключить при создании партии):**
1. Приёмка — список позиций с баркодами, кол-вом; авто-лукап из БД товаров по баркоду (если store.api_key есть)
2. ОТК — ввод кол-ва после контроля качества
3. Маркировка — ввод кол-ва после маркировки
4. Формирование коробов — единицы + кол-во коробов на каждую позицию
5. Передача на логистику — выбор рейса + поставки → обновляет box_qty/units_qty

**Файлы:**
- `supabase/patch_fulfillment.sql` — таблицы: `fulfillment_settings` (дефолты), `fulfillment_batches`, `fulfillment_items`, `fulfillment_stage_logs`; RLS по `account_members`; UPDATE roles SET permissions ← добавляет `fulfillment_view`/`fulfillment_manage` ⚠️ **ЕЩЁ НЕ ПРИМЕНЁН в Supabase**
- `src/services/fulfillmentService.ts` — полный CRUD + `advanceStage` (вычисляет следующий включённый этап, логирует) + `lookupProductByBarcode` (`.contains('barcodes', [barcode])`, парсит `sizes[].skus`)
- `src/pages/FulfillmentPage.tsx` — три модалки: `CreateBatchModal`, `BatchDetailModal` (прогресс-бар, per-stage UI), `SettingsModal`
- `src/types/index.ts` — `FulfillmentStage`, `FulfillmentBatchStatus`, `FulfillmentSettings`, `FulfillmentBatch`, `FulfillmentItem`, `FulfillmentStageLog`, `FulfillmentBatchWithItems`; добавлены `fulfillment_view`/`fulfillment_manage` в `RolePermissions`, `DEFAULT_PERMISSIONS`, `FULL_PERMISSIONS`
- `src/App.tsx` — `pagePermKey.fulfillment = 'fulfillment_view'`; пробрасывает `accountId`, `stores`, `trips`, `onEditTripLine`, `canManage` в FulfillmentPage

**RBAC:** `fulfillment_view` — видит страницу; `fulfillment_manage` — создаёт/редактирует/удаляет партии. `isOwnerOrAdmin` всегда даёт полные права.

### Баг-фикс StickersPage белый экран (03.05.2026)
- **Причина:** `storesWithKey` использовалась в JSX (строки 572/586) без объявления → `ReferenceError` в браузере → белый экран
- **Фикс:** добавлено `const storesWithKey = stores.filter((s) => s.api_key)` в блок рендера `StickersPage.tsx` перед первым использованием
- TypeScript не поймал — только runtime браузера
