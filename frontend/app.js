/**
 * AuraFlow Tech (auraflowtech.lat) — Interactive Frontend Client
 * Fundado por el Ing. Santiago Delgado Leiva · Zona Sur, Costa Rica
 * Connects to Python + SQLite REST API:
 * - /api/metrics, /api/subdomains, /api/facturas, /api/terminal
 * - /api/workflows, /api/workflows/simulate, /api/executions
 * - /api/roi-calculator, /api/wabot-chat, /api/sso/send-code, /api/sso/verify
 * - /api/loyalty, /api/leads
 */

let state = {
  workflows: [],
  activeWorkflowId: 1,
  currentFactura: null,
  lastRoi: {
    annual_savings_usd: 10600,
    recommended_plan: "Plan PYME Pro (WaBot IA + Factura CR v4.4)"
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([
    loadMetrics(),
    loadSubdomains(),
    loadFacturas(),
    loadWorkflows(),
    loadExecutions(),
    loadLoyalty(),
    loadLeads(),
    loadWabotStatus(),
    runTerminalCmd("--status")
  ]);
  updateRoiCalculator();
  setInterval(loadWabotStatus, 5000);

  const host = window.location.hostname;
  const params = new URLSearchParams(window.location.search);
  const pageParam = params.get("page");

  if (pageParam) {
    showPage(pageParam, false);
  } else if (host.startsWith("bot.")) {
    showPage("bot", false);
  } else if (host.startsWith("fac.") || host.startsWith("pos.")) {
    showPage("fac", false);
  } else if (host.startsWith("crm.")) {
    showPage("crm", false);
  } else if (host.startsWith("id.") || host.startsWith("admin.")) {
    showPage("cloud", false);
    openSsoModal();
  } else if (host.startsWith("builder.") || host.startsWith("openclaw.") || host.startsWith("api.")) {
    showPage("builder", false);
  } else if (host.startsWith("clinica.")) {
    showPage("sectores", false);
  } else if (host.startsWith("club.") || host.startsWith("demo.")) {
    showPage("roi", false);
  } else if (host.startsWith("status.") || host.startsWith("cdn.")) {
    showPage("cloud", false);
  } else {
    showPage("home", false);
  }
});

function showPage(page, updateHistory = true) {
  const allSections = {
    hero: document.querySelector("section.hero"),
    metrics: document.querySelector(".metrics-strip"),
    fac: document.getElementById("facturador-v44"),
    builder: document.getElementById("builder"),
    roi: document.getElementById("calculadora-roi"),
    bot: document.getElementById("auraflow-bot"),
    sectores: document.getElementById("sectores-cr"),
    cloud: document.getElementById("ecosistema-cloud"),
    planes: document.getElementById("planes"),
    faq: document.getElementById("faq"),
    crm: document.getElementById("cotizar")
  };

  // Ocultar todo primero
  Object.values(allSections).forEach(el => {
    if (el) el.style.display = "none";
  });

  // Mostrar solo las secciones de la página activa
  if (page === "home") {
    if (allSections.hero) allSections.hero.style.display = "";
    if (allSections.metrics) allSections.metrics.style.display = "";
  } else if (allSections[page]) {
    allSections[page].style.display = "";
  } else {
    if (allSections.hero) allSections.hero.style.display = "";
    if (allSections.metrics) allSections.metrics.style.display = "";
  }

  // Resaltar pestaña activa en el navbar
  document.querySelectorAll(".nav-links a[data-nav]").forEach(a => {
    const isAct = a.getAttribute("data-nav") === page;
    a.style.borderBottom = isAct ? "2px solid #22d3ee" : "none";
    a.style.paddingBottom = isAct ? "4px" : "0";
  });

  if (updateHistory) {
    const url = page === "home" ? window.location.pathname : `?page=${page}`;
    window.history.pushState({ page }, "", url);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.addEventListener("popstate", (e) => {
  const page = (e.state && e.state.page) || new URLSearchParams(window.location.search).get("page") || "home";
  showPage(page, false);
});

async function loadMetrics() {
  try {
    const res = await fetch("/api/metrics");
    const data = await res.json();

    const runsEl = document.getElementById("metric-runs");
    if (runsEl) {
      runsEl.textContent = Number(data.total_runs + (data.facturas_v44_count || 0)).toLocaleString("en-US");
    }
    const subsEl = document.getElementById("metric-subdomains");
    if (subsEl) {
      subsEl.textContent = `${data.active_subdomains || 16} / 16`;
    }
    const savEl = document.getElementById("metric-savings");
    if (savEl && data.estimated_cost_saved_crc) {
      const millions = (data.estimated_cost_saved_crc / 1000000).toFixed(1);
      savEl.textContent = `₡${millions}M`;
    }
    const hrsEl = document.getElementById("metric-hours");
    if (hrsEl) {
      hrsEl.textContent = `${Number(data.total_hours_saved).toLocaleString("en-US")} hrs ahorradas`;
    }
  } catch (err) {
    console.error("Error loading metrics:", err);
  }
}

async function runTerminalCmd(cmd, btnEl = null) {
  if (btnEl) {
    document.querySelectorAll(".cli-btn").forEach(b => b.classList.remove("active"));
    btnEl.classList.add("active");
  }
  try {
    const res = await fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();
    const out = document.getElementById("cli-output");
    if (!out) return;

    out.innerHTML = `
      <div class="cli-line"><span class="cli-prompt">${data.command}</span></div>
      ${(data.output || []).map(line => `<div class="cli-line">${line}</div>`).join("")}
    `;
  } catch (err) {
    console.error("Terminal error:", err);
  }
}

async function loadSubdomains() {
  try {
    const res = await fetch("/api/subdomains");
    const data = await res.json();
    const container = document.getElementById("subdomains-container");
    if (!container) return;

    const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const badgeStyle = {
      ONLINE: "",
      LENTO: "background:rgba(234,179,8,.14);color:#facc15;border-color:rgba(234,179,8,.4);",
      OFFLINE: "background:rgba(239,68,68,.14);color:#f87171;border-color:rgba(239,68,68,.4);",
      VERIFICANDO: "background:rgba(148,163,184,.12);color:#cbd5e1;border-color:rgba(148,163,184,.3);",
    };

    container.innerHTML = (data.subdomains || []).map(s => `
      <a class="subdomain-card" href="https://${esc(s.subdomain)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;" title="${s.checked_at ? "Verificado " + esc(s.checked_at.replace("T", " ")) : "Verificando…"}">
        <div class="sub-top">
          <span class="sub-host">${esc(s.subdomain)} ↗</span>
          <span class="sub-badge" style="${badgeStyle[s.status] || ""}">● ${esc(s.status)}${s.latency_ms != null ? " · " + s.latency_ms + "ms" : ""}</span>
        </div>
        <div class="sub-name">${esc(s.name)}</div>
        <div class="sub-desc">${esc(s.description)}</div>
      </a>
    `).join("");

    const subsEl = document.getElementById("metric-subdomains");
    if (subsEl && data.total) subsEl.textContent = `${data.online} / ${data.total}`;
  } catch (err) {
    console.error("Error loading subdomains:", err);
  }
}
setInterval(loadSubdomains, 60000);

function syncCabysPreset() {
  const sel = document.getElementById("fac-cabys");
  if (!sel) return;
  const parts = sel.value.split("|");
  if (parts.length >= 4) {
    document.getElementById("fac-detalle").value = parts[1];
    document.getElementById("fac-iva").value = parts[2];
    document.getElementById("fac-precio").value = parts[3];
  }
}

async function loadFacturas() {
  try {
    const res = await fetch("/api/facturas");
    const data = await res.json();
    const facturas = data.facturas || [];
    if (facturas.length > 0) {
      renderFacturaDetail(facturas[0]);
    }
    const listEl = document.getElementById("facturas-history-list");
    if (listEl) {
      listEl.innerHTML = facturas.slice(0, 6).map(f => `
        <div class="log-line" style="cursor:pointer;" onclick=' selectFacturaById(${f.id}) '>
          <span class="log-ok">✓ [${f.tipo_doc}] ${f.cliente_nombre}</span>
          <span class="log-ms">₡${Number(f.total).toLocaleString("en-US")} · Clave ${f.clave_50.slice(0, 10)}...</span>
        </div>
      `).join("");
    }
    window._cachedFacturas = facturas;
  } catch (err) {
    console.error("Error loading facturas:", err);
  }
}

function selectFacturaById(id) {
  const found = (window._cachedFacturas || []).find(f => f.id === id);
  if (found) renderFacturaDetail(found);
}

function renderFacturaDetail(f) {
  state.currentFactura = f;
  document.getElementById("live-consecutivo").textContent = `CONSECUTIVO: ${f.consecutivo_20}`;
  document.getElementById("live-clave-50").textContent = f.clave_50;
  document.getElementById("live-fac-sub").textContent = `₡${Number(f.subtotal).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  document.getElementById("live-fac-iva").textContent = `₡${Number(f.monto_iva).toLocaleString("en-US", { minimumFractionDigits: 2 })} (${f.tarifa_iva}%)`;
  document.getElementById("live-fac-total").textContent = `₡${Number(f.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  document.getElementById("live-xml-box").textContent = f.xml_payload;
}

async function emitirFacturaV44(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-emitir-fac");
  btn.disabled = true;
  btn.textContent = "⏳ Firmando XAdES-EPES y enviando a Hacienda CR...";

  const cabysRaw = document.getElementById("fac-cabys").value.split("|")[0];
  const payload = {
    tipo_doc: document.getElementById("fac-tipo").value,
    cliente_cedula: document.getElementById("fac-cedula").value,
    cliente_nombre: document.getElementById("fac-nombre").value,
    cliente_correo: document.getElementById("fac-correo").value,
    cabys_codigo: cabysRaw,
    descripcion: document.getElementById("fac-detalle").value,
    cantidad: parseFloat(document.getElementById("fac-cant").value || "1"),
    precio_unitario: parseFloat(document.getElementById("fac-precio").value || "49500"),
    tarifa_iva: parseFloat(document.getElementById("fac-iva").value || "13"),
    moneda: "CRC"
  };

  try {
    const res = await fetch("/api/facturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.factura) {
      renderFacturaDetail(data.factura);
      await Promise.all([loadFacturas(), loadMetrics(), loadExecutions()]);
    }
  } catch (err) {
    console.error("Error emitting invoice:", err);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Firmar y Emitir en Hacienda CR v4.4 (Clave 50 Dígitos)";
  }
}

function downloadCurrentXml() {
  if (!state.currentFactura) return;
  const blob = new Blob([state.currentFactura.xml_payload], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Factura_CR_v44_${state.currentFactura.clave_50}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function loadWorkflows() {
  try {
    const res = await fetch("/api/workflows");
    const data = await res.json();
    state.workflows = data.workflows || [];
    if (state.workflows.length > 0 && !state.workflows.find(w => w.id === state.activeWorkflowId)) {
      state.activeWorkflowId = state.workflows[0].id;
    }
    renderWorkflowList();
    renderActiveWorkflowCanvas();
  } catch (err) {
    console.error("Error loading workflows:", err);
  }
}

function renderWorkflowList() {
  const list = document.getElementById("workflow-list");
  if (!list) return;
  list.innerHTML = state.workflows.map(wf => `
    <div class="wf-item ${wf.id === state.activeWorkflowId ? "active" : ""}" onclick="selectWorkflow(${wf.id})">
      <div class="wf-item-top">
        <span>${wf.category}</span>
        <span>${wf.runs_count} ejecuciones</span>
      </div>
      <h4>${wf.name}</h4>
    </div>
  `).join("");
}

function selectWorkflow(id) {
  state.activeWorkflowId = id;
  renderWorkflowList();
  renderActiveWorkflowCanvas();
}

function renderActiveWorkflowCanvas() {
  const wf = state.workflows.find(w => w.id === state.activeWorkflowId);
  if (!wf) return;

  document.getElementById("active-wf-category").textContent = wf.category;
  document.getElementById("active-wf-title").textContent = wf.name;
  document.getElementById("active-wf-desc").textContent = wf.description;
  document.getElementById("active-wf-stats").textContent = `${wf.avg_duration_ms} ms · ${wf.success_rate}% SLA`;

  const container = document.getElementById("canvas-nodes");
  container.innerHTML = wf.nodes.map((n, i) => `
    <div class="flow-node-box" id="flow-node-${i + 1}">
      <span class="step-tag">NODO 0${i + 1} · ${n.type.toUpperCase()}</span>
      <h5>${n.name}</h5>
      <p>${n.detail}</p>
    </div>
  `).join("");
}

async function runWorkflowSimulation() {
  const btn = document.getElementById("btn-run-sim");
  const payloadInput = document.getElementById("sim-payload-input");
  const terminal = document.getElementById("execution-terminal");

  btn.disabled = true;
  btn.textContent = "⏳ Ejecutando Nodos...";

  document.querySelectorAll(".flow-node-box").forEach(el => {
    el.classList.remove("running", "done");
  });

  try {
    const res = await fetch("/api/workflows/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_id: state.activeWorkflowId,
        payload: payloadInput.value
      })
    });
    const data = await res.json();
    const exec = data.execution;

    terminal.innerHTML = `<div class="log-line"><span style="color:#a78bfa;">[AURAFLOW-BUILDER] Iniciando ejecución #${exec.id}: ${exec.workflow_name}</span><span>0 ms</span></div>`;

    for (let i = 0; i < exec.steps_log.length; i++) {
      const step = exec.steps_log[i];
      const nodeEl = document.getElementById(`flow-node-${i + 1}`);
      if (nodeEl) nodeEl.classList.add("running");

      await new Promise(r => setTimeout(r, 220));

      if (nodeEl) {
        nodeEl.classList.remove("running");
        nodeEl.classList.add("done");
      }

      terminal.innerHTML += `
        <div class="log-line">
          <span class="log-ok">✓ [NODO 0${step.step}] ${step.node}: ${step.output}</span>
          <span class="log-ms">${step.ms} ms</span>
        </div>
      `;
      terminal.scrollTop = terminal.scrollHeight;
    }

    terminal.innerHTML += `
      <div class="log-line" style="border-top: 1px solid rgba(16,185,129,0.3); margin-top:4px; padding-top:6px;">
        <strong class="log-ok">★ FLUJO COMPLETADO SIN ERRORES · SINCRONIZADO EN SQLITE</strong>
        <strong class="log-ms">Total: ${exec.duration_ms} ms</strong>
      </div>
    `;

    await Promise.all([loadMetrics(), loadWorkflows()]);
  } catch (err) {
    console.error("Simulation error:", err);
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Simular Flujo en Vivo";
  }
}

async function loadExecutions() {
  try {
    const res = await fetch("/api/executions");
    const data = await res.json();
    const terminal = document.getElementById("execution-terminal");
    if (!terminal || !data.executions || data.executions.length === 0) return;

    const latest = data.executions[0];
    terminal.innerHTML = `
      <div class="log-line">
        <span style="color:#38bdf8;">[ÚLTIMA EJECUCIÓN #${latest.id}] ${latest.workflow_name}</span>
        <span class="log-ms">${latest.duration_ms} ms</span>
      </div>
      ${latest.steps_log.map((s, idx) => `
        <div class="log-line">
          <span class="log-ok">✓ [NODO 0${idx + 1}] ${s.node}: ${s.output}</span>
          <span class="log-ms">${s.ms} ms</span>
        </div>
      `).join("")}
    `;
  } catch (err) {
    console.error("Error loading executions:", err);
  }
}

async function loadLoyalty() {
  try {
    const res = await fetch("/api/loyalty");
    const data = await res.json();
    const el = document.getElementById("loyalty-list");
    if (!el) return;
    el.innerHTML = (data.members || []).map(m => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(148,163,184,0.1); font-size:0.78rem;">
        <div>
          <strong>${m.member_name}</strong> <span style="color:#38bdf8;">(${m.tier})</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-family:var(--font-mono); color:#10b981;">${m.points} pts</span>
          <button class="cli-btn" style="padding:2px 7px; font-size:0.7rem;" onclick="addLoyaltyPoints(${m.id})">+150 pts</button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Error loading loyalty:", err);
  }
}

async function addLoyaltyPoints(memberId) {
  try {
    await fetch("/api/loyalty/add-points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ member_id: memberId, points: 150 })
    });
    await loadLoyalty();
  } catch (err) {
    console.error("Error adding points:", err);
  }
}

async function updateRoiCalculator() {
  const msgsDay = parseInt(document.getElementById("input-team").value, 10);
  const facturasMonth = parseInt(document.getElementById("input-hours").value, 10);
  const hourlyCostCrc = parseInt(document.getElementById("input-cost").value, 10);

  document.getElementById("val-team").textContent = `${msgsDay} msgs / día`;
  document.getElementById("val-hours").textContent = `${facturasMonth} facturas / mes`;
  document.getElementById("val-cost").textContent = `₡${hourlyCostCrc.toLocaleString("en-US")} / hr`;

  try {
    const res = await fetch("/api/roi-calculator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whatsapp_msgs_day: msgsDay,
        facturas_month: facturasMonth,
        hourly_cost_crc: hourlyCostCrc
      })
    });
    const data = await res.json();
    state.lastRoi = data;

    document.getElementById("roi-monthly").textContent = `₡${Number(data.monthly_savings_crc).toLocaleString("en-US")} ($${data.monthly_savings_usd})`;
    document.getElementById("roi-annual").textContent = `₡${Number(data.annual_savings_crc).toLocaleString("en-US")}`;
    document.getElementById("roi-hours").textContent = `${data.monthly_saved_hours} hrs / mes`;
    document.getElementById("roi-payback").textContent = `${data.payback_weeks} sem (${data.roi_multiple}x ROI)`;
    document.getElementById("roi-plan").textContent = data.recommended_plan;
  } catch (err) {
    console.error("ROI error:", err);
  }
}

function formatMarkdown(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
    .replace(/_(.*?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code style="background:rgba(15,23,42,0.85);padding:2px 6px;border-radius:4px;color:#38bdf8;">$1</code>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color:#22d3ee;text-decoration:underline;">$1</a>')
    .replace(/\n/g, "<br>");
}

async function sendAiMessage(customText = null) {
  const input = document.getElementById("chat-input");
  const messagesBox = document.getElementById("chat-messages");
  const message = (customText || input.value).trim();
  if (!message) return;

  if (!customText) input.value = "";
  messagesBox.innerHTML += `<div class="chat-bubble chat-user">${message}</div>`;
  messagesBox.scrollTop = messagesBox.scrollHeight;

  try {
    const res = await fetch("/api/wabot-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const data = await res.json();

    let extraMedia = "";
    if (data.qrDataUrl) {
      extraMedia += `<div style="margin-top:10px;"><img src="${data.qrDataUrl}" alt="QR Code" style="max-width:190px;border-radius:10px;border:2px solid #22d3ee;"/></div>`;
    }
    if (data.stickerDataUrl) {
      extraMedia += `<div style="margin-top:10px;"><img src="${data.stickerDataUrl}" alt="Sticker" style="max-width:160px;border-radius:12px;"/></div>`;
    }
    if (data.audioUrl) {
      extraMedia += `<div style="margin-top:10px;"><audio controls src="${data.audioUrl}" style="width:100%;max-width:260px;height:36px;"></audio></div>`;
    }

    messagesBox.innerHTML += `
      <div class="chat-bubble chat-ai">
        ${formatMarkdown(data.reply)}
        ${extraMedia}
        <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.15); font-size:0.74rem; font-family:var(--font-mono); color:#22d3ee;">
          ⚡ ${data.node_badge || "AURAFLOW BOT"} · ${data.suggested_workflow || "AuraFlow Bot Multi-Device"}
        </div>
      </div>
    `;
    messagesBox.scrollTop = messagesBox.scrollHeight;

    if (message.toLowerCase().startsWith("-cotizar")) {
      loadLeads();
    }
    loadWabotStatus();
  } catch (err) {
    console.error("Chat error:", err);
  }
}

function sendQuickPrompt(promptText) {
  sendAiMessage(promptText);
}

function testBotCommandFromPanel(cmd) {
  const chatSection = document.getElementById("chat-messages");
  if (chatSection) {
    chatSection.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  sendAiMessage(cmd);
}

async function loadWabotStatus() {
  try {
    const res = await fetch("/api/wabot/status");
    const data = await res.json();

    const badge = document.getElementById("wabot-status-badge");
    const qrBox = document.getElementById("wabot-qr-container");
    const cmdCount = document.getElementById("wabot-cmd-count");
    const logsBox = document.getElementById("wabot-live-logs");

    if (cmdCount) {
      cmdCount.textContent = `${data.commandsExecuted || 0} comandos ejecutados`;
    }

    if (badge && qrBox) {
      if (data.status === "connected" && data.connectedUser) {
        badge.textContent = "🟢 CONECTADO EN WHATSAPP";
        badge.style.background = "rgba(16,185,129,0.2)";
        badge.style.color = "#10b981";
        qrBox.innerHTML = `
          <div style="text-align:center; padding:16px;">
            <div style="font-size:2.4rem; margin-bottom:8px;">✅</div>
            <h4 style="color:#10b981; font-size:1.1rem; margin-bottom:4px;">AuraFlow Bot Vinculado Activo 24/7</h4>
            <div style="font-family:var(--font-mono); color:#22d3ee; font-size:0.95rem; margin-bottom:8px;">
              ${data.connectedUser.phone} (${data.connectedUser.name})
            </div>
            <p style="font-size:0.8rem; color:var(--text-secondary);">
              Envía <code>-menu</code> desde cualquier chat de WhatsApp para desplegar todos los comandos.
            </p>
          </div>
        `;
      } else if (data.qrDataUrl) {
        badge.textContent = "📱 QR LISTO PARA ESCANEAR";
        badge.style.background = "rgba(34,211,238,0.16)";
        badge.style.color = "#22d3ee";
        qrBox.innerHTML = `
          <img src="${data.qrDataUrl}" alt="WhatsApp QR Code" style="width:220px; height:220px; border-radius:12px; border:3px solid #22d3ee; background:#fff; padding:6px;" />
          <div style="margin-top:10px; font-size:0.8rem; color:var(--text-secondary); text-align:center;">
            Escanea este QR desde tu WhatsApp (<strong>+506 8941-8680</strong>) o genera un código de 8 dígitos abajo.
          </div>
        `;
      } else {
        badge.textContent = "⏳ INICIANDO SOCKET...";
        qrBox.innerHTML = `<div style="color:var(--text-secondary); font-size:0.85rem;">Generando sesión segura Multi-Device...</div>`;
      }
    }

    if (data.pairingCode) {
      const pairRes = document.getElementById("wabot-pair-result");
      if (pairRes && !pairRes.innerHTML.includes(data.pairingCode)) {
        pairRes.innerHTML = `<span style="color:#10b981;">🔑 Código de Vinculación (${data.pairingPhone}): <strong style="font-size:1.15rem; color:#22d3ee; letter-spacing:2px;">${data.pairingCode}</strong></span>`;
      }
    }

    if (logsBox && Array.isArray(data.logs) && data.logs.length > 0) {
      logsBox.innerHTML = data.logs.map(l => `
        <div class="log-line">
          <span class="log-ok">${l}</span>
        </div>
      `).join("");
    }
  } catch (err) {
    console.error("Error loading WaBot status:", err);
  }
}

async function requestWabotPairingCode() {
  const phoneInput = document.getElementById("wabot-pair-phone");
  const pairRes = document.getElementById("wabot-pair-result");
  const btn = document.getElementById("btn-pair-code");
  const phone = (phoneInput?.value || "50689418680").trim();

  if (btn) btn.disabled = true;
  if (pairRes) pairRes.innerHTML = `<span style="color:#38bdf8;">⏳ Solicitando código de 8 dígitos a WhatsApp para +${phone.replace(/\D/g, "")}...</span>`;

  try {
    const res = await fetch("/api/wabot/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (data.pairingCode) {
      pairRes.innerHTML = `
        <div style="padding:10px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.4); border-radius:8px; margin-top:6px;">
          <div style="font-size:0.78rem; color:var(--text-secondary);">Ingresa este código en WhatsApp (${data.phone}):</div>
          <div style="font-size:1.35rem; font-weight:800; color:#22d3ee; letter-spacing:3px; margin:4px 0;">${data.pairingCode}</div>
        </div>
      `;
    } else {
      pairRes.innerHTML = `<span style="color:#f43f5e;">⚠️ ${data.error || "No se pudo generar el código."}</span>`;
    }
  } catch (err) {
    if (pairRes) pairRes.innerHTML = `<span style="color:#f43f5e;">Error de conexión al generar código.</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function resetWabotSession() {
  const pairRes = document.getElementById("wabot-pair-result");
  if (pairRes) pairRes.innerHTML = `<span style="color:#38bdf8;">🔄 Reiniciando sesión y generando nuevo QR...</span>`;
  try {
    await fetch("/api/wabot/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setTimeout(loadWabotStatus, 2200);
  } catch (err) {
    console.error("Reset error:", err);
  }
}

function selectPlan(planName) {
  const sel = document.getElementById("lead-plan");
  if (sel) sel.value = planName;
}

async function loadLeads() {
  try {
    const res = await fetch("/api/leads");
    const data = await res.json();
    const container = document.getElementById("leads-pipeline-list");
    if (!container) return;

    container.innerHTML = (data.leads || []).map(l => `
      <div class="lead-item">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong>${l.name} · <span style="color:#38bdf8;">${l.company}</span></strong>
          <span class="sub-badge">${l.status.toUpperCase()}</span>
        </div>
        <div style="font-size:0.78rem; color:var(--text-secondary); margin-bottom:4px;">
          ${l.automation_goal}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.74rem; font-family:var(--font-mono); color:var(--text-muted);">
          <span>${l.plan_interest}</span>
          <span>${l.phone || "+506"}</span>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Error loading leads:", err);
  }
}

async function submitLeadForm(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-submit-lead");
  const feedback = document.getElementById("lead-feedback");
  btn.disabled = true;

  const payload = {
    name: document.getElementById("lead-name").value,
    phone: document.getElementById("lead-phone").value,
    email: document.getElementById("lead-email").value,
    company: document.getElementById("lead-company").value,
    plan_interest: document.getElementById("lead-plan").value,
    sector: document.getElementById("lead-sector").value,
    automation_goal: document.getElementById("lead-goal").value,
    estimated_roi_usd: state.lastRoi.annual_savings_usd || 6500
  };

  try {
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    feedback.style.color = "#10b981";
    feedback.textContent = data.message;
    e.target.reset();
    await Promise.all([loadLeads(), loadMetrics()]);
  } catch (err) {
    feedback.style.color = "#f43f5e";
    feedback.textContent = "Error al enviar la solicitud.";
  } finally {
    btn.disabled = false;
  }
}

function openSsoModal() {
  document.getElementById("sso-modal").classList.add("open");
}

function closeSsoModal() {
  document.getElementById("sso-modal").classList.remove("open");
}

async function sendSsoCode() {
  const email = document.getElementById("sso-email").value.trim();
  const feedback = document.getElementById("sso-feedback");
  if (!email) {
    feedback.style.color = "#f43f5e";
    feedback.textContent = "⚠️ Ingresa un correo electrónico válido.";
    return;
  }
  feedback.style.color = "#94a3b8";
  feedback.textContent = "⏳ Enviando código de 6 dígitos a " + email + "...";
  const res = await fetch("/api/sso/send-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });
  const data = await res.json();
  document.getElementById("sso-step-verify").style.display = "block";
  document.getElementById("sso-code").value = "";
  document.getElementById("sso-code").focus();
  feedback.style.color = "#38bdf8";
  feedback.textContent = `✓ ${data.message}. Revisa tu bandeja de entrada e ingresa los 6 dígitos.`;
}

async function verifySsoCode() {
  const email = document.getElementById("sso-email").value;
  const code_6 = document.getElementById("sso-code").value;
  const feedback = document.getElementById("sso-feedback");
  const res = await fetch("/api/sso/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code_6 })
  });
  const data = await res.json();
  if (data.verified) {
    feedback.style.color = "#10b981";
    feedback.textContent = `${data.message} (Token: ${data.token})`;
  } else {
    feedback.style.color = "#f43f5e";
    feedback.textContent = data.error || "Error de verificación";
  }
}

function openWorkflowModal() {
  document.getElementById("workflow-modal").classList.add("open");
}

function closeWorkflowModal() {
  document.getElementById("workflow-modal").classList.remove("open");
}

async function createCustomWorkflow(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById("wf-name").value,
    category: document.getElementById("wf-category").value,
    trigger_type: document.getElementById("wf-trigger").value,
    description: document.getElementById("wf-desc").value
  };
  const res = await fetch("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.id) {
    state.activeWorkflowId = data.id;
    closeWorkflowModal();
    e.target.reset();
    await Promise.all([loadWorkflows(), loadMetrics()]);
  }
}
