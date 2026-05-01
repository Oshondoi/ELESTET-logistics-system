-- Добавляем тип отгрузки поставки WB: 1=короба, 2=монопаллеты, 3=суперсейф
alter table trip_lines
  add column if not exists wb_cargo_type smallint null;
