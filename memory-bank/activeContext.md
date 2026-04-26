# Active Context

## Current Focus
ИИ-ответы на отзывы WB — расширенная настройка ИИ завершена: поддержка Claude + OpenAI, мульти-провайдер, Vision для фото, промпты системный и магазина, 4 тона ответов, активный таб сохраняется в localStorage. SQL-патч `patch_ai_providers.sql` и `patch_store_ai_prompt.sql` нужно применить в Supabase SQL Editor. Следующие шаги: поиск/фильтры на странице Логистика, участники компании (Members), мобильное приложение.

## What Was Recently Done

### ИИ-настройки — мульти-провайдер Claude + OpenAI (26.04.2026)
- **`src/types/index.ts`**: добавлены `AiProvider` (`openai`|`claude`), `ClaudeModel`, `AiTone` расширен (`professional`), обновлены `AiSettings` и `AiSettingsFormValues`
- **`src/services/reviewsService.ts`**:
  - `callClaudeDirect`: прямой вызов Anthropic API с Vision (base64 image blocks)
  - `callOpenAiDirect`: GPT-4o Vision через base64
  - `callOpenAi`: роутинг по `settings.provider` к claude/openai
  - `buildAiPromptParts`: системный промпт + промпт магазина (append после системного) + `storePrompt` в `AiFeedbackInput`
  - `saveStorePrompt(storeId, prompt)`: сохраняет `ai_prompt` в таблицу `stores`
  - `saveAiSettings`: сохраняет `provider`, `claude_key`, `claude_model`
- **`src/types/index.ts`**: `Store` интерфейс расширен полем `ai_prompt?: string | null`
- **`src/components/reviews/AiSettingsModal.tsx`** — полный рефакторинг:
  - Google Sheets-стиль табы: Claude (первый) / OpenAI
  - Таб = просмотр настроек; отдельный `activeProvider` state = кто генерирует
  - Кнопка «Активировать» в каждом табе (серая/disabled = уже активен, синяя = кликабельная)
  - Бейдж «активный» на активном табе
  - Оба блока настроек рендерятся одновременно в одной grid-ячейке (`[grid-area:1/1]`), неактивный `invisible` — высота не прыгает при переключении
  - Удаление API-ключей: кнопка «Удалить» (красная) → плашка «Ключ будет удалён при сохранении» + «Отменить»
  - 4 тона ответов: Вежливый / Нейтральный / Дружелюбный / Профессиональный
  - 2 кнопки промптов: «Системный промпт» + «Промпт магазина» — открывают `PromptModal` overlay (z-60)
  - `PromptModal`: draft state (Отмена = отменяет изменения), автоматически растущий textarea (max 480px), Сохранить + Отмена
  - `initialStorePrompt` + `onSaveStorePrompt` пропы
  - Все поля не обязательны для сохранения
- **`src/pages/ReviewsPage.tsx`**:
  - Активный таб (`queue`/`answered`/`templates`/`test`) сохраняется в localStorage `reviews_active_tab`
  - `storePrompt` передаётся в `callOpenAi` при генерации
  - `handleSaveStorePrompt` → вызывает `saveStorePrompt`
  - `AiSettingsModal` получает `initialStorePrompt` и `onSaveStorePrompt`
- **`tailwind.config.js`**: добавлен `zIndex: { 60: '60' }` для `PromptModal`
- **`supabase/patch_ai_providers.sql`**: `ALTER TABLE account_ai_settings ADD COLUMN IF NOT EXISTS provider/claude_key/claude_model` — ⚠️ применить в Supabase
- **`supabase/patch_store_ai_prompt.sql`**: `ALTER TABLE stores ADD COLUMN IF NOT EXISTS ai_prompt text` — ⚠️ применить в Supabase

### ИИ-ответы на отзывы WB (26.04.2026)
- **`supabase/patch_ai_reviews.sql`**: новые поля `ai_reply`, `ai_reply_status`, `reply_sent_at` в `wb_feedbacks`; новая таблица `account_ai_settings` (RLS по `account_members`)
- **`src/types/index.ts`**: добавлены `AiReplyStatus`, `AiTone`, `AiModel`, `AiSettings`, `AiSettingsFormValues`, `WbFeedbackRow`
- **`src/services/reviewsService.ts`**: добавлены `loadFeedbackRowsFromDb`, `saveAiReply`, `markReplySent`, `getAiSettings`, `saveAiSettings`, `callOpenAi`
- **`src/components/reviews/AiSettingsModal.tsx`**: модалка настройки ИИ
- **`src/pages/ReviewsPage.tsx`**: 4 вкладки (Без ответа / Отвечено / Шаблоны / Тест ИИ-ответа); `NegativeSendModal` для 1–3★
- Кнопка «⚙ ИИ настроен»: фиолетовая когда ключ настроен

### Логистика — новые поля и поведение (25.04.2026)
- Колонки trip_lines: `reception_date`, `arrival_date`, `shipped_date`, `weight`
- Автозаполнение дат, массовое «Прибыл», глобальная нумерация, режим фокуса
- SQL патч: `supabase/patch_all_in_one.sql`

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Топбар: профиль-кнопка — дропдаун (Настройки / Выйти), имя + email

## SQL патчи — порядок применения
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
20. patch_all_in_one.sql
21. patch_review_templates.sql
22. patch_wb_feedbacks.sql
23. patch_fix_wb_feedbacks_rls.sql
24. patch_ai_reviews.sql             ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
25. patch_ai_providers.sql           ← ⚠️ мульти-провайдер: provider/claude_key/claude_model
26. patch_store_ai_prompt.sql        ← ⚠️ промпт магазина: ai_prompt в stores
```

## What Was Recently Done

### ИИ-ответы на отзывы WB (26.04.2026)
- **`supabase/patch_ai_reviews.sql`**: новые поля `ai_reply`, `ai_reply_status`, `reply_sent_at` в `wb_feedbacks`; новая таблица `account_ai_settings` (RLS по `account_members`)
- **`src/types/index.ts`**: добавлены `AiReplyStatus`, `AiTone`, `AiModel`, `AiSettings`, `AiSettingsFormValues`, `WbFeedbackRow`
- **`src/services/reviewsService.ts`**: добавлены `loadFeedbackRowsFromDb`, `saveAiReply`, `markReplySent`, `getAiSettings`, `saveAiSettings`, `callOpenAi`
- **`src/components/reviews/AiSettingsModal.tsx`**: модалка настройки OpenAI (ключ, модель, тон, system prompt)
- **`src/pages/ReviewsPage.tsx`**: полный рефакторинг — 4 вкладки (Без ответа / Отвечено / Шаблоны / Тест ИИ-ответа); `NegativeSendModal` для 1–3★; генерация через `callOpenAi` + сохранение в БД; отправка через WB API; кнопка «⚙ Настройки ИИ» (фиолетовая когда ключ настроен)
- **Архитектура**: ключ OpenAI хранится в `account_ai_settings` с RLS, вызовы идут напрямую из браузера
- **UI-фикс**: header row (кнопки «Настройки ИИ» + «Синхронизировать») — всегда рендерятся на всех вкладках → высота строки не прыгает при переключении
- **Загрузка при смене магазина**: `loadFromDb` вызывается сразу в reset-эффекте → данные из БД появляются немедленно

### Отзывы WB — полная реализация (26.04.2026)
- **DB-first архитектура**: данные грузятся из `wb_feedbacks` (Supabase), кнопка «Синхронизировать» — единственная точка обращения к WB API
- **Cooldown в localStorage**: ключи `wb_feedbacks_cooldown_end` + `wb_feedbacks_fail_count` — пережигают page refresh
- **Exponential backoff**: база 60с, удваивается при 429, максимум 600с (10 мин)
- **UPSERT вместо DELETE+INSERT**: данные в БД не разрушаются при сбое синхронизации
- **RLS-фикс**: политика `wb_feedbacks` ссылалась на несуществующую таблицу `role_members` вместо `account_members` — исправлено в `patch_fix_wb_feedbacks_rls.sql` и применено в продакшн
- **WB Feedbacks API**: `GET /api/v1/feedbacks` — заголовки rate-limit всегда null, поэтому используется exponential backoff
- **Шаблоны**: CRUD в таблице `review_templates`; приоритет: ключевые слова → оценка → универсальный; флаг `is_auto`
- **matchTemplate / applyTemplate**: подстановка `{buyer_name}`, `{product_name}`, `{stars}`
- **Ручные ответы**: textarea + chips шаблонов по каждому отзыву → PATCH WB API
- **Вкладки**: Без ответа / Отвечено / Шаблоны / 🧪 Тест авто-ответа
- **Вкладка «Тест»** (dry-run): показывает для каждого отзыва из «Без ответа» — какой шаблон совпал (по ключевым словам / оценке / универсальный) и итоговый текст ответа после подстановки переменных. Ничего не отправляется. Итоговая строка: «Будет отвечено: X из Y / Без шаблона: Z»
- **Файлы**: `src/services/reviewsService.ts`, `src/pages/ReviewsPage.tsx`, `supabase/patch_wb_feedbacks.sql`, `supabase/patch_review_templates.sql`

### Логистика — новые поля и поведение (25.04.2026)
- **Колонки trip_lines**: `reception_date` (Дата приёма), `arrival_date` (Прибыл), `shipped_date` (Отгружено), `weight` (Вес кг, numeric)
- **Автозаполнение дат**: `arrival_date` → при смене статуса на «Прибыл»; `shipped_date` → при «Отгружен» (не перезаписывает вручную заданное)
- **Массовое «Прибыл»**: при смене статуса рейса → «Прибыл» все не-«Отгружен» строки получают `arrival_date = today`
- **Глобальная нумерация**: поставки нумеруются по `account_id` (не `store_id`), constraint `trip_lines_account_id_shipment_number_key`
- **Сортировка**: поставки — новые сверху (`shipment_number DESC`)
- **Вес в «Объём»**: `weight` отображается внутри колонки Объём (`120 единиц · 40 кг`), отдельной колонки нет
- **Режим фокуса**: оверлей `bg-slate-900/60` снаружи таблицы; соседние рейсы `opacity-10`
- **Границы строк**: `divide-slate-200` (было `divide-slate-100/80`)
- **SQL патч**: `supabase/patch_all_in_one.sql` — применить в Supabase SQL Editor один раз

### UI-фиксы (25.04.2026)
- Modal: `footer` prop вынесен за scroll-область; `max-h` на Card; `flex-1 min-h-0` на content
- Sidebar: `h-full overflow-hidden` — никогда не скроллится
- Layout: `html/body overflow:hidden; #root height:100%`; content — `overflow-y-scroll` (всегда виден scrollbar)
- StatusDropdown: `whitespace-nowrap` + spacer включает SVG-стрелку

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Topbar: профиль-кнопка — дропдаун (Настройки / Выйти), имя + email

## SQL патчи — порядок применения
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
20. patch_all_in_one.sql
21. patch_review_templates.sql
22. patch_wb_feedbacks.sql
23. patch_fix_wb_feedbacks_rls.sql  ← фикс RLS (account_members вместо role_members)
24. patch_ai_reviews.sql             ← ИИ-ответы: поля в wb_feedbacks + account_ai_settings
```

## What Was Recently Done

### RBAC — Ролевой контроль доступа (завершено)
- `src/types/index.ts`: добавлена константа `FULL_PERMISSIONS` (все флаги `true`)
- `src/hooks/useMyPermissions.ts` (новый файл): хук загружает эффективные права текущего пользователя
  - `owner` / `admin` → автоматически `FULL_PERMISSIONS` (без запроса к БД)
  - остальные → запрос в таблицу `roles` по `assigned_user_id + account_id`
  - если роль не найдена → `DEFAULT_PERMISSIONS` (все `false`)
- `src/components/layout/Sidebar.tsx`: принимает `permissions: RolePermissions`; каждый nav-пункт имеет `permKey`; фильтрация `.filter(item => item.permKey === null || permissions[item.permKey])`
- `src/App.tsx`: подключён `useMyPermissions`; `pagePermKey` map + `useEffect` редирект на главную если страница недоступна; `permissions` передаётся в Sidebar и все страницы как `canManage`
- `ShipmentsPage` + `TripTable`: `canManage` скрывает «+ Создать рейс», чекбоксы, bulk-кнопки, дропдауны статусов (pointer-events-none), кнопки редактирования/удаления рейсов и строк, строку «Добавить поставку», фото накладных (onAdd/onReplace/onRemove = undefined)
- `InvoicePhotoCell`: все три обработчика `onAdd?/onReplace?/onRemove?` стали опциональными; кнопки лайтбокса и контекстное меню скрыты когда обработчик не передан
- `StoresPage` + `StoreList`: `canManage` скрывает «+ Создать магазин», кнопки sync/edit/delete строки
- `DirectoriesPage` + `DirectoryPanel`: `canManage` скрывает форму добавления и кнопки редактировать/удалить каждого пункта
- `StickersPage`: `canManage` скрывает «+ Создать стикер», «Создать набор», кнопки редактировать/удалить стикеры и наборы
- `RolesPage` + `RoleRow`: `canManage` скрывает «+ Создать роль» (топ-бар + пустой state), кнопки редактировать/удалить каждой роли
- Все `canManage` props имеют `default = true` — обратная совместимость сохранена

### Стикеры — Import WB аккордеон + массовые операции (завершено)
- Вкладка «Импорт WB» полностью перестроена в аккордеон (аналог ProductsPage)
- Анимация раскрытия: `gridTemplateRows: '1fr' / '0fr'`, `transition: 220ms ease`
- Колонка фото (миниатюра 36×36), превью по наведению (288×384px, умное позиционирование)
- Чекбокс глобальный в `<thead>` — выбирает ВСЕ size-строки по всем товарам
- Чекбокс на каждой строке товара — выбирает все его размеры / снимает их
- Чекбокс на каждой строке размера — отдельный выбор
- Кнопка «Развернуть/Свернуть все» — двойная стрелка
- «Создать набор» — создаёт стикеры для всех выбранных строк (skip дублей по баркоду), затем открывает модалку набора с pre-fill
- Уведомление «Все выбранные стикеры уже существуют» если все дубли

### Стикеры — Кастомная вкладка: массовое удаление (завершено)
- Колонка удаления выделена в отдельный `<th w-10>` правее колонки действий (eye/print/edit)
- Шапка колонки: иконка-корзина, неактивна (`opacity-30`) пока не выбрана хотя бы 1 строка
- При выборе 1+ строк кнопка активируется и открывает `<DeleteConfirmModal>` с количеством

### Страница Товары — ProductsPage (завершена)
- Таблица товаров с аккордеон-раскрытием по строке (клик на строку)
- Вложенная таблица размеров: колонки «Размер» (badge) и «Баркод»
- Сортировка размеров по убыванию: 2XL → XL → L → M → S → числовые
- Поиск по артикулу WB, артикулу продавца, названию, бренду
- Выбор магазина: дропдаун, только магазины с API-ключом
- Синхронизация товаров через Edge Function `sync-store-products`
- Колонка фото: 2-я колонка, миниатюра 36×36 с rounded-lg, превью по наведению 288×384px

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- Supabase: Site URL и Redirect URLs настроены на Vercel-домен
- RBAC: все страницы и action-кнопки защищены по правам из таблицы `roles`
- Topbar: блок «0 сом» удалён; профиль-кнопка — дропдаун (Настройки / Выйти), отображает имя + email
- ProfileModal: смена имени (auth.user_metadata + profiles) и пароля

## SQL патчи — порядок применения
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
```

⚠️ `patch_system_warehouses.sql` (#14) — нужно применить в продакшн Supabase SQL Editor, чтобы системные склады WB вернулись на странице Справочники.

## What Was Recently Done

### Стикеры — Import WB аккордеон + массовые операции (завершено)
- Вкладка «Импорт WB» полностью перестроена в аккордеон (аналог ProductsPage)
- Анимация раскрытия: `gridTemplateRows: '1fr' / '0fr'`, `transition: 220ms ease`
- Колонка фото (миниатюра 36×36), превью по наведению (288×384px, умное позиционирование)
- Чекбокс глобальный в `<thead>` — выбирает ВСЕ size-строки по всем товарам
- Чекбокс на каждой строке товара — выбирает все его размеры / снимает их
- Чекбокс на каждой строке размера — отдельный выбор
- Кнопка «Развернуть/Свернуть все» — двойная стрелка
- «Создать набор» — создаёт стикеры для всех выбранных строк (skip дублей по баркоду), затем открывает модалку набора с pre-fill
- Уведомление «Все выбранные стикеры уже существуют» если все дубли

### Стикеры — Кастомная вкладка: массовое удаление (завершено)
- Колонка удаления выделена в отдельный `<th w-10>` правее колонки действий (eye/print/edit)
- Шапка колонки: иконка-корзина, неактивна (`opacity-30`) пока не выбрана хотя бы 1 строка
- При выборе 1+ строк кнопка активируется и открывает `<DeleteConfirmModal>` с количеством
- State: `deleteMassOpen`, `isDeletingMass`, `deleteMassError`
- Handler: `handleConfirmDeleteMass()` — удаляет каждый id из `selected`, очищает set
- В каждой строке корзина вынесена в отдельный `<td>` — стоит ровно под шапкой

### Страница Товары — ProductsPage (завершена)
- Таблица товаров с аккордеон-раскрытием по строке (клик на строку)
- Анимация раскрытия: `gridTemplateRows: '1fr' / '0fr'`, `transition: 220ms ease` (как в LogisticsPage)
- Вложенная таблица размеров: колонки «Размер» (badge) и «Баркод»
- Сортировка размеров по убыванию: 2XL → XL → L → M → S → числовые
- Кнопка «Развернуть все / Свернуть все» (двойная стрелка, стиль Logistics)
- Поиск по артикулу WB, артикулу продавца, названию, бренду
- Выбор магазина: дропдаун, только магазины с API-ключом
- Синхронизация товаров через Edge Function `sync-store-products`
- Время последней синхронизации в шапке карточки
- **Колонка фото**: 2-я колонка (после стрелки), миниатюра 36×36 с rounded-lg
- **Превью по наведению**: 288×384px, позиционирование с учётом краёв экрана (зеркалится если не влезает справа, прижимается если уходит за низ)
- Плейсхолдер если фото нет (серый квадрат с иконкой)

### Магазины — синк с WB API (завершено)
- `StoreList.tsx`: добавлены колонки «API ключ» (зелёный badge / прочерк), «Поставщик», «Адрес», «Создан»
- `StoreList.tsx`: кнопка синка (rotating arrows icon, зелёный hover), `animate-spin` во время загрузки
- `StoreList.tsx`: ошибка синка показывается над кнопками
- `StoresPage.tsx`: prop `onSync: (store: Store) => Promise<void>` передаётся в StoreList
- `App.tsx`: `handleSyncStore` — вызывает WB `/api/v1/seller-info`, сохраняет `data.name` в поле `supplier`
- WB API ограничения: только `{name, sid, tin, tradeMark}` — адреса нет. Rate limit: 1 req/24h (429 → «Много запросов»)
- `StoreFormModal.tsx`: кнопка «Из WB» удалена (мёртвый код)

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- Supabase: Site URL и Redirect URLs настроены на Vercel-домен

## SQL патчи — порядок применения
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
```

⚠️ `patch_system_warehouses.sql` (#14) — нужно применить в продакшн Supabase SQL Editor, чтобы системные склады WB вернулись на странице Справочники.

## What Was Recently Done

### Профиль пользователя — Topbar дропдаун + ProfileModal (завершено)
- `src/components/layout/Topbar.tsx`: удалён блок «0 сом»; кнопка профиля теперь открывает дропдаун
- Дропдаун: шапка (имя + email), пункт «Настройки профиля», пункт «Выйти из аккаунта» (красный)
- Клик вне дропдауна закрывает его (`useRef` + `mousedown` listener)
- Под именем в кнопке отображается email (с truncate), а не слово «Аккаунт»
- Topbar принимает `onSignOut` prop — выход прямо из дропдауна
- `src/components/accounts/ProfileModal.tsx` (новый): email read-only, смена имени через `supabase.auth.updateUser` + UPDATE в `profiles`, смена пароля (min 6 символов, подтверждение)
- `App.tsx`: `profileUserName` синхронизируется через `useEffect([session?.user?.id])` — корректно обновляется при входе с другого аккаунта

### Страница Ролей (завершена)
- SQL: таблица `roles` с RLS (`patch_roles.sql`)
- SQL: колонка `assigned_user_id` + RPC `resolve_account_user` (`patch_roles_user.sql`)
- SQL: `short_id` (U1, U2, U3...) в `profiles` + обновлённый RPC с `p_short_id` (`patch_profiles_short_id.sql`)
- Типы: `Role`, `RolePermissions`, `DEFAULT_PERMISSIONS`, `ResolvedUser` в `index.ts`
- `roleService.ts` — CRUD + клонирование + `resolveAccountUser` (email / UUID / U{n})
- `useRoles.ts` — хук загрузки, `addRole`, `updateRole`, `removeRole`, `cloneRoleToAccount`
- `RoleFormModal.tsx` — создание/редактирование роли:
  - 10 переключателей доступов по 5 группам
  - Секция "Назначить пользователю": email или U{n}/UUID, резолв на blur, мэтчинг обоих полей
  - Кнопка "Применить к другой компании" (CloneModal)
- `RolesPage.tsx` — список ролей с карточками, имя пользователя + `U{n}`, иконки edit/delete
- `App.tsx` — `useRoles` подключён, пропсы переданы в `RolesPage`

### Сайдбар зафиксирован по высоте (завершено)
- `min-h-screen` → `h-screen sticky top-0 overflow-hidden`
- Средняя секция (компания + nav) → `flex-1 overflow-y-auto`
- Логотип и кнопка Выход всегда видны

### Магазины — полный CRUD (завершено)
- Редактирование магазина (StoreFormModal с `initialValues`)
- Удаление с подтверждением (DeleteConfirmModal)
- Поле API-ключа: скрыто в edit-режиме (маска `••••`), кнопка «Изменить»
- `store_code` редактируем, ограничение формата снято (`patch_store_code_constraint.sql`)
- Иконки edit/delete в стиле DirectoriesPage (всегда видны)

### Редактирование названия компании (завершено)
- Иконка карандаша в дропдауне компании в сайдбаре
- `EditAccountModal` — inline в `App.tsx`
- `updateAccount` в `useAccounts` + `updateAccountInSupabase` в `accountService`

### Удаление компании — FK-безопасное (завершено)
- `delete_account.sql` обновлён: сначала `trip_lines`, `trips`, `carriers`, `warehouses`

### Порядок в сайдбаре
- Стикеры → Роли (поменяны местами)

### Регистрация
- Обязательная JS-валидация поля Имя (не только HTML required)

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / Роли
- Деплой: Vercel (main ветка), env переменные настроены
- Supabase: Site URL и Redirect URLs настроены на Vercel-домен

## SQL патчи — порядок применения
```
1. schema.sql
2. bootstrap.sql
3. dev_access.sql
4. delete_account.sql
5. trips.sql
6. patch_trip_functions.sql
7. carriers_warehouses.sql
8. patch_invoice_photos_v2.sql
9. patch_stickers.sql
10. patch_sticker_icons.sql
11. patch_sticker_bundles.sql
12. patch_store_api_key.sql
13. patch_store_code_constraint.sql
14. patch_system_warehouses.sql
15. patch_roles.sql
16. patch_roles_user.sql
17. patch_profiles_short_id.sql
18. patch_role_member_sync.sql
```

### Продакшн деплой — полная настройка БД (завершено)
- Применены все 18 SQL-патчей в продакшн Supabase
- Восстановлены RLS политики (были дропнуты при переприменении схемы):
  - `stores`, `shipments`, `sticker_templates`, `trips`, `trip_lines`, `roles`
- Добавлен `patch_role_member_sync.sql` (#18): триггер синхронизации account_members, RPC `get_my_accounts`, бэкфилл
- Storage политики для `trip-invoices` bucket восстановлены
- `account_members` заполнен — sydykovsam как owner в обеих компаниях

### Баркод в форме стикера (завершено)
- `StickerFormValues.barcode: string` добавлен в типы
- Поле баркода первым в `StickerFormModal` (генерируется через `generateEAN13()` по умолчанию)
- `stickerService` передаёт barcode при create и update

### PDF стикер — финальные визуальные правки (завершено)
- Шрифт тела 21px, начальный отступ 20px
- Значения полей `font-weight: 500` (тоньше меток `600`)

### Страница Товары (заглушка)
- Показывает «Скоро» вместо RolesPage

## Immediate Next Steps
1. **Этап 5:** Текстовый поиск + фильтр по статусу на странице Логистика
2. Участники компании (Members) — пригласить / удалить

## What Was Recently Done

### Наборы стикеров (завершен)
- Таблица `sticker_bundles` в Supabase с RLS
- Типы `StickerBundle` и `StickerBundleItem` в `index.ts`
- `stickerService.ts` — `fetchBundles`, `createBundle`, `updateBundle`, `deleteBundle`
- `useAppData.ts` — состояние `bundles`, методы `addBundle`, `editBundle`, `removeBundle`
- `App.tsx` — проброс всех пропс в `StickersPage`
- `StickersPage.tsx`:
  - Таблица стикеров с чекбоксами — выбор товаров для набора
  - Кнопка «Создать набор» активна только при выбранных стикерах
  - Модалка создания: название + список выбранных с индивидуальным кол-вом копий
  - Модалка редактирования: только стикеры из набора, менять название и копии
  - Список наборов (отдельная Card): название, кол стикеров, копий итого, дата
  - Действия: предпросмотр PDF, скачать PDF, редактировать, удалить
  - Индивидуальное кол-во копий стикера в наборе (не привязано к `copies` шаблона)
- `fetchBundles` устойчив к отсутствию таблицы (возвращает `[]` вместо краша)

### Иконки ухода в стикере (завершен)
- SVG-файлы: `public/icons/wash-30.svg`, `iron.svg`, `no-bleach.svg`, `no-tumble-dry.svg`
- `public/eac.svg` — знак ЕАС
- Боолеан поля `icon_wash`, `icon_iron`, `icon_no_bleach`, `icon_no_tumble_dry`, `icon_eac` в `sticker_templates`
- Визуальные тогглы иконок в `StickerFormModal`
- Иконки рисуются в PDF (строка «Страна:» справа, 44px)

### Предыдущее
- Шаблоны стикеров: CRUD, PDF-генерация, векторные иконки, EAC-тоггл

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Роли / Стикеры
- Стикеры: таблица стикеров + секция наборов, полный CRUD, PDF-генерация
- Логистика: таблица рейсов, фото накладных, редактирование
- Справочники: carriers/warehouses

## Immediate Next Steps
1. **Этап 5:** Текстовый поиск + фильтр по статусу на странице Логистика

### TypeScript build-ошибки Vercel (завершен)
- `src/types/supabase.ts` — добавлены таблицы `carriers`, `warehouses`, `sticker_templates`, `sticker_bundles`
- `Topbar.tsx` — тип `title` расширен до `string` (раньше был union с 6 значениями)
- `App.tsx` — `products` добавлен в guard `storedPage` (был пропущен)
- `TripLineFormModal.tsx` — исправлен вызов `makeDefaults(stores, warehouses)` (был без 2-го аргумента)
- `stickerPdf.ts` — `output('bloburl') as unknown as string` (TS2352)
- `stickerService.ts` — `StickerBundleItem[]` → `as unknown as Json` при insert/update

## Important Implementation Notes
- `fetchBundles` возвращает `[]` при ошибке (не крашит апп если таблица не создана)
- Runtime is Supabase-only
- `useAuth` handles session

## What Was Recently Done

### Шаг 1 — Редактирование рейса и поставки (завершён)
- `updateTrip` и `updateTripLine` в `tripService.ts` (Supabase UPDATE + `.select().single()`)
- `editTrip` и `editTripLine` в `useAppData.ts` — оптимистичный апдейт состояния
- `TripFormModal`: режим edit (пропс `initialValues` + заголовок/кнопка меняются)
- `TripLineFormModal`: режим edit (пропс `initialValues`), все поля включая `arrived_box_qty` и `arrival_date`
- `TripTable`: кнопки редактирования рейса и поставки, второй экземпляр модалок для edit-режима
- Поле `departure_date` добавлено в `TripFormValues` и в форму

### Этап 3 — Справочники carriers/warehouses (завершён)
- `src/services/directoriesService.ts` — CRUD для carriers и warehouses через Supabase
- `src/pages/DirectoriesPage.tsx` — двухпанельный UI (lg:grid-cols-2), инлайн-форма добавления, удаление с подтверждением
- `useAppData.ts` — состояния `carriers`/`warehouses`, методы `addCarrier`/`removeCarrier`/`addWarehouse`/`removeWarehouse`, загрузка параллельно с рейсами
- `App.tsx` — `carrierNames`/`warehouseNames` из Supabase (fallback на constants), рендер DirectoriesPage
- `Sidebar.tsx` — пункт «Справочники» в навигации (Товары → Справочники → Роли)
- Дропдауны перевозчика и склада в модалках теперь динамические (из Supabase)

### Шаг 0 — Фото накладных (завершён)
- Колонка `invoice_photo_urls text[]` в `trip_lines` (SQL-патч `patch_invoice_photos_v2.sql`)
- Storage bucket `trip-invoices` с RLS-политиками
- Компонент `InvoicePhotoCell`: миниатюра, лайтбокс-карусель (циклический), клавиатурная навигация, scroll lock
- Контекстное меню (3 точки): Добавить / Заменить все / Удалить все
- Диалог подтверждения удаления с закрытием по клику вне
- Хуки: `addInvoicePhoto`, `replaceInvoicePhoto`, `removeInvoicePhoto` в `useAppData`
- Сервисы: `uploadInvoicePhoto`, `updateTripLineInvoicePhotos` в `tripService`

### Шаг 2 — Добавление поставки в рейс (завершён)
- Кнопка "+ Добавить поставку" (peek при hover, фиксирована при открытии)
- Модалка `TripLineFormModal`: выбор магазина, склада, объёма
- Добавление через `add_trip_line` RPC
- Удаление рейса и поставки с подтверждением
- Массовое выделение + массовое удаление поставок
- Дропдауны статуса рейса и статуса поставки (меняются сразу в Supabase)
- Дропдаун статуса оплаты поставки

### UX-полировка
- При наведении на строку открытого рейса → все строки поставок подсвечиваются `bg-blue-50`
- Компактный сайдбар

## Present UI State
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Роли / Стикеры
- Логистика: таблица рейсов, раскрытие → строки поставок + фото накладных + редактирование
- Магазины: список + модалка создания
- Справочники: управление carriers/warehouses (добавить/удалить)
- Товары / Роли: заглушки

### Стикеры WB (завершён)
- Таблица `sticker_templates` в Supabase (CRUD)
- `src/types/index.ts` — тип `StickerTemplate`
- `src/services/storeService.ts` — функции `fetchStickers`, `createSticker`, `updateSticker`, `deleteSticker`
- `src/hooks/useAppData.ts` — состояние `stickers`, методы `addSticker`, `editSticker`, `removeSticker`
- `src/components/stickers/StickerFormModal.tsx` — создание/редактирование шаблона
- `src/pages/StickersPage.tsx` — таблица с чекбоксами, предпросмотр, скачивание PDF, редактирование, удаление
- `src/lib/stickerPdf.ts` — генерация PDF через Canvas + jsPDF + JsBarcode (EAN-13)
  - Раскладка 58×40мм: HEADER(120px штрихкод) / BODY(236px текст полная ширина) / FOOTER(44px иконки+ЕАС)
  - Иконки по уходу 26px в ряд + ЕАС справа, всё центрировано в подвале
  - EAC — геометрические буквы через fillRect (без шрифтов)
  - Штрихкод: JsBarcode `width:4, flat:true, displayValue:false`, цифры вручную с spacing
  - Предпросмотр (`output('bloburl')`) и скачивание (`.save()`)
- `src/components/layout/Sidebar.tsx` — пункт «Стикеры» в навигации

## Immediate Next Steps
1. **Этап 5:** Реальный поиск и фильтры — текстовый поиск по рейсу/перевозчику + дропдаун фильтра статуса на странице Логистика

## Последний багфикс (Стикеры)
- Знак ЕАС в PDF рисовал перекладину буквы Е вне блока (y=191 вместо y=377) — баг приоритета операторов `oy + (ch-t) >> 1` вместо `oy + ((ch-t) >> 1)`
- Знак ЕАС переведён на SVG-файл `public/eac.svg` (официальные пропорции Wikipedia) вместо rect-рисования вручную
- Поле артикула чистится regex `/^[\s\-–—]+|[\s\-–—]+$/g` при рендере PDF
- stickerService.ts: `.trim()` на всех строковых полях при create/update
- Знак ЕАС добавлен в правый верхний угол тела стикера (64px)

## Important Implementation Notes
- Runtime is Supabase-only
- `useAuth` handles session
- `useAccounts` handles company list and active company creation/deletion
- `useAppData` handles reads/writes scoped to active company — включает trips, invoice photos
- RLS policies in schema.sql имеют recursion issue вокруг account_members; обходится в dev через disable_rls_dev.sql
- Не регрессировать компактный операционный layout
- Только минимально необходимые изменения

## Active Risks
- Нет валидации форм кроме базовой
- Страницы Товары и Роли — заглушки
- Мобильное приложение запланировано на будущее (React Native + Expo, та же Supabase БД)


## What Was Recently Done

### UX-полировка сайдбара
- Уменьшен шрифт и отступы навигационных пунктов
- Убран плюс перед "Добавить компанию", уменьшен текст через scale
- Усилен название компании (font-bold), уменьшен ID-subtitle
- Добавлен пункт "Товары" между Магазины и Роли (заглушка)
- Усилен hover-эффект строк в таблице поставок

### Дропдауны в модалках
- Перевозчик и Склад назначения стали Select вместо Input
- Списки захардкожены в `src/lib/constants.ts` (временно)
- Созданы таблицы `carriers` и `warehouses` в Supabase (`supabase/carriers_warehouses.sql`)

### Рефакторинг логистики → Рейсы
- Введена сущность **Рейс** (`trips`) как верхний уровень отправки
- Введена сущность **Поставка** (`trip_lines`) — строка рейса для конкретного магазина
- Рейс имеет порядковый номер внутри аккаунта (Рейс #1, #2...)
- Поставка имеет порядковый номер внутри магазина (уникален только в рамках store_id)
- SQL-схема: `supabase/trips.sql`
- Патч исправления функций: `supabase/patch_trip_functions.sql`
- Тестовые данные: `supabase/seed_trips.sql` и `supabase/run_seed.mjs`
- Фронт переделан: `TripTable`, `TripFormModal`, `tripService.ts`
- Страница Логистики показывает список рейсов с раскрытием строк
- Протестировано с реальными данными в Supabase ✅

## Present UI State
- Сайдбар: компактный, nav-пункты мельче, компания заметнее
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Роли
- Логистика: таблица рейсов, раскрытие по стрелке → строки поставок
- Магазины: список + модалка создания
- Товары / Роли: заглушки

## Immediate Next Steps
1. **Этап 2:** Кнопка "+ Поставка" внутри раскрытого рейса → модалка → `add_trip_line` RPC
2. **Этап 3:** Страница Справочники — управление перевозчиками и складами из UI (таблицы уже в Supabase)
3. **Этап 4:** Редактирование рейса и поставки
4. **Этап 5:** Реальный поиск и фильтры
5. **Этап 6:** Деплой + production RLS

## Important Implementation Notes
- Runtime is Supabase-only
- `useAuth` handles session
- `useAccounts` handles company list and active company creation/deletion
- `useAppData` handles reads/writes scoped to active company — теперь включает `trips` и `addTrip`
- RLS policies in `schema.sql` have recursion issue around `account_members`; bypassed in dev using `disable_rls_dev.sql`
- Новые таблицы `trips`, `trip_lines`, `carriers`, `warehouses` имеют корректные RLS по тому же паттерну
- Не регрессировать компактный операционный layout
- Только минимально необходимые изменения; не трогать смежную логику без запроса

## Active Risks
- RLS/auth design is not production-ready yet
- `carriers` и `warehouses` пока не подключены к фронту (дропдауны из constants.ts)
- Мобильное приложение запланировано на будущее (React Native + Expo, та же Supabase БД)
