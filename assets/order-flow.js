(() => {
  "use strict";

  const config = window.TEAMSPIRIT_ORDER_CONFIG || {};
  const sizes = ["55 XS","60 S","65 M","70 L","75 XL","80 2XL","85 3XL","90","95","100","105","110","Khác"];
  const colors = ["디자인 기본색","블랙","화이트","레드","블루","그린","옐로","오렌지","퍼플","핑크","기타"];
  const contacts = ["KakaoTalk","Instagram","Điện thoại","Zalo","Khác"];
  let selectedProduct = null;
  let currentStep = 1;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[char]));
  const numericPrice = value => {
    const digits = String(value || "").replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  };
  const productIdFromUrl = url => {
    const match = String(url || "").match(/\/products\/([^/?#]+)/);
    return match ? match[1] : "";
  };
  const currentProduct = () => {
    const title = document.querySelector(".product-info h1");
    if (!title) return null;
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    return {
      id: productIdFromUrl(canonical) || location.pathname.split("/").filter(Boolean).pop(),
      name: title.textContent.trim(),
      price: document.querySelector(".product-info .current-price")?.textContent.trim() || "",
      image: document.querySelector("#productMainImage,.product-gallery-main img")?.src || "",
      url: canonical,
    };
  };
  const productFromCard = card => {
    const link = card.querySelector('a[href*="/products/"]');
    const inlineOpen = card.querySelector("[onclick*='openProduct']")?.getAttribute("onclick") || "";
    const id = productIdFromUrl(link?.href) || inlineOpen.match(/openProduct\(['"]([^'"]+)/)?.[1] || "";
    const catalogProduct = window.SITE_DATA?.products?.find(product => product.id === id);
    return {
      id,
      name: catalogProduct?.name || card.querySelector(".name,h2")?.textContent.trim() || id,
      price: catalogProduct?.price || card.querySelector(".price,.current-price")?.textContent.trim() || "",
      image: catalogProduct?.image || card.querySelector("img")?.src || "",
      url: link?.href || `${location.origin}/products/${id}/`,
    };
  };

  function ensureModal() {
    if (document.getElementById("tsOrderModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <div class="ts-order-modal" id="tsOrderModal" hidden>
        <section class="ts-order-dialog" role="dialog" aria-modal="true" aria-labelledby="tsOrderTitle">
          <header class="ts-order-head">
            <h2 id="tsOrderTitle">TEAMSPIRIT 주문하기</h2>
            <button class="ts-order-close" type="button" aria-label="닫기">×</button>
          </header>
          <div class="ts-order-body" id="tsOrderBody"></div>
          <footer class="ts-order-actions" id="tsOrderActions"></footer>
        </section>
      </div>`);
    const modal = document.getElementById("tsOrderModal");
    modal.querySelector(".ts-order-close").addEventListener("click", closeModal);
    modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  function progress(step) {
    return `<div class="ts-order-progress"><span class="${step === 1 ? "active" : ""}">1. 상품 옵션</span><span class="${step === 2 ? "active" : ""}">2. 배송 정보</span></div>`;
  }

  function renderStepOne() {
    currentStep = 1;
    const body = document.getElementById("tsOrderBody");
    const existingSize = document.querySelector(".product-size.active")?.dataset.size || "";
    body.innerHTML = `${progress(1)}
      <div class="ts-order-product">
        <img src="${escapeHtml(selectedProduct.image)}" alt="">
        <div><strong>${escapeHtml(selectedProduct.name)}</strong><span>${escapeHtml(selectedProduct.price || "가격 문의")}</span></div>
      </div>
      <div class="ts-order-grid">
        <div class="ts-order-field"><label for="tsSize">사이즈 *</label><select id="tsSize" required><option value="">사이즈 선택</option>${sizes.map(size => `<option ${size === existingSize ? "selected" : ""}>${escapeHtml(size)}</option>`).join("")}</select></div>
        <div class="ts-order-field"><label for="tsColor">색상 *</label><select id="tsColor" required><option value="">색상 선택</option>${colors.map(color => `<option>${escapeHtml(color)}</option>`).join("")}</select></div>
        <div class="ts-order-field"><label for="tsQuantity">수량 *</label><input id="tsQuantity" type="number" min="1" max="999" value="${escapeHtml(document.getElementById("productQuantity")?.value || 1)}" inputmode="numeric" required></div>
        <div class="ts-order-field"><label for="tsJerseyNumber">등번호</label><input id="tsJerseyNumber" maxlength="3" placeholder="예: 10"></div>
        <div class="ts-order-field"><label for="tsPrintName">마킹 이름</label><input id="tsPrintName" maxlength="30" placeholder="예: MINH"></div>
        <div class="ts-order-field full"><label for="tsDesignRequest">제작·연락 요청사항</label><textarea id="tsDesignRequest" maxlength="1000" placeholder="팀 로고, 배색, 카라 형태, 희망 수령일 또는 연락 가능한 시간을 입력해 주세요."></textarea></div>
      </div>
      <p class="ts-order-note">제작 전 TEAMSPIRIT 담당자가 디자인, 최종 금액과 제작 일정을 확인해 드립니다.</p>
      <p class="ts-order-status" id="tsOrderStatus" role="status" aria-live="polite"></p>`;
    document.getElementById("tsOrderActions").innerHTML = `<button class="ts-order-secondary" type="button" data-action="cancel">취소</button><button class="ts-order-primary" type="button" data-action="continue">주문 계속하기</button>`;
    bindActions();
  }

  function collectStepOne() {
    const size = document.getElementById("tsSize").value;
    const color = document.getElementById("tsColor").value;
    const quantity = Math.max(1, Math.min(999, Number(document.getElementById("tsQuantity").value) || 0));
    if (!size || !color || !quantity) {
      document.getElementById("tsOrderStatus").textContent = "사이즈, 색상과 수량을 선택해 주세요.";
      return false;
    }
    selectedProduct = {
      ...selectedProduct,
      size,
      color,
      quantity,
      printName: document.getElementById("tsPrintName").value.trim(),
      jerseyNumber: document.getElementById("tsJerseyNumber").value.trim(),
      designRequest: document.getElementById("tsDesignRequest").value.trim(),
      unitPrice: numericPrice(selectedProduct.price),
    };
    return true;
  }

  function renderStepTwo() {
    if (!collectStepOne()) return;
    currentStep = 2;
    document.getElementById("tsOrderBody").innerHTML = `${progress(2)}
      <div class="ts-order-product">
        <img src="${escapeHtml(selectedProduct.image)}" alt="">
        <div><strong>${escapeHtml(selectedProduct.name)}</strong><span>${escapeHtml(selectedProduct.size)} · ${escapeHtml(selectedProduct.color)} · ${selectedProduct.quantity}개</span></div>
      </div>
      <div class="ts-order-grid">
        <div class="ts-order-field"><label for="tsCustomerName">주문자 이름 *</label><input id="tsCustomerName" autocomplete="name" maxlength="80" required></div>
        <div class="ts-order-field"><label for="tsPhone">전화번호 *</label><input id="tsPhone" type="tel" autocomplete="tel" inputmode="tel" maxlength="24" placeholder="010-0000-0000" required></div>
        <div class="ts-order-field full"><label for="tsAddress">배송 주소 *</label><textarea id="tsAddress" autocomplete="street-address" maxlength="300" required></textarea></div>
        <div class="ts-order-field"><label for="tsContactChannel">희망 연락 채널 *</label><select id="tsContactChannel" required>${contacts.map(channel => `<option>${escapeHtml(channel)}</option>`).join("")}</select></div>
        <div class="ts-order-field"><label for="tsContactTime">연락 가능 시간</label><input id="tsContactTime" maxlength="80" placeholder="예: 18:00–21:00"></div>
      </div>
      <p class="ts-order-status" id="tsOrderStatus" role="status" aria-live="polite"></p>`;
    document.getElementById("tsOrderActions").innerHTML = `<button class="ts-order-secondary" type="button" data-action="back">이전</button><button class="ts-order-primary" type="button" data-action="submit">주문 확정</button>`;
    bindActions();
  }

  function validateCustomer() {
    const name = document.getElementById("tsCustomerName").value.trim();
    const phone = document.getElementById("tsPhone").value.trim();
    const address = document.getElementById("tsAddress").value.trim();
    if (name.length < 2 || !/[\d]{8,}/.test(phone.replace(/\D/g, "")) || address.length < 8) {
      document.getElementById("tsOrderStatus").textContent = "이름, 올바른 전화번호와 배송 주소를 입력해 주세요.";
      return null;
    }
    return {
      name,
      phone,
      address,
      contactChannel: document.getElementById("tsContactChannel").value,
      contactTime: document.getElementById("tsContactTime").value.trim(),
    };
  }

  async function submitOrder(button) {
    const customer = validateCustomer();
    if (!customer) return;
    const endpoint = String(config.endpoint || "").trim();
    if (!endpoint || !/^https:\/\/script\.google\.com\//.test(endpoint)) {
      document.getElementById("tsOrderStatus").innerHTML = `온라인 주문 접수가 아직 활성화되지 않았습니다. Google Sheet 연동을 완료해 주세요.`;
      return;
    }
    button.disabled = true;
    button.textContent = "전송 중...";
    const orderId = `TS-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().slice(0,6)}`;
    const payload = {
      orderId,
      submittedAt: new Date().toISOString(),
      customer,
      items: [{
        ...selectedProduct,
        lineTotal: selectedProduct.unitPrice * selectedProduct.quantity,
      }],
      source: "Website",
      pageUrl: location.href,
      userAgent: navigator.userAgent,
    };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || "주문을 저장할 수 없습니다");
      document.getElementById("tsOrderBody").innerHTML = `<div class="ts-order-success"><div class="ts-order-success-mark">✓</div><h3>주문이 접수되었습니다</h3><p>주문번호는 <strong>${escapeHtml(orderId)}</strong>입니다.<br>TEAMSPIRIT 담당자가 디자인과 배송 정보를 확인하기 위해 연락드리겠습니다.</p></div>`;
      document.getElementById("tsOrderActions").innerHTML = `<button class="ts-order-primary" type="button" data-action="done">완료</button>`;
      bindActions();
    } catch (error) {
      document.getElementById("tsOrderStatus").textContent = `주문을 전송하지 못했습니다: ${error.message}. 다시 시도하거나 KakaoTalk으로 문의해 주세요.`;
      button.disabled = false;
      button.textContent = "주문 확정";
    }
  }

  function bindActions() {
    document.getElementById("tsOrderActions").querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.dataset.action === "cancel" || button.dataset.action === "done") closeModal();
        if (button.dataset.action === "continue") renderStepTwo();
        if (button.dataset.action === "back") renderStepOne();
        if (button.dataset.action === "submit") submitOrder(button);
      });
    });
  }

  function openModal(product) {
    if (!product?.id) return;
    ensureModal();
    selectedProduct = product;
    document.getElementById("tsOrderModal").hidden = false;
    document.body.style.overflow = "hidden";
    renderStepOne();
  }

  function closeModal() {
    const modal = document.getElementById("tsOrderModal");
    if (modal) modal.hidden = true;
    document.body.style.overflow = "";
  }

  function enhanceProducts() {
    const detailProduct = currentProduct();
    const productInfo = document.querySelector(".product-info");
    if (detailProduct && productInfo && !productInfo.querySelector(".ts-order-button")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ts-order-button";
      button.textContent = "바로 주문하기";
      button.addEventListener("click", () => openModal(currentProduct()));
      const actions = productInfo.querySelector(".contact-order-actions");
      productInfo.insertBefore(button, actions || null);
    }
    document.querySelectorAll(".card,.product-card").forEach(card => {
      if (card.querySelector(".ts-order-button")) return;
      const product = productFromCard(card);
      if (!product.id) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ts-order-button";
      button.textContent = "주문하기";
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openModal(productFromCard(card));
      });
      card.appendChild(button);
    });
  }

  function init() {
    ensureModal();
    enhanceProducts();
    const observer = new MutationObserver(enhanceProducts);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
