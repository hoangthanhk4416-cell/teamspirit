(() => {
  "use strict";

  const config = window.TEAMSPIRIT_ORDER_CONFIG || {};
  const form = document.getElementById("orderLookupForm");
  const input = document.getElementById("orderLookupInput");
  const message = document.getElementById("trackingMessage");
  const results = document.getElementById("trackingResults");
  if (!form || !input || !message || !results) return;

  const statusLabels = {
    "Mới": "신규 접수",
    "Đã xác nhận": "주문 확인",
    "Đang thiết kế": "디자인 진행",
    "Đang sản xuất": "제작 중",
    "Đang giao": "배송 중",
    "Hoàn thành": "완료",
    "Đã hủy": "취소",
  };
  const progressStatuses = ["Mới", "Đã xác nhận", "Đang thiết kế", "Đang sản xuất", "Đang giao", "Hoàn thành"];

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);

  function lookupParameters(value) {
    const text = String(value || "").trim();
    if (/^TS-/i.test(text)) return { orderId: text.toUpperCase() };
    const phone = text.replace(/\D/g, "");
    return phone ? { phone } : {};
  }

  function jsonpRequest(parameters) {
    const endpoint = String(config.endpoint || "").trim();
    if (!/^https:\/\/script\.google\.com\//.test(endpoint)) {
      return Promise.reject(new Error("주문 조회 서비스가 아직 연결되지 않았습니다."));
    }

    return new Promise((resolve, reject) => {
      const callback = `__tsOrderLookup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const url = new URL(endpoint);
      url.searchParams.set("mode", "lookup");
      url.searchParams.set("callback", callback);
      Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));

      const cleanup = () => {
        delete window[callback];
        script.remove();
        clearTimeout(timeout);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("조회 시간이 초과되었습니다. 다시 시도해 주세요."));
      }, 15000);

      window[callback] = data => {
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("주문 조회 서버에 연결할 수 없습니다."));
      };
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function displayError(error) {
    const translations = {
      "Vui lòng nhập mã đơn hàng hoặc số điện thoại": "주문번호 또는 전화번호를 입력해 주세요.",
      "Mã đơn hàng không đúng định dạng": "주문번호 형식이 올바르지 않습니다.",
      "Số điện thoại không đúng định dạng": "전화번호 형식이 올바르지 않습니다.",
    };
    message.className = "tracking-message";
    message.textContent = translations[error.message] || error.message || "주문을 조회할 수 없습니다.";
  }

  function statusSteps(status) {
    if (status === "Đã hủy") return `<div class="status-badge cancelled">취소된 주문입니다</div>`;
    const activeIndex = Math.max(0, progressStatuses.indexOf(status));
    return `<div class="status-steps">${progressStatuses.map((item, index) => `
      <div class="status-step ${index < activeIndex ? "done" : index === activeIndex ? "current" : ""}">
        ${escapeHtml(statusLabels[item])}
      </div>`).join("")}</div>`;
  }

  function formatPrice(value) {
    return `${new Intl.NumberFormat("ko-KR").format(Number(value || 0))}원`;
  }

  function orderCard(order) {
    const cancelled = order.status === "Đã hủy";
    return `<article class="tracking-order">
      <div class="order-head">
        <div>
          <small>주문번호</small>
          <div class="order-code">
            <strong>${escapeHtml(order.orderId)}</strong>
            <button class="copy-code" type="button" data-copy-order="${escapeHtml(order.orderId)}">복사</button>
          </div>
        </div>
        <span class="status-badge ${cancelled ? "cancelled" : ""}">${escapeHtml(statusLabels[order.status] || order.status)}</span>
      </div>
      <div class="order-meta">
        <div><span>주문 일시 (베트남 시간)</span><strong>${escapeHtml(order.placedAt || "-")}</strong></div>
        <div><span>주문 수량</span><strong>${Number(order.totalQuantity || 0)}개</strong></div>
        <div><span>주문 금액</span><strong>${formatPrice(order.totalPrice)}</strong></div>
      </div>
      <p class="order-summary">${escapeHtml(order.summary || "상품 정보 확인 중")}</p>
      ${statusSteps(order.status)}
    </article>`;
  }

  async function copyText(value, button) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (_error) {
      const temporary = document.createElement("textarea");
      temporary.value = value;
      document.body.appendChild(temporary);
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
    }
    const original = button.textContent;
    button.textContent = "복사됨";
    setTimeout(() => { button.textContent = original; }, 1400);
  }

  async function submitLookup() {
    const parameters = lookupParameters(input.value);
    if (!parameters.orderId && !parameters.phone) {
      displayError(new Error("주문번호 또는 전화번호를 입력해 주세요."));
      return;
    }

    message.className = "tracking-message loading";
    message.textContent = "주문 정보를 확인하고 있습니다…";
    results.innerHTML = "";
    form.querySelector("button").disabled = true;
    try {
      const data = await jsonpRequest(parameters);
      if (!data || data.ok !== true) throw new Error(data?.error || "주문을 조회할 수 없습니다.");
      if (!Array.isArray(data.orders) || !data.orders.length) {
        message.className = "tracking-message";
        message.textContent = "일치하는 주문을 찾지 못했습니다. 입력 정보를 다시 확인해 주세요.";
        return;
      }
      message.className = "tracking-message";
      message.textContent = `${data.orders.length}개의 주문을 찾았습니다.`;
      results.innerHTML = data.orders.map(orderCard).join("");
      const url = new URL(location.href);
      url.search = "";
      if (parameters.orderId) url.searchParams.set("orderId", parameters.orderId);
      history.replaceState({}, "", url);
    } catch (error) {
      displayError(error);
    } finally {
      form.querySelector("button").disabled = false;
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    submitLookup();
  });
  results.addEventListener("click", event => {
    const button = event.target.closest("[data-copy-order]");
    if (button) copyText(button.dataset.copyOrder, button);
  });

  const initialOrderId = new URLSearchParams(location.search).get("orderId");
  if (initialOrderId) {
    input.value = initialOrderId;
    submitLookup();
  }
})();
