(() => {
  const state = {
    loading: false,
    error: "",
    notice: "",
    pending: "",
    submitCodes: "",
    submitEmails: "",
    queryCodes: "",
    confirmOpen: false,
    confirmPairs: [],
    queryItems: [],
    activePanel: "submit",
  };

const API = {
  submit: "/api/activation-submit",
  query: "/api/activation-query",
};

  const el = {};

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function statusBadge(status) {
    const text = String(status || "").toLowerCase();
    let cls = "neutral";
    if (/(bound|used|ok|success|ready|completed)/.test(text)) cls = "ok";
    else if (/(queued|running|processing|pending)/.test(text)) cls = "warn";
    else if (/(fail|error|disabled|expired|used)/.test(text)) cls = "bad";
    return `<span class="badge ${cls}">${escapeHtml(status || "unknown")}</span>`;
  }

  function splitValues(rawText) {
    return String(rawText || "")
      .split(/[\r\n,]+/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  function normalizeCode(code) {
    return String(code || "").trim().replace(/[^A-Za-z0-9_-]+/g, "").toUpperCase();
  }

  function isValidBuyerEmail(email) {
    const value = String(email || "").trim();
    if (!value || value.length > 254) return false;
    if (value.includes("|") || /\s/.test(value)) return false;
    if ((value.match(/@/g) || []).length !== 1) return false;
    if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)) return false;
    const [localPart, domain] = value.split("@");
    if (!localPart || !domain) return false;
    if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) return false;
    if (domain.includes("..")) return false;
    const labels = domain.split(".");
    if (labels.length < 2) return false;
    return labels.every((label) => label && !label.startsWith("-") && !label.endsWith("-"));
  }

  function formatBeijingTime(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "-") return "-";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const parts = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  }

  function buyerStatusText(item) {
    const text = String(item?.status || "").toLowerCase();
    if (item?.invite_created || /(bound|used|completed|success)/.test(text)) return "已成功邀请至Team✅️";
    if (/queued/.test(text)) return "排队中";
    if (/(running|processing|pending)/.test(text)) return "处理中";
    if (/(fail|error|disabled|expired)/.test(text)) return "邀请失败";
    return "等待处理";
  }

  function buyerStatusBadge(item) {
    const label = buyerStatusText(item);
    const map = {
      "已成功邀请至Team✅️": "ok",
      "排队中": "warn",
      "处理中": "warn",
      "邀请失败": "bad",
      "等待处理": "neutral",
    };
    return `<span class="badge ${map[label] || "neutral"}">${escapeHtml(label)}</span>`;
  }

  function queuedBanner() {
    const queuedItems = state.queryItems.filter((item) => /queued/i.test(String(item?.status || "")));
    if (!queuedItems.length) return "";
    const queueTotal = queuedItems.reduce((max, item) => Math.max(max, Number(item?.queue_total || 0)), 0);
    const queueAhead = queuedItems.reduce((max, item) => Math.max(max, Number(item?.queue_ahead || 0)), 0);
    return `
      <div class="info-banner">
        当前请求较多，系统已进入排队。当前待处理约 ${queueTotal || queuedItems.length} 单，前方最多 ${queueAhead} 单，请 1 分钟后再次查询。
      </div>
    `;
  }

  function buyerNoteText(item) {
    if (item?.invite_created) return "请前往邮箱查收 ChatGPT Team 邀请邮件";
    const text = String(item?.status || "").toLowerCase();
    if (/queued/.test(text)) return "当前请求较多，系统已进入排队，请 1 分钟后再次查询";
    if (/(running|processing|pending)/.test(text)) return "系统正在处理，请 1 分钟后再次查询";
    if (/(fail|error|disabled|expired)/.test(text)) return "邀请失败，当前网络环境异常，请 1 分钟后重试";
    return "等待处理，请 1 分钟后再次查询";
  }

  function buildRateLimitMessage(response, data, fallback) {
    const retryAfter = Number(response?.headers?.get("Retry-After") || data?.retry_after || 0);
    if (retryAfter > 0) {
      return `${fallback} 请在 ${retryAfter} 秒后再试。`;
    }
    return fallback;
  }

  function buildPairs() {
    const codes = splitValues(state.submitCodes);
    const emails = splitValues(state.submitEmails);
    if (!codes.length) throw new Error("请至少输入一个卡号");
    if (!emails.length) throw new Error("请至少输入一个已注册 ChatGPT 的邮箱");
    if (codes.length !== emails.length) {
      throw new Error(`卡号数量与邮箱数量不一致：卡号 ${codes.length} 个，邮箱 ${emails.length} 个`);
    }
    return codes.map((code, index) => ({
      activation_code: normalizeCode(code),
      target_email: String(emails[index] || "").trim(),
    })).map((item, index) => {
      if (!item.activation_code) {
        throw new Error(`第 ${index + 1} 行卡号为空或格式无效`);
      }
      if (!isValidBuyerEmail(item.target_email)) {
        throw new Error(`第 ${index + 1} 行邮箱格式错误，请输入正确的已注册 ChatGPT 邮箱`);
      }
      return item;
    });
  }

  function renderQueryResults() {
    if (!state.queryItems.length) {
      return `<div class="empty-state">请输入卡号后查询处理进度。</div>`;
    }
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>卡号</th>
              <th>ChatGPT 邮箱</th>
              <th>当前状态</th>
              <th>最近更新时间</th>
              <th>处理说明</th>
            </tr>
          </thead>
          <tbody>
            ${state.queryItems.map((item) => `
              <tr>
                <td><strong>${escapeHtml(item.activation_code || "-")}</strong></td>
                <td class="cell-wrap"><strong>${escapeHtml(item.target_email || "-")}</strong></td>
                <td class="cell-status">${buyerStatusBadge(item)}</td>
                <td class="mono">${escapeHtml(formatBeijingTime(item.finished_at || item.updated_at || item.created_at || "-"))}</td>
                <td class="cell-wrap">${escapeHtml(buyerNoteText(item))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function confirmModal() {
    if (!state.confirmOpen) return "";
    return `
        <div class="activate-modal-backdrop" data-close-confirm="1">
        <div class="activate-modal" role="dialog" aria-modal="true">
          <div class="section-head">
            <div>
              <div class="section-badge">CONFIRM</div>
              <h2>请再次确认激活信息</h2>
              <p>请确认卡号与已注册 ChatGPT 邮箱一一对应。确认提交后，系统会立即开始处理。</p>
            </div>
            <div class="section-actions">
              <button class="btn btn-soft btn-small" data-action="close-confirm">返回修改</button>
              <button class="btn btn-primary btn-small" data-action="submit-confirmed" ${state.pending ? "disabled" : ""}>${state.pending === "submit" ? "提交中..." : "确认无误，立即提交"}</button>
            </div>
          </div>
          <div class="confirm-preview-list">
            ${state.confirmPairs.map((item, index) => `
              <div class="confirm-preview-item">
                <small>邮箱 ${index + 1}</small>
                <strong>${escapeHtml(item.target_email)}</strong>
              </div>
            `).join("")}
          </div>
          <div class="confirm-note">请重点核对邮箱是否与卡号一一对应。卡号提交后会立即进入处理流程。</div>
        </div>
      </div>
    `;
  }

  function activateTabs() {
    return `
      <div class="activate-tabs" role="tablist" aria-label="激活功能切换">
        <button class="activate-tab ${state.activePanel === "submit" ? "active" : ""}" type="button" data-action="switch-submit">提交激活</button>
        <button class="activate-tab ${state.activePanel === "query" ? "active" : ""}" type="button" data-action="switch-query">查询进度</button>
      </div>
    `;
  }

  function render() {
    if (!el.app) return;
    el.app.innerHTML = `
      <main>
        <section class="hero activate-hero">
          <div class="hero-top">
            <div class="hero-title">
              <p class="eyebrow">ACTIVATE</p>
              <h1>卡号激活与进度查询</h1>
              <p>请输入你购买到的卡号，以及已经注册过 ChatGPT 的邮箱。支持多行提交，一行一个卡号，对应一行一个邮箱；提交前会再次确认，避免输错。</p>
            </div>
          </div>
        </section>
        ${activateTabs()}
        ${state.error ? `<div class="error-banner">${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="success-banner">${escapeHtml(state.notice)}</div>` : ""}
        <div class="activate-layout">
          <section class="section-card ${state.activePanel === "submit" ? "activate-panel-active" : "activate-panel-inactive"}" data-panel="submit">
            <div class="section-head">
              <div>
                <h2>提交激活申请</h2>
                <p>一行一个卡号，对应一行一个已经注册过 ChatGPT 的邮箱。数量必须一致，提交前请认真核对。</p>
              </div>
              <div class="section-actions">
                <button class="btn btn-primary" data-action="prepare-submit" ${state.pending ? "disabled" : ""}>提交激活</button>
              </div>
            </div>
            <div class="activate-form-grid">
              <label class="textarea-field">
                <span>请输入卡号</span>
                <textarea id="activate-submit-codes" placeholder="一行一个卡号">${escapeHtml(state.submitCodes)}</textarea>
                <small class="field-hint">提交后请勿连续重复点击。若页面提示处理中，等待约 1 分钟后再查询即可。</small>
              </label>
              <label class="textarea-field">
                <span>请输入已经注册的 ChatGPT 账号</span>
                <textarea id="activate-submit-emails" placeholder="一行一个已注册的 ChatGPT 邮箱">${escapeHtml(state.submitEmails)}</textarea>
                <small class="field-hint">请确认邮箱已注册过 ChatGPT，且每个卡号与每个邮箱一一对应。</small>
              </label>
            </div>
          </section>
          <section class="section-card ${state.activePanel === "query" ? "activate-panel-active" : "activate-panel-inactive"}" data-panel="query">
            <div class="section-head">
              <div>
                <h2>查询处理进度</h2>
                <p>仅支持按卡号查询。若显示邀请失败，请等待 1 分钟后重新查询或重新提交。</p>
              </div>
              <div class="section-actions">
                <button class="btn btn-soft" data-action="query-activation" ${state.pending ? "disabled" : ""}>查询</button>
              </div>
            </div>
            <label class="textarea-field">
              <span>请输入卡号</span>
              <textarea id="activate-query-codes" placeholder="一行一个卡号">${escapeHtml(state.queryCodes)}</textarea>
              <small class="field-hint">查询建议每 5 到 10 秒操作一次。连续频繁查询会被系统临时限速。</small>
            </label>
            ${queuedBanner()}
            ${renderQueryResults()}
          </section>
        </div>
        <section class="section-card activate-support">
          <div class="activate-support-grid">
            <button class="support-contact-card" type="button" data-action="support-qq">
              <span class="support-contact-label">售后QQ群</span>
              <strong>1072653807</strong>
              <div class="support-agent-actions">
                <span class="support-agent-btn support-service-btn">立即加入售后群 QQ：1072653807</span>
              </div>
              <p class="support-card-note">正常闲鱼人工在线时间是 10:30 到 22:30。若长时间未收到邀请、查询结果异常，或要人工协助，还可以加售后群联系管理员处理。</p>
            </button>
            <button class="support-contact-card support-card-agent" type="button" data-action="agent-qq">
              <span class="support-contact-label">渠道合作 QQ</span>
              <h3 class="support-agent-title">诚招代理与批发</h3>
              <div class="support-agent-actions">
                <span class="support-agent-btn">立即咨询代理合作 QQ：191176548</span>
              </div>
              <p class="support-agent-copy">想在闲鱼卖码赚差价？或有大量 Codex / 团队使用需求？欢迎合作，量大拿货享专属低价。</p>
            </button>
          </div>
        </section>
        ${confirmModal()}
      </main>
    `;
    bindEvents();
  }

  function bindEvents() {
    document.querySelectorAll("[data-action]").forEach((btn) => {
      if (btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener("click", onActionClick);
    });
    document.querySelectorAll("[data-close-confirm]").forEach((node) => {
      if (node.__bound) return;
      node.__bound = true;
      node.addEventListener("click", (event) => {
        if (event.target !== node) return;
        state.confirmOpen = false;
        render();
      });
    });
    [["activate-submit-codes", "submitCodes"], ["activate-submit-emails", "submitEmails"], ["activate-query-codes", "queryCodes"]].forEach(([id, key]) => {
      const node = document.getElementById(id);
      if (!node || node.__bound) return;
      node.__bound = true;
      node.addEventListener("input", (event) => {
        state[key] = String(event.target?.value || "");
      });
    });
  }

  async function onActionClick(event) {
    const action = event.currentTarget?.getAttribute("data-action");
    if (!action) return;
    if (action === "prepare-submit") {
      try {
        state.error = "";
        state.notice = "";
        state.confirmPairs = buildPairs();
        state.confirmOpen = true;
        render();
      } catch (err) {
        state.error = err?.message || String(err);
        render();
      }
      return;
    }
    if (action === "switch-submit") {
      state.activePanel = "submit";
      render();
      return;
    }
    if (action === "switch-query") {
      state.activePanel = "query";
      render();
      return;
    }
    if (action === "close-confirm") {
      state.confirmOpen = false;
      render();
      return;
    }
    if (action === "submit-confirmed") {
      await submitPairs();
      return;
    }
    if (action === "query-activation") {
      await queryOrders();
      return;
    }
    if (action === "support-qq") {
      await openSupportQq();
      return;
    }
    if (action === "agent-qq") {
      await openAgentQq();
    }
  }

  async function openSupportQq() {
    const qqNumber = "1072653807";
    const qqUrl = "https://qun.qq.com/universal-share/share?ac=1&authKey=MxVj0%2BYRlbZif%2BT8xyW%2BBkIm/nocEgdCSvF2ThCgc16uARN5FXqI6ErDB5bV8bdv&busi_data=eyJncm91cENvZGUiOiIxMDcyNjUzODA3IiwidG9rZW4iOiJId2RVaE5LMzBlNE1MVlAxOWQ1K2JiREdJNTNsWWY2d0pWdEYxVkw2Y091Ryt5LzAvSFR4WVVxQWx5cmNPOWFFIiwidWluIjoiMTkxMTc2NTQ4In0=&data=UYPqeLIPTd6GyJoCSVv7K30S_fiMZXySSLtL5DLr_YpTOSSSw2Q5VeduRH_-rYd6wj7-95lphFhQhB_cBSUUDw&svctype=4&tempid=h5_group_info";
    state.error = "";
    state.notice = "";
    try {
      await copyTextToClipboard(qqNumber);
      state.notice = `已复制售后QQ群号：${qqNumber}`;
    } catch {
      state.notice = `售后QQ群号：${qqNumber}`;
    }
    render();
    window.open(qqUrl, "_blank", "noopener,noreferrer");
  }

  async function openAgentQq() {
    const qqNumber = "191176548";
    const qqUrl = "https://qm.qq.com/q/WsLF7F9awO";
    state.error = "";
    state.notice = "";
    try {
      await copyTextToClipboard(qqNumber);
      state.notice = `已复制渠道合作 QQ：${qqNumber}`;
    } catch {
      state.notice = `渠道合作 QQ：${qqNumber}`;
    }
    render();
    window.open(qqUrl, "_blank", "noopener,noreferrer");
  }

async function submitPairs() {
  state.pending = "submit";
  state.error = "";
  state.notice = "";
  render();
  try {
    // 调用原站提交接口
    const response = await fetch("https://activate.xile.indevs.in/api/public/activation-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bulk_activation_codes: state.confirmPairs.map((item) => item.activation_code).join("\n"),
        bulk_target_emails: state.confirmPairs.map((item) => item.target_email).join("\n"),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("提交过于频繁，请稍后再试。");
      }
      throw new Error(data?.detail || `提交失败 (${response.status})`);
    }

    // 提交成功后生成“处理中”条目，保持原表格风格
    state.confirmPairs.forEach((item) => {
      const exists = state.queryItems.find(
        (q) => q.activation_code === item.activation_code && q.target_email === item.target_email
      );
      if (!exists) {
        state.queryItems.push({
          activation_code: item.activation_code,
          target_email: item.target_email,
          status: "processing",             // 显示“处理中”
          finished_at: null,
          updated_at: new Date().toISOString(),
        });
      }
    });

    state.notice = `提交成功，系统已开始处理 ${data.count || state.confirmPairs.length} 条卡号申请。`;
    state.confirmOpen = false;

    // 渲染表格保持页面风格和样式
    render();

    // 提交完成后再调用查询接口刷新真实状态
    await queryOrders();

  } catch (err) {
    state.error = err?.message || String(err);
    render();
  } finally {
    state.pending = "";
    render();
  }
}

  async function queryOrders() {
    state.pending = "query";
    state.error = "";
    state.notice = "";
    render();
    try {
      const response = await fetch(API.query, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bulk_activation_codes: state.queryCodes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(buildRateLimitMessage(response, data, "查询过于频繁。"));
        }
        throw new Error(data?.detail || `查询失败 (${response.status})`);
      }
      state.queryItems = Array.isArray(data.items) ? data.items : [];
      if (!state.queryItems.length) {
        state.notice = "未查询到匹配记录。";
      }
    } catch (err) {
      state.error = err?.message || String(err);
    } finally {
      state.pending = "";
      render();
    }
  }

  function init() {
    el.app = document.getElementById("activate-app");
    render();
  }

  init();
})();
