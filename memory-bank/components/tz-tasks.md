# Промпты ТЗ и задачи (09.08.2026)

## Назначение
Служебная страница `/tz-prompts` доступна только superadmin и разделяет короткие задачи и длинные промпты/ТЗ.

## UI
- Табы: сначала `Задачи`, затем `Промпты ТЗ`.
- Ключ localStorage: `elestet-tz-prompts-active-tab`; default `tasks`.
- Форма: компактный textarea, иконка будущей сортировки, кнопка «Добавить».
- Заголовка «Новая задача» и видимой подсказки клавиатуры нет.
- Enter сохраняет, Shift+Enter добавляет строку.
- Карточки идут вертикально по `position`, затем `created_at`.
- Checkbox переключает выполнение; done-текст серый и зачёркнутый.
- Удаление требует browser confirm.
- Иконка сортировки — только placeholder; порядок пока не меняет.

## DB
- Таблица `public.tz_tasks`.
- Patch: `supabase/patch_tz_tasks.sql`.
- Seed: `supabase/seed_tz_tasks_20260809.sql`.
- RLS разрешает CRUD только `profiles.platform_role = 'superadmin'`.
- Patch и seed применены в production Supabase.

## Начальные задачи
Загружены девять записей: остатки FBS/WB, ограниченный просмотр, Excel-поля, массовый выбор FBS, маркировка, QR bulk print, лист подбора, КИЗ и Excel-import партий.

## Layout
- Внешний padding/scroll принадлежит App shell.
- Root `TzPromptsPage` не должен добавлять второй большой padding, иначе страница не совпадает с Diary/Admin/Finance.

## Проверка
- Полный `npm run build` проходит.
- Frontend-изменения включены в публикацию ветки `main` от 09.08.2026.
