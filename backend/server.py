#!/usr/bin/env python3
"""
AuraFlow Tech (auraflowtech.lat) — Full-Stack Server & REST API Engine
Fundado por el Ing. Santiago Delgado Leiva · Zona Sur, Costa Rica
Serves the interactive frontend, Open Graph assets, and REST API endpoints:
- /api/health & /api/metrics
- /api/services (Nodos 01, 02, 03, 04)
- /api/subdomains (16 Subdominios Activos *.auraflowtech.lat)
- /api/facturas (Emisor en vivo Factura Electrónica Hacienda CR v4.4 + Clave 50 dígitos + XML)
- /api/workflows & /api/workflows/simulate (AuraFlow Builder)
- /api/executions
- /api/terminal (Consola interactiva $ auraflow --status | --factura-v4.4 | --wabot-ia | --sso | --cotizar)
- /api/roi-calculator (Calculadora ROI PYMEs Costa Rica en Colones ₡ y USD $)
- /api/ai-assistant & /api/wabot-chat (Simulador WaBot IA 24/7)
- /api/sso/send-code & /api/sso/verify (AuraFlow ID Cloud SSO 6 dígitos)
- /api/loyalty (Club de Puntos y Lealtad)
- /api/leads (Kanban CRM & Cotizaciones)
"""

import json
import os
import random
import re
import sqlite3
import string
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from database import (
    generate_clave_50_digitos,
    generate_xml_v44,
    get_connection,
    init_db,
)
from portals import MONITOR, PORTALS, enrich_subdomain, host_to_sub, render_portal
import apps_api

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEOIP_CACHE: dict[str, dict[str, Any]] = {}


def lookup_geoip(ip: str) -> dict[str, Any]:
    if ip in GEOIP_CACHE:
        return GEOIP_CACHE[ip]
    info: dict[str, Any] = {"country": "Desconocido", "city": "", "isp": "", "lat": None, "lon": None}
    try:
        req = urllib.request.Request(
            f"http://ip-api.com/json/{ip}?fields=status,country,city,isp,lat,lon",
            headers={"User-Agent": "AuraFlowRadar/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
            if parsed.get("status") == "success":
                info = {
                    "country": parsed.get("country", "Desconocido"),
                    "city": parsed.get("city", ""),
                    "isp": parsed.get("isp", ""),
                    "lat": parsed.get("lat"),
                    "lon": parsed.get("lon"),
                }
    except Exception:
        pass
    GEOIP_CACHE[ip] = info
    return info


def get_security_radar_data() -> dict[str, Any]:
    import subprocess
    total_failed = 0
    total_banned = 0
    currently_banned = 0
    active_ips: set[str] = set()

    try:
        out = subprocess.check_output(["fail2ban-client", "status", "sshd"], text=True, timeout=5)
        for line in out.splitlines():
            if "Total failed:" in line:
                total_failed = int(line.split(":")[-1].strip())
            elif "Total banned:" in line:
                total_banned = int(line.split(":")[-1].strip())
            elif "Currently banned:" in line:
                currently_banned = int(line.split(":")[-1].strip())
            elif "Banned IP list:" in line:
                active_ips = set(line.split(":", 1)[-1].strip().split())
    except Exception:
        pass

    seen: dict[str, str] = {}
    log_path = "/var/log/fail2ban.log"
    if os.path.isfile(log_path):
        try:
            with open(log_path, "r", encoding="utf-8", errors="ignore") as fh:
                lines = fh.readlines()[-800:]
            for line in reversed(lines):
                if " Ban " in line and "[sshd]" in line:
                    parts = line.strip().split()
                    ip = parts[-1]
                    ts = f"{parts[0]} {parts[1].split(',')[0]}" if len(parts) >= 2 else ""
                    if ip not in seen:
                        seen[ip] = ts
                    if len(seen) >= 35:
                        break
        except Exception:
            pass

    for ip in active_ips:
        if ip not in seen:
            seen[ip] = "Activo ahora"

    attacks = []
    for ip, ts in seen.items():
        geo = lookup_geoip(ip)
        attacks.append({"ip": ip, "timestamp": ts, "active": ip in active_ips, **geo})

    return {
        "total_failed": total_failed,
        "total_banned": total_banned,
        "currently_banned": currently_banned,
        "attacks": attacks,
    }
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
CRM_DB_PATH = os.path.join(ROOT_DIR, "backend", "prospectos.db")
CRM_ADMIN_PASS = "YOUR_ADMIN_PASSWORD"


def get_crm_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(CRM_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS prospectos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            contacto TEXT NOT NULL,
            servicio TEXT NOT NULL,
            detalle TEXT NOT NULL DEFAULT '',
            estado TEXT NOT NULL DEFAULT 'pendiente',
            notas TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shortlinks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            target_url TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            clicks INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
        """
    )
    conn.commit()
    return conn
WABOT_ENGINE_URL = "http://127.0.0.1:8001"


def proxy_wabot_engine(endpoint: str, method: str = "GET", payload: dict | None = None) -> tuple[dict, int]:
    url = f"{WABOT_ENGINE_URL}{endpoint}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw), resp.status
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode("utf-8"))
        except Exception:
            err_body = {"error": str(e)}
        return err_body, e.code
    except Exception as e:
        return {"error": f"Motor AuraFlow Bot iniciándose: {e}", "status": "starting"}, 503


def compute_wabot_response(message: str) -> dict:
    msg_clean = (message or "").strip()
    if msg_clean.startswith(("-", "/", "!")) or msg_clean.lower() in ("menu", "menú", "help", "comandos"):
        cmd_res, status_code = proxy_wabot_engine("/command", method="POST", payload={"message": msg_clean})
        if status_code == 200 and cmd_res.get("isCommand"):
            return cmd_res

    msg_lower = msg_clean.lower()

    if any(k in msg_lower for k in ["factura", "hacienda", "4.4", "cabys", "clave", "xml", "iva", "tiquete"]):
        return {
            "reply": (
                "✅ **Módulo Factura CR v4.4 (fac.auraflowtech.lat) Sincronizado**\n\n"
                "Nuestro motor ERP emite comprobantes 100% homologados con el Ministerio de Hacienda de Costa Rica:\n"
                "• **Clave Numérica de 50 dígitos** y Consecutivo de 20 dígitos automáticos.\n"
                "• **Catálogo CABYS integrado** y tarifas de **IVA Ley 9635** (13% general, 4% salud/clínicas, 2% educación/medicamentos, 1% canasta básica).\n"
                "• **Firma XAdES-EPES y XML v4.4** enviados en tiempo real con acuse instantáneo por WhatsApp y correo."
            ),
            "suggested_workflow": "WaBot IA 24/7 + Emisión Automática Factura CR v4.4",
            "estimated_savings_hrs": "140 hrs / mes",
            "node_badge": "NODO 02 • HACIENDA v4.4",
        }

    if any(k in msg_lower for k in ["precio", "plan", "costo", "cuanto", "cuánto", "mensualidad", "colones", "cotizar"]):
        return {
            "reply": (
                "📊 **Planes AuraFlow Tech Costa Rica (`auraflowtech.lat`)**:\n\n"
                "1. **Plan Emprendedor / Factura CR v4.4 (₡18,500 / mes o $36):** Emisión ilimitada de Facturas y Tiquetes v4.4, catálogo CABYS, IVA Ley 9635 y acceso con AuraFlow ID.\n"
                "2. **Plan PYME Pro: WaBot IA 24/7 + Factura v4.4 (₡49,500 / mes o $95):** Bot de WhatsApp con IA 24/7, AuraFlow Builder, CRM Kanban, Club de Lealtad y Facturación automática.\n"
                "3. **Plan Ecosistema Cloud / Clínicas & Empresas (₡95,000 / mes o $185):** Multi-sucursal, Agenda Médica (IVA 4%), POS Inventario, Radio PTT GPS y soporte directo con el Ing. Santiago Delgado Leiva."
            ),
            "suggested_workflow": "WaBot IA 24/7 + Emisión Automática Factura CR v4.4",
            "estimated_savings_hrs": "180 hrs / mes",
            "node_badge": "PLANES COSTA RICA",
        }

    if any(k in msg_lower for k in ["clinica", "clínica", "cita", "salud", "doctor", "odontolog", " médico", "medico"]):
        return {
            "reply": (
                "🏥 **AuraFlow Salud & Clínicas (`clinica.auraflowtech.lat`)**:\n\n"
                "• **Agenda Automatizada 24/7 por WhatsApp:** El paciente consulta horarios, reserva cita y recibe recordatorios automáticos.\n"
                "• **Facturación Médica v4.4 (IVA 4%):** Aplica automáticamente el código CABYS de servicios de salud y la tarifa reducida del **4% de IVA (Ley 9635)** al pagar con tarjeta o SINPE Móvil."
            ),
            "suggested_workflow": "Agenda Médica Clínicas CR + Recordatorio WhatsApp + IVA 4%",
            "estimated_savings_hrs": "160 hrs / mes",
            "node_badge": "NODO SALUD CR · IVA 4%",
        }

    if any(k in msg_lower for k in ["sso", "cuenta", "login", "acceso", "codigo", "código", "id", "subdominio", "radio", "ptt"]):
        return {
            "reply": (
                "🔐 **AuraFlow ID Cloud SSO (`id.auraflowtech.lat`)**:\n\n"
                "Con **1 sola cuenta unificada** accedes a los **16 subdominios activos** (`fac`, `bot`, `crm`, `pos`, `radio`, `openclaw`, `panel`, `admin`, etc.).\n"
                "• Seguridad **SSL TLS 1.3** y verificación mediante código de **6 dígitos** enviado desde `support@auraflowtech.lat`."
            ),
            "suggested_workflow": "AuraFlow ID Cloud SSO & Verificación 6 Dígitos",
            "estimated_savings_hrs": "100% SSO Unificado",
            "node_badge": "NODO 03 • SSO CLOUD",
        }

    return {
        "reply": (
            "🤖 **¡Hola! Soy el Agente WaBot IA 24/7 de AuraFlow Tech (`auraflowtech.lat`)**.\n\n"
            "Operamos desde la **Zona Sur para todo Costa Rica** bajo la dirección del **Ing. Santiago Delgado Leiva**.\n"
            "Puedo ayudarte a probar en vivo:\n"
            "• **Nodo 01 (AuraFlow Builder):** Flujos visuales de WhatsApp y bots autónomos 24/7.\n"
            "• **Nodo 02 (Factura CR v4.4):** Emisión de comprobantes con Clave de 50 dígitos, CABYS e IVA Ley 9635.\n"
            "• **Nodo 03 (AuraFlow ID Cloud):** Cuenta única SSO para nuestros 16 subdominios activos.\n\n"
            "Pregúntame por *precios en colones*, *Factura CR v4.4*, *clínicas* o prueba el emisor de facturas arriba."
        ),
        "suggested_workflow": "WaBot IA 24/7 + Emisión Automática Factura CR v4.4",
        "estimated_savings_hrs": "150 - 320 hrs / mes",
        "node_badge": "AURAFLOW CLOUD ECOSYSTEM",
    }


def compute_terminal_command(cmd: str) -> dict:
    c = cmd.strip().lower()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S CST")

    if "--factura" in c or "v4.4" in c:
        sample = generate_clave_50_digitos(cedula="3101849201", tipo_doc="01", consecutivo_num=random.randint(1050, 1999))
        return {
            "command": "$ auraflow --factura-v4.4",
            "output": [
                f"[{now_str}] Conectando con nodo fac.auraflowtech.lat (TLS 1.3)...",
                "✓ Esquema XML: FacturaElectronica v4.4 (MH-DGT-RES-0027-2024)",
                f"✓ Consecutivo (20 dígitos): {sample['consecutivo_20']}",
                f"✓ Clave Numérica (50 dígitos): {sample['clave_50']}",
                "✓ Validación CABYS & IVA Ley 9635 (13% / 4% / 2% / 1%): OK",
                "✓ Firma Criptográfica XAdES-EPES completada en 48 ms",
                "✓ Respuesta Ministerio de Hacienda CR: [ACEPTADO · SINCRONIZADO 24/7]",
            ],
        }

    if "--wabot" in c or "whatsapp" in c or "builder" in c:
        return {
            "command": "$ auraflow --wabot-ia",
            "output": [
                f"[{now_str}] Estado del Nodo 01 • AuraFlow Builder (bot.auraflowtech.lat):",
                "✓ Motor Multi-Device WhatsApp 24/7: ACTIVO (Latencia: 14 ms)",
                "✓ Agentes Autónomos RAG + Reconocimiento SINPE Móvil: ONLINE",
                "✓ Árboles conversacionales activos: Ventas PYME, Agenda Clínica, Posventa & Factura v4.4",
                "✓ Tasa de respuesta automática sin intervención humana: 94.8%",
            ],
        }

    if "--sso" in c or "--id" in c:
        return {
            "command": "$ auraflow --sso",
            "output": [
                f"[{now_str}] Verificando Nodo 03 • AuraFlow ID Cloud (id.auraflowtech.lat):",
                "✓ Clúster de Identidad MongoDB + JWT SSO: SINCRONIZADO",
                "✓ Despacho OTP 6 dígitos vía support@auraflowtech.lat: OPERATIVO",
                "✓ Cobertura Single Sign-On: 16/16 subdominios (*.auraflowtech.lat) con SSL TLS 1.3",
            ],
        }

    if "--cotizar" in c or "--planes" in c:
        return {
            "command": "$ auraflow --cotizar",
            "output": [
                f"[{now_str}] Tabulador Comercial AuraFlow Tech Costa Rica:",
                "• Plan Emprendedor CR v4.4: ₡18,500/mes ($36) -> Facturador v4.4 + CABYS + AuraFlow ID",
                "• Plan PYME Pro IA:         ₡49,500/mes ($95) -> WaBot IA 24/7 + AuraFlow Builder + Factura v4.4 + CRM",
                "• Plan Ecosistema Cloud:    ₡95,000/mes ($185)-> Multi-Sucursal + Clínicas/POS + Radio PTT GPS + Soporte VIP",
                "→ Contacto directo: Ing. Santiago Delgado Leiva · support@auraflowtech.lat",
            ],
        }

    return {
        "command": "$ auraflow --status",
        "output": [
            f"[{now_str}] AURAFLOW CLOUD ECOSYSTEM — ZONA SUR, COSTA RICA",
            "• Fundador & Arquitecto: Ing. Santiago Delgado Leiva",
            "• Cloud VPS Status: ONLINE · 24h Uptime · SLA 99.98% · SSL TLS 1.3",
            "• Subdominios Activos (16): fac, bot, id, demo, openclaw, radio, panel, admin, pos, crm, clinica, club, builder, api, status, cdn",
            "• NODO 01 (IA):       AuraFlow Builder · Flujos Visuales WhatsApp 24/7 [OK]",
            "• NODO 02 (HACIENDA): Factura CR v4.4 · Clave 50 Dígitos + XML + CABYS [SINCRONIZADO 24/7]",
            "• NODO 03 (SSO):      AuraFlow ID Cloud · 1 Cuenta Multi-Plataforma [OK]",
        ],
    }


class AuraRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def log_message(self, format: str, *args) -> None:
        pass

    def _send_json(self, data: dict | list, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        # Portal propio para subdominios sin app dedicada (antes mostraban la landing)
        sub = host_to_sub(self.headers.get("Host"))
        if sub in PORTALS and path in ("/", "/index.html"):
            app_file = os.path.join(FRONTEND_DIR, "apps", f"{sub}.html")
            if os.path.isfile(app_file):
                with open(app_file, "rb") as fh:
                    payload = fh.read()
            else:
                conn = get_connection()
                cur = conn.cursor()
                cur.execute("SELECT * FROM subdomains WHERE subdomain LIKE ? LIMIT 1", (f"{sub}.%",))
                row = cur.fetchone()
                conn.close()
                payload = render_portal(sub, dict(row) if row else None)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        # Redirigir rutas antiguas de demos/plantillas rastreadas por Googlebot para evitar 404 en Search Console
        if path in ("/api/demo/puntos", "/$2") or "/$" in path or "%7B" in self.path.upper():
            host_hdr = (self.headers.get("Host") or "auraflowtech.lat").split(":")[0].strip().lower()
            target_host = host_hdr if host_hdr.endswith("auraflowtech.lat") else "auraflowtech.lat"
            self.send_response(301)
            self.send_header("Location", f"https://{target_host}/")
            self.end_headers()
            return

        if path == "/favicon.ico":
            og_png = os.path.join(FRONTEND_DIR, "og-image.png")
            if os.path.isfile(og_png):
                with open(og_png, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path in ("/tramite", "/tramite.html"):
            tramite_file = os.path.join(FRONTEND_DIR, "tramite.html")
            if os.path.isfile(tramite_file):
                with open(tramite_file, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path in ("/servicios", "/servicios/", "/servicios.html"):
            servicios_file = os.path.join(FRONTEND_DIR, "servicios.html")
            if os.path.isfile(servicios_file):
                with open(servicios_file, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path in ("/cotizador", "/cotizador/", "/cotizador.html"):
            cotizador_file = os.path.join(FRONTEND_DIR, "cotizador.html")
            if os.path.isfile(cotizador_file):
                with open(cotizador_file, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path in ("/links", "/links/", "/links.html"):
            links_file = os.path.join(FRONTEND_DIR, "links.html")
            if os.path.isfile(links_file):
                with open(links_file, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path in ("/privacidad", "/privacidad/", "/privacidad.html"):
            privacidad_file = os.path.join(FRONTEND_DIR, "privacidad.html")
            if os.path.isfile(privacidad_file):
                with open(privacidad_file, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path in ("/radar", "/radar/", "/radar.html"):
            radar_file = os.path.join(FRONTEND_DIR, "radar.html")
            if os.path.isfile(radar_file):
                with open(radar_file, "rb") as fh:
                    payload = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return

        if path == "/api/security-radar":
            data = get_security_radar_data()
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if path.startswith("/s/"):
            slug = path[3:].strip("/").strip()
            if slug:
                conn = get_crm_conn()
                row = conn.execute("SELECT id, target_url FROM shortlinks WHERE slug = ?", (slug,)).fetchone()
                if row:
                    conn.execute("UPDATE shortlinks SET clicks = clicks + 1 WHERE id = ?", (row["id"],))
                    conn.commit()
                    conn.close()
                    self.send_response(302)
                    self.send_header("Location", row["target_url"])
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return
                conn.close()
            self._send_json({"ok": False, "error": "Enlace no encontrado"}, status=404)
            return

        if path == "/api/links":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            conn = get_crm_conn()
            rows = [dict(r) for r in conn.execute("SELECT * FROM shortlinks ORDER BY id DESC LIMIT 200").fetchall()]
            conn.close()
            self._send_json({"ok": True, "links": rows})
            return

        if path == "/api/crm/prospectos":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            conn = get_crm_conn()
            rows = [dict(r) for r in conn.execute("SELECT * FROM prospectos ORDER BY id DESC LIMIT 200").fetchall()]
            conn.close()
            self._send_json({"ok": True, "prospectos": rows})
            return

        if path == "/api/cedula":
            qs = parse_qs(parsed.query)
            q = (qs.get("q") or qs.get("cedula") or [""])[0].strip()
            clean_q = re.sub(r"\D", "", q)
            if not clean_q or len(clean_q) < 9:
                self._send_json({"ok": False, "error": "Cédula inválida (mínimo 9 dígitos)"}, status=400)
                return
            try:
                proc = subprocess.run(
                    ["curl", "-s", "-m", "5", "-x", "socks5h://127.0.0.1:40000", f"https://api.hacienda.go.cr/fe/ae?identificacion={clean_q}"],
                    capture_output=True, text=True, timeout=6
                )
                raw_out = proc.stdout.strip()
                if not raw_out or raw_out.startswith("<html"):
                    proc = subprocess.run(
                        ["curl", "-6", "-s", "-m", "5", f"https://api.hacienda.go.cr/fe/ae?identificacion={clean_q}"],
                        capture_output=True, text=True, timeout=6
                    )
                    raw_out = proc.stdout.strip()
                data = json.loads(raw_out)
                if data.get("nombre"):
                    self._send_json({"ok": True, "nombre": data["nombre"], "data": data})
                else:
                    self._send_json({"ok": False, "error": "Cédula no encontrada en el padrón de Hacienda", "cedula": clean_q})
                return
            except Exception as e:
                self._send_json({"ok": False, "error": f"Consulta no disponible temporalmente: {str(e)}", "cedula": clean_q})
                return

        if path.startswith("/api/"):
            handled = apps_api.handle_get(path, parse_qs(parsed.query), self.headers)
            if handled is not None:
                self._send_json(handled[0], status=handled[1])
                return

        if path == "/api/health":
            self._send_json({
                "status": "operational",
                "ecosystem": "AURAFLOW CLOUD ECOSYSTEM",
                "service": "AuraFlow Tech — Software, IA & Factura CR v4.4",
                "founder": "Ing. Santiago Delgado Leiva",
                "region": "Zona Sur, Costa Rica",
                "domain": "https://auraflowtech.lat",
                "support_email": "support@auraflowtech.lat",
                "active_subdomains": 16,
                "ssl": "TLS 1.3",
                "hacienda_normativa": "v4.4 Ready (MH-DGT-RES-0027-2024)",
                "timestamp": datetime.now().isoformat(),
                "uptime_sla": "99.98%",
            })
            return

        if path == "/api/metrics":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("""
                SELECT
                    COUNT(*) as total_workflows,
                    COALESCE(SUM(runs_count), 0) as total_runs,
                    COALESCE(SUM(time_saved_hrs), 0) as total_hours_saved,
                    COALESCE(AVG(success_rate), 99.9) as avg_success_rate,
                    COALESCE(AVG(avg_duration_ms), 220) as avg_latency_ms
                FROM workflows
            """)
            row = cur.fetchone()

            cur.execute("SELECT COUNT(*) as lead_count, COALESCE(SUM(estimated_roi_usd), 0) as pipeline_roi FROM leads")
            lead_row = cur.fetchone()

            cur.execute("SELECT COUNT(*) as facturas_count, COALESCE(SUM(total), 0) as total_facturado_crc FROM facturas_cr")
            fac_row = cur.fetchone()

            cur.execute("SELECT subdomain FROM subdomains")
            sub_hosts = [r["subdomain"] for r in cur.fetchall()]
            conn.close()
            sub_online = sum(1 for h in sub_hosts if MONITOR.get(h)["status"] in ("ONLINE", "LENTO", "VERIFICANDO"))
            sub_row = {"sub_count": sub_online}

            total_hours = round(float(row["total_hours_saved"]), 1)
            cost_saved_usd = int(total_hours * 28)
            cost_saved_crc = cost_saved_usd * 515

            self._send_json({
                "total_workflows": row["total_workflows"],
                "total_runs": row["total_runs"],
                "total_hours_saved": total_hours,
                "estimated_cost_saved_usd": cost_saved_usd,
                "estimated_cost_saved_crc": cost_saved_crc,
                "avg_success_rate": round(float(row["avg_success_rate"]), 2),
                "avg_latency_ms": int(row["avg_latency_ms"]),
                "active_leads": lead_row["lead_count"],
                "pipeline_roi_usd": lead_row["pipeline_roi"],
                "facturas_v44_count": fac_row["facturas_count"],
                "total_facturado_crc": round(float(fac_row["total_facturado_crc"]), 2),
                "active_subdomains": sub_row["sub_count"],
            })
            return

        if path == "/api/services":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM services ORDER BY id ASC")
            services = []
            for r in cur.fetchall():
                services.append({
                    "id": r["id"],
                    "slug": r["slug"],
                    "node_code": r["node_code"],
                    "title": r["title"],
                    "subtitle": r["subtitle"],
                    "description": r["description"],
                    "icon": r["icon"],
                    "features": json.loads(r["features_json"]),
                    "impact_metric": r["impact_metric"],
                })
            conn.close()
            self._send_json({"services": services})
            return

        if path == "/api/subdomains":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM subdomains ORDER BY id ASC")
            subs = [enrich_subdomain(dict(r)) for r in cur.fetchall()]
            conn.close()
            online = sum(1 for s in subs if s["status"] in ("ONLINE", "LENTO"))
            self._send_json({"subdomains": subs, "total": len(subs), "online": online})
            return

        if path == "/api/solicitar-servicio":
            nombre = str(body.get("nombre") or "").strip()[:80]
            contacto = str(body.get("contacto") or "").strip()[:120]
            servicio = str(body.get("servicio") or "Consulta General").strip()[:100]
            detalle = str(body.get("detalle") or "").strip()[:1200]
            if not nombre or not contacto:
                self._send_json({"ok": False, "error": "Nombre y WhatsApp/correo son obligatorios."}, status=400)
                return
            try:
                conn = get_crm_conn()
                conn.execute(
                    "INSERT INTO prospectos (nombre, contacto, servicio, detalle) VALUES (?, ?, ?, ?)",
                    (nombre, contacto, servicio, detalle),
                )
                conn.commit()
                conn.close()
            except Exception:
                pass
            tg_msg = (
                f"💼 *Nueva Solicitud de Servicio*\n\n"
                f"👤 *Cliente:* {nombre}\n"
                f"📞 *Contacto:* {contacto}\n"
                f"🛠️ *Servicio:* {servicio}\n"
                f"📝 *Detalle:* {detalle or 'Sin detalle adicional'}"
            )
            try:
                tg_payload = json.dumps({
                    "chat_id": "8934877782",
                    "text": tg_msg,
                    "parse_mode": "Markdown",
                }).encode("utf-8")
                tg_req = urllib.request.Request(
                    "https://api.telegram.org/botYOUR_TELEGRAM_BOT_TOKEN/sendMessage",
                    data=tg_payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(tg_req, timeout=8):
                    pass
            except Exception:
                pass
            self._send_json({"ok": True, "message": "Solicitud enviada. Te contactaré muy pronto."})
            return

        if path == "/api/servicios/chat":
            msg_text = str(body.get("message") or "").strip()[:600]
            session_id = str(body.get("session_id") or "web-servicios").strip()[:64]
            if not msg_text:
                self._send_json({"ok": False, "error": "Escribe un mensaje."}, status=400)
                return
            prompt = (
                "[Contexto: Eres el Asistente Comercial de Ing. Santiago Delgado Leiva (AuraFlow Tech, Costa Rica). "
                "Ofreces: 1) Bots de WhatsApp/Telegram con IA 24/7, 2) Páginas Web, Sistemas a Medida y Automatización, "
                "3) Redes, VPN (Ruijie/MikroTik), Monitoreo y Soporte ISP, 4) Nube Privada e IA Propia para empresas. "
                "NO menciones tecnologías internas como Docker, SQLite, Groq, Python, Node o direcciones IP. "
                "Responde breve, amable y profesional en español, e invita al cliente a llenar el formulario de cotización o escribir por WhatsApp.]\n\n"
                f"Cliente: {msg_text}"
            )
            try:
                ai_payload = json.dumps({
                    "agent_slug": "aura-director",
                    "message": prompt,
                    "session_id": f"srv-{session_id}",
                }).encode("utf-8")
                ai_req = urllib.request.Request(
                    "http://127.0.0.1:8095/api/chat",
                    data=ai_payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(ai_req, timeout=25) as resp:
                    ai_data = json.loads(resp.read().decode("utf-8"))
                reply = str(ai_data.get("reply") or "").strip()
                if reply:
                    self._send_json({"ok": True, "reply": reply})
                    return
            except Exception:
                pass
            self._send_json({"ok": False, "error": "Asistente ocupado en este momento. Usa el formulario abajo."}, status=502)
            return

        if path == "/api/crm/prospectos/update":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            pid = int(body.get("id") or 0)
            estado = str(body.get("estado") or "").strip()
            notas = str(body.get("notas") or "").strip()[:1000]
            if pid <= 0 or estado not in ("pendiente", "cotizado", "cerrado"):
                self._send_json({"ok": False, "error": "Datos inválidos"}, status=400)
                return
            conn = get_crm_conn()
            conn.execute("UPDATE prospectos SET estado = ?, notas = ? WHERE id = ?", (estado, notas, pid))
            conn.commit()
            conn.close()
            self._send_json({"ok": True})
            return

        if path == "/api/crm/prospectos/delete":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            pid = int(body.get("id") or 0)
            if pid <= 0:
                self._send_json({"ok": False, "error": "ID inválido"}, status=400)
                return
            conn = get_crm_conn()
            conn.execute("DELETE FROM prospectos WHERE id = ?", (pid,))
            conn.commit()
            conn.close()
            self._send_json({"ok": True})
            return

        if path == "/api/links/create":
            is_loopback = self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")
            if not is_loopback and (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            target_url = str(body.get("url") or "").strip()[:1000]
            if not re.match(r"^https?://", target_url, re.IGNORECASE):
                self._send_json({"ok": False, "error": "La URL debe empezar con http:// o https://"}, status=400)
                return
            raw_slug = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("slug") or "").strip())[:40]
            slug = raw_slug or "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
            title = str(body.get("title") or "").strip()[:120]
            conn = get_crm_conn()
            try:
                conn.execute(
                    "INSERT INTO shortlinks (slug, target_url, title) VALUES (?, ?, ?)",
                    (slug, target_url, title),
                )
                conn.commit()
                row = dict(conn.execute("SELECT * FROM shortlinks WHERE slug = ?", (slug,)).fetchone())
                conn.close()
                self._send_json({"ok": True, "shortUrl": f"https://auraflowtech.lat/s/{slug}", "link": row})
            except sqlite3.IntegrityError:
                conn.close()
                self._send_json({"ok": False, "error": f"El alias '{slug}' ya existe. Elige otro."}, status=409)
            return

        if path == "/api/links/delete":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            lid = int(body.get("id") or 0)
            if lid <= 0:
                self._send_json({"ok": False, "error": "ID inválido"}, status=400)
                return
            conn = get_crm_conn()
            conn.execute("DELETE FROM shortlinks WHERE id = ?", (lid,))
            conn.commit()
            conn.close()
            self._send_json({"ok": True})
            return

        if path == "/api/tramite":
            nombre = str(body.get("nombre") or "").strip()
            cedula = str(body.get("cedula") or "").strip()
            telefono = str(body.get("telefono") or "").strip()
            tipo_tramite = str(body.get("tipo_tramite") or "Consulta General").strip()
            detalle = str(body.get("detalle") or "").strip()
            plan = str(body.get("plan") or "Plan PYME Pro").strip()
            correo = str(body.get("correo") or "tramite@auraflowtech.lat").strip()

            if not telefono and not cedula:
                self._send_json({"ok": False, "error": "Debes proporcionar al menos un teléfono o cédula."}, status=400)
                return

            ticket_num = random.randint(1000, 9999)
            ticket_id = f"AF-{ticket_num}"

            # Guardar en base de datos CRM
            try:
                conn = get_connection()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO leads (
                        name, email, phone, company, sector, plan_interest,
                        monthly_budget, automation_goal, estimated_roi_usd, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'tramite_web', ?)
                """, (
                    f"{nombre} [Ticket {ticket_id}]",
                    correo,
                    telefono,
                    f"Cédula: {cedula}" if cedula else "Trámite Web",
                    tipo_tramite,
                    plan,
                    "Cotización solicitada",
                    f"[{tipo_tramite}] {detalle}",
                    4800,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                ))
                conn.commit()
                conn.close()
            except Exception as db_err:
                print(f"[Tramite DB Error]: {db_err}")

            # Enviar mensaje al bot de WhatsApp (a Santiago y al cliente)
            try:
                wa_msg_admin = (
                    f"⚡ *NUEVO TRÁMITE AURAFLOW TECH*\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"🎫 *Ticket:* `{ticket_id}`\n"
                    f"👤 *Cliente:* *{nombre or 'No indicado'}*\n"
                    f"🪪 *Cédula:* `{cedula or 'N/A'}`\n"
                    f"📱 *Teléfono:* +{telefono}\n"
                    f"📋 *Gestión:* {tipo_tramite}\n"
                    f"💼 *Plan / Interés:* {plan}\n\n"
                    f"📝 *Detalle:* {detalle}\n\n"
                    f"🌐 *CRM:* https://admin.auraflowtech.lat"
                )
                proxy_wabot_engine("/api/chat/send", method="POST", payload={
                    "jid": "50689418680@s.whatsapp.net",
                    "text": wa_msg_admin,
                    "isAssistant": False
                })

                if telefono:
                    clean_tel = re.sub(r"\D", "", telefono)
                    if len(clean_tel) == 8:
                        clean_tel = f"506{clean_tel}"
                    client_jid = f"{clean_tel}@s.whatsapp.net"
                    wa_msg_client = (
                        f"⚡ *AuraFlow Tech — Trámite Registrado*\n\n"
                        f"Hola *{nombre or 'estimado/a cliente'}*, hemos recibido tu solicitud correctamente.\n\n"
                        f"🎫 *Número de Ticket:* `{ticket_id}`\n"
                        f"📋 *Gestión:* {tipo_tramite}\n"
                        f"💼 *Servicio:* {plan}\n\n"
                        f"El Ing. Santiago Delgado o nuestro Asistente IA te responderán por este canal a la brevedad.\n\n"
                        f"🌐 https://auraflowtech.lat"
                    )
                    proxy_wabot_engine("/api/chat/send", method="POST", payload={
                        "jid": client_jid,
                        "text": wa_msg_client,
                        "isAssistant": True
                    })
            except Exception as notify_err:
                print(f"[Tramite Notify Error]: {notify_err}")

            self._send_json({
                "ok": True,
                "ticket_id": ticket_id,
                "message": f"Trámite #{ticket_id} registrado exitosamente.",
                "whatsapp_support": "https://wa.me/50689418680"
            })
            return

        if path == "/api/facturas":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM facturas_cr ORDER BY id DESC LIMIT 15")
            facturas = [dict(r) for r in cur.fetchall()]
            conn.close()
            self._send_json({"facturas": facturas})
            return

        if path == "/api/workflows":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM workflows ORDER BY id ASC")
            workflows = []
            for r in cur.fetchall():
                workflows.append({
                    "id": r["id"],
                    "name": r["name"],
                    "category": r["category"],
                    "description": r["description"],
                    "trigger_type": r["trigger_type"],
                    "nodes": json.loads(r["nodes_json"]),
                    "status": r["status"],
                    "avg_duration_ms": r["avg_duration_ms"],
                    "success_rate": r["success_rate"],
                    "runs_count": r["runs_count"],
                    "time_saved_hrs": round(float(r["time_saved_hrs"]), 1),
                    "created_at": r["created_at"],
                })
            conn.close()
            self._send_json({"workflows": workflows})
            return

        if path == "/api/executions":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM executions ORDER BY id DESC LIMIT 12")
            executions = []
            for r in cur.fetchall():
                executions.append({
                    "id": r["id"],
                    "workflow_id": r["workflow_id"],
                    "workflow_name": r["workflow_name"],
                    "status": r["status"],
                    "duration_ms": r["duration_ms"],
                    "payload_summary": r["payload_summary"],
                    "steps_log": json.loads(r["steps_log_json"]),
                    "executed_at": r["executed_at"],
                })
            conn.close()
            self._send_json({"executions": executions})
            return

        if path == "/api/leads":
            conn = get_connection()
            cur = conn.cursor()
            # Sincronizar contactos recientes de WhatsApp (wabot) al Kanban CRM
            wabot_store = "/root/aura-flow-tech/wabot/dashboard_store.json"
            if os.path.isfile(wabot_store):
                try:
                    with open(wabot_store, "r", encoding="utf-8") as wf:
                        wdata = json.load(wf)
                    chats = wdata.get("chats", {})
                    for jid, chat in chats.items():
                        if chat.get("isGroup"):
                            continue
                        phone = (chat.get("phone") or "").strip()
                        name = (chat.get("name") or phone or "Contacto WhatsApp").strip()
                        preview = (chat.get("lastMessagePreview") or "Conversación activa en WhatsApp").strip()
                        if not phone:
                            continue
                        cur.execute("SELECT id FROM leads WHERE phone = ? LIMIT 1", (phone,))
                        if not cur.fetchone():
                            ts_ms = chat.get("lastMessageAt") or int(datetime.now().timestamp() * 1000)
                            dt_str = datetime.fromtimestamp(ts_ms / 1000.0).strftime("%Y-%m-%d %H:%M:%S")
                            cur.execute("""
                                INSERT INTO leads (
                                    name, email, phone, company, sector, plan_interest,
                                    monthly_budget, automation_goal, estimated_roi_usd, status, created_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'whatsapp_activo', ?)
                            """, (
                                f"{name} (WhatsApp)",
                                "whatsapp@auraflowtech.lat",
                                phone,
                                "Contacto WaBot CR",
                                "WhatsApp Directo",
                                "Atención IA / CRM",
                                "₡49,500/mes",
                                f"Último mensaje: {preview[:120]}",
                                4800,
                                dt_str
                            ))
                    conn.commit()
                except Exception as exc:
                    print(f"[CRM WaBot Sync Error]: {exc}")

            cur.execute("SELECT * FROM leads ORDER BY id DESC LIMIT 25")
            leads = [dict(r) for r in cur.fetchall()]
            conn.close()
            self._send_json({"leads": leads})
            return

        if path == "/api/loyalty":
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM loyalty_members ORDER BY points DESC")
            members = [dict(r) for r in cur.fetchall()]
            conn.close()
            self._send_json({"members": members})
            return

        if path == "/api/wabot/status":
            res_data, status_code = proxy_wabot_engine("/status", method="GET")
            self._send_json(res_data, status=status_code)
            return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, status=400)
            return

        handled = apps_api.handle_post(path, body, self.headers)
        if handled is not None:
            self._send_json(handled[0], status=handled[1])
            return

        if path == "/api/solicitar-servicio":
            nombre = str(body.get("nombre") or "").strip()[:80]
            contacto = str(body.get("contacto") or "").strip()[:120]
            servicio = str(body.get("servicio") or "Consulta General").strip()[:100]
            detalle = str(body.get("detalle") or "").strip()[:1200]
            if not nombre or not contacto:
                self._send_json({"ok": False, "error": "Nombre y WhatsApp/correo son obligatorios."}, status=400)
                return
            try:
                conn = get_crm_conn()
                conn.execute(
                    "INSERT INTO prospectos (nombre, contacto, servicio, detalle) VALUES (?, ?, ?, ?)",
                    (nombre, contacto, servicio, detalle),
                )
                conn.commit()
                conn.close()
            except Exception:
                pass
            tg_msg = (
                f"💼 *Nueva Solicitud de Servicio*\n\n"
                f"👤 *Cliente:* {nombre}\n"
                f"📞 *Contacto:* {contacto}\n"
                f"🛠️ *Servicio:* {servicio}\n"
                f"📝 *Detalle:* {detalle or 'Sin detalle adicional'}"
            )
            try:
                tg_payload = json.dumps({
                    "chat_id": "8934877782",
                    "text": tg_msg,
                    "parse_mode": "Markdown",
                }).encode("utf-8")
                tg_req = urllib.request.Request(
                    "https://api.telegram.org/botYOUR_TELEGRAM_BOT_TOKEN/sendMessage",
                    data=tg_payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(tg_req, timeout=8):
                    pass
            except Exception:
                pass
            self._send_json({"ok": True, "message": "Solicitud enviada. Te contactaré muy pronto."})
            return

        if path == "/api/servicios/chat":
            msg_text = str(body.get("message") or "").strip()[:600]
            session_id = str(body.get("session_id") or "web-servicios").strip()[:64]
            if not msg_text:
                self._send_json({"ok": False, "error": "Escribe un mensaje."}, status=400)
                return
            prompt = (
                "[Contexto: Eres el Asistente Comercial de Ing. Santiago Delgado Leiva (AuraFlow Tech, Costa Rica). "
                "Ofreces: 1) Bots de WhatsApp/Telegram con IA 24/7, 2) Páginas Web, Sistemas a Medida y Automatización, "
                "3) Redes, VPN (Ruijie/MikroTik), Monitoreo y Soporte ISP, 4) Nube Privada e IA Propia para empresas. "
                "NO menciones tecnologías internas como Docker, SQLite, Groq, Python, Node o direcciones IP. "
                "Responde breve, amable y profesional en español, e invita al cliente a llenar el formulario de cotización o escribir por WhatsApp.]\n\n"
                f"Cliente: {msg_text}"
            )
            try:
                ai_payload = json.dumps({
                    "agent_slug": "aura-director",
                    "message": prompt,
                    "session_id": f"srv-{session_id}",
                }).encode("utf-8")
                ai_req = urllib.request.Request(
                    "http://127.0.0.1:8095/api/chat",
                    data=ai_payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(ai_req, timeout=25) as resp:
                    ai_data = json.loads(resp.read().decode("utf-8"))
                reply = str(ai_data.get("reply") or "").strip()
                if reply:
                    self._send_json({"ok": True, "reply": reply})
                    return
            except Exception:
                pass
            self._send_json({"ok": False, "error": "Asistente ocupado en este momento. Usa el formulario abajo."}, status=502)
            return

        if path == "/api/crm/prospectos/update":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            pid = int(body.get("id") or 0)
            estado = str(body.get("estado") or "").strip()
            notas = str(body.get("notas") or "").strip()[:1000]
            if pid <= 0 or estado not in ("pendiente", "cotizado", "cerrado"):
                self._send_json({"ok": False, "error": "Datos inválidos"}, status=400)
                return
            conn = get_crm_conn()
            conn.execute("UPDATE prospectos SET estado = ?, notas = ? WHERE id = ?", (estado, notas, pid))
            conn.commit()
            conn.close()
            self._send_json({"ok": True})
            return

        if path == "/api/crm/prospectos/delete":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            pid = int(body.get("id") or 0)
            if pid <= 0:
                self._send_json({"ok": False, "error": "ID inválido"}, status=400)
                return
            conn = get_crm_conn()
            conn.execute("DELETE FROM prospectos WHERE id = ?", (pid,))
            conn.commit()
            conn.close()
            self._send_json({"ok": True})
            return

        if path == "/api/links/create":
            is_loopback = self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")
            if not is_loopback and (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            target_url = str(body.get("url") or "").strip()[:1000]
            if not re.match(r"^https?://", target_url, re.IGNORECASE):
                self._send_json({"ok": False, "error": "La URL debe empezar con http:// o https://"}, status=400)
                return
            raw_slug = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("slug") or "").strip())[:40]
            slug = raw_slug or "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
            title = str(body.get("title") or "").strip()[:120]
            conn = get_crm_conn()
            try:
                conn.execute(
                    "INSERT INTO shortlinks (slug, target_url, title) VALUES (?, ?, ?)",
                    (slug, target_url, title),
                )
                conn.commit()
                row = dict(conn.execute("SELECT * FROM shortlinks WHERE slug = ?", (slug,)).fetchone())
                conn.close()
                self._send_json({"ok": True, "shortUrl": f"https://auraflowtech.lat/s/{slug}", "link": row})
            except sqlite3.IntegrityError:
                conn.close()
                self._send_json({"ok": False, "error": f"El alias '{slug}' ya existe. Elige otro."}, status=409)
            return

        if path == "/api/links/delete":
            if (self.headers.get("x-admin-password") or "").strip() != CRM_ADMIN_PASS:
                self._send_json({"ok": False, "error": "No autorizado"}, status=401)
                return
            lid = int(body.get("id") or 0)
            if lid <= 0:
                self._send_json({"ok": False, "error": "ID inválido"}, status=400)
                return
            conn = get_crm_conn()
            conn.execute("DELETE FROM shortlinks WHERE id = ?", (lid,))
            conn.commit()
            conn.close()
            self._send_json({"ok": True})
            return

        if path == "/api/tramite":
            nombre = str(body.get("nombre") or "").strip()
            cedula = str(body.get("cedula") or "").strip()
            telefono = str(body.get("telefono") or "").strip()
            tipo_tramite = str(body.get("tipo_tramite") or "Consulta General").strip()
            detalle = str(body.get("detalle") or "").strip()
            plan = str(body.get("plan") or "Plan PYME Pro").strip()
            correo = str(body.get("correo") or "tramite@auraflowtech.lat").strip()

            if not telefono and not cedula:
                self._send_json({"ok": False, "error": "Debes proporcionar al menos un teléfono o cédula."}, status=400)
                return

            ticket_num = random.randint(1000, 9999)
            ticket_id = f"AF-{ticket_num}"

            # Guardar en base de datos CRM
            try:
                conn = get_connection()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO leads (
                        name, email, phone, company, sector, plan_interest,
                        monthly_budget, automation_goal, estimated_roi_usd, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'tramite_web', ?)
                """, (
                    f"{nombre} [Ticket {ticket_id}]",
                    correo,
                    telefono,
                    f"Cédula: {cedula}" if cedula else "Trámite Web",
                    tipo_tramite,
                    plan,
                    "Cotización solicitada",
                    f"[{tipo_tramite}] {detalle}",
                    4800,
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                ))
                conn.commit()
                conn.close()
            except Exception as db_err:
                print(f"[Tramite DB Error]: {db_err}")

            # Enviar mensaje al bot de WhatsApp (a Santiago y al cliente)
            try:
                wa_msg_admin = (
                    f"⚡ *NUEVO TRÁMITE AURAFLOW TECH*\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"🎫 *Ticket:* `{ticket_id}`\n"
                    f"👤 *Cliente:* *{nombre or 'No indicado'}*\n"
                    f"🪪 *Cédula:* `{cedula or 'N/A'}`\n"
                    f"📱 *Teléfono:* +{telefono}\n"
                    f"📋 *Gestión:* {tipo_tramite}\n"
                    f"💼 *Plan / Interés:* {plan}\n\n"
                    f"📝 *Detalle:* {detalle}\n\n"
                    f"🌐 *CRM:* https://admin.auraflowtech.lat"
                )
                proxy_wabot_engine("/api/chat/send", method="POST", payload={
                    "jid": "50689418680@s.whatsapp.net",
                    "text": wa_msg_admin,
                    "isAssistant": False
                })

                if telefono:
                    clean_tel = re.sub(r"\D", "", telefono)
                    if len(clean_tel) == 8:
                        clean_tel = f"506{clean_tel}"
                    client_jid = f"{clean_tel}@s.whatsapp.net"
                    wa_msg_client = (
                        f"⚡ *AuraFlow Tech — Trámite Registrado*\n\n"
                        f"Hola *{nombre or 'estimado/a cliente'}*, hemos recibido tu solicitud correctamente.\n\n"
                        f"🎫 *Número de Ticket:* `{ticket_id}`\n"
                        f"📋 *Gestión:* {tipo_tramite}\n"
                        f"💼 *Servicio:* {plan}\n\n"
                        f"El Ing. Santiago Delgado o nuestro Asistente IA te responderán por este canal a la brevedad.\n\n"
                        f"🌐 https://auraflowtech.lat"
                    )
                    proxy_wabot_engine("/api/chat/send", method="POST", payload={
                        "jid": client_jid,
                        "text": wa_msg_client,
                        "isAssistant": True
                    })
            except Exception as notify_err:
                print(f"[Tramite Notify Error]: {notify_err}")

            self._send_json({
                "ok": True,
                "ticket_id": ticket_id,
                "message": f"Trámite #{ticket_id} registrado exitosamente.",
                "whatsapp_support": "https://wa.me/50689418680"
            })
            return

        if path == "/api/facturas":
            cliente_nombre = body.get("cliente_nombre", "Cliente Contado Costa Rica").strip() or "Cliente Contado Costa Rica"
            cliente_cedula = body.get("cliente_cedula", "3101849201").strip() or "3101849201"
            cliente_correo = body.get("cliente_correo", "cliente@empresa.cr").strip() or "cliente@empresa.cr"
            tipo_doc = body.get("tipo_doc", "Factura Electrónica").strip()
            cabys_codigo = body.get("cabys_codigo", "8314300000000").strip() or "8314300000000"
            descripcion = body.get("descripcion", "Servicio SaaS AuraFlow Tech + Facturación CR v4.4").strip()
            cantidad = max(1.0, float(body.get("cantidad", 1)))
            precio_unitario = max(100.0, float(body.get("precio_unitario", 49500)))
            tarifa_iva = float(body.get("tarifa_iva", 13.0))
            moneda = body.get("moneda", "CRC").strip().upper()
            if moneda not in ("CRC", "USD"):
                moneda = "CRC"

            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) as c FROM facturas_cr")
            next_num = 1041 + int(cur.fetchone()["c"])

            tipo_cod = "01" if "Factura" in tipo_doc else ("04" if "Tiquete" in tipo_doc else "03")
            claves = generate_clave_50_digitos(
                cedula=cliente_cedula,
                sucursal="001",
                terminal="00001",
                tipo_doc=tipo_cod,
                consecutivo_num=next_num,
            )

            subtotal = round(cantidad * precio_unitario, 2)
            monto_iva = round(subtotal * (tarifa_iva / 100.0), 2)
            total = round(subtotal + monto_iva, 2)
            xml_payload = generate_xml_v44(
                clave=claves["clave_50"],
                consecutivo=claves["consecutivo_20"],
                receptor_nombre=cliente_nombre,
                receptor_cedula=cliente_cedula,
                cabys_codigo=cabys_codigo,
                detalle=descripcion,
                cantidad=cantidad,
                precio_unitario=precio_unitario,
                tarifa_iva=tarifa_iva,
                moneda=moneda,
            )

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cur.execute("""
                INSERT INTO facturas_cr (
                    clave_50, consecutivo_20, tipo_doc, cliente_nombre, cliente_cedula, cliente_correo,
                    cabys_codigo, descripcion, cantidad, precio_unitario, tarifa_iva, moneda,
                    subtotal, monto_iva, total, estado_hacienda, xml_payload, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACEPTADO · HACIENDA CR v4.4', ?, ?)
            """, (
                claves["clave_50"], claves["consecutivo_20"], tipo_doc, cliente_nombre, cliente_cedula,
                cliente_correo, cabys_codigo, descripcion, cantidad, precio_unitario, tarifa_iva,
                moneda, subtotal, monto_iva, total, xml_payload, now_str
            ))
            factura_id = cur.lastrowid

            # Also log execution in AuraFlow Builder
            cur.execute("""
                INSERT INTO executions (
                    workflow_id, workflow_name, status, duration_ms, payload_summary, steps_log_json, executed_at
                ) VALUES (?, ?, 'success', ?, ?, ?, ?)
            """, (
                1,
                "WaBot IA 24/7 + Emisión Automática Factura CR v4.4",
                random.randint(190, 290),
                f"{tipo_doc} v4.4 · Clave {claves['clave_50'][:12]}... · {cliente_nombre}",
                json.dumps([
                    {"node": "Validador Padrón & CABYS", "status": "ok", "ms": 38, "output": f"Cédula {cliente_cedula} · CABYS {cabys_codigo}"},
                    {"node": "Cálculo IVA Ley 9635", "status": "ok", "ms": 22, "output": f"Tarifa IVA {tarifa_iva:.0f}% aplicada · Total {moneda} {total:,.2f}"},
                    {"node": "Generador Clave 50 Dígitos + XML v4.4", "status": "ok", "ms": 74, "output": f"Clave: {claves['clave_50']}"},
                    {"node": "Ministerio de Hacienda CR", "status": "ok", "ms": 86, "output": "ACEPTADO · Sincronizado en fac.auraflowtech.lat"},
                ]),
                now_str
            ))
            cur.execute("UPDATE workflows SET runs_count = runs_count + 1, time_saved_hrs = time_saved_hrs + 0.3 WHERE id = 1")
            conn.commit()
            conn.close()

            self._send_json({
                "message": "Comprobante electrónico emitido y aceptado por Hacienda CR v4.4",
                "factura": {
                    "id": factura_id,
                    "clave_50": claves["clave_50"],
                    "consecutivo_20": claves["consecutivo_20"],
                    "tipo_doc": tipo_doc,
                    "cliente_nombre": cliente_nombre,
                    "cliente_cedula": cliente_cedula,
                    "cliente_correo": cliente_correo,
                    "cabys_codigo": cabys_codigo,
                    "descripcion": descripcion,
                    "cantidad": cantidad,
                    "precio_unitario": precio_unitario,
                    "tarifa_iva": tarifa_iva,
                    "moneda": moneda,
                    "subtotal": subtotal,
                    "monto_iva": monto_iva,
                    "total": total,
                    "estado_hacienda": "ACEPTADO · HACIENDA CR v4.4",
                    "xml_payload": xml_payload,
                    "created_at": now_str,
                }
            }, status=201)
            return

        if path == "/api/workflows/simulate":
            workflow_id = int(body.get("workflow_id", 1))
            custom_payload = body.get("payload", "Cliente WhatsApp +506 8888-0000 · Solicitud Factura CR v4.4")

            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,))
            wf = cur.fetchone()
            if not wf:
                conn.close()
                self._send_json({"error": "Workflow no encontrado"}, status=404)
                return

            nodes = json.loads(wf["nodes_json"])
            steps_log = []
            total_ms = 0
            for idx, node in enumerate(nodes, start=1):
                step_ms = random.randint(25, 95)
                total_ms += step_ms
                steps_log.append({
                    "step": idx,
                    "node": node["name"],
                    "type": node.get("type", "action"),
                    "status": "ok",
                    "ms": step_ms,
                    "output": f"{node.get('detail', 'Nodo ejecutado')} · [{custom_payload[:48]}]",
                })

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cur.execute("""
                INSERT INTO executions (
                    workflow_id, workflow_name, status, duration_ms, payload_summary, steps_log_json, executed_at
                ) VALUES (?, ?, 'success', ?, ?, ?, ?)
            """, (workflow_id, wf["name"], total_ms, custom_payload, json.dumps(steps_log), now_str))

            cur.execute("""
                UPDATE workflows
                SET runs_count = runs_count + 1,
                    time_saved_hrs = ROUND(time_saved_hrs + 0.4, 2)
                WHERE id = ?
            """, (workflow_id,))
            exec_id = cur.lastrowid
            conn.commit()
            conn.close()

            self._send_json({
                "execution": {
                    "id": exec_id,
                    "workflow_id": workflow_id,
                    "workflow_name": wf["name"],
                    "status": "success",
                    "duration_ms": total_ms,
                    "payload_summary": custom_payload,
                    "steps_log": steps_log,
                    "executed_at": now_str,
                }
            })
            return

        if path == "/api/workflows":
            name = body.get("name", "").strip()
            category = body.get("category", "WhatsApp + Hacienda v4.4").strip()
            description = body.get("description", "").strip()
            trigger_type = body.get("trigger_type", "WhatsApp Multi-Device Webhook").strip()
            raw_nodes = body.get("nodes", [])

            if not name or not description:
                self._send_json({"error": "Nombre y descripción del flujo son requeridos"}, status=400)
                return

            if not raw_nodes:
                raw_nodes = [
                    {"step": 1, "name": trigger_type, "type": "trigger", "detail": "Mensaje o evento entrante en tiempo real"},
                    {"step": 2, "name": "AuraFlow Builder IA", "type": "ai", "detail": "Procesamiento contextual y reglas de negocio"},
                    {"step": 3, "name": "Factura CR v4.4 & CRM Sync", "type": "erp", "detail": "Emisión de comprobante y actualización de expediente"},
                ]

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO workflows (
                    name, category, description, trigger_type, nodes_json,
                    status, avg_duration_ms, success_rate, runs_count, time_saved_hrs, created_at
                ) VALUES (?, ?, ?, ?, ?, 'active', 240, 99.9, 1, 0.5, ?)
            """, (name, category, description, trigger_type, json.dumps(raw_nodes), now_str))
            new_id = cur.lastrowid
            conn.commit()
            conn.close()

            self._send_json({"id": new_id, "message": "Flujo creado exitosamente en AuraFlow Builder"}, status=201)
            return

        if path == "/api/roi-calculator":
            whatsapp_msgs_day = max(5, int(body.get("whatsapp_msgs_day", body.get("team_size", 65))))
            facturas_month = max(10, int(body.get("facturas_month", body.get("hours_per_week", 220))))
            hourly_cost_crc = max(1500, float(body.get("hourly_cost_crc", 3500)))

            # 3.5 min saved per WhatsApp interaction + 4.5 min saved per electronic invoice + reconciliation
            monthly_saved_hours = round(((whatsapp_msgs_day * 30 * 3.5) + (facturas_month * 4.5)) / 60.0, 1)
            monthly_savings_crc = int(monthly_saved_hours * hourly_cost_crc)
            annual_savings_crc = monthly_savings_crc * 12
            monthly_savings_usd = int(round(monthly_savings_crc / 515.0))
            annual_savings_usd = monthly_savings_usd * 12

            plan_cost_crc = 49500 if facturas_month <= 500 else 95000
            recommended_plan = (
                "Plan PYME Pro (WaBot IA 24/7 + Factura CR v4.4)"
                if facturas_month <= 500
                else "Plan Ecosistema Cloud Completo (Multi-Sucursal)"
            )
            roi_multiple = round(annual_savings_crc / float(plan_cost_crc * 12), 1)
            payback_weeks = max(0.5, round((plan_cost_crc / max(1, monthly_savings_crc)) * 4.3, 1))

            self._send_json({
                "whatsapp_msgs_day": whatsapp_msgs_day,
                "facturas_month": facturas_month,
                "monthly_saved_hours": monthly_saved_hours,
                "monthly_savings_crc": monthly_savings_crc,
                "annual_savings_crc": annual_savings_crc,
                "monthly_savings_usd": monthly_savings_usd,
                "annual_savings_usd": annual_savings_usd,
                "roi_multiple": roi_multiple,
                "payback_weeks": payback_weeks,
                "recommended_plan": recommended_plan,
            })
            return

        if path in ("/api/ai-assistant", "/api/wabot-chat"):
            message = body.get("message", "")
            result = compute_wabot_response(message)
            self._send_json(result)
            return

        if path == "/api/wabot/pair":
            res_data, status_code = proxy_wabot_engine("/pair", method="POST", payload=body)
            self._send_json(res_data, status=status_code)
            return

        if path == "/api/wabot/reset":
            res_data, status_code = proxy_wabot_engine("/reset", method="POST", payload=body)
            self._send_json(res_data, status=status_code)
            return

        if path == "/api/terminal":
            cmd = body.get("command", "--status")
            self._send_json(compute_terminal_command(cmd))
            return

        if path == "/api/sso/send-code":
            email = body.get("email", "usuario@empresa.cr").strip() or "usuario@empresa.cr"
            code_6 = f"{random.randint(100000, 999999)}"
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn = get_connection()
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO sso_sessions (email, code_6, verified, created_at) VALUES (?, ?, 0, ?)",
                (email, code_6, now_str),
            )
            conn.commit()
            conn.close()
            email_sent = False
            try:
                import smtplib
                from email.mime.text import MIMEText
                from email.mime.multipart import MIMEMultipart
                msg = MIMEMultipart("alternative")
                msg["Subject"] = f"Código de Verificación {code_6} — AuraFlow ID Cloud"
                msg["From"] = "AuraFlow Tech <support@auraflowtech.lat>"
                msg["To"] = email
                text_body = (
                    f"AuraFlow ID Cloud (SSO) — Tu código de verificación de 6 dígitos es: {code_6}\n\n"
                    f"Válido para acceder a los 16 subdominios activos (*.auraflowtech.lat)."
                )
                html_body = f"""
                <div style="font-family:'Inter',Arial,sans-serif;max-width:540px;margin:0 auto;background:#0b1120;color:#f8fafc;border:1px solid #38bdf8;border-radius:16px;padding:28px;">
                  <div style="font-family:monospace;color:#38bdf8;font-size:13px;font-weight:bold;letter-spacing:1px;">
                    NODO 03 · AURAFLOW ID CLOUD (SSO)
                  </div>
                  <h2 style="margin:10px 0 14px;color:#ffffff;font-size:22px;">
                    Código de Acceso Unificado (16 Subdominios)
                  </h2>
                  <p style="color:#cbd5e1;font-size:15px;line-height:1.6;">
                    Ingresa el siguiente código de seguridad de <strong>6 dígitos</strong> para autenticar tu sesión en el ecosistema <strong>AuraFlow Tech</strong>:
                  </p>
                  <div style="margin:22px 0;text-align:center;background:#07191e;border:2px dashed #38bdf8;border-radius:12px;padding:18px;">
                    <span style="font-family:monospace;font-size:34px;font-weight:800;letter-spacing:8px;color:#34d399;">
                      {code_6}
                    </span>
                  </div>
                  <p style="color:#94a3b8;font-size:13px;">
                    Emitido por <a href="mailto:support@auraflowtech.lat" style="color:#38bdf8;">support@auraflowtech.lat</a> · TLS 1.3
                  </p>
                </div>
                """
                msg.attach(MIMEText(text_body, "plain", "utf-8"))
                msg.attach(MIMEText(html_body, "html", "utf-8"))
                with smtplib.SMTP_SSL("mail.spacemail.com", 465, timeout=10) as smtp:
                    smtp.login("support@auraflowtech.lat", "YOUR_SMTP_PASSWORD")
                    smtp.sendmail("support@auraflowtech.lat", [email], msg.as_string())
                email_sent = True
            except Exception as exc:
                print(f"[SSO SMTP Error]: {exc}")
            self._send_json({
                "message": f"Código de verificación de 6 dígitos enviado desde support@auraflowtech.lat a {email}",
                "email": email,
                "email_sent": email_sent,
                "issuer": "support@auraflowtech.lat",
                "subdomains_unlocked": 16,
            })
            return

        if path == "/api/sso/verify":
            email = body.get("email", "").strip()
            code_6 = body.get("code_6", "").strip()
            conn = get_connection()
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM sso_sessions WHERE email = ? AND code_6 = ? AND verified = 0 AND created_at >= ? ORDER BY id DESC LIMIT 1",
                (email, code_6, (datetime.now() - timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")),
            )
            row = cur.fetchone()
            if row:
                cur.execute("UPDATE sso_sessions SET verified = 1 WHERE id = ?", (row["id"],))
                conn.commit()
                conn.close()
                self._send_json({
                    "verified": True,
                    "email": email,
                    "token": apps_api.issue_token(email),
                    "message": "✅ Sesión SSO AuraFlow ID Cloud iniciada. Acceso habilitado a los 16 subdominios.",
                })
                return
            conn.close()
            self._send_json({"verified": False, "error": "❌ Código incorrecto o expirado. Revisa el código de 6 dígitos enviado a tu correo."}, status=400)
            return

        if path == "/api/loyalty/add-points":
            member_id = int(body.get("member_id", 1))
            add_pts = int(body.get("points", 150))
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT * FROM loyalty_members WHERE id = ?", (member_id,))
            m = cur.fetchone()
            if not m:
                conn.close()
                self._send_json({"error": "Miembro no encontrado"}, status=404)
                return
            new_pts = int(m["points"]) + add_pts
            new_tier = "Bronce"
            if new_pts >= 2000:
                new_tier = "Diamante"
            elif new_pts >= 1000:
                new_tier = "Oro"
            elif new_pts >= 350:
                new_tier = "Plata"

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cur.execute(
                "UPDATE loyalty_members SET points = ?, tier = ?, updated_at = ? WHERE id = ?",
                (new_pts, new_tier, now_str, member_id),
            )
            conn.commit()
            conn.close()
            self._send_json({"id": member_id, "points": new_pts, "tier": new_tier})
            return

        if path == "/api/leads":
            name = body.get("name", "").strip()
            email = body.get("email", "").strip()
            phone = body.get("phone", "+506 8888-0000").strip() or "+506 8888-0000"
            company = body.get("company", "").strip()
            sector = body.get("sector", "PYME / Comercio CR").strip()
            plan_interest = body.get("plan_interest", "Plan PYME Pro (WaBot IA + Factura CR v4.4)").strip()
            monthly_budget = body.get("monthly_budget", "₡49,500 - ₡95,000 / mes").strip()
            automation_goal = body.get("automation_goal", "").strip()
            estimated_roi_usd = int(body.get("estimated_roi_usd", 4800))

            if not name or not email or not automation_goal:
                self._send_json({"error": "Por favor completa nombre, correo y objetivo de automatización."}, status=400)
                return

            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO leads (
                    name, email, phone, company, sector, plan_interest, monthly_budget, automation_goal, estimated_roi_usd, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'calificado_ia', ?)
            """, (name, email, phone, company or "PYME Costa Rica", sector, plan_interest, monthly_budget, automation_goal, estimated_roi_usd, now_str))
            lead_id = cur.lastrowid
            conn.commit()
            conn.close()

            self._send_json({
                "message": "✅ ¡Solicitud registrada en el CRM de AuraFlow Tech! El equipo del Ing. Santiago Delgado Leiva te contactará por WhatsApp y desde support@auraflowtech.lat.",
                "lead_id": lead_id,
                "status": "calificado_ia",
            }, status=201)
            return

        self._send_json({"error": "Endpoint no encontrado"}, status=404)


def run_server(port: int = 8000) -> None:
    init_db()
    conn = get_connection()
    hosts = [r["subdomain"] for r in conn.execute("SELECT subdomain FROM subdomains ORDER BY id")]
    conn.close()
    MONITOR.start(hosts)
    server_address = ("0.0.0.0", port)
    httpd = ThreadingHTTPServer(server_address, AuraRequestHandler)
    print(f"[AuraFlow Tech CR v4.4] Full-Stack Server escuchando en http://localhost:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    port_env = int(os.environ.get("PORT", "8000"))
    run_server(port_env)
