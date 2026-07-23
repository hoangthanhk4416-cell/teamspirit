const SPREADSHEET_ID = "1AtQo4vi6nlYV3yzRPUit0iiJTmvgllGplSSfgl1aigU";
const ORDERS_SHEET = "Đơn hàng";
const ITEMS_SHEET = "Chi tiết sản phẩm";

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
    const ordersSheet = spreadsheet.getSheetByName(ORDERS_SHEET);
    const itemsSheet = spreadsheet.getSheetByName(ITEMS_SHEET);
    if (!ordersSheet || !itemsSheet) throw new Error("Không tìm thấy tab nhận đơn");

    const items = payload.items || [];
    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const totalPrice = items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
    const summary = items.map(item => `${item.name} | ${item.size} | ${item.color} | x${item.quantity}`).join("\n");
    const contactRequest = [payload.customer.contactTime, items.map(item => item.designRequest).filter(Boolean).join(" | ")].filter(Boolean).join(" — ");

    ordersSheet.appendRow([
      safe_(payload.orderId),
      new Date(payload.submittedAt || Date.now()),
      "Mới",
      safe_(payload.customer.name),
      safe_(payload.customer.phone),
      safe_(payload.customer.address),
      safe_(payload.customer.contactChannel),
      safe_(contactRequest),
      totalQuantity,
      totalPrice,
      safe_(summary),
      "",
      safe_(payload.source || "Website"),
      safe_(payload.userAgent),
    ]);

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
    ]);
    if (itemRows.length) {
      itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, itemRows[0].length).setValues(itemRows);
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

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
