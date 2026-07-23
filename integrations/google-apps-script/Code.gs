const SPREADSHEET_ID = "1AtQo4vi6nlYV3yzRPUit0iiJTmvgllGplSSfgl1aigU";
const ORDERS_SHEET = "Đơn hàng";
const ITEMS_SHEET = "Chi tiết sản phẩm";
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
const SHEET_LAYOUT_VERSION = "2026-07-23-v3";
const ORDER_STATUSES = ["Mới", "Đã xác nhận", "Đang thiết kế", "Đang sản xuất", "Đang giao", "Hoàn thành", "Đã hủy"];
const DESIGN_CHOICES = ["Giữ nguyên thiết kế", "Yêu cầu thiết kế riêng"];

function doGet() {
  return jsonResponse_({ ok: true, service: "TEAMSPIRIT order intake" });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const payload = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    validatePayload_(payload);

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    ensureSheetLayout_(spreadsheet);
    const ordersSheet = spreadsheet.getSheetByName(ORDERS_SHEET);
    const itemsSheet = spreadsheet.getSheetByName(ITEMS_SHEET);
    if (!ordersSheet || !itemsSheet) throw new Error("Không tìm thấy tab nhận đơn");

    const items = payload.items || [];
    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalPrice = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    const summary = items.map(item => `${item.name} | ${item.size} | ${item.color} | x${item.quantity}`).join("\n");
    const contactRequest = items.map(item => item.designRequest).filter(Boolean).join(" | ");

    ordersSheet.appendRow([
      safe_(payload.orderId),
      new Date(),
      "Mới",
      safe_(payload.customer.name),
      safe_(payload.customer.phone),
      safe_(payload.customer.address || "Không cung cấp"),
      safe_(payload.customer.contactChannel || "Không yêu cầu"),
      safe_(contactRequest),
      totalQuantity,
      totalPrice,
      safe_(summary),
      "",
      safe_(payload.source || "Website"),
      safe_(payload.userAgent),
    ]);
    const orderRow = ordersSheet.getLastRow();
    ordersSheet.getRange(orderRow, 2).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    ordersSheet.getRange(orderRow, 9).setNumberFormat("0");
    ordersSheet.getRange(orderRow, 10).setNumberFormat('#,##0" ₩"');
    ordersSheet.getRange(orderRow, 1, 1, 14).setVerticalAlignment("middle").setWrap(true);

    const itemRows = items.map((item, index) => [
      safe_(payload.orderId),
      index + 1,
      safe_(item.id),
      safe_(item.name),
      safe_(item.size),
      safe_(normalizeColor_(item.color)),
      Number(item.quantity || 0),
      Number(item.unitPrice || 0),
      Number(item.lineTotal || 0),
      safe_(item.designRequest),
      safe_(item.printName),
      safe_(item.jerseyNumber),
      safe_(item.url || payload.pageUrl),
      "Mới",
    ]);
    if (itemRows.length) {
      const firstItemRow = itemsSheet.getLastRow() + 1;
      itemsSheet.getRange(firstItemRow, 1, itemRows.length, itemRows[0].length)
        .setValues(itemRows)
        .setVerticalAlignment("middle")
        .setWrap(true);
      itemsSheet.getRange(firstItemRow, 7, itemRows.length, 1).setNumberFormat("0");
      itemsSheet.getRange(firstItemRow, 8, itemRows.length, 2).setNumberFormat('#,##0" ₩"');
    }

    return jsonResponse_({ ok: true, orderId: payload.orderId });
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message });
  } finally {
    lock.releaseLock();
  }
}

function validatePayload_(payload) {
  if (!payload || !payload.orderId || !payload.customer || !Array.isArray(payload.items) || !payload.items.length) {
    throw new Error("Dữ liệu đơn hàng không hợp lệ");
  }
  if (String(payload.customer.name || "").trim().length < 2) throw new Error("Thiếu tên khách hàng");
  if (!/^0\d{8,10}$/.test(String(payload.customer.phone || "").replace(/\D/g, ""))) {
    throw new Error("Số điện thoại không hợp lệ");
  }
  if (payload.items.length > 50) throw new Error("Đơn hàng có quá nhiều dòng sản phẩm");
}

function safe_(value) {
  const text = String(value == null ? "" : value).slice(0, 2000);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function normalizeColor_(value) {
  const colors = {
    "디자인 기본색": "Theo mẫu",
    "블랙": "Đen",
    "화이트": "Trắng",
    "레드": "Đỏ",
    "블루": "Xanh dương",
    "그린": "Xanh lá",
    "옐로": "Vàng",
    "오렌지": "Cam",
    "퍼플": "Tím",
    "핑크": "Hồng",
    "기타": "Khác",
  };
  return colors[value] || value;
}

function ensureSheetLayout_(spreadsheet) {
  spreadsheet.setSpreadsheetTimeZone(VIETNAM_TIME_ZONE);

  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("SHEET_LAYOUT_VERSION") === SHEET_LAYOUT_VERSION) return;

  const ordersSheet = spreadsheet.getSheetByName(ORDERS_SHEET);
  const itemsSheet = spreadsheet.getSheetByName(ITEMS_SHEET);
  if (!ordersSheet || !itemsSheet) throw new Error("Không tìm thấy tab nhận đơn");

  const orderHeaders = [
    "Mã đơn",
    "Thời gian đặt hàng (Việt Nam)",
    "Trạng thái",
    "Tên khách hàng",
    "Số điện thoại",
    "Địa chỉ",
    "Kênh liên hệ",
    "Yêu cầu sản xuất",
    "Tổng số lượng",
    "Tổng tiền",
    "Tóm tắt sản phẩm",
    "Ghi chú xử lý",
    "Nguồn",
    "Thiết bị",
  ];
  const itemHeaders = [
    "Mã đơn",
    "STT",
    "Mã sản phẩm",
    "Tên sản phẩm",
    "Kích thước",
    "Lựa chọn thiết kế",
    "Số lượng",
    "Đơn giá",
    "Thành tiền",
    "Yêu cầu sản xuất",
    "Tên in áo",
    "Số áo",
    "Trang sản phẩm",
    "Trạng thái",
  ];

  formatTable_(ordersSheet, orderHeaders, [140, 180, 110, 160, 130, 230, 120, 280, 100, 120, 320, 220, 100, 260]);
  formatTable_(itemsSheet, itemHeaders, [140, 55, 120, 240, 100, 190, 90, 120, 120, 280, 130, 80, 260, 120]);

  if (ordersSheet.getLastRow() > 1) {
    ordersSheet.getRange(2, 2, ordersSheet.getLastRow() - 1, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    ordersSheet.getRange(2, 9, ordersSheet.getLastRow() - 1, 1).setNumberFormat("0");
    ordersSheet.getRange(2, 10, ordersSheet.getLastRow() - 1, 1).setNumberFormat('#,##0" ₩"');
  }
  if (itemsSheet.getLastRow() > 1) {
    itemsSheet.getRange(2, 7, itemsSheet.getLastRow() - 1, 1).setNumberFormat("0");
    itemsSheet.getRange(2, 8, itemsSheet.getLastRow() - 1, 2).setNumberFormat('#,##0" ₩"');
  }

  normalizeExistingDesignChoices_(itemsSheet);
  syncAllStatuses_(ordersSheet, itemsSheet);
  applyDropdown_(ordersSheet, 3, ORDER_STATUSES);
  applyDropdown_(itemsSheet, 6, DESIGN_CHOICES);
  applyDropdown_(itemsSheet, 14, ORDER_STATUSES);
  applyStatusRules_(ordersSheet, 3);
  applyStatusRules_(itemsSheet, 14);
  properties.setProperty("SHEET_LAYOUT_VERSION", SHEET_LAYOUT_VERSION);
}

function setupOrderSheets() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty("SHEET_LAYOUT_VERSION");
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  ensureSheetLayout_(spreadsheet);
  ensureStatusSyncTrigger_(spreadsheet);
  SpreadsheetApp.flush();
}

function handleOrderStatusEdit(event) {
  if (!event || !event.range || event.range.getRow() < 2) return;

  const sheet = event.range.getSheet();
  const spreadsheet = sheet.getParent();
  const ordersSheet = spreadsheet.getSheetByName(ORDERS_SHEET);
  const itemsSheet = spreadsheet.getSheetByName(ITEMS_SHEET);
  if (!ordersSheet || !itemsSheet) return;

  const firstColumn = event.range.getColumn();
  const lastColumn = firstColumn + event.range.getNumColumns() - 1;
  const isOrderStatusEdit = sheet.getName() === ORDERS_SHEET && firstColumn <= 3 && lastColumn >= 3;
  const isItemStatusEdit = sheet.getName() === ITEMS_SHEET && firstColumn <= 14 && lastColumn >= 14;
  if (!isOrderStatusEdit && !isItemStatusEdit) return;

  const statusColumn = isOrderStatusEdit ? 3 : 14;
  const firstRow = event.range.getRow();
  const rowCount = event.range.getNumRows();
  const orderIds = sheet.getRange(firstRow, 1, rowCount, 1).getDisplayValues();
  const statuses = sheet.getRange(firstRow, statusColumn, rowCount, 1).getDisplayValues();

  orderIds.forEach((row, index) => {
    const orderId = String(row[0] || "").trim();
    const status = String(statuses[index][0] || "").trim();
    if (orderId && ORDER_STATUSES.includes(status)) {
      syncOrderStatus_(ordersSheet, itemsSheet, orderId, status);
    }
  });
}

function ensureStatusSyncTrigger_(spreadsheet) {
  const exists = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === "handleOrderStatusEdit" &&
    trigger.getEventType() === ScriptApp.EventType.ON_EDIT
  );
  if (!exists) {
    ScriptApp.newTrigger("handleOrderStatusEdit")
      .forSpreadsheet(spreadsheet)
      .onEdit()
      .create();
  }
}

function syncOrderStatus_(ordersSheet, itemsSheet, orderId, status) {
  ordersSheet.createTextFinder(orderId)
    .matchEntireCell(true)
    .findAll()
    .filter(cell => cell.getColumn() === 1 && cell.getRow() > 1)
    .forEach(cell => ordersSheet.getRange(cell.getRow(), 3).setValue(status));

  itemsSheet.createTextFinder(orderId)
    .matchEntireCell(true)
    .findAll()
    .filter(cell => cell.getColumn() === 1 && cell.getRow() > 1)
    .forEach(cell => itemsSheet.getRange(cell.getRow(), 14).setValue(status));
}

function syncAllStatuses_(ordersSheet, itemsSheet) {
  const statusByOrder = {};
  if (ordersSheet.getLastRow() > 1) {
    const rowCount = ordersSheet.getLastRow() - 1;
    const rows = ordersSheet.getRange(2, 1, rowCount, 3).getDisplayValues();
    const normalizedStatuses = rows.map(row => [ORDER_STATUSES.includes(row[2]) ? row[2] : "Mới"]);
    ordersSheet.getRange(2, 3, rowCount, 1).setValues(normalizedStatuses);
    rows.forEach((row, index) => {
      const orderId = String(row[0] || "").trim();
      if (orderId) statusByOrder[orderId] = normalizedStatuses[index][0];
    });
  }

  if (itemsSheet.getLastRow() > 1) {
    const rowCount = itemsSheet.getLastRow() - 1;
    const orderIds = itemsSheet.getRange(2, 1, rowCount, 1).getDisplayValues();
    const existingStatuses = itemsSheet.getRange(2, 14, rowCount, 1).getDisplayValues();
    const statuses = orderIds.map((row, index) => {
      const orderId = String(row[0] || "").trim();
      const existingStatus = existingStatuses[index][0];
      return [statusByOrder[orderId] || (ORDER_STATUSES.includes(existingStatus) ? existingStatus : "Mới")];
    });
    itemsSheet.getRange(2, 14, rowCount, 1).setValues(statuses);
  }
}

function normalizeExistingDesignChoices_(itemsSheet) {
  if (itemsSheet.getLastRow() < 2) return;

  const range = itemsSheet.getRange(2, 6, itemsSheet.getLastRow() - 1, 1);
  const values = range.getDisplayValues().map(row => {
    const value = String(row[0] || "").trim();
    if (!value || DESIGN_CHOICES.includes(value)) return [value];
    return ["Giữ nguyên thiết kế"];
  });
  range.setValues(values);
}

function applyDropdown_(sheet, column, choices) {
  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(choices, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, column, rowCount, 1).setDataValidation(rule);
}

function applyStatusRules_(sheet, column) {
  const statusRange = sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1);
  const otherRules = sheet.getConditionalFormatRules().filter(rule =>
    !rule.getRanges().some(range => range.getColumn() === column && range.getNumColumns() === 1)
  );
  const styles = [
    ["Mới", "#fff2cc", "#7f6000"],
    ["Đã xác nhận", "#d9ead3", "#274e13"],
    ["Đang thiết kế", "#d9eaf7", "#134f5c"],
    ["Đang sản xuất", "#cfe2f3", "#073763"],
    ["Đang giao", "#d9d2e9", "#351c75"],
    ["Hoàn thành", "#b6d7a8", "#274e13"],
    ["Đã hủy", "#f4cccc", "#990000"],
  ];
  const statusRules = styles.map(([status, background, fontColor]) =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status)
      .setBackground(background)
      .setFontColor(fontColor)
      .setRanges([statusRange])
      .build()
  );
  sheet.setConditionalFormatRules(otherRules.concat(statusRules));
}

function formatTable_(sheet, headers, widths) {
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground("#f1f3f4")
    .setFontColor("#202124")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 40);

  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
      .setVerticalAlignment("middle")
      .setWrap(true);
  }

  const filter = sheet.getFilter();
  if (filter && filter.getRange().getNumColumns() !== headers.length) {
    filter.remove();
  }
  if (!sheet.getFilter() && sheet.getLastRow() > 1) {
    sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
