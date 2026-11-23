/* AuraFlow — utilidades compartidas por las web apps de cada subdominio */
const AF = (() => {
  const DOMAIN = "auraflowtech.lat";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = s => document.querySelector(s);
  const money = (n, cur = "CRC") => (cur === "USD" ? "$" : "₡") + Number(n || 0).toLocaleString("es-CR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  function getToken() {
    const m = document.cookie.match(/(?:^|; )af_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setToken(t) {
    const dom = location.hostname.endsWith(DOMAIN) ? `; domain=.${DOMAIN}` : "";
    document.cookie = `af_token=${encodeURIComponent(t)}; path=/; max-age=43200; samesite=lax; secure${dom}`;
  }
  function clearToken() {
    const dom = location.hostname.endsWith(DOMAIN) ? `; domain=.${DOMAIN}` : "";
    document.cookie = `af_token=; path=/; max-age=0; samesite=lax; secure${dom}`;
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    const t = getToken();
    if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(path, { method: opts.body ? "POST" : "GET", ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let data = {};
    try { data = await res.json(); } catch (e) { }
    if (!res.ok) { const err = new Error(data.error || `Error ${res.status}`); err.status = res.status; throw err; }
    return data;
  }

  let toastTimer;
  function toast(msg, isErr = false) {
    let el = $(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.className = "toast" + (isErr ? " err" : ""); el.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.style.display = "none"), 4000);
  }

  async function me() {
    if (!getToken()) return null;
    try { return (await api("/api/sso/me")).email; } catch (e) { clearToken(); return null; }
  }
  function loginUrl() { return `https://id.${DOMAIN}/?next=${encodeURIComponent(location.href)}`; }
  async function logout() {
    try { await api("/api/sso/logout", { body: {} }); } catch (e) { }
    clearToken(); location.reload();
  }

  /** Barra superior común. requireLogin=true redirige a id.auraflowtech.lat si no hay sesión. */
  async function shell(appName, { requireLogin = false } = {}) {
    const top = document.createElement("header");
    top.className = "af-top";
    top.innerHTML = `<a class="af-brand" href="https://${DOMAIN}/">⚡ AuraFlow <span class="app">${esc(appName)}</span></a>
      <div class="af-user" id="af-user">…</div>`;
    document.body.prepend(top);
    const f = document.createElement("footer"); f.className = "af";
    f.innerHTML = `AuraFlow Tech · Costa Rica · <a href="https://status.${DOMAIN}">Estado</a> · <a href="mailto:support@${DOMAIN}">support@${DOMAIN}</a>`;
    document.body.appendChild(f);
    const email = await me();
    const u = $("#af-user");
    if (email) u.innerHTML = `👤 ${esc(email)} <button class="btn s sm" id="af-logout">Salir</button>`;
    else u.innerHTML = `<a class="btn s sm" href="${loginUrl()}">🔐 Iniciar sesión</a>`;
    const lo = $("#af-logout"); if (lo) lo.onclick = logout;
    if (requireLogin && !email) { location.href = loginUrl(); throw new Error("redirect"); }
    return email;
  }

  return { esc, $, money, api, toast, shell, me, getToken, setToken, clearToken, loginUrl, DOMAIN };
})();
