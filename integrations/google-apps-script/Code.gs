const SPREADSHEET_ID = "1AtQo4vi6nlYV3yzRPUit0iiJTmvgllGplSSfgl1aigU";
const ORDERS_SHEET = "Đơn hàng";
const ITEMS_SHEET = "Chi tiết sản phẩm";
const TRACKING_SHEET = "Tra cứu vận đơn";
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";
const SHEET_LAYOUT_VERSION = "2026-07-24-v8";
const ORDER_STATUSES = ["Mới", "Đã xác nhận", "Đang thiết kế", "Đang sản xuất", "Đang giao", "Hoàn tất", "Đã hủy"];
const DESIGN_CHOICES = ["Giữ nguyên thiết kế", "Yêu cầu thiết kế riêng"];
const KOREAN_STATUS = {
  "Mới": "신규 접수",
  "Đã xác nhận": "주문 확인",
  "Đang thiết kế": "디자인 진행",
  "Đang sản xuất": "제작 중",
  "Đang giao": "배송 중",
  "Hoàn tất": "완료",
  "Đã hủy": "취소",
};
const STATUS_KEY = {
  "Mới": "NEW",
  "Đã xác nhận": "CONFIRMED",
  "Đang thiết kế": "DESIGNING",
  "Đang sản xuất": "PRODUCTION",
  "Đang giao": "SHIPPING",
  "Hoàn tất": "COMPLETED",
  "Đã hủy": "CANCELLED",
};
const KOREAN_NOTICE = {
  "Mới": "주문이 정상적으로 접수되었습니다. 담당자가 주문 내용을 확인하고 있습니다.",
  "Đã xác nhận": "주문 내용을 확인했습니다. 디자인 및 제작 준비를 진행하고 있습니다.",
  "Đang thiết kế": "요청하신 내용을 바탕으로 디자인 시안을 준비하고 있습니다.",
  "Đang sản xuất": "디자인 확인이 완료되어 상품을 제작하고 있습니다.",
  "Đang giao": "제작이 완료되어 배송이 진행 중입니다.",
  "Hoàn tất": "배송이 완료되었습니다. TEAMSPIRIT를 이용해 주셔서 감사합니다.",
  "Đã hủy": "주문이 취소되었습니다. 자세한 내용은 고객 안내 메시지를 확인하거나 문의해 주세요.",
};

function doGet(event) {
  const parameters = (event && event.parameter) || {};
  if (parameters.mode === "lookup") {
    try {
      return publicResponse_(lookupOrders_(parameters), parameters.callback);
    } catch (error) {
      return publicResponse_({ ok: false, error: error.message }, parameters.callback);
    }
  }
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

    const items = (payload.items || []).map(item => ({
      ...item,
      size: normalizeSize_(item.size),
    }));
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
    itemsSheet.getRange(firstItemRow, 8, itemRows.length, 1).setNumberFormat('#,##0" ₩"');
    itemsSheet.getRange(firstItemRow, 9, itemRows.length, 1).setNumberFormat('#,##0" ₩"');
    }

    const trackingSheet = spreadsheet.getSheetByName(TRACKING_SHEET);
    upsertTrackingOrder_(trackingSheet, {
      orderId: payload.orderId,
      placedAt: ordersSheet.getRange(orderRow, 2).getValue(),
      status: "Mới",
      summary,
      totalQuantity,
      totalPrice,
      phone: payload.customer.phone,
    });

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

function lookupOrders_(parameters) {
  const orderId = String(parameters.orderId || "").trim().toUpperCase();
  const phone = String(parameters.phone || "").replace(/\D/g, "");
  if (!orderId && !phone) throw new Error("Vui lòng nhập mã đơn hàng hoặc số điện thoại");
  if (orderId && !/^TS-\d{8}-[A-Z0-9]{1,10}$/.test(orderId)) throw new Error("Mã đơn hàng không đúng định dạng");
  if (phone && !/^0\d{8,10}$/.test(phone)) throw new Error("Số điện thoại không đúng định dạng");

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  spreadsheet.setSpreadsheetTimeZone(VIETNAM_TIME_ZONE);
  const trackingSheet = spreadsheet.getSheetByName(TRACKING_SHEET);
  if (!trackingSheet || trackingSheet.getLastRow() < 2) return { ok: true, orders: [] };

  const values = trackingSheet.getRange(2, 1, trackingSheet.getLastRow() - 1, 10).getValues();
  const matches = values
    .filter(row => {
      const rowOrderId = String(row[0] || "").trim().toUpperCase();
      const rowPhone = String(row[8] || "").replace(/\D/g, "");
      return orderId ? rowOrderId === orderId : rowPhone === phone;
    })
    .slice(-10)
    .reverse()
    .map(row => {
      const internalStatus = internalStatusFromKorean_(row[2]);
      return {
        orderId: String(row[0] || ""),
        placedAt: row[1] instanceof Date
          ? Utilities.formatDate(row[1], VIETNAM_TIME_ZONE, "dd/MM/yyyy HH:mm:ss")
          : String(row[1] || ""),
        status: KOREAN_STATUS[internalStatus],
        statusKey: STATUS_KEY[internalStatus],
        defaultMessage: String(row[3] || KOREAN_NOTICE[internalStatus]),
        customerMessage: String(row[4] || ""),
        summary: String(row[5] || ""),
        totalQuantity: Number(row[6] || 0),
        totalPrice: Number(row[7] || 0),
        phoneHint: maskPhone_(row[8]),
      };
    });

  return { ok: true, orders: matches };
}

function maskPhone_(value) {
  const phone = String(value || "").replace(/\D/g, "");
  if (phone.length < 7) return "";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function publicResponse_(data, callback) {
  const callbackName = String(callback || "");
  if (/^[A-Za-z_$][0-9A-Za-z_$]{0,80}$/.test(callbackName)) {
    return ContentService
      .createTextOutput(`${callbackName}(${JSON.stringify(data)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse_(data);
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
  const trackingSheet = spreadsheet.getSheetByName(TRACKING_SHEET) || spreadsheet.insertSheet(TRACKING_SHEET);
  if (!ordersSheet || !itemsSheet) throw new Error("Không tìm thấy tab nhận đơn");

  const orderHeaders = [
    "Mã đơn",
    "Thời gian đặt hàng",
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
  const trackingHeaders = [
    "주문번호",
    "주문일시",
    "진행상태",
    "기본 진행 안내",
    "고객 안내 메시지 (직접 입력)",
    "상품정보",
    "수량",
    "주문금액",
    "조회 전화번호",
    "최종 업데이트",
  ];

  formatTable_(ordersSheet, orderHeaders, [140, 180, 110, 160, 130, 230, 120, 280, 100, 120, 320, 220, 100, 260]);
  formatTable_(itemsSheet, itemHeaders, [140, 55, 120, 240, 100, 190, 90, 120, 120, 280, 130, 80, 260, 120]);
  formatTable_(trackingSheet, trackingHeaders, [155, 180, 120, 340, 340, 320, 75, 120, 135, 180]);

  if (ordersSheet.getLastRow() > 1) {
    ordersSheet.getRange(2, 2, ordersSheet.getLastRow() - 1, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    ordersSheet.getRange(2, 9, ordersSheet.getLastRow() - 1, 1).setNumberFormat("0");
    ordersSheet.getRange(2, 10, ordersSheet.getLastRow() - 1, 1).setNumberFormat('#,##0" ₩"');
  }
  if (itemsSheet.getLastRow() > 1) {
    const itemRowCount = itemsSheet.getLastRow() - 1;
    itemsSheet.getRange(2, 7, itemRowCount, 1).setNumberFormat("0");
    // Google Sheets Tables reject column operations spanning multiple columns.
    // Format unit price and line total as two independent one-column ranges.
    itemsSheet.getRange(2, 8, itemRowCount, 1).setNumberFormat('#,##0" ₩"');
    itemsSheet.getRange(2, 9, itemRowCount, 1).setNumberFormat('#,##0" ₩"');
  }
  if (trackingSheet.getLastRow() > 1) {
    const trackingRowCount = trackingSheet.getLastRow() - 1;
    safeSheetOperation_("format tracking order time", () =>
      trackingSheet.getRange(2, 2, trackingRowCount, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss")
    );
    safeSheetOperation_("format tracking quantity", () =>
      trackingSheet.getRange(2, 7, trackingRowCount, 1).setNumberFormat("0")
    );
    safeSheetOperation_("format tracking amount", () =>
      trackingSheet.getRange(2, 8, trackingRowCount, 1).setNumberFormat('#,##0" ₩"')
    );
    safeSheetOperation_("format tracking update time", () =>
      trackingSheet.getRange(2, 10, trackingRowCount, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss")
    );
  }

  normalizeExistingDesignChoices_(itemsSheet);
  normalizeExistingSizes_(ordersSheet, itemsSheet);
  syncAllStatuses_(ordersSheet, itemsSheet);
  syncTrackingSheet_(ordersSheet, trackingSheet);
  safeSheetOperation_("orders status dropdown", () => applyDropdown_(ordersSheet, 3, ORDER_STATUSES));
  safeSheetOperation_("items design dropdown", () => applyDropdown_(itemsSheet, 6, DESIGN_CHOICES));
  safeSheetOperation_("items status dropdown", () => applyDropdown_(itemsSheet, 14, ORDER_STATUSES));
  safeSheetOperation_("tracking status dropdown", () => applyDropdown_(trackingSheet, 3, Object.values(KOREAN_STATUS)));
  safeSheetOperation_("orders status colors", () => applyStatusRules_(ordersSheet, 3));
  safeSheetOperation_("items status colors", () => applyStatusRules_(itemsSheet, 14));
  safeSheetOperation_("tracking status colors", () => applyKoreanStatusRules_(trackingSheet, 3));
  properties.setProperty("SHEET_LAYOUT_VERSION", SHEET_LAYOUT_VERSION);
}

function safeSheetOperation_(description, callback) {
  try {
    callback();
  } catch (error) {
    // Some spreadsheets use the newer Google Sheets Table feature. A Table
    // can reject column-level formatting or validation even when the selected
    // range is one column. These presentation helpers must never stop setup.
    console.log(`Skipped ${description}: ${error.message}`);
  }
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
  const firstColumn = event.range.getColumn();
  const lastColumn = firstColumn + event.range.getNumColumns() - 1;
  const isOrderStatusEdit = sheet.getName() === ORDERS_SHEET && firstColumn <= 3 && lastColumn >= 3;
  const isItemStatusEdit = sheet.getName() === ITEMS_SHEET && firstColumn <= 14 && lastColumn >= 14;
  const isTrackingStatusEdit = sheet.getName() === TRACKING_SHEET && firstColumn <= 3 && lastColumn >= 3;
  const isTrackingMessageEdit = sheet.getName() === TRACKING_SHEET && firstColumn <= 5 && lastColumn >= 5;
  if (!isOrderStatusEdit && !isItemStatusEdit && !isTrackingStatusEdit && !isTrackingMessageEdit) return;

  // Installable edit triggers can overlap when staff changes a status twice in
  // quick succession. Serialize them and read the live cell only after the lock
  // is acquired so an older "Đã hủy" task cannot overwrite "Hoàn tất".
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = sheet.getParent();
    const ordersSheet = spreadsheet.getSheetByName(ORDERS_SHEET);
    const itemsSheet = spreadsheet.getSheetByName(ITEMS_SHEET);
    const trackingSheet = spreadsheet.getSheetByName(TRACKING_SHEET);
    if (!ordersSheet || !itemsSheet || !trackingSheet) return;

    const firstRow = event.range.getRow();
    const rowCount = event.range.getNumRows();
    if (isTrackingMessageEdit && !isTrackingStatusEdit) {
      trackingSheet.getRange(firstRow, 10, rowCount, 1).setValue(new Date()).setNumberFormat("dd/MM/yyyy HH:mm:ss");
      SpreadsheetApp.flush();
      return;
    }

    const statusColumn = isOrderStatusEdit || isTrackingStatusEdit ? 3 : 14;
    const orderIds = sheet.getRange(firstRow, 1, rowCount, 1).getDisplayValues();
    const statuses = sheet.getRange(firstRow, statusColumn, rowCount, 1).getDisplayValues();

    orderIds.forEach((row, index) => {
      const orderId = String(row[0] || "").trim();
      const rawStatus = String(statuses[index][0] || "").trim();
      const status = isTrackingStatusEdit ? internalStatusFromKorean_(rawStatus) : canonicalStatus_(rawStatus);
      if (orderId && status) {
        syncOrderStatus_(ordersSheet, itemsSheet, trackingSheet, orderId, status);
      }
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function ensureStatusSyncTrigger_(spreadsheet) {
  const matchingTriggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === "handleOrderStatusEdit" &&
    trigger.getEventType() === ScriptApp.EventType.ON_EDIT
  );
  // Keep exactly one trigger. Duplicate triggers can replay an older status
  // after a newer edit and leave the customer tracking row out of sync.
  matchingTriggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
  if (!matchingTriggers.length) {
    ScriptApp.newTrigger("handleOrderStatusEdit")
      .forSpreadsheet(spreadsheet)
      .onEdit()
      .create();
  }
}

function syncOrderStatus_(ordersSheet, itemsSheet, trackingSheet, orderId, status) {
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

  syncTrackingStatus_(trackingSheet, orderId, status);
}

function syncAllStatuses_(ordersSheet, itemsSheet) {
  const statusByOrder = {};
  if (ordersSheet.getLastRow() > 1) {
    const rowCount = ordersSheet.getLastRow() - 1;
    const rows = ordersSheet.getRange(2, 1, rowCount, 3).getDisplayValues();
    const normalizedStatuses = rows.map(row => [canonicalStatus_(row[2]) || "Mới"]);
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
      return [statusByOrder[orderId] || canonicalStatus_(existingStatus) || "Mới"];
    });
    itemsSheet.getRange(2, 14, rowCount, 1).setValues(statuses);
  }
}

function syncTrackingSheet_(ordersSheet, trackingSheet) {
  const existingByOrder = {};
  if (trackingSheet.getLastRow() > 1) {
    trackingSheet.getRange(2, 1, trackingSheet.getLastRow() - 1, 10).getValues().forEach(row => {
      const orderId = String(row[0] || "").trim();
      if (orderId) {
        existingByOrder[orderId] = {
          customerMessage: String(row[4] || ""),
          updatedAt: row[9] || new Date(),
        };
      }
    });
  }

  const rows = [];
  if (ordersSheet.getLastRow() > 1) {
    ordersSheet.getRange(2, 1, ordersSheet.getLastRow() - 1, 11).getValues().forEach(row => {
      const orderId = String(row[0] || "").trim();
      if (!orderId) return;
      const status = canonicalStatus_(row[2]) || "Mới";
      const existing = existingByOrder[orderId] || {};
      rows.push([
        orderId,
        row[1],
        KOREAN_STATUS[status],
        KOREAN_NOTICE[status],
        existing.customerMessage || "",
        koreanSummary_(row[10]),
        Number(row[8] || 0),
        Number(row[9] || 0),
        String(row[4] || ""),
        existing.updatedAt || new Date(),
      ]);
    });
  }

  if (trackingSheet.getMaxRows() > 1) {
    trackingSheet.getRange(2, 1, trackingSheet.getMaxRows() - 1, 10).clearContent();
  }
  if (rows.length) {
    trackingSheet.getRange(2, 1, rows.length, 10)
      .setValues(rows)
      .setVerticalAlignment("middle")
      .setWrap(true);
    trackingSheet.getRange(2, 2, rows.length, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    trackingSheet.getRange(2, 7, rows.length, 1).setNumberFormat("0");
    trackingSheet.getRange(2, 8, rows.length, 1).setNumberFormat('#,##0" ₩"');
    trackingSheet.getRange(2, 10, rows.length, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  }
  const filter = trackingSheet.getFilter();
  if (filter && (filter.getRange().getNumColumns() !== 10 || filter.getRange().getNumRows() !== trackingSheet.getLastRow())) {
    filter.remove();
  }
  if (!trackingSheet.getFilter() && trackingSheet.getLastRow() > 1) {
    trackingSheet.getRange(1, 1, trackingSheet.getLastRow(), 10).createFilter();
  }
}

function upsertTrackingOrder_(trackingSheet, order) {
  if (!trackingSheet) return;
  const status = canonicalStatus_(order.status) || "Mới";
  const matches = trackingSheet.createTextFinder(String(order.orderId))
    .matchEntireCell(true)
    .findAll()
    .filter(cell => cell.getColumn() === 1 && cell.getRow() > 1);
  const row = matches.length ? matches[0].getRow() : trackingSheet.getLastRow() + 1;
  const customerMessage = matches.length ? String(trackingSheet.getRange(row, 5).getValue() || "") : "";
  trackingSheet.getRange(row, 1, 1, 10).setValues([[
    String(order.orderId || ""),
    order.placedAt || new Date(),
    KOREAN_STATUS[status],
    KOREAN_NOTICE[status],
    customerMessage,
    koreanSummary_(order.summary),
    Number(order.totalQuantity || 0),
    Number(order.totalPrice || 0),
    String(order.phone || ""),
    new Date(),
  ]]).setVerticalAlignment("middle").setWrap(true);
  trackingSheet.getRange(row, 2).setNumberFormat("dd/MM/yyyy HH:mm:ss");
  trackingSheet.getRange(row, 7).setNumberFormat("0");
  trackingSheet.getRange(row, 8).setNumberFormat('#,##0" ₩"');
  trackingSheet.getRange(row, 10).setNumberFormat("dd/MM/yyyy HH:mm:ss");
}

function syncTrackingStatus_(trackingSheet, orderId, status) {
  if (!trackingSheet) return;
  trackingSheet.createTextFinder(orderId)
    .matchEntireCell(true)
    .findAll()
    .filter(cell => cell.getColumn() === 1 && cell.getRow() > 1)
    .forEach(cell => {
      const row = cell.getRow();
      trackingSheet.getRange(row, 3).setValue(KOREAN_STATUS[status]);
      trackingSheet.getRange(row, 4).setValue(KOREAN_NOTICE[status]);
      trackingSheet.getRange(row, 10).setValue(new Date()).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    });
}

function internalStatusFromKorean_(value) {
  const korean = String(value || "").trim();
  const found = ORDER_STATUSES.find(status => KOREAN_STATUS[status] === korean);
  return found || "Mới";
}

function canonicalStatus_(value) {
  const status = String(value || "").trim();
  // Accept the legacy wording already stored in older spreadsheet rows, while
  // keeping "Hoàn tất" as the only current dropdown value.
  if (status === "Hoàn thành") return "Hoàn tất";
  return ORDER_STATUSES.includes(status) ? status : "";
}

function koreanSummary_(value) {
  return normalizeSizesInText_(value)
    .replaceAll("Giữ nguyên thiết kế", "기존 디자인 유지")
    .replaceAll("Yêu cầu thiết kế riêng", "별도 디자인 요청")
    .replaceAll("Theo mẫu", "기존 디자인 유지");
}

function normalizeSize_(value) {
  const text = String(value || "").trim().replace(/\b(lít|lit|liters?|litres?)\b/gi, "L");
  const match = text.match(/^(\d+)\s*\(?\s*(XS|S|M|L|XL|2XL|3XL|4XL)\s*\)?$/i);
  return match ? `${match[1]} (${match[2].toUpperCase()})` : text;
}

function normalizeSizesInText_(value) {
  return String(value || "").replace(
    /(^|[\s|])(\d+)\s*\(?\s*(XS|S|M|L|XL|2XL|3XL|4XL|lít|lit|liters?|litres?)\s*\)?(?=\s*(?:\||$))/gim,
    (_match, prefix, number, size) => {
      const normalized = /^(lít|lit|liters?|litres?)$/i.test(size) ? "L" : size.toUpperCase();
      return `${prefix}${number} (${normalized})`;
    }
  );
}

function normalizeExistingSizes_(ordersSheet, itemsSheet) {
  if (ordersSheet.getLastRow() > 1) {
    const orderRange = ordersSheet.getRange(2, 11, ordersSheet.getLastRow() - 1, 1);
    orderRange.setValues(orderRange.getDisplayValues().map(row => [normalizeSizesInText_(row[0])]));
  }
  if (itemsSheet.getLastRow() > 1) {
    const itemRange = itemsSheet.getRange(2, 5, itemsSheet.getLastRow() - 1, 1);
    itemRange.setValues(itemRange.getDisplayValues().map(row => [normalizeSize_(row[0])]));
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
    ["Hoàn tất", "#b6d7a8", "#274e13"],
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

function applyKoreanStatusRules_(sheet, column) {
  const statusRange = sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1);
  const otherRules = sheet.getConditionalFormatRules().filter(rule =>
    !rule.getRanges().some(range => range.getColumn() === column && range.getNumColumns() === 1)
  );
  const styles = [
    ["신규 접수", "#fff2cc", "#7f6000"],
    ["주문 확인", "#d9ead3", "#274e13"],
    ["디자인 진행", "#d9eaf7", "#134f5c"],
    ["제작 중", "#cfe2f3", "#073763"],
    ["배송 중", "#d9d2e9", "#351c75"],
    ["완료", "#b6d7a8", "#274e13"],
    ["취소", "#f4cccc", "#990000"],
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
    try {
      sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
    } catch (error) {
      // Google Sheets "Tables" already provide their own filter controls.
      // Creating a basic filter over the same cells throws an overlap error,
      // but it must not prevent the remaining sheets from being configured.
      console.log(
        `Skipped basic filter on "${sheet.getName()}": ${error.message}`
      );
    }
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
