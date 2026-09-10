-- MERTECH CL-1300 GS BLE Dongle P2D USB Black (manufacturer article 4893).
-- The device label uses the shorter model name "MERTECH CL-1300 P2D".
--
-- Primary sources:
-- https://mertech.ru/besprovodnoj-skaner-shtrih-koda-mertech-cl-1300-ble-dongle-p2d-usb-black/
-- https://help.mertech.ru/barcode_scanners/SUPERLEAD/Scanner_k_1C.html
-- https://help.mertech.ru/barcode_scanners/SUPERLEAD/GS_bez_provod.html
-- https://mertech.ru/image/catalog/goods/inst/Bluetooth_2D_UserGuide_V2.0.pdf
--
-- This is a Web Serial profile using the scanner's wireless USB-COM emulation.
-- Do not reuse interface barcodes intended for a wired MERTECH scanner.

begin;

do $$
declare
  v_current public.fbs_scanner_models%rowtype;
  v_saved public.fbs_scanner_models%rowtype;
  v_action text;
  v_serial_options jsonb := '{"baudRate":115200,"dataBits":8,"stopBits":1,"parity":"none","flowControl":"none"}'::jsonb;
  v_scan_options jsonb := '{"maxPacketLength":4096,"packetTerminator":"cr"}'::jsonb;
  v_setup_barcodes jsonb := '[
    {"label":"3. Включить USB-COM (беспроводной)","value":"SX060802130.","format":"CODE128"},
    {"label":"4. Добавить суффикс CR (Enter)","value":"090200.","format":"CODE128"}
  ]'::jsonb;
  v_restore_barcodes jsonb := '[
    {"label":"Вернуть USB-HID (беспроводной)","value":"SX060802124.","format":"CODE128"}
  ]'::jsonb;
  v_instructions text := E'1. Отсканируйте код сопряжения, напечатанный на комплектном USB-приёмнике (Dongle).\n2. Подключите приёмник к USB-порту компьютера.\nЗатем отсканируйте коды ниже строго сверху вниз.';
  v_warning_text text := E'После настройки выберите эту модель и нажмите «Подключить COM к ELESTET».\nВ Windows 10/11 используется системный драйвер. Если COM-порт не появился, переподключите приёмник и проверьте раздел «Порты (COM и LPT)» в диспетчере устройств. Не используйте код интерфейса от проводной модели.';
begin
  select * into v_current
  from public.fbs_scanner_models scanner
  where lower(scanner.display_name) = lower('MERTECH CL-1300 P2D')
  for update;

  if v_current.id is null then
    insert into public.fbs_scanner_models (
      brand,
      model,
      display_name,
      connection_type,
      status,
      serial_options,
      scan_options,
      setup_barcodes,
      restore_barcodes,
      instructions,
      warning_text,
      sort_order
    ) values (
      'MERTECH',
      'CL-1300 P2D',
      'MERTECH CL-1300 P2D',
      'web_serial',
      'active',
      v_serial_options,
      v_scan_options,
      v_setup_barcodes,
      v_restore_barcodes,
      v_instructions,
      v_warning_text,
      21
    )
    returning * into v_saved;
    v_action := 'created_and_published';
  elsif v_current.brand is distinct from 'MERTECH'
    or v_current.model is distinct from 'CL-1300 P2D'
    or v_current.display_name is distinct from 'MERTECH CL-1300 P2D'
    or v_current.connection_type is distinct from 'web_serial'
    or v_current.status is distinct from 'active'
    or v_current.serial_options is distinct from v_serial_options
    or v_current.scan_options is distinct from v_scan_options
    or v_current.setup_barcodes is distinct from v_setup_barcodes
    or v_current.restore_barcodes is distinct from v_restore_barcodes
    or v_current.instructions is distinct from v_instructions
    or v_current.warning_text is distinct from v_warning_text
    or v_current.sort_order is distinct from 21 then
    update public.fbs_scanner_models
    set brand = 'MERTECH',
        model = 'CL-1300 P2D',
        display_name = 'MERTECH CL-1300 P2D',
        connection_type = 'web_serial',
        status = 'active',
        serial_options = v_serial_options,
        scan_options = v_scan_options,
        setup_barcodes = v_setup_barcodes,
        restore_barcodes = v_restore_barcodes,
        instructions = v_instructions,
        warning_text = v_warning_text,
        sort_order = 21,
        profile_version = v_current.profile_version + 1,
        updated_at = now()
    where id = v_current.id
    returning * into v_saved;
    v_action := 'updated';
  else
    return;
  end if;

  insert into public.fbs_scanner_model_history (
    scanner_model_id,
    action,
    profile_version,
    actor_user_id,
    snapshot
  ) values (
    v_saved.id,
    v_action,
    v_saved.profile_version,
    null,
    to_jsonb(v_saved)
  );
end
$$;

commit;

notify pgrst, 'reload schema';
