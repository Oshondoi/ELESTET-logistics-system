# ELESTET Logistics MVP

MVP веб-приложения для логистики поставок на стеке `React + Vite + Tailwind CSS + Supabase`.

## Принцип работы с кодом (хирургические изменения)

> Делаем ровно то, что попросили. Ничего лишнего.

- Изменять строго указанное место. Не трогать соседние компоненты, логику, стили без явной нужды.
- Не рефакторить и не улучшать самостоятельно — только по явному запросу.
- Не добавлять комментарии, типы, обработку ошибок там, где это не просили.
- Понять задачу, выполнить правильно — но исключительно её одну.

## UI-соглашения

- **Числовые поля** (`input[type="number"]`) — стрелки (spinners) глобально отключены в `src/styles.css`. Никогда не добавлять стрелки при создании или редактировании числовых полей. Исключение только по явному указанию.

## Что уже есть

- SaaS-структура данных: `profiles`, `accounts`, `account_members`, `stores`, `trips`, `trip_lines`, `carriers`, `warehouses`, `roles`
- Supabase Auth: регистрация (Имя + Email + Пароль обязательны), вход, выход
- Company flow: создание, список, switcher, сохранение в localStorage, **архивное удаление** (только владелец + пароль, 15 дней в архиве → жёсткое удаление через pg_cron), редактирование названия
- Деплой на Vercel: env переменные, email-подтверждение → Vercel-домен
- Домен `elestet.net` зарегистрирован на **Namecheap**; DNS настраивается там (Advanced DNS → CNAME/A-запись на Vercel)
- Левый сайдбар: зафиксирован по высоте (`h-screen sticky`), бренд, company switcher (edit + delete), nav, выход
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- **Sidebar**: ID компании отображается как `ID: C-1` (с префиксом)

### Android-совместимость (11.05.2026)
- `src/styles.css`: `@media (pointer: coarse) { :root { -webkit-font-smoothing: auto; -moz-osx-font-smoothing: auto } }`
- Исправляет полное обесцвечивание UI на планшетах с кастомными сборками Chrome и флагом `--disable-composited-antialiasing`

### Браки — авто-загрузка из БД (11.05.2026)
- Вкладка «Браки» в `ProductsPage` читает `fulfillment_marking_logs` где `qty_defect > 0`
- Только чтение, фильтр по магазину, 4 чипа статистики в шапке
- Сервис: `fetchMarkingDefectsByStore` + `MarkingDefectRow` в `fulfillmentService.ts`

### Счёт клиенту — InvoicesPage (10–11.05.2026)
Модуль выставления счётов на основе данных FulfillmentБатч: каждая партия = один счёт.

#### Модальное окно счёта (InvoiceModal)
- **Формат**: полноэкранное (`fixed inset-0`, `h-full w-full`), без закругленных углов
- **Тело**: **три карточки** `grid-cols-3 gap-4`: «Фулфилмент», «Логистика», **«Расходники»** (новая, 11.05)
- **Карточка «Фулфилмент»**:
  - Строки: Приёмка (`stage=reception`), ОТК+Маркировка (`buildWorkLines`), Формирование коробов (`stage=packing`)
  - **Критично**: `tariffMap` ключ = `t.id` (UUID), НЕ `t.name`
- **Карточка «Расходники»**: пустая заглушка, TBD
- **Share-кнопка**: `font-[inherit]` на `<button>` для совпадения размера текста с соседними ссылками
- **URL-роутинг**: `/invoices/C-{accountShortId}/I-{batch.short_id}`

### Справочники — WB склады (11.05.2026)
- `patch_wb_system_warehouses.sql`: 120+ реальных складов WB + 5 международных (Алматы, Астана, Бишкек, Минск, Ташкент)
- Удалены строки с `?????` (артефакт неверной кодировки предыдущего патча)
- `ON CONFLICT DO NOTHING` — пользовательские склады компаний не тронуты

### Справочники — Склады назначения: сортировка + D&D (11.05.2026)
- Компонент `WarehousesPanel` вместо `DirectoryPanel` для секции складов
- Режим `alpha`: сортировка A→Я через `useMemo`
- Режим `custom`: HTML5 drag-and-drop, ручка (6-dots), синяя подсветка цели
- Иконки-кнопки переключения: `text-slate-400 hover:text-slate-700` (видимые по умолчанию)
- Состояние в localStorage: `warehouse_sort_mode`, `warehouse_order_{accountId}`

### Фулфилмент — этап Упаковка (13.05.2026)

Новый производственный этап **Упаковка** (`packaging`) между ОТК и Маркировкой.

- **Зип-пакеты**: переключатель «Все товары» / «Указать вручную» + числовой инпут; сохраняется в `fulfillment_batches.packaging_zip_qty`
- **Журнал работ**: полный паритет с ОТК — исполнитель, тариф (`stage=packaging`), расходник (dropdown), кол-во годных, брак, фото, мягкое удаление
- **Расходники**: выбираются прямо в модале «Добавить работу» (отдельного блока Расходники нет)
- **Буфер**: несохранённые записи отображаются amber-карточками; «Сохранить» или «Сохранить и продолжить»
- **Тип**: `FulfillmentPackagingLog extends FulfillmentOtkLog { consumable_id: string | null }`
- **Сервис**: `fetchPackagingLogs`, `addPackagingLog`, `updatePackagingLog`, `deletePackagingLog`, `uploadPackagingPhoto`
- **advanceStage**: order-массив и skip-map обновлены (порядок: reception→otk→packaging→marking→packing→logistics→done)
- **Формирование коробов (packing)**: добавлен блок «Зип-пакеты» сверху (показывает то, что сохранено на этапе Упаковка)
- **Dashboard**: split-card «Упаковка» [Упаковано / Браки / Итого] в статистике партии

⚠️ SQL-патчи применить в Supabase Dashboard:
1. `supabase/patch_packaging_logs.sql`
2. `supabase/patch_packaging_logs_consumable.sql`

### Справочники — Тарифы работ: логистика (11.05.2026)
- Стейджи `logistics_rf` + `wb_unload`: поле «Склад» (кастомный `WarehouseSearchSelect`) вместо текстового поля
- `WarehouseSearchSelect`: `position: fixed` (выходит за overflow-parent), поиск по подстроке, фокус при открытии
- Новое поле `price_per_kg` (`patch_work_tariffs_price_per_kg.sql` ⚠️ применить)
- Форма добавления тарифа поднята вверх (под «Валюта раздела»)
- Шапка таблицы всегда видна (пустое состояние внутри `<tbody>`)

### Справочники — тарифы работ (10.05.2026)
- **Три колонки цен** в таблице тарифов: «Заказчику», «Исполнителю» (зелёный), «Старшему» (синий)
- Поля `price_worker` и `price_senior` в таблице `fulfillment_work_tariffs` (`patch_work_tariffs_worker_senior.sql` ✅)
- **Hover-редактирование**: клик по ячейке → edit на конкретное поле; no pencil icon
- Placeholder = текущее значение; auto-save on blur (120ms); Escape — отмена; blur-delete race исправлен `onMouseDown+preventDefault`
- **Право `directories_tariff_manage`**: гранулярное, отдельно от `directories_manage`
  - `canManageTariffs` prop в `DirectoriesPage` и `WorkTariffsPanel`
  - ⚠️ SQL: `supabase/patch_roles_tariff_manage.sql` запустить в Supabase

### URL-роутинг (10.05.2026)
- `react-router-dom` (BrowserRouter) — SPA с реальными URL
- `PAGE_ROUTES` / `ROUTE_PAGES` — карты PageKey ↔ путь (`/fulfillment`, `/shipments`, …)
- `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` — fallback для SPA

### Фулфилмент — URL партий (10.05.2026)
- **Схема**: `/fulfillment/C-{accountShortId}/P-{batchShortId}`
- `C-N` — глобальный порядковый номер компании (`accounts.short_id`, SERIAL), `patch_accounts_short_id.sql` ✅
- `P-N` — порядковый номер партии внутри компании (`fulfillment_batches.short_id`, per-account через триггер), `patch_batches_short_id.sql` ✅
- `App.tsx` парсит URL при первом рендере, переключает активный аккаунт, передаёт `initialBatchShortId`
- **Кнопка «Поделиться»**: Telegram / WhatsApp / Копировать ссылку (птичка 2с)

### Фулфилмент (04.05.2026)
Полный модуль управления производственным/фулфилментным процессом: от приёмки товара до передачи на логистику.

- **Партии** — основная единица: название, магазин, набор включённых этапов, статус (В работе / Завершена / Отменена)
- **Многоэтапный процесс** (каждый этап можно включить/отключить при создании партии):
  1. **Приёмка** — добавление позиций по баркоду (ручной ввод или сканер), кол-во; авто-лукап названия/размера из БД товаров если у магазина есть API-ключ
  2. **ОТК** — журнал работ: исполнитель, тариф, кол-во годных + брак, фото. Подробная история изменений. Расхождение с приёмкой.
  3. **Упаковка** — журнал работ: Зип-пакеты (кол-во), тариф + расходник + кол-во/брак/фото. Аналог ОТК. `fulfillment_packaging_logs`.
  4. **Маркировка** — журнал работ: исполнитель, тариф, кол-во годных + брак, фото. Подробная история изменений (полный паритет с ОТК).
  5. **Формирование коробов** — ввод кол-ва единиц + кол-ва коробов на каждую позицию; блок «Зип-пакеты» сверху
  6. **Передача на логистику** — выбор рейса + поставки → авто-обновляет `box_qty` и `units_qty` в поставке
- **Прогресс-бар** этапов внутри партии: зелёный = пройден, синий = текущий, серый = ожидает
- **Редактирование партии** (EditBatchModal) — иконка карандаша в строке; изменение названия, магазина, этапов
- **Создание партии** (CreateBatchModal):
  - Кастомный searchable picker магазина — поиск по названию/коду, вложенная модалка «Создать магазин»
  - «Создать и закрыть» (тёмная, слева) + «Далее» (синяя, справа)
  - Подтверждение «Продолжить без магазина?» если магазин не выбран
  - Все этапы по умолчанию выключены (из настроек компании)
- **Настройки** (шестерёнка) — дефолтные этапы для новых партий в компании
- **RBAC**: `fulfillment_view` и `fulfillment_manage` в таблице ролей

#### История изменений (аудит-журнал ОТК и Маркировка)
Кнопка **«История»** в шапке партии → модалка с полным журналом:
- Табы этапов (Приёмка / ОТК / Маркировка / ...)
- Мини-табы логов: синий = нетронутый, оранжевый = изменённый, **красный = удалённый** (показывается сразу, ещё до сохранения)
- Левая колонка: текущие / первоначальные данные записи
- Правая колонка: карточки журнала (зелёная=Создал, жёлтая=Изменил, красная=Удалил) с автором и датой

**DB-таблицы:** `fulfillment_otk_log_history`, `fulfillment_marking_log_history`

#### ⚠️ Политика сохранения данных (важно)
**Данные никогда не удаляются без явного согласия.** Мотивация: спорные ситуации с клиентами могут возникнуть через год+, архив — доказательная база.

- **OTK и Marking логи** удаляются только soft-delete (`deleted_at`). FK `user_id` → `auth.users ON DELETE SET NULL`.
- **Партии** при нажатии «Удалить» перемещаются в архив (`deleted_at`), не удаляются физически.
- **Авто-создание trip_line**: добавление новой поставки к завершённой партии (через кнопку «Сохранить» на этапе Коробов) автоматически создаёт поставку в привязанном рейсе и проставляет `trip_line_id` + `fulfillment_batch_id`

**Файлы:**
- `supabase/patch_fulfillment.sql` — 4 таблицы: `fulfillment_settings`, `fulfillment_batches`, `fulfillment_items`, `fulfillment_stage_logs`
- `supabase/patch_otk_logs.sql` — `fulfillment_otk_logs`, `fulfillment_otk_log_history`
- `supabase/patch_marking_logs.sql` — `fulfillment_marking_logs`, `fulfillment_marking_log_history`
- `supabase/patch_packaging_logs.sql` — `fulfillment_packaging_logs` (⚠️ применить)
- `supabase/patch_packaging_logs_consumable.sql` — добавляет `consumable_id` к `fulfillment_packaging_logs` (⚠️ применить)
- `src/services/fulfillmentService.ts` — CRUD батчей/позиций + история + soft-delete
- `src/pages/FulfillmentPage.tsx` — полная страница (3500+ строк)
### RBAC — ролевой контроль доступа
- `useMyPermissions` хук: owner/admin → полные права (без запроса к БД); остальные → запрос в таблицу `roles` по `assigned_user_id + account_id`
- Sidebar скрывает пункты меню по `permKey` из `RolePermissions`
- App.tsx: автоматический редирект на главную если страница недоступна
- Все страницы принимают `canManage?: boolean` и скрывают кнопки создания/редактирования/удаления при недостаточных правах
### Логистика — модель Рейсов
- **Рейс** (#1, #2…) — верхний уровень: перевозчик, дата, статус, оплата
- **Поставка** — строка рейса: магазин, склад, коробов, единиц, вес (кг)
- Таблица рейсов с раскрытием поставок по стрелке
- Кнопка "+ Добавить поставку" (peek при hover, фиксирована при открытии)
- **Свернуть/Развернуть список** — кнопка (двойные шевроны ↑↓) в тулбаре; синий фон когда раскрыт хоть один рейс; состояние в `localStorage` (ключ включает userId — per-user); при активном поиске авто-разворачивает рейсы
- **Поиск по рейсам и поставкам** — поле `min-w-[400px]`; ищет по: рейсу, перевозчику, магазину WB, юр. названию, коду стора, складу, номеру поставки, WB supply ID; фильтрует строки внутри рейса
- **Режим фокуса** — скрывает сайдбар и топбар (`body.elestet-focus-mode` CSS); хранится в `sessionStorage`; переживает F5, сбрасывается при уходе со страницы или закрытии вкладки
- **Настройки тулбара привязаны к userId** — каждый пользователь хранит своё состояние (expand-all, hover-add, show-supplier) даже в одной компании
- Удаление рейса / поставки с подтверждением
- Массовое выделение и массовое удаление поставок
- Дропдауны статусов рейса, поставки, оплаты
- **Колонки поставки**: Магазин, Поставка, Объём (коробов + единиц + кг), Статус, **Даты**, Стикеры, Оплата, Комментарий
- **Колонка "Даты"** — динамические подстолбцы (w-[148px] каждый, max 3 строки):
  - Фиксированный порядок 6 дат: **Приём** → **Отправлен** (`transit_at`) → **Прибыл** (`arrival_date`) → **Отгружен** (`shipped_date`) → **Запланирован** (`planned_marketplace_delivery_date`) → **Приём ВБ** (`wb_acceptance_date`)
  - Видимые даты автораспределяются по подстолбцам чанками по 3 — порядок не нарушается никогда
- **MpDateButton**: карандаш (ручной ввод даты) + иконка обновления (из WB API, только при наличии `wb_supply_id`) — оба поля «Запланирован» и «Приём ВБ» обновляются одним запросом
- **Автодаты**: `arrival_date` → авто при «Прибыл»; `shipped_date` → авто при «Отгружен»
- **Массовое «Прибыл»**: смена статуса рейса затрагивает все не-«Отгружен» поставки
- **Глобальная нумерация** поставок по компании (`account_id`)
- **Настройка колонок**: показ/скрытие builtin и custom колонок через `columnConfigService`
- **Режим фокуса**: затемняет всё кроме активного рейса
- **Иконки оплаты** (`StatusDropdown` с `iconMap`): цветовая схема `bg-100 text-500 hover:bg-200`, совпадает с поведением иконок стикеров. `StatusDropdown` имеет отдельный `iconToneClasses` для иконочного режима
- **Переключатель названия магазина**: тоггл-кнопка в тулбаре — переключает между `store.supplier` (юр. название) и `store.name` (WB-название) в колонке «Магазин»; `store_code` всегда отображается ниже; состояние сохраняется в localStorage
- **Модалка создания поставки**: поля «Прибыл» и «Отгружено» скрыты (показываются только при редактировании)
- **Блокировка ФФ-поставок**: поставки из Фулфилмента помечаются `fulfillment_batch_id`; в модалке редактирования заблокированы поля Магазин/Склад/Коробов/Единиц/Дата приёма + синий информационный баннер; ⚠️ требует `patch_trip_line_fulfillment_batch_id.sql` + `patch_trip_line_backfill_fulfillment_batch_id.sql`

### Фото накладных
- Колонка `invoice_photo_urls text[]` в `trip_lines`
- Хранилище: bucket `trip-invoices` (публичный) с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра → лайтбокс-карусель, клавиатурная навигация, scroll lock
- Контекстное меню: Добавить / Заменить все / Удалить все

### Отзывы WB
- Таблица `wb_feedbacks` в Supabase — синхронизация с WB Feedbacks API
- **DB-first**: данные грузятся из БД; WB API вызывается только кнопкой «Синхронизировать»
- **Cooldown** в localStorage — пережигает page refresh; exponential backoff 60→120→240→480→600с
- **Шаблоны авто-ответа** (`review_templates`): CRUD, приоритет ключевые слова → оценка → универсальный, флаг «Авто»
- Переменные в шаблоне: `{buyer_name}`, `{product_name}`, `{stars}`
- **Ручные ответы**: textarea + chips шаблонов → PATCH WB API
- **Вкладка «Тест авто-ответа»** (dry-run): видно какой шаблон совпадёт с каждым отзывом и итоговый текст ответа — ничего не отправляется
- Итоговая статистика: «Будет отвечено: X из Y / Без шаблона: Z»

### ИИ-ответы на отзывы WB
- Ключ хранится в `account_ai_settings` с RLS — каждый клиент использует свой ключ
- **Мульти-провайдер**: Claude (Sonnet 4.6 / Haiku 4.5 / Opus 4.7) и OpenAI (gpt-4o-mini / gpt-4o / gpt-3.5-turbo) — оба поддерживают Vision (фото из отзыва)
- **Активный провайдер**: выбирается кнопкой «Активировать» внутри таба, бейдж «активный» в заголовке
- **`AiSettingsModal`**: табы Claude/OpenAI, оба блока в grid-ячейке (высота не прыгает), удаление ключа
- **4 тона**: Вежливый / Нейтральный / Дружелюбный / Профессиональный
- **Защита от случайного закрытия**: `isDirty` флаг (ключи, модели, тон, провайдер) → диалог «Закрыть без сохранения?»
- **Архитектура промптов**:
  - ИИ определяет магазин отзыва → читает системный промпт → читает промпт магазина
  - **Системный промпт** — глобальный для всей Компании (account_id). Если задан — заменяет стандартный промпт ИИ.
  - **Промпт магазина** — привязан к конкретному магазину (store_id). Добавляется после системного.
  - Каждого типа может быть несколько. Все конкатенируются.
  - Хранятся в таблице `ai_prompts` (`type`: `'system'|'store'`, `store_id` nullable)
  - UI: кнопки `[список][+]` рядом с каждым типом; `PromptListModal` (max-w-3xl, 90vh) — полный текст, редактирование/удаление; `PromptAddEditModal` (max-w-3xl) — название + большой textarea
- **`callOpenAi`**: роутинг по `settings.provider` → `callClaudeDirect` или `callOpenAiDirect`
- **Генерация**: кнопка «⚡ ИИ-ответ» на каждой карточке, текст сохраняется в `wb_feedbacks.ai_reply`
- **Правка перед отправкой**: textarea редактируема после генерации
- **NegativeSendModal**: дополнительное подтверждение для отзывов 1–3★
- **Статусы**: `none` → `generated` → `sent`; `reply_sent_at` записывается при отправке
- **Вкладка «🧪 Тест ИИ-ответа»**: dry-run с произвольным текстом/оценкой
- **Активный таб** (Без ответа / Отвечено / Шаблоны / Тест) сохраняется в localStorage
- **Плюсы/Минусы из WB**: поля `pros`/`cons` показываются в карточках отзывов и передаются в ИИ-промпт
- **`PromptListModal`**: закрывается кликом по тёмному фону
- Требует применения `supabase/patch_ai_reviews.sql`, `patch_ai_providers.sql`, `patch_store_ai_prompt.sql`, `patch_ai_prompts_list.sql`

### Автоматизация ответов WB
- **Edge Function** `auto-reply` (Deno) — обрабатывает один аккаунт (принимает `account_id` в теле)
- **Dispatcher** `auto-reply-dispatch` — параллельный запуск `auto-reply` для всех аккаунтов, pg_cron вызывает его каждые 30 минут
- **Управление**: блок «Автоматизация ответов» на вкладке Автоматизация — заголовок, кнопки [обновить] [⚡ Срочный запуск] [чекбокс Включена/Включить] и кнопка логов (справа, по ширине контента)
- **Все настройки с фронта**: задержка, лимит, магазины, фильтры сохраняются в `automation_settings`
- **⚡ Срочный запуск**: дизейблед при `autoEnabled=false`
- **Логи**: кнопка «Последний запуск: ...» — модальный список; кнопка прижата вправо
- **Паузы**: `delay_seconds / 2` до/после отправки (мин 32с)
- Требует применения `patch_automation_settings.sql`, `patch_auto_reply_cron.sql` + деплоя Edge Functions `auto-reply` и `auto-reply-dispatch`

### Стикеры файлов поставки WB
- **Кнопка «WB»** в ячейке стикеров каждой поставки: вводишь ID поставки WB → Edge Function `wb-supply` тянет `/package`, генерирует PDF с QR-кодами коробов (1 стр. = 1 коробка, 58×40мм), загружает в `trip-stickers`
  - Коробки сортируются по числовому суффиксу кода по возрастанию
  - Ошибки читаемы: «Неверный API-ключ», «Поставка принадлежит другому магазину», «Поставка не найдена»
  - Зелёный toast «Штрихкоды WB загружены в стикеры поставки» при успехе
- **Кнопка «Пропуск»** в ячейке стикеров:
  - Пропуск скачивается вручную из ЛК WB и загружается через эту кнопку (PDF)
  - Серая — не загружен; зелёная — загружен (клик → открывает PDF, рядом кнопка замены)
  - Хранится в `trip-stickers` бакете (суффикс `_pass`), отдельное поле `wb_pass_url` в `trip_lines`
- **Стикеры 2в1** — новая виолетовая группа кнопок в ячейке:
  - Загрузка любого файла (PDF / JPG) в бакет `trip-stickers` (суффикс `_combined`)
  - Хранится в отдельном поле `combined_sticker_urls text[]` в `trip_lines`
  - Badge со счётчиком, dropdown-меню с датой загрузки, удаление файлов
  - Порядок кнопок (слева направо): `[2в1 view | 2в1 upload] [стикер download | QR] [пропуск view | пропуск upload]`
- **Меню стикеров**: дата/время загрузки из timestamp в имени файла `DD.MM.YYYY HH:MM GMT+N`; badge от 1 файла; кнопка всегда открывает меню
- Требует применения `supabase/patch_wb_pass_url.sql` и `supabase/patch_combined_stickers.sql`

### Тарифы логистики
- **carrier_tariffs**: тариф перевозчика до склада назначения: `price_per_box` и `price_per_kg`
- **wb_unload_tariffs**: цена за отгрузку на склад ВБ: `price_per_box` по каждому складу
- Кнопка `₽` у перевозчика открывает `CarrierTariffModal` со всеми складами, чекбоксами и инпутами (автосохранение при blur)
- Панель «Тарифы отгрузки на склады ВБ» ниже сетки справочников
- Требует применения `patch_carrier_tariffs.sql`

### Автоматизация отзывов WB — чёрный список артикулов (10.05.2026)

- **Blacklist модель**: `excludedNmIds` (пустой = отвечать всем, заполнен = пропускать эти nmId)
- **Модалка «Артикулы WB»**: товары из таблицы `products` (те же данные что на странице Товары)
- **Поиск** по артикулу продавца, названию, WB nmId, баркодам
- **Фото товаров** в модалке: миниатюра + hover-превью (полный паритет с ProductsPage)
- **Фикс размера модалки**: `h-[85vh] max-h-[720px]` — одинакова при любом состоянии
- **Источник ответов** карточка удалена — всегда ИИ
- **`excluded_nm_ids`** синхронизируется в `automation_settings` в DB
- **Edge Function `auto-reply`** дополнена фильтрацией по `excluded_nm_ids`
- SQL `patch_excluded_nm_ids.sql` применён в продакшн ✅, Edge Function задеплоена ✅

### Магазины
- Список магазинов + создание / редактирование / **архивное удаление** (пароль, 15 дней в архиве → жёсткое удаление через pg_cron)
- API-ключ: маска `••••` в edit-режиме, кнопка «Изменить»
- store_code редактируем

### Справочники
- Страница Справочники: Перевозчики и Склады
- Добавление/переименование/удаление с подтверждением
- Динамические дропдауны перевозчика/склада в модалках (из Supabase)
- **Тарифы перевозчика**: кнопка `₽` у каждого → модалка со всеми складами, инпуты «за короб» и «за кг», чекбоксы, автосохранение
- **Тарифы отгрузки ВБ**: панель ниже сетки — цена за короб по каждому системному складу WB

### Стикеры WB (58×40мм)
- Таблица `sticker_templates` в Supabase — полный CRUD
- Генерация PDF через Canvas + jsPDF + JsBarcode
- Иконки ухода (SVG): стирка, утюг, не отбеливать, не тумбинг — **всегда фиксированы внизу-справа** (не зависят от длины контента)
- Знак ЕАС — `public/eac.svg`
- Предпросмотр и скачивание PDF (одиночный и bulk)
- **Кнопка «Дата производства»**: кастомная кнопка открывает нативный date picker (`showPicker()`), показывает `дд.мм.гггг` или форматированную дату, фиксированная ширина
- **Пре-принт модалка**: показывает редактор для ЛЮБОГО кол-ва стикеров (не только одиночных) — применить изменения ко всем
- **Вкладка Импорт WB**: аккордеон с фото, превью по наведению, чекбоксы (глобальный / на товар / на размер), expand-all, «Создать набор» со skip дублей по баркоду
- **Вкладка Кастомная**: массовое удаление через кнопку-корзину в шапке колонки (активна при 1+ выбранных строках)

### Наборы стикеров
- Выбрать несколько стикеров через чекбоксы → «Создать набор»
- Каждому стикеру в наборе своё кол-во копий
- Список наборов: название, дата, предпросмотр/скачать PDF, редактировать, удалить

## Структура

```text
src/
  components/
    layout/        — Sidebar, Topbar
    trips/         — TripTable, TripLineFormModal, TripFormModal
    stores/        — StoreList, StoreFormModal
    accounts/      — AccountFormModal, DeleteAccountModal, ProfileModal
    roles/         — RoleFormModal
    stickers/      — StickerFormModal
    reviews/       — AiSettingsModal
    ui/            — Button, Badge, Card, Input, Modal, Select, Textarea, InvoicePhotoCell, DeleteConfirmModal
  hooks/           — useAuth, useAccounts, useAppData, useRoles, useMyPermissions
  lib/             — supabase, constants, utils, stickerPdf, ean13
  pages/           — ShipmentsPage, StoresPage, HomePage, RolesPage, DirectoriesPage, StickersPage, ProductsPage, ReviewsPage, AuthPage
  services/        — tripService, shipmentService, storeService, directoriesService, roleService, accountService, stickerService, reviewsService
  types/           — index.ts (RolePermissions, FULL_PERMISSIONS, AiSettings, WbFeedbackRow, ...)
supabase/
  schema.sql
  bootstrap.sql
  dev_access.sql
  delete_account.sql
  trips.sql
  patch_trip_functions.sql
  carriers_warehouses.sql
  patch_invoice_photos_v2.sql
  patch_stickers.sql
  patch_sticker_icons.sql
  patch_sticker_bundles.sql
  patch_store_api_key.sql
  patch_store_code_constraint.sql
  patch_system_warehouses.sql
  patch_roles.sql
  patch_roles_user.sql
  patch_profiles_short_id.sql
  patch_role_member_sync.sql
  patch_draft_number.sql
memory-bank/
```

## Запуск

1. `npm install`
2. Создать `.env`:
```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```
3. Применить SQL в Supabase SQL Editor по порядку:
```
1.  schema.sql
2.  bootstrap.sql
3.  dev_access.sql
4.  delete_account.sql
5.  trips.sql
6.  patch_trip_functions.sql
7.  carriers_warehouses.sql
8.  patch_invoice_photos_v2.sql
9.  patch_stickers.sql
10. patch_sticker_icons.sql
11. patch_sticker_bundles.sql
12. patch_store_api_key.sql
13. patch_store_code_constraint.sql
14. patch_system_warehouses.sql
15. patch_roles.sql
16. patch_roles_user.sql
17. patch_profiles_short_id.sql
18. patch_role_member_sync.sql
19. patch_draft_number.sql
20. patch_review_templates.sql
21. patch_wb_feedbacks.sql
22. patch_fix_wb_feedbacks_rls.sql
23. patch_ai_reviews.sql            ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
24. patch_automation_settings.sql   ← Таблицы automation_settings + automation_logs + RLS
25. patch_auto_reply_cron.sql       ← pg_cron задание (заменить PROJECT_REF и SERVICE_ROLE_KEY)
26. patch_carrier_tariffs.sql       ← Тарифы перевозчиков и отгрузки ВБ
27. patch_archive_accounts.sql      ← Архив компаний: soft delete + pg_cron автоочистка 15 дней
28. patch_archive_stores.sql        ← Архив магазинов: soft delete + pg_cron автоочистка 15 дней
29. patch_wb_pass_url.sql           ← Поле wb_pass_url в trip_lines для хранения пропуска WB
30. patch_combined_stickers.sql     ← Поле combined_sticker_urls text[] для стикеров 2в1
31. patch_transit_at.sql            ← Поле transit_at date (авто при статусе «В пути»)
33. patch_wb_acceptance_date.sql    ← Поле wb_acceptance_date date (фактическая дата принятия WB)
34. patch_fulfillment.sql           ← Модуль Фулфилмент: 4 таблицы + RLS + права в roles
35. patch_otk_logs.sql              ← OTK: журнал работ + история изменений
36. patch_marking_logs.sql          ← Маркировка: журнал работ + история изменений
37. patch_diary.sql                 ← Дневник ELESTET: diary_entries, RLS, хранилище diary-media
38. patch_ai_providers.sql          ← Мульти-провайдер ИИ (Claude + OpenAI) + миграция model ID
39. patch_ai_prompts_list.sql       ← Таблица ai_prompts (system/store промпты)
40. cleanup_archived_accounts.sql   ← (однократно) Удаление архивных компаний для конкретного пользователя
41. patch_trip_line_fulfillment_batch_id.sql ← Колонка fulfillment_batch_id в trip_lines
42. patch_trip_line_backfill_fulfillment_batch_id.sql ← Бэкфилл fulfillment_batch_id для старых записей
43. patch_excluded_nm_ids.sql  ← excluded_nm_ids integer[] в automation_settings (чёрный список артикулов)
44. patch_accounts_short_id.sql ← Глобальный short_id для accounts (C-N в URL)
45. patch_batches_short_id.sql  ← Per-account short_id для fulfillment_batches (P-N в URL)

4. `npm run dev`

## Roadmap

| Этап | Статус | Описание |
|------|--------|----------|
| 1. Рейсы | ✅ Готово | trips/trip_lines, UI, RPC |
| Фото накладных | ✅ Готово | invoice_photo_urls, лайтбокс, контекстное меню |
| 2. Добавление поставки | ✅ Готово | Кнопка + модалка + add_trip_line |
| Деплой | ✅ Готово | Vercel + email-подтверждение |
| 1. Редактирование | ✅ Готово | Рейс и поставка |
| 3. Справочники | ✅ Готово | UI управления carriers/warehouses |
| Стикеры WB | ✅ Готово | CRUD шаблонов, PDF, иконки, EAC |
| Наборы стикеров | ✅ Готово | Создать/редактировать/удалить, PDF |
| Магазины CRUD | ✅ Готово | Редактирование, удаление, API-ключ |
| Роли | ✅ Готово | CRUD, доступы, назначение пользователя, U{n} |
| Продакшн БД | ✅ Готово | Все 23 SQL-патчей, RLS восстановлены, данные видны |
| Баркод в стикере | ✅ Готово | Поле в форме, генерация EAN-13, PDF |
| Товары | ✅ Готово | Аккордеон, размеры, фото, превью, синхронизация |
| Магазины — синк WB | ✅ Готово | Колонки API ключ/Поставщик/Адрес, синк seller-info |
| Профиль пользователя | ✅ Готово | Topbar дропдаун + ProfileModal (имя, пароль) |
| **Отзывы WB** | ✅ Готово | WB API, DB-first, шаблоны, cooldown, dry-run вкладка «Тест» |
| **ИИ-ответы на отзывы** | ✅ Готово | OpenAI интеграция, генерация/правка/отправка, 1–3★ подтверждение, Тест-вкладка |
| **Серверная автоматизация WB** | ✅ Готово | Dispatcher + auto-reply Edge Functions, cron, № запуск |
| **Артикулы WB — чёрный список** | ✅ Готово | excludedNmIds, модалка с фото/поиском, синк с DB, Edge Function обновлена |
| **Счёт клиенту (InvoicesPage)** | ✅ Готово | Список счётов (I-N), фулл-скрин модаль, Секции Фулфилмент+Логистика, урл-роутинг, share-кнопка |
| **Тарифы логистики** | ✅ Готово | Тарифы перевозчиков + отгрузка на склады ВБ |
| **Стикеры QR поставки WB** | ✅ Готово | Edge Function wb-supply, QR PDF, кнопка пропуска |
| **Стикеры 2в1** | ✅ Готово | Отдельная колонка combined_sticker_urls, фиолетовая группа кнопок |
| **Колонка "Даты"** | ✅ Готово | 2 подстолбца: Приём/Отправлен/Прибыл + Отгружен/Запланирован/Приём ВБ; MpDateButton; WB API supplyDate+factDate |
| **Фулфилмент** | ✅ Готово | 5 этапов (Приёмка→ОТК→Маркировка→Коробá→Логистика), авто-лукап баркода, привязка к рейсу, RBAC |
| **Дневник ELESTET** | ✅ Готово | Личный дневник (только owner): таймлайн, запись дня, ИИ-разбор, AI-настройки с вкладками цен |
| **Topbar UX** | ✅ Готово | Кнопки Дневник/Словарь/Админ всегда видны; «Домой» слева от них на full-page страницах; сайдбар скрыт на admin/glossary/diary |
| **Company auto-create** | ✅ Готово | При `accounts.length === 0` — авто-создаётся «Основная компания»; `autoCreatingCompanyRef` предотвращает дубли при race condition |
| **Company delete guard** | ✅ Готово | Нельзя удалить последнюю компанию; кнопка `disabled`+`opacity-40`; при удалении активной — переключение на другую ДО удаления (нет null-флэша) |
| **Company dropdown Portal** | ✅ Готово | createPortal → document.body, position:fixed, z-9999; dropdownRef фикс click-outside; архив в отдельной модалке |
| **API keys browser block** | ✅ Готово | autoComplete=new-password + data-lpignore + data-1p-ignore на всех полях ключей |
| **TS/Vercel build fix** | ✅ Готово | SpeechRecognition объявлен в vite-env.d.ts (TS2552 на Vercel устранена) |
| **Sourcemap отключен** | ✅ Готово | `sourcemap: false` в vite.config.ts — исходники невидны через DevTools |
| 5. Поиск и фильтры | 🔲 Следующий | Текстовый поиск, фильтр по статусу (Логистика) |
| Участники компании | 🔲 Следующий | Пригласить / удалить |
| Будущее | 🔲 | Мобильное приложение React Native + Expo |

## Безопасность проекта («задача о безопасности проекта»)

### Домен elestet.net
- Регистратор: **Namecheap**
- DNS настраивается в Namecheap → Advanced DNS
- Нужные записи: CNAME `www` → `cname.vercel-dns.com` + A `@` → `76.76.21.21`
- Если сайт упал с ERR_CONNECTION_REFUSED — первым делом проверить Namecheap Advanced DNS и статус домена в Vercel → Domains

### GitHub — публичный репо
- Vercel бесплатный тариф требует публичного репо. Код виден всем — скачать может любой
- Защита: добавить файл `LICENSE` (Commons Clause поверх MIT или проприетарная). Альтернатива: Vercel Pro ($20/мес) или `vercel deploy` CLI
- **Исходники через DevTools**: закрыто — `sourcemap: false` в `vite.config.ts` ✅

### Supabase — безопасность БД
- **Anon key** в `.env` — нормально, публичный по дизайну. Безопасен при включённом RLS
- **Service role key** — НИКОГДА в фронтенд. Только Edge Functions / .env сервера. Утек в репо → немедленно ротировать в Supabase Dashboard
- **RLS** — главная защита. Откат: Pro ($25/мес) = PITR 7 дней; бесплатный = ежедневные бэкапы
- Снапшот БД: `supabase db dump` (CLI) → один SQL-файл

### Приоритеты (в порядке важности)
1. `service_role` key нигде нет в коде/репо — **критично**
2. `sourcemap: false` в `vite.config.ts` — ✅ сделано
3. Добавить `LICENSE` файл — правовая защита
4. Supabase Pro — если данные клиентов критически важны (PITR)

## Правила внесения изменений

- Выполнять работу строго по ТЗ
- Не менять бизнес-логику, UX, визуальный стиль, тексты вне рамок задачи
- Не делать попутные рефакторинги без явного запроса
- Локальная и минимально достаточная правка

### Account / Company модель
- **Account** = «Компания» в UI. Это SaaS tenant-сущность, не профиль пользователя.
- Каждый пользователь может зарегистрироваться и создать свою компанию самостоятельно.
- Один user может быть членом нескольких компаний.
- `Account.my_role` — роль текущего пользователя в этой компании. Приходит из RPC `get_my_accounts`.
- **Важно:** после `createAccountWithOwnerInSupabase` RPC не возвращает `my_role`. В `useAccounts.ts` нужно вручную добавить `my_role: 'owner'` к объекту — иначе новый пользователь после создания компании видит только Главную (пустые permissions).

### Сброс активной страницы на home при обновлении
Активная страница сохраняется в `localStorage` (`elestet-active-page`). **Проблема:** редирект на `home` по правам доступа срабатывал до загрузки прав из БД — `permissions = DEFAULT_PERMISSIONS` (все `false`) сбрасывал страницу.

**Обязательный паттерн в App.tsx:**
```ts
const { permissions, isLoading: isPermissionsLoading } = useMyPermissions(...)
useEffect(() => {
  if (isPermissionsLoading) return  // ← без этого страница всегда сбрасывается на home
  const key = pagePermKey[activePage]
  if (key !== null && !permissions[key]) setActivePage('home')
}, [permissions, activePage, isPermissionsLoading])
```

## Что уже есть

- SaaS-структура данных: `profiles`, `accounts`, `account_members`, `stores`, `trips`, `trip_lines`, `carriers`, `warehouses`
- Supabase Auth: регистрация, вход, выход, блокировка интерфейса без сессии
- Company flow: создание, список, switcher, сохранение в localStorage, удаление
- Русский операционный интерфейс в компактном SaaS-стиле
- Левый сайдбар: бренд, company switcher, nav, выход
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Роли

### Логистика — модель Рейсов
- **Рейс** (#1, #2…) — верхний уровень: перевозчик, дата, статус, оплата
- **Поставка** — строка рейса: магазин, склад, коробов, единиц (номер уникален внутри магазина)
- Таблица рейсов с раскрытием поставок по стрелке
- Кнопка "+ Добавить поставку" (peek при hover, фиксирована при открытии)
- **Свернуть/Развернуть список** — кнопка (двойные шевроны ↑↓) в тулбаре; при активном поиске авто-разворачивает; настройка в localStorage с суффиксом userId
- **Поиск** — поле `min-w-[400px]`; ищет по рейсу, перевозчику, магазину WB, юр. названию, коду стора, складу, номеру поставки, WB supply ID; фильтрует строки внутри рейса
- **Режим фокуса** — скрывает сайдбар и топбар (100% экрана); `sessionStorage` + `beforeunload`-флаг (F5 не сбрасывает, уход со страницы — сбрасывает)
- **Настройки тулбара per-user** — expand-all, hover-add, show-supplier хранятся с суффиксом `userId` в localStorage
- Модалка создания рейса и поставки
- RPC: `create_trip`, `add_trip_line`
- Удаление рейса / поставки с подтверждением
- Массовое выделение и массовое удаление поставок
- Дропдауны статусов рейса, поставки, оплаты (сохраняются в Supabase сразу)

### Фото накладных
- Колонка `invoice_photo_urls text[]` в `trip_lines`
- Хранилище: bucket `trip-invoices` (публичный) с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра → лайтбокс-карусель (циклический), клавиатурная навигация, scroll lock
- Контекстное меню: Добавить / Заменить все / Удалить все
- Диалог подтверждения удаления (закрывается по клику вне)

### Редактирование рейса и поставки
- Кнопки редактирования на каждой строке рейса и поставки
- Модалки edit-режима с предзаполнением всех полей
- UPDATE через Supabase (`updateTrip`, `updateTripLine`)

### Справочники
- Страница Справочники: два панели — перевозчики и склады
- Добавление/удаление записей с подтверждением
- Динамические дропдауны перевозчика/склада в модалках (из Supabase)

### Страница магазинов
- Список магазинов + создание / редактирование / удаление
- API-ключ: маска `••••` в edit-режиме, кнопка «Изменить»
- store_code редактируем
- Колонки: API ключ (зелёный badge / прочерк), Поставщик, Адрес, Создан
- Кнопка синка с WB API → подтягивает `data.name` (seller-info) в поле «Поставщик»
- Индикатор загрузки и ошибка при синке (429 → «Много запросов»)

### Товары — ProductsPage
- Таблица товаров с аккордеон-раскрытием по клику на строку
- Анимация `grid-template-rows: 1fr / 0fr` (220ms ease)
- Вложенная таблица размеров: Размер (badge) + Баркод
- Сортировка размеров по убыванию: 2XL → XL → L → M → S → числовые
- Кнопка «Развернуть все / Свернуть все» (двойная стрелка)
- Поиск по артикулу WB, артикулу продавца, названию, бренду
- Колонка фото: миниатюра 36×36px с rounded-lg, плейсхолдер если фото нет
- Превью при наведении: 288×384px, умное позиционирование — не выходит за края экрана
- Синхронизация через Edge Function `sync-store-products`
- Только магазины с API-ключом доступны в дропдауне
- **Счётчики в шапке таблицы**: «Артикулы N · Баркоды N» — баркоды = сумма всех `product.barcodes`

### Стикеры WB (58×40мм)
- Таблица `sticker_templates` в Supabase — полный CRUD
- Генерация PDF через Canvas + jsPDF + JsBarcode
- Раскладка: Шапка (штрихкод EAN-13) / Тело (текст + ЕАС справа)
- Иконки ухода (SVG): стирка, утюг, не отбеливать, не тумбинг — вкл/выкл через тоггл в модалке
- Знак ЕАС — `public/eac.svg` (официальные пропорции, векторный)
- Предпросмотр в новой вкладке и скачивание `.pdf` (один или bulk)
- Чекбоксы для массовых операций
- **Sweep-select (свип-выбор)**: удерживай ЛКМ на чекбоксе и веди мышь — галочки ставятся/снимаются на строках под курсором. Применён на вкладках «Кастомная» и «Импорт WB». Термин: "sweep-select".

### Наборы стикеров
- Выбрать несколько стикеров через чекбоксы → «Создать набор»
- Каждому стикеру в наборе своё кол-во копий (не зависит от шаблона)
- Список наборов: название, дата, предпросмотр/скачать PDF, редактировать, удалить
- Хранится в `sticker_bundles` (jsonb `items`)

## Структура

```text
src/
  components/
    layout/        — Sidebar, Topbar
    trips/         — TripTable, TripLineFormModal, TripFormModal
    shipments/     — legacy
    stores/
    accounts/
    stickers/        — StickerFormModal
    ui/            — Button, Badge, Card, Input, Modal, Select, Textarea, InvoicePhotoCell
  hooks/           — useAuth, useAccounts, useAppData
  lib/             — supabase, constants, utils, stickerPdf
  pages/           — ShipmentsPage, StoresPage, HomePage, ...
  services/        — tripService, shipmentService, storeService, directoriesService
  types/           — index.ts (Trip, TripLine, TripWithLines, ...)
supabase/
  schema.sql                    — основная схема
  bootstrap.sql                 — первый аккаунт
  dev_access.sql                — временный dev-доступ
  disable_rls_dev.sql           — обход рекурсии RLS в dev
  delete_account.sql            — удаление компании
  trips.sql                     — таблицы trips, trip_lines, RLS, RPC
  patch_trip_functions.sql      — патч исправления FOR UPDATE
  carriers_warehouses.sql       — таблицы carriers, warehouses, RLS
  patch_invoice_photos_v2.sql   — миграция invoice_photo_urls text[]  patch_stickers.sql            — таблица sticker_templates + RLS
  patch_sticker_icons.sql       — колонки icon_* (иконки ухода + EAC)
  patch_sticker_bundles.sql     — таблица sticker_bundles + RLS
  seed_stickers.sql             — 3 тестовых стикера
  fix_seed_barcodes.sql         — исправление EAN13 в тестовых данных  seed_trips.sql                — тестовый SQL-сид
  run_seed.mjs                  — тестовый Node.js сид
memory-bank/
```

## Запуск

1. `npm install`
2. Создать `.env`:
```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```
3. Применить SQL в Supabase SQL Editor по порядку:
```
1. supabase/schema.sql
2. supabase/bootstrap.sql
3. supabase/dev_access.sql
4. supabase/delete_account.sql
5. supabase/trips.sql
6. supabase/patch_trip_functions.sql
7. supabase/carriers_warehouses.sql
8. supabase/patch_invoice_photos_v2.sql
9. supabase/patch_stickers.sql
10. supabase/patch_sticker_icons.sql
11. supabase/patch_sticker_bundles.sql
```
> Для dev без auth: `supabase/disable_rls_dev.sql`

4. `npm run dev`

## Roadmap

| Этап | Статус | Описание |
|------|--------|----------|
| 1. Рейсы | ✅ Готово | trips/trip_lines, UI, RPC |
| Шаг 0. Фото накладных | ✅ Готово | invoice_photo_urls, лайтбокс, контекстное меню |
| 2. Добавление поставки | ✅ Готово | Кнопка + модалка + add_trip_line |
| Деплой | ✅ Готово | Vercel + production RLS |
| Шаг 1. Редактирование | ✅ Готово | Редактирование рейса и поставки |
| 3. Справочники | ✅ Готово | UI управления carriers/warehouses |
| Стикеры WB | ✅ Готово | CRUD шаблонов, PDF-генерация, иконки ухода, EAC |
| Наборы стикеров | ✅ Готово | Создать/редактировать/удалить, индивидуальные копии, PDF |
| TS build fix | ✅ Готово | supabase.ts + Topbar + App + TripLineFormModal + stickerPdf + stickerService |
| Профиль пользователя | ✅ Готово | Topbar дропдаун + ProfileModal (имя, пароль) |
| 5. Поиск и фильтры | 🔲 Следующий | Текстовый поиск, фильтр по статусу |
| Будущее | 🔲 | Мобильное приложение React Native + Expo |

## Правила внесения изменений

- Выполнять работу строго по ТЗ
- Не менять бизнес-логику, UX, визуальный стиль, тексты вне рамок задачи
- Не делать попутные рефакторинги без явного запроса
- Локальная и минимально достаточная правка
- При исправлении одного дефекта не ломать соседние сценарии
