#!/usr/bin/env python3
"""
AuraFlow Tech — Monitor real de subdominios + portales por subdominio.

- SubdomainMonitor: sondea cada *.auraflowtech.lat por HTTPS cada 60 s
  (latencia real, código HTTP, estado ONLINE / LENTO / OFFLINE).
- render_portal(): página propia para los subdominios que no tienen una app
  dedicada (antes caían todos en la landing principal).
"""

import html
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

BASE_DOMAIN = "auraflowtech.lat"
MAIN_URL = f"https://{BASE_DOMAIN}"
PROBE_INTERVAL_S = 60
PROBE_TIMEOUT_S = 6
SLOW_THRESHOLD_MS = 1500

# Subdominios con app propia (bloque server_name dedicado en nginx).
DEDICATED_APPS = {
    "bot": "AuraFlow Bot Dashboard",
    "openclaw": "AuraAgent Framework",
    "builder": "AuraAgent Framework",
    "radio": "PTT + GPS Radio",
    "panel": "Cloud VPS Panel",
}

# Subdominios servidos por este backend con un portal propio.
# widget: bloque interactivo específico; target: sección de la landing con la demo en vivo.
PORTALS = {
    "fac": {"icon": "🧾", "target": "#facturador-v44", "cta": "Abrir Facturador v4.4 en vivo", "widget": "facturas", "name": "AuraFlow Facturador Electrónico CR v4.4", "category": "Facturación Hacienda CR", "description": "Emisor de Factura Electrónica v4.4 del Ministerio de Hacienda de Costa Rica con catálogo CABYS, IVA Ley 9635 y Clave de 50 dígitos."},
    "id": {"icon": "🔐", "target": "#ecosistema-cloud", "cta": "Ver ecosistema", "widget": "sso", "name": "AuraFlow ID · Cloud SSO", "category": "Identidad & Seguridad", "description": "Autenticación unificada sin contraseña con códigos OTP de 6 dígitos para todo el ecosistema empresarial AuraFlow Tech."},
    "demo": {"icon": "🧪", "target": "#builder", "cta": "Abrir Sandbox en vivo", "widget": "demos", "name": "AuraFlow Sandbox & Demos Interactivas", "category": "Laboratorio Cloud", "description": "Prueba en tiempo real los flujos de automatización, bots de WhatsApp IA y facturación electrónica v4.4 de AuraFlow Tech."},
    "admin": {"icon": "🛡️", "target": "#cotizar", "cta": "Abrir pipeline de clientes", "widget": "leads", "name": "AuraFlow Admin & Control Empresarial", "category": "Administración", "description": "Panel ejecutivo de gestión de clientes, métricas operativas y control de infraestructura cloud en Costa Rica."},
    "pos": {"icon": "🛒", "target": "#facturador-v44", "cta": "Emitir Tiquete Electrónico v4.4", "widget": "facturas", "name": "AuraFlow POS & Inventario CR", "category": "Punto de Venta", "description": "Sistema de Punto de Venta (POS) e inventario en la nube con lector de código de barras y tiquete electrónico Hacienda v4.4."},
    "crm": {"icon": "📊", "target": "#cotizar", "cta": "Abrir Kanban CRM en vivo", "widget": "leads", "name": "AuraFlow Kanban CRM Comercial", "category": "Ventas & CRM", "description": "CRM Kanban con captura automática de prospectos desde WhatsApp, calificación con IA y seguimiento comercial en tiempo real."},
    "clinica": {"icon": "🏥", "target": "#sectores-cr", "cta": "Ver solución para clínicas", "widget": "clinica", "name": "AuraFlow Clínicas & Consultorios Médicos", "category": "Salud & Agenda", "description": "Expediente digital, recordatorios de citas por WhatsApp y facturación electrónica médica con IVA reducido del 4% en Costa Rica."},
    "club": {"icon": "💎", "target": "#builder", "cta": "Ver Club de Puntos en vivo", "widget": "loyalty", "name": "AuraFlow Club de Lealtad & Puntos", "category": "Fidelización", "description": "Programa digital de fidelización de clientes con niveles Bronce, Plata, Oro y Diamante, puntos por compra y recompensas."},
    "api": {"icon": "🔌", "target": "#builder", "cta": "Ver integraciones", "widget": "api", "name": "AuraFlow REST API & Webhooks", "category": "Desarrolladores", "description": "API REST empresarial para conectar facturación electrónica v4.4, bots de WhatsApp IA, CRM y flujos de trabajo en Costa Rica."},
    "status": {"icon": "📡", "target": "#ecosistema-cloud", "cta": "Ver ecosistema", "widget": "status", "name": "AuraFlow System Status & Uptime", "category": "Monitoreo 24/7", "description": "Monitor en vivo de disponibilidad, latencia HTTPS y estado operativo de los nodos y subdominios de AuraFlow Tech."},
    "cdn": {"icon": "🗂️", "target": "#facturador-v44", "cta": "Generar XML v4.4", "widget": "cdn", "name": "AuraFlow CDN & Activos Digitales", "category": "Infraestructura", "description": "Red de distribución de recursos estáticos, esquemas XML v4.4 y activos multimedia de alta velocidad de AuraFlow Tech."},
    "chat": {"icon": "💬", "target": "#wabot-ia", "cta": "Probar Asistente WaBot IA 24/7", "widget": "clinica", "name": "AuraFlow Chat & Asistente Conversacional IA", "category": "Atención al Cliente IA", "description": "Plataforma de chat inteligente multicanal y atención automatizada 24/7 para WhatsApp, web y redes sociales con IA generativa."},
    "citas": {"icon": "📅", "target": "#sectores-cr", "cta": "Agendar cita o demostración", "widget": "clinica", "name": "AuraFlow Citas & Agenda Inteligente", "category": "Reservas & Agenda", "description": "Sistema de agendamiento de citas online con confirmación automática por WhatsApp para clínicas, consultorios y empresas en Costa Rica."},
    "cobros": {"icon": "💳", "target": "#facturador-v44", "cta": "Ver Facturación y Cobros CR", "widget": "facturas", "name": "AuraFlow Cobros & Gestión de Pagos", "category": "Finanzas & Facturación", "description": "Automatización de cobros recurrentes, recordatorios de pago por WhatsApp, SINPE Móvil y emisión de Factura Electrónica v4.4."},
    "comunidad": {"icon": "🤝", "target": "#ecosistema-cloud", "cta": "Unirse a la Comunidad AuraFlow", "widget": "loyalty", "name": "Comunidad AuraFlow Tech Costa Rica", "category": "Comunidad & Innovación", "description": "Red de emprendedores, desarrolladores y empresas en Costa Rica que transforman sus negocios con inteligencia artificial y automatización."},
    "menu": {"icon": "🍽️", "target": "#sectores-cr", "cta": "Ver soluciones para comercios", "widget": "demos", "name": "AuraFlow Menú Digital & Pedidos por WhatsApp", "category": "Gastronomía & Comercio", "description": "Catálogo y menú digital interactivo con código QR, carrito de pedidos directo a WhatsApp y facturación electrónica integrada."},
    "portfolio": {"icon": "🚀", "target": "#ecosistema-cloud", "cta": "Explorar proyectos en vivo", "widget": "status", "name": "Portafolio de Proyectos · Ing. Santiago Delgado Leiva", "category": "Ingeniería & Software", "description": "Portafolio oficial de arquitecturas cloud, sistemas SaaS, telecomunicaciones FTTH/GPON, agentes IA y software empresarial por el Ing. Santiago Delgado Leiva."},
    "zyntrip": {"icon": "✈️", "target": "#builder", "cta": "Ver motor de reservas y turismo", "widget": "demos", "name": "ZynTrip by AuraFlow · Turismo & Reservas Inteligentes", "category": "Turismo & Hospitalidad", "description": "Plataforma digital de reservas turísticas, itinerarios inteligentes con IA y atención automatizada en varios idiomas para hoteles y tours en Costa Rica."},
}


def host_to_sub(host_header: str | None) -> str | None:
    """'fac.auraflowtech.lat:443' -> 'fac'; dominio raíz / www -> None."""
    if not host_header:
        return None
    host = host_header.split(":")[0].strip().lower()
    if not host.endswith("." + BASE_DOMAIN):
        return None
    sub = host[: -(len(BASE_DOMAIN) + 1)]
    return None if sub in ("", "www") else sub


class SubdomainMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._results: dict[str, dict] = {}
        self._hosts: list[str] = []
        self._started = False
        self._ctx = ssl.create_default_context()

    def start(self, hosts: list[str]) -> None:
        with self._lock:
            self._hosts = list(hosts)
            if self._started:
                return
            self._started = True
        threading.Thread(target=self._loop, name="subdomain-monitor", daemon=True).start()

    def _loop(self) -> None:
        while True:
            try:
                self.probe_all()
            except Exception as exc:  # nunca matar el hilo
                print(f"[SubdomainMonitor] error: {exc}")
            time.sleep(PROBE_INTERVAL_S)

    def _probe(self, host: str) -> dict:
        url = f"https://{host}/"
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "AuraFlow-Uptime/1.0"})
        t0 = time.perf_counter()
        code = None
        error = None
        try:
            with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT_S, context=self._ctx) as resp:
                code = resp.status
                resp.read(1)
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception as e:
            error = str(e)[:160]
        latency = int((time.perf_counter() - t0) * 1000)

        if code is not None and code < 500:
            status = "LENTO" if latency > SLOW_THRESHOLD_MS else "ONLINE"
        else:
            status = "OFFLINE"
        return {
            "status": status,
            "latency_ms": latency if status != "OFFLINE" else None,
            "http_code": code,
            "error": error,
            "checked_at": datetime.now().isoformat(timespec="seconds"),
        }

    def probe_all(self) -> None:
        with self._lock:
            hosts = list(self._hosts)
        if not hosts:
            return
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = dict(zip(hosts, pool.map(self._probe, hosts)))
        with self._lock:
            self._results.update(results)

    def get(self, host: str) -> dict:
        with self._lock:
            r = self._results.get(host)
        if r:
            return dict(r)
        return {"status": "VERIFICANDO", "latency_ms": None, "http_code": None, "error": None, "checked_at": None}


MONITOR = SubdomainMonitor()


def enrich_subdomain(row: dict) -> dict:
    """Mezcla la fila de la BD con el estado real medido."""
    host = row["subdomain"]
    sub = host.split(".")[0]
    live = MONITOR.get(host)
    out = dict(row)
    out.update(live)
    if sub in DEDICATED_APPS:
        out["kind"] = "app"
    elif sub in PORTALS:
        out["kind"] = "portal"
    else:
        out["kind"] = "landing"
    return out


# --------------------------------------------------------------------------- #
# Portales HTML
# --------------------------------------------------------------------------- #

_WIDGETS_JS = {
    "status": """
async function widget(){
  const box=document.getElementById('w');
  async function draw(){
    const d=await (await fetch('/api/subdomains')).json();
    const subs=d.subdomains||[];
    const on=subs.filter(s=>s.status==='ONLINE'||s.status==='LENTO').length;
    box.innerHTML=`<p class="muted">${on} / ${subs.length} subdominios respondiendo · se actualiza cada 30 s</p>
    <table><tr><th>Subdominio</th><th>Estado</th><th>Latencia</th><th>HTTP</th><th>Tipo</th><th>Verificado</th></tr>`+
    subs.map(s=>`<tr><td><a href="https://${s.subdomain}" target="_blank">${s.subdomain}</a></td>
      <td><span class="b ${s.status}">● ${s.status}</span></td>
      <td>${s.latency_ms!=null?s.latency_ms+' ms':'—'}</td><td>${s.http_code??'—'}</td>
      <td>${s.kind==='app'?'App dedicada':'Portal'}</td>
      <td>${s.checked_at?s.checked_at.replace('T',' '):'—'}</td></tr>`).join('')+'</table>';
  }
  await draw(); setInterval(draw,30000);
}""",
    "api": """
async function widget(){
  const box=document.getElementById('w');
  const eps=[['GET','/api/health','Estado del servicio'],['GET','/api/metrics','Métricas globales'],
   ['GET','/api/subdomains','Estado real de los 16 subdominios'],['GET','/api/services','Nodos de servicio'],
   ['GET','/api/facturas','Últimos comprobantes v4.4'],['POST','/api/facturas','Emitir comprobante v4.4'],
   ['GET','/api/workflows','Flujos del Builder'],['POST','/api/workflows/simulate','Simular flujo'],
   ['GET','/api/executions','Ejecuciones recientes'],['POST','/api/roi-calculator','Calculadora ROI'],
   ['POST','/api/wabot-chat','Asistente WaBot IA'],['POST','/api/sso/send-code','Enviar código SSO'],
   ['POST','/api/sso/verify','Verificar código SSO'],['GET','/api/loyalty','Club de lealtad'],
   ['POST','/api/leads','Registrar lead CRM']];
  let h=await (await fetch('/api/health')).json();
  box.innerHTML='<h3>Endpoints REST</h3><table><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr>'+
   eps.map(e=>`<tr><td><span class="b m">${e[0]}</span></td><td><code>${e[1]}</code></td><td>${e[2]}</td></tr>`).join('')+
   '</table><h3>GET /api/health (en vivo)</h3><pre>'+JSON.stringify(h,null,2)+'</pre>';
}""",
    "sso": """
async function widget(){
  const box=document.getElementById('w');
  box.innerHTML=`<h3>Iniciar sesión con AuraFlow ID</h3>
   <div class="row"><input id="em" type="email" placeholder="tu@empresa.cr"><button onclick="send()">Enviar código</button></div>
   <div class="row" id="vr" style="display:none"><input id="cd" maxlength="6" placeholder="Código de 6 dígitos"><button onclick="verify()">Verificar</button></div>
   <p id="msg" class="muted"></p>`;
}
async function send(){
  const em=document.getElementById('em').value.trim(); if(!em) return;
  const r=await (await fetch('/api/sso/send-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})})).json();
  document.getElementById('msg').textContent=r.email_sent?('Código enviado a '+em):'No se pudo enviar el correo, intenta de nuevo.';
  document.getElementById('vr').style.display='flex';
}
async function verify(){
  const r=await fetch('/api/sso/verify',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:document.getElementById('em').value.trim(),code_6:document.getElementById('cd').value.trim()})});
  const d=await r.json(); document.getElementById('msg').textContent=d.message||d.error;
}""",
    "facturas": """
async function widget(){
  const box=document.getElementById('w');
  const d=await (await fetch('/api/facturas')).json();
  const f=(d.facturas||[]).slice(0,8);
  box.innerHTML='<h3>Últimos comprobantes emitidos</h3><table><tr><th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Total</th><th>Estado</th></tr>'+
   f.map(x=>`<tr><td>${x.created_at}</td><td>${esc(x.tipo_doc)}</td><td>${esc(x.cliente_nombre)}</td>
   <td>${x.moneda} ${Number(x.total).toLocaleString('es-CR')}</td><td><span class="b ONLINE">${esc(x.estado_hacienda)}</span></td></tr>`).join('')+'</table>';
}""",
    "leads": """
async function widget(){
  const box=document.getElementById('w');
  const d=await (await fetch('/api/leads')).json();
  const cols={};(d.leads||[]).forEach(l=>{(cols[l.status]=cols[l.status]||[]).push(l)});
  box.innerHTML='<h3>Pipeline comercial</h3><div class="kan">'+Object.entries(cols).map(([k,v])=>
   `<div class="col"><b>${esc(k)} (${v.length})</b>`+v.slice(0,6).map(l=>`<div class="card"><b>${esc(l.name)}</b><br><span class="muted">${esc(l.plan_interest||'')}</span></div>`).join('')+'</div>').join('')+'</div>';
}""",
    "loyalty": """
async function widget(){
  const box=document.getElementById('w');
  const d=await (await fetch('/api/loyalty')).json();
  box.innerHTML='<h3>Ranking del Club</h3><table><tr><th>Miembro</th><th>Nivel</th><th>Puntos</th></tr>'+
   (d.members||[]).map(m=>`<tr><td>${esc(m.name||m.member_name||'')}</td><td><span class="b m">${esc(m.tier)}</span></td><td>${m.points}</td></tr>`).join('')+'</table>';
}""",
    "demos": """
async function widget(){
  const box=document.getElementById('w');
  const d=await (await fetch('/api/workflows')).json();
  box.innerHTML='<h3>Flujos disponibles para probar</h3><table><tr><th>Flujo</th><th>Categoría</th><th>Ejecuciones</th><th></th></tr>'+
   (d.workflows||[]).map(w=>`<tr><td>${esc(w.name)}</td><td>${esc(w.category)}</td><td id="r${w.id}">${w.runs_count}</td>
   <td><button onclick="run(${w.id})">▶ Ejecutar</button></td></tr>`).join('')+'</table><pre id="out" style="display:none"></pre>';
}
async function run(id){
  const d=await (await fetch('/api/workflows/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workflow_id:id})})).json();
  const e=d.execution; const o=document.getElementById('out'); o.style.display='block';
  o.textContent=e.workflow_name+' · '+e.duration_ms+' ms\\n'+e.steps_log.map(s=>`  ✓ ${s.node} (${s.ms} ms)`).join('\\n');
  document.getElementById('r'+id).textContent=Number(document.getElementById('r'+id).textContent)+1;
}""",
    "clinica": """
async function widget(){
  const box=document.getElementById('w');
  box.innerHTML=`<h3>Pregúntale al asistente de citas</h3>
   <div class="row"><input id="q" value="Quiero agendar una cita en la clínica"><button onclick="ask()">Enviar</button></div><pre id="out" style="display:none"></pre>`;
}
async function ask(){
  const d=await (await fetch('/api/wabot-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:document.getElementById('q').value})})).json();
  const o=document.getElementById('out'); o.style.display='block'; o.textContent=(d.reply||'').replace(/\\*\\*/g,'');
}""",
    "cdn": """
async function widget(){
  const box=document.getElementById('w');
  const d=await (await fetch('/api/facturas')).json();
  const f=(d.facturas||[])[0];
  box.innerHTML=`<h3>Recursos públicos</h3><table><tr><th>Recurso</th><th>Tipo</th></tr>
   <tr><td><a href="/og-image.png" target="_blank">/og-image.png</a></td><td>image/png</td></tr>
   <tr><td><a href="/og-image.svg" target="_blank">/og-image.svg</a></td><td>image/svg+xml</td></tr>
   <tr><td><a href="/styles.css" target="_blank">/styles.css</a></td><td>text/css</td></tr>
   <tr><td><a href="/app.js" target="_blank">/app.js</a></td><td>application/javascript</td></tr></table>`+
   (f?`<h3>Último XML v4.4 generado</h3><button onclick="dl()">⬇ Descargar XML</button><pre>${esc(f.xml_payload)}</pre>`:'');
  window._xml=f&&f.xml_payload; window._clave=f&&f.clave_50;
}
function dl(){const b=new Blob([window._xml],{type:'application/xml'});const a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=(window._clave||'comprobante')+'.xml';a.click();}""",
}

_CSS = """
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#040814;color:#f8fafc}
a{color:#22d3ee}.wrap{max-width:1000px;margin:0 auto;padding:28px 20px 60px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:28px}
.brand{font-weight:800;text-decoration:none;color:#f8fafc}.brand span{color:#22d3ee}
.hero{background:rgba(11,19,37,.85);border:1px solid rgba(34,211,238,.3);border-radius:18px;padding:28px}
.tag{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:#22d3ee;letter-spacing:1px}
h1{margin:8px 0 10px;font-size:1.9rem}h3{margin:22px 0 10px}.muted{color:#94a3b8}
.b{font-family:'JetBrains Mono',monospace;font-size:.72rem;padding:3px 8px;border-radius:99px;white-space:nowrap;
 background:rgba(16,185,129,.14);color:#34d399;border:1px solid rgba(16,185,129,.35)}
.b.LENTO{background:rgba(234,179,8,.14);color:#facc15;border-color:rgba(234,179,8,.4)}
.b.OFFLINE{background:rgba(239,68,68,.14);color:#f87171;border-color:rgba(239,68,68,.4)}
.b.VERIFICANDO,.b.m{background:rgba(148,163,184,.12);color:#cbd5e1;border-color:rgba(148,163,184,.3)}
.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.btn,button{background:linear-gradient(90deg,#06b6d4,#7c3aed);color:#fff;border:0;border-radius:10px;padding:10px 16px;
 font-weight:700;text-decoration:none;cursor:pointer;font-size:.9rem}
.btn.s{background:transparent;border:1px solid rgba(148,163,184,.35)}
#w{margin-top:22px;background:rgba(7,16,34,.84);border:1px solid rgba(148,163,184,.16);border-radius:16px;padding:6px 20px 20px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;padding:8px;border-bottom:1px solid rgba(148,163,184,.12)}
th{color:#94a3b8;font-weight:600}pre{background:#020617;padding:14px;border-radius:10px;overflow:auto;font-size:.78rem;max-height:420px;white-space:pre-wrap}
input{flex:1;min-width:200px;background:#020617;border:1px solid rgba(148,163,184,.3);color:#f8fafc;border-radius:10px;padding:10px}
.row{display:flex;gap:10px;margin:10px 0;flex-wrap:wrap}.kan{display:flex;gap:12px;overflow-x:auto}
.col{min-width:220px;flex:1;background:#020617;border-radius:12px;padding:10px}.card{background:rgba(11,19,37,.9);border-radius:10px;padding:10px;margin-top:8px;font-size:.82rem}
footer{margin-top:40px;text-align:center;font-size:.8rem;color:#64748b}
"""


def render_portal(sub: str, row: dict | None) -> bytes:
    cfg = PORTALS[sub]
    host = f"{sub}.{BASE_DOMAIN}"
    name = html.escape((row.get("name") if row else None) or cfg.get("name") or host)
    desc = html.escape((row.get("description") if row else None) or cfg.get("description") or f"Módulo oficial {name} del ecosistema AuraFlow Tech Costa Rica.")
    category = html.escape((row.get("category") if row else None) or cfg.get("category") or "Cloud SaaS")
    live = MONITOR.get(host)
    lat = f" · {live['latency_ms']}ms" if live.get("latency_ms") is not None else ""
    widget_js = _WIDGETS_JS.get(cfg["widget"], "async function widget(){document.getElementById('w').remove()}")

    page = f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name} · {host}</title><meta name="description" content="{desc}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://{host}/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://{host}/">
<meta property="og:title" content="{name} · AuraFlow Tech"><meta property="og:description" content="{desc}">
<meta property="og:image" content="{MAIN_URL}/og-image.png">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>{_CSS}</style></head><body><div class="wrap">
<div class="top"><a class="brand" href="{MAIN_URL}/">AuraFlow <span>Tech</span></a>
<span class="b {live['status']}" id="st">● {live['status']}{lat}</span></div>
<div class="hero"><div class="tag">{cfg['icon']} {host.upper()} · {category}</div>
<h1>{name}</h1><p class="muted">{desc}</p>
<div class="btns"><a class="btn" href="{MAIN_URL}/{cfg['target']}">{html.escape(cfg['cta'])} →</a>
<a class="btn s" href="https://status.{BASE_DOMAIN}/">Estado del sistema</a>
<a class="btn s" href="{MAIN_URL}/#ecosistema-cloud">Todos los módulos</a></div></div>
<div id="w"><p class="muted">Cargando…</p></div>
<footer>AuraFlow Tech · Zona Sur, Costa Rica · <a href="mailto:support@auraflowtech.lat">support@auraflowtech.lat</a></footer>
</div><script>
function esc(s){{return String(s??'').replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]))}}
{widget_js}
widget().catch(e=>{{document.getElementById('w').innerHTML='<p class="muted">No se pudo cargar: '+esc(e.message)+'</p>'}});
setInterval(async()=>{{try{{const d=await (await fetch('/api/subdomains')).json();
 const s=(d.subdomains||[]).find(x=>x.subdomain==='{host}'); if(!s) return;
 const el=document.getElementById('st'); el.className='b '+s.status;
 el.textContent='● '+s.status+(s.latency_ms!=null?' · '+s.latency_ms+'ms':'');}}catch(e){{}}}},30000);
</script></body></html>"""
    return page.encode("utf-8")
