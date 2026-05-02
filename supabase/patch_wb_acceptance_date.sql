-- Фактическая дата принятия товара на складе WB (factDate из API поставок)
ALTER TABLE trip_lines ADD COLUMN IF NOT EXISTS wb_acceptance_date date NULL;
