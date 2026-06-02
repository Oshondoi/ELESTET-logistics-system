# Product Context

## Why This Project Exists
The product is being created to manage logistics operations for shipments going to Wildberries. The user needs a compact web interface to register stores, create shipments, track statuses, and later add account-based collaboration and authorization.

## Problems It Solves
- Shipment tracking is currently not systematized in a structured SaaS product
- Store-specific tracking sequences are easy to break without explicit system logic
- Operators need a clean interface in Russian for everyday work
- Data model must be safe for future multi-company operation

## Target Users
- Logistics operators
- Managers
- Admins / account owners
- Internal teams working inside one business account

## SaaS Account Model (КРИТИЧНО)
- **Аккаунт** — высшая сущность. В UI называется «Компания». Это tenant-граница.
- **Компания (account)** — каждый пользователь может зарегистрироваться и создать свою компанию самостоятельно, без приглашений.
- Пользователь может быть членом нескольких компаний (account_members).
- `my_role` на объекте Account — роль текущего пользователя в этой компании. Берётся из RPC `get_my_accounts`.
- **Аккаунт ≠ профиль пользователя.** Один user может иметь несколько аккаунтов/компаний или быть invited в чужие.

## UX Expectations
- Russian-language UI
- Compact and business-like
- Better suited for operations than presentation
- Minimal friction when entering repetitive logistics data
- Easy to extend later with auth, roles, and stronger Supabase account isolation

## Current Product Shape
- Main focus is shipment registry
- Stores are supporting entities required for shipment creation
- Layout uses a left sidebar plus main content work area
- Forms open in modals
- UI is being tuned toward a denser SaaS dashboard style
- Access is now blocked behind auth; user must sign in before seeing the app
- Company is a first-class entity in the product and is selected via sidebar switcher
- Nav: Главная / Фулфилмент / Логистика / Магазины / Товары / Справочники / Стикеры / **Отзывы** / Роли
- Отзывы WB: загрузка через WB Feedbacks API (лимит 1 запрос/мин), шаблоны ответов, авто-ответ

## Billing / Subscription System (02.06.2026)

### Тарифные планы
| Тариф | Цена/мес | Возможности |
|---|---|---|
| `free` | 0 | ограниченный доступ |
| `seller` | 2 000 сом | базовый |
| `operational` | 17 000 сом | полный |

- **Trial**: 14 дней бесплатно при регистрации (trial_ends_at)
- **Grace period**: 7 дней после истечения (grace_until) — возможность продлить
- **access_overrides**: платформенные оверрайды (глобальные или для конкретного account_id); `include_trial_accounts` — применять ли глобальный оверрайд к компаниям с активным триалом

### Создание 2-й компании
- Заблокировано без активного платного плана (`create_account_with_owner` в БД)
- 1 компания всегда бесплатно; 2-я и далее — только платный тариф

### Платёжный поток (скелет готов, MBusiness интеграция pending)
1. SubscriptionPage → выбор тарифа + периода → «Оплатить»
2. Edge Function `create-payment` → создаёт `payment_orders` запись → [TODO: MBusiness API] → возвращает `payment_url`
3. Пользователь оплачивает на странице MBusiness
4. MBusiness → webhook → Edge Function `payment-webhook` → `activate_plan_by_payment` RPC
5. Redirect → `/payment/result?order_id=...` → PaymentResultPage polling → показывает результат

### Провайдер оплаты: MBusiness (KG)
- Требует NDA перед получением API-документации
- TODO-блоки в обоих Edge Functions ждут заполнения после получения ключей
- ТЗ для разработчиков MBusiness скачивается из AdminPage → «Интеграция оплаты»

**Концепция:** Компания A создаёт пайплайн для партии → назначает партнёрскую компанию (Компанию B) исполнителем этапа → B видит партию у себя в Фулфилменте и может работать только со своим этапом.

**Поток:**
1. Компания A приглашает B по C-ID (Роли → Аутсорс → «Пригласить компанию») — ввод в любом формате
2. B принимает во вкладке «Приглашения» (с именем отправителя — для понимания кто приглашает)
3. B появляется в дропдауне «Исполнитель» при настройке pipeline-стадии
4. B видит «Партии на аутсорс» в FulfillmentPage — read-only кроме своего этапа

**Конфиденциальность:**
- Принятые партнёры и исходящие приглашения — показывается только `C{id}` (без имени)
- Входящие приглашения — показывается имя + ID (компания сама инициировала, конфиденциальности нет)

## AI Prompt Architecture (Отзывы)
- ИИ обрабатывает отзыв в контексте конкретного магазина.
- **Системный промпт** — глобальный для всей Компании (account). Читается первым. Если задан — полностью заменяет стандартный промпт ИИ.
- **Промпт магазина** — привязан к конкретному магазину. Читается вторым, после системного.
- Порядок: ИИ определяет магазин → читает системный промпт → читает промпт магазина.
- Хранится в таблице `ai_prompts` (поля: `account_id`, `store_id` nullable, `type`: `'system'|'store'`).
- Каждого типа может быть несколько промптов (список). Все активны одновременно — конкатенируются.

## Platform Roles — роли платформы (31.05.2026)

Поверх SaaS RBAC существуют **платформенные роли** — для сотрудников сервиса ELESTET.

| Роль | Описание |
|------|----------|
| `user` | Обычный клиент (по умолчанию) |
| `support` | Саппорт: видит AdminPage, не меняет роли, имеет оперативный тариф без платы |
| `admin` | Администратор: видит команду, может менять роли команды |
| `superadmin` | Суперадмин: полные права, включая повышение до superadmin |

- В сайдбаре: кнопка «Админ» видна всем у кого `platformRole !== 'user'`
- AdminPage вкладка «Команда» — только `canEdit` (admin/superadmin)
- `isSupport` → `effectiveOverride = { plan: 'operational', free_until: '2099-12-31' }` — саппорт видит всё как платный пользователь


- `Прибыл` means cargo reached the required city/country and is ready for next dispatch step
- `planned_marketplace_delivery_date` is the expected date for marketplace delivery
- `arrived_box_qty` means actual boxes received in fact
- `units_qty` and `units_total` must remain distinct fields because the business requested both

## Current Product Quality Target
Not enterprise-heavy, but not toy-quality. The MVP should be stable, readable, and structurally safe for future growth.
