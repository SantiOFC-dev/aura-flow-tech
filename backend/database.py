#!/usr/bin/env python3
"""
AuraFlow Tech (auraflowtech.lat) — Database Management & Seed Module
Fundado por el Ing. Santiago Delgado Leiva · Zona Sur, Costa Rica
Provides SQLite persistence for:
- Facturación Electrónica Hacienda CR v4.4 (Clave 50 dígitos, CABYS, IVA Ley 9635, XML v4.4)
- AuraFlow Builder Workflows & Executions (Flujos Visuales WhatsApp 24/7)
- AuraFlow ID Cloud SSO (1 Cuenta Multi-Plataforma, códigos de 6 dígitos)
- 16 Subdominios Activos del Ecosistema Cloud (*.auraflowtech.lat)
- CRM Kanban Pipeline & Cotizaciones
- Club de Lealtad y Puntos (Bronce -> Plata -> Oro -> Diamante)
"""

import json
import os
import random
import sqlite3
from datetime import datetime
from typing import Any, Dict, List

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aura_flow.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def generate_clave_50_digitos(
    cedula: str = "3101849201",
    sucursal: str = "001",
    terminal: str = "00001",
    tipo_doc: str = "01",
    consecutivo_num: int = 1,
    situacion: str = "1",
) -> Dict[str, str]:
    """
    Genera una Clave Numérica oficial de 50 dígitos y Consecutivo de 20 dígitos
    según la normativa del Ministerio de Hacienda de Costa Rica (v4.4).
    Formato Clave (50):
      - Código País (3): 506
      - Día (2), Mes (2), Año (2)
      - Cédula Emisor rellenada a 12 dígitos (12)
      - Consecutivo (20): Sucursal(3) + Terminal(5) + TipoDoc(2) + Número(10)
      - Situación del Comprobante (1): 1=Normal, 2=Contingencia, 3=Sin Internet
      - Código de Seguridad (8)
    """
    now = datetime.now()
    dia = f"{now.day:02d}"
    mes = f"{now.month:02d}"
    anio = f"{now.year % 100:02d}"

    digits_only = "".join(ch for ch in str(cedula) if ch.isdigit())
    if not digits_only:
        digits_only = "3101849201"
    cedula_12 = digits_only[:12].zfill(12)

    suc_3 = "".join(ch for ch in str(sucursal) if ch.isdigit())[:3].zfill(3)
    term_5 = "".join(ch for ch in str(terminal) if ch.isdigit())[:5].zfill(5)
    tipo_2 = "".join(ch for ch in str(tipo_doc) if ch.isdigit())[:2].zfill(2)
    num_10 = f"{int(consecutivo_num):010d}"

    consecutivo_20 = f"{suc_3}{term_5}{tipo_2}{num_10}"
    sit_1 = str(situacion)[0] if str(situacion) in ("1", "2", "3") else "1"
    seguridad_8 = f"{random.randint(10000000, 99999999)}"

    clave_50 = f"506{dia}{mes}{anio}{cedula_12}{consecutivo_20}{sit_1}{seguridad_8}"
    return {
        "clave_50": clave_50,
        "consecutivo_20": consecutivo_20,
    }


def generate_xml_v44(
    clave: str,
    consecutivo: str,
    receptor_nombre: str,
    receptor_cedula: str,
    cabys_codigo: str,
    detalle: str,
    cantidad: float,
    precio_unitario: float,
    tarifa_iva: float,
    moneda: str = "CRC",
) -> str:
    subtotal = round(cantidad * precio_unitario, 2)
    impuesto = round(subtotal * (tarifa_iva / 100.0), 2)
    total = round(subtotal + impuesto, 2)
    fecha_emision = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-06:00")

    return f"""<?xml version="1.0" encoding="utf-8"?>
<FacturaElectronica xmlns="https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Clave>{clave}</Clave>
  <CodigoActividad>722003</CodigoActividad>
  <NumeroConsecutivo>{consecutivo}</NumeroConsecutivo>
  <FechaEmision>{fecha_emision}</FechaEmision>
  <Emisor>
    <Nombre>AURAFLOW TECH COSTA RICA S.A.</Nombre>
    <Identificacion>
      <Tipo>02</Tipo>
      <Numero>3101849201</Numero>
    </Identificacion>
    <CorreoElectronico>support@auraflowtech.lat</CorreoElectronico>
  </Emisor>
  <Receptor>
    <Nombre>{receptor_nombre}</Nombre>
    <Identificacion>
      <Tipo>01</Tipo>
      <Numero>{receptor_cedula}</Numero>
    </Identificacion>
  </Receptor>
  <CondicionVenta>01</CondicionVenta>
  <MedioPago>04</MedioPago>
  <DetalleServicio>
    <LineaDetalle>
      <NumeroLinea>1</NumeroLinea>
      <CodigoCABYS>{cabys_codigo}</CodigoCABYS>
      <Cantidad>{cantidad:.2f}</Cantidad>
      <UnidadMedida>Sp</UnidadMedida>
      <Detalle>{detalle}</Detalle>
      <PrecioUnitario>{precio_unitario:.2f}</PrecioUnitario>
      <MontoTotal>{subtotal:.2f}</MontoTotal>
      <SubTotal>{subtotal:.2f}</SubTotal>
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifaIVA>08</CodigoTarifaIVA>
        <Tarifa>{tarifa_iva:.2f}</Tarifa>
        <Monto>{impuesto:.2f}</Monto>
      </Impuesto>
      <MontoTotalLinea>{total:.2f}</MontoTotalLinea>
    </LineaDetalle>
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda>
      <CodigoMoneda>{moneda}</CodigoMoneda>
      <TipoCambio>{"1.00" if moneda == "CRC" else "515.00"}</TipoCambio>
    </CodigoTipoMoneda>
    <TotalVenta>{subtotal:.2f}</TotalVenta>
    <TotalVentaNeta>{subtotal:.2f}</TotalVentaNeta>
    <TotalImpuesto>{impuesto:.2f}</TotalImpuesto>
    <TotalComprobante>{total:.2f}</TotalComprobante>
  </ResumenFactura>
  <Normativa>
    <NumeroResolucion>MH-DGT-RES-0027-2024</NumeroResolucion>
    <FechaResolucion>2024-11-19T00:00:00-06:00</FechaResolucion>
  </Normativa>
</FacturaElectronica>"""


def init_db() -> None:
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='facturas_cr'"
    )
    has_v44 = cursor.fetchone() is not None

    if not has_v44:
        cursor.execute("DROP TABLE IF EXISTS executions")
        cursor.execute("DROP TABLE IF EXISTS workflows")
        cursor.execute("DROP TABLE IF EXISTS leads")
        cursor.execute("DROP TABLE IF EXISTS services")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS facturas_cr (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clave_50 TEXT NOT NULL,
            consecutivo_20 TEXT NOT NULL,
            tipo_doc TEXT NOT NULL DEFAULT 'Factura Electrónica',
            cliente_nombre TEXT NOT NULL,
            cliente_cedula TEXT NOT NULL,
            cliente_correo TEXT NOT NULL,
            cabys_codigo TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            cantidad REAL NOT NULL DEFAULT 1,
            precio_unitario REAL NOT NULL,
            tarifa_iva REAL NOT NULL DEFAULT 13.0,
            moneda TEXT NOT NULL DEFAULT 'CRC',
            subtotal REAL NOT NULL,
            monto_iva REAL NOT NULL,
            total REAL NOT NULL,
            estado_hacienda TEXT NOT NULL DEFAULT 'ACEPTADO · HACIENDA CR v4.4',
            xml_payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subdomains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subdomain TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ONLINE',
            latency_ms INTEGER NOT NULL DEFAULT 12,
            ssl_grade TEXT NOT NULL DEFAULT 'TLS 1.3'
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workflows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            nodes_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            avg_duration_ms INTEGER NOT NULL DEFAULT 280,
            success_rate REAL NOT NULL DEFAULT 99.8,
            runs_count INTEGER NOT NULL DEFAULT 0,
            time_saved_hrs REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workflow_id INTEGER NOT NULL,
            workflow_name TEXT NOT NULL,
            status TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            payload_summary TEXT NOT NULL,
            steps_log_json TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            FOREIGN KEY (workflow_id) REFERENCES workflows (id)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL DEFAULT '+506 8888-0000',
            company TEXT NOT NULL,
            sector TEXT NOT NULL DEFAULT 'PYME / Comercio CR',
            plan_interest TEXT NOT NULL,
            monthly_budget TEXT NOT NULL,
            automation_goal TEXT NOT NULL,
            estimated_roi_usd INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'nuevo_whatsapp',
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            node_code TEXT NOT NULL,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL,
            description TEXT NOT NULL,
            icon TEXT NOT NULL,
            features_json TEXT NOT NULL,
            impact_metric TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS loyalty_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            member_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            points INTEGER NOT NULL DEFAULT 420,
            tier TEXT NOT NULL DEFAULT 'Plata',
            total_purchases_crc REAL NOT NULL DEFAULT 185000,
            updated_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sso_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code_6 TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS citas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente TEXT NOT NULL,
            telefono TEXT NOT NULL,
            servicio TEXT NOT NULL,
            fecha TEXT NOT NULL,
            hora TEXT NOT NULL,
            notas TEXT NOT NULL DEFAULT '',
            estado TEXT NOT NULL DEFAULT 'pendiente',
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            nombre TEXT NOT NULL,
            cabys TEXT NOT NULL,
            precio REAL NOT NULL,
            tarifa_iva REAL NOT NULL DEFAULT 13,
            stock INTEGER NOT NULL DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sso_tokens (
            token TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS oraciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            ciudad TEXT NOT NULL DEFAULT '',
            motivo TEXT NOT NULL DEFAULT 'Petición de oración',
            mensaje TEXT NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'peticion',
            canal TEXT NOT NULL DEFAULT 'web',
            estado TEXT NOT NULL DEFAULT 'recibida',
            created_at TEXT NOT NULL
        )
    """)

    cursor.execute("SELECT COUNT(*) as count FROM productos")
    if cursor.fetchone()["count"] == 0:
        cursor.executemany(
            "INSERT INTO productos (codigo, nombre, cabys, precio, tarifa_iva, stock) VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("7441001000011", "Café Chirripó 500 g", "2111100000000", 3800, 1, 48),
                ("7441001000028", "Arroz 1 kg", "2111100000000", 1450, 1, 120),
                ("7441001000035", "Frijoles negros 900 g", "2111100000000", 1650, 1, 85),
                ("7441001000042", "Aceite vegetal 1 L", "2111100000000", 2300, 1, 40),
                ("7441001000059", "Refresco 2.5 L", "2399000000000", 1900, 13, 60),
                ("7441001000066", "Detergente 1 kg", "3532000000000", 2750, 13, 35),
                ("7441001000073", "Pan cuadrado", "2349000000000", 1550, 13, 25),
                ("7441001000080", "Leche 1 L", "2211100000000", 1050, 1, 70),
            ],
        )

    cursor.execute("SELECT COUNT(*) as count FROM facturas_cr")
    if cursor.fetchone()["count"] == 0:
        _seed_initial_data(cursor)

    conn.commit()
    conn.close()


def _seed_initial_data(cursor: sqlite3.Cursor) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    services = [
        (
            "auraflow-builder",
            "NODO 01 • IA",
            "AuraFlow Builder",
            "Flujos Visuales WhatsApp & Agentes Autónomos 24/7",
            "Plataforma visual SaaS para diseñar, simular y orquestar flujos conversacionales automatizados e integrados con Inteligencia Artificial Multi-Device para WhatsApp 24/7.",
            "bot",
            json.dumps([
                "Flujos Visuales WhatsApp (Low-Code / Drag & Drop)",
                "Agentes Autónomos 24/7 con memoria contextual y RAG",
                "Reconocimiento de intenciones ('precios', 'factura', 'cita', 'catálogo')",
                "Conexión directa con POS, inventario, agenda médica y Factura CR v4.4"
            ]),
            "SINCRONIZADO 24/7 · bot.auraflowtech.lat"
        ),
        (
            "factura-cr-v44",
            "NODO 02 • HACIENDA",
            "Factura CR v4.4",
            "ERP & Facturación Electrónica Ministerio de Hacienda CR",
            "Emisión en tiempo real de Facturas Electrónicas, Tiquetes Electrónicos y Notas de Crédito/Débito 100% homologadas con la normativa v4.4 de Tributación Costa Rica.",
            "invoice",
            json.dumps([
                "Clave Numérica Oficial de 50 Dígitos + Consecutivo de 20 Dígitos",
                "Catálogo CABYS integrado y cálculo automático de IVA Ley 9635 (13%, 4%, 2%, 1%)",
                "Firma Criptográfica XAdES-EPES y envío directo de XML v4.4 a Hacienda",
                "Emisión desde Punto de Venta (POS) o directamente por mensaje de WhatsApp"
            ]),
            "✓ SINCRONIZADO 24/7 · fac.auraflowtech.lat"
        ),
        (
            "auraflow-id-cloud",
            "NODO 03 • SSO",
            "AuraFlow ID Cloud",
            "Single Sign-On (SSO) · 1 Cuenta Multi-Plataforma",
            "Sistema de identidad unificada respaldado por MongoDB y TLS 1.3 para acceder sin fricción a los 16 subdominios del ecosistema AuraFlow Tech con verificación de 6 dígitos.",
            "shield",
            json.dumps([
                "1 Cuenta Multi-Plataforma para Facturador, Bot IA, CRM, POS y Radio PTT",
                "Autenticación segura con código de 6 dígitos vía support@auraflowtech.lat",
                "Control de roles, permisos corporativos y sesiones cifradas con SSL TLS 1.3",
                "Infraestructura Cloud VPS activa 24/7 desde Zona Sur para todo Costa Rica"
            ]),
            "SSO UNIFICADO · id.auraflowtech.lat"
        ),
        (
            "auraflow-radio-ptt",
            "NODO 04 • TELEMETRÍA",
            "AuraFlow PTT Radio & Radar GPS",
            "Comunicación Táctica en Vivo y Telemetría Satelital",
            "Plataforma web de radio Push-To-Talk (PTT) de baja latencia con canales encriptados, indicativos (Callsigns) y radar GPS en tiempo real para flotas, seguridad y logística.",
            "radio",
            json.dumps([
                "Canales de voz Push-To-Talk (PTT) instantáneos desde navegador o móvil",
                "Radar GPS en tiempo real con telemetría de unidades e indicativos (Callsigns)",
                "Integración con alertas operativas y despacho automatizado",
                "Acceso protegido mediante código seguro y AuraFlow ID"
            ]),
            "RADAR GPS EN VIVO · radio.auraflowtech.lat"
        )
    ]

    cursor.executemany("""
        INSERT INTO services (slug, node_code, title, subtitle, description, icon, features_json, impact_metric)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, services)

    subdomains = [
        ("fac.auraflowtech.lat", "AuraFlow Factura CR v4.4", "Hacienda & ERP", "Emisión de comprobantes electrónicos v4.4, Clave 50 dígitos, CABYS e IVA Ley 9635.", "ONLINE", 11, "TLS 1.3"),
        ("bot.auraflowtech.lat", "AuraFlow Builder & WaBot IA", "IA & WhatsApp", "Orquestador visual de chatbots con IA multi-dispositivo 24/7 para WhatsApp.", "ONLINE", 14, "TLS 1.3"),
        ("id.auraflowtech.lat", "AuraFlow ID Cloud (SSO)", "Seguridad & SSO", "Autenticación centralizada MongoDB con códigos de 6 dígitos vía support@auraflowtech.lat.", "ONLINE", 9, "TLS 1.3"),
        ("demo.auraflowtech.lat", "AuraFlow Sandbox & Demos", "Sandbox Interactivo", "Entorno de pruebas en vivo: Facturador v4.4, Bot IA, Kanban CRM y Club de Puntos.", "ONLINE", 12, "TLS 1.3"),
        ("openclaw.auraflowtech.lat", "OpenClaw Autonomous Node", "Agentes IA", "Motor de ejecución autónoma de agentes cognitivos y automatización de procesos.", "ONLINE", 18, "TLS 1.3"),
        ("radio.auraflowtech.lat", "AuraFlow PTT Radio & GPS", "Telemetría & PTT", "Walkie-talkie táctico web Push-To-Talk y radar GPS en tiempo real con Callsigns.", "ONLINE", 15, "TLS 1.3"),
        ("panel.auraflowtech.lat", "Cloud VPS Control Panel", "Infraestructura", "Gestión de recursos Cloud VPS, contenedores, métricas y monitoreo 24/7.", "ONLINE", 10, "TLS 1.3"),
        ("admin.auraflowtech.lat", "Consola Central Admin SSO", "Administración", "Panel administrativo multi-tenant para gestión de clientes, licencias y nodos.", "ONLINE", 11, "TLS 1.3"),
        ("pos.auraflowtech.lat", "AuraFlow POS & Inventario", "Comercio & Retail", "Punto de venta adaptativo con código de barras, control de stock y tiquete electrónico v4.4.", "ONLINE", 13, "TLS 1.3"),
        ("crm.auraflowtech.lat", "AuraFlow Kanban CRM", "Ventas & Leads", "Embudo comercial en tiempo real conectado directamente a conversaciones de WhatsApp.", "ONLINE", 12, "TLS 1.3"),
        ("clinica.auraflowtech.lat", "AuraFlow Salud & Clínicas", "Sector Salud CR", "Agenda médica automatizada por WhatsApp, recordatorios y facturación con IVA 4%.", "ONLINE", 14, "TLS 1.3"),
        ("club.auraflowtech.lat", "AuraFlow Club de Lealtad", "Fidelización", "Tarjetas digitales de puntos (Bronce, Plata, Oro, Diamante) y cupones automáticos.", "ONLINE", 11, "TLS 1.3"),
        ("builder.auraflowtech.lat", "Flow Studio Low-Code", "Automatización", "Editor visual de árboles de decisión, webhooks y conectores API empresariales.", "ONLINE", 16, "TLS 1.3"),
        ("api.auraflowtech.lat", "Gateway REST & Webhooks", "Core API", "Pasarela de microservicios de alta disponibilidad para integración con bancos y Hacienda.", "ONLINE", 8, "TLS 1.3"),
        ("status.auraflowtech.lat", "Uptime & Telemetry Monitor", "Observabilidad", "Monitor público de SLA 99.98% y estado de conexión con el Ministerio de Hacienda.", "ONLINE", 7, "TLS 1.3"),
        ("cdn.auraflowtech.lat", "AuraFlow Edge Assets & XML", "Almacenamiento", "Distribución segura de esquemas XML v4.4, PDFs firmados y recursos estáticos.", "ONLINE", 6, "TLS 1.3"),
    ]

    cursor.executemany("""
        INSERT INTO subdomains (subdomain, name, category, description, status, latency_ms, ssl_grade)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, subdomains)

    sample_invoices_data = [
        ("Clínica Dental Brunca S.A.", "3101754321", "facturacion@clinicabrunca.cr", "8512010000000", "Suscripción Mensual AuraFlow Salud + Bot Citas WhatsApp 24/7", 1, 45000.0, 4.0, "CRC", "Factura Electrónica"),
        ("Supermercado & Agro Zona Sur", "3102698114", "admin@agrozona.cr", "8314300000000", "Licencia ERP POS + Facturación Electrónica Hacienda CR v4.4", 1, 68000.0, 13.0, "CRC", "Factura Electrónica"),
        ("Distribuidora Café Chirripó", "109840552", "ventas@cafechirripo.cr", "8313100000000", "Implementación AuraFlow Builder + CRM Kanban & Club de Puntos", 1, 95000.0, 13.0, "CRC", "Tiquete Electrónico"),
    ]

    for idx, (nom, ced, cor, cabys, desc, cant, precio, iva, mon, tdoc) in enumerate(sample_invoices_data, start=1):
        claves = generate_clave_50_digitos(cedula="3101849201", tipo_doc="01" if "Factura" in tdoc else "04", consecutivo_num=1040 + idx)
        sub = round(cant * precio, 2)
        m_iva = round(sub * (iva / 100.0), 2)
        tot = round(sub + m_iva, 2)
        xml_str = generate_xml_v44(claves["clave_50"], claves["consecutivo_20"], nom, ced, cabys, desc, cant, precio, iva, mon)
        cursor.execute("""
            INSERT INTO facturas_cr (
                clave_50, consecutivo_20, tipo_doc, cliente_nombre, cliente_cedula, cliente_correo,
                cabys_codigo, descripcion, cantidad, precio_unitario, tarifa_iva, moneda,
                subtotal, monto_iva, total, estado_hacienda, xml_payload, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACEPTADO · HACIENDA CR v4.4', ?, ?)
        """, (
            claves["clave_50"], claves["consecutivo_20"], tdoc, nom, ced, cor,
            cabys, desc, cant, precio, iva, mon, sub, m_iva, tot, xml_str, now
        ))

    workflows = [
        (
            "WaBot IA 24/7 + Emisión Automática Factura CR v4.4",
            "WhatsApp + Hacienda v4.4",
            "Atiende al cliente por WhatsApp 24/7, muestra catálogo con precios, confirma pago SINPE Móvil / Tarjeta y emite automáticamente la Factura Electrónica v4.4 con clave de 50 dígitos.",
            "WhatsApp Multi-Device Webhook",
            json.dumps([
                {"step": 1, "name": "WhatsApp Gateway 24/7", "type": "trigger", "detail": "Recibe mensaje del cliente ('precios', 'comprar' o comprobante SINPE)"},
                {"step": 2, "name": "AuraFlow Builder IA Agent", "type": "ai", "detail": "Identifica productos, valida cédula en Padrón de Hacienda y calcula IVA Ley 9635"},
                {"step": 3, "name": "Motor Factura CR v4.4", "type": "erp", "detail": "Genera Clave de 50 dígitos, asigna código CABYS y firma XML v4.4"},
                {"step": 4, "name": "Ministerio de Hacienda API", "type": "security", "detail": "Envía comprobante y recibe acuse ACEPTADO en tiempo real"},
                {"step": 5, "name": "Entrega PDF/XML + Puntos Lealtad", "type": "notification", "detail": "Envía PDF y XML por WhatsApp/Correo y acredita puntos al cliente"}
            ]),
            "active",
            265,
            99.9,
            2840,
            640.0,
            now
        ),
        (
            "Agenda Médica Clínicas CR + Recordatorio WhatsApp + IVA 4%",
            "Clínicas & Salud CR",
            "Automatiza la reserva de citas médicas en clínicas y consultorios, envía recordatorios automáticos por WhatsApp y prepara el comprobante electrónico con tarifa reducida de salud (4% IVA).",
            "WhatsApp / Web Booking",
            json.dumps([
                {"step": 1, "name": "Solicitud de Cita WhatsApp", "type": "trigger", "detail": "Paciente consulta disponibilidad de especialidad u odontología"},
                {"step": 2, "name": "AuraFlow Salud IA", "type": "ai", "detail": "Verifica horarios disponibles y registra expediente del paciente"},
                {"step": 3, "name": "Confirmación & Recordatorio 24h", "type": "notification", "detail": "Envía confirmación interactiva por WhatsApp evitando ausencias"},
                {"step": 4, "name": "Facturación Clínica v4.4 (IVA 4%)", "type": "erp", "detail": "Aplica código CABYS médico e IVA 4% Ley 9635 al finalizar consulta"}
            ]),
            "active",
            230,
            99.8,
            1590,
            410.5,
            now
        ),
        (
            "AuraFlow ID Cloud SSO & Verificación 6 Dígitos",
            "Seguridad & SSO",
            "Gestiona el inicio de sesión único (Single Sign-On) en los 16 subdominios de AuraFlow Tech enviando un código seguro de 6 dígitos desde support@auraflowtech.lat.",
            "SSO Auth Request (id.auraflowtech.lat)",
            json.dumps([
                {"step": 1, "name": "Solicitud Acceso SSO", "type": "trigger", "detail": "Usuario ingresa correo en cualquiera de los 16 subdominios"},
                {"step": 2, "name": "MongoDB Identity Lookup", "type": "database", "detail": "Verifica perfil corporativo, permisos y licencias activas"},
                {"step": 3, "name": "Generador OTP 6 Dígitos", "type": "security", "detail": "Despacha código cifrado desde support@auraflowtech.lat"},
                {"step": 4, "name": "Sesión Global TLS 1.3", "type": "api", "detail": "Habilita acceso simultáneo a Facturador, Bot IA, CRM y Radio PTT"}
            ]),
            "active",
            180,
            99.95,
            4120,
            520.0,
            now
        )
    ]

    cursor.executemany("""
        INSERT INTO workflows (
            name, category, description, trigger_type, nodes_json,
            status, avg_duration_ms, success_rate, runs_count, time_saved_hrs, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, workflows)

    executions = [
        (
            1,
            "WaBot IA 24/7 + Emisión Automática Factura CR v4.4",
            "success",
            258,
            "Factura v4.4 Emitida · Clave 506... · Clínica Dental Brunca (₡46,800)",
            json.dumps([
                {"node": "WhatsApp Gateway 24/7", "status": "ok", "ms": 14, "output": "Mensaje recibido de +506 8742-1900: 'Confirmar pago y enviar factura'"},
                {"node": "AuraFlow Builder IA Agent", "status": "ok", "ms": 62, "output": "Cédula Jurídica 3-101-754321 validada · CABYS 8512010000000"},
                {"node": "Motor Factura CR v4.4", "status": "ok", "ms": 84, "output": "Clave 50 dígitos generada y XML v4.4 firmado"},
                {"node": "Ministerio de Hacienda API", "status": "ok", "ms": 72, "output": "Estado Hacienda: ACEPTADO (MH-DGT-RES-0027-2024)"},
                {"node": "Entrega PDF/XML + Puntos Lealtad", "status": "ok", "ms": 26, "output": "Comprobante enviado por WhatsApp y +45 pts acreditados"}
            ]),
            now
        ),
        (
            3,
            "AuraFlow ID Cloud SSO & Verificación 6 Dígitos",
            "success",
            168,
            "SSO Login Verificado · santiago@auraflowtech.lat [16 Nodos Activos]",
            json.dumps([
                {"node": "Solicitud Acceso SSO", "status": "ok", "ms": 12, "output": "Origen: panel.auraflowtech.lat · TLS 1.3"},
                {"node": "MongoDB Identity Lookup", "status": "ok", "ms": 44, "output": "Rol: SuperAdmin · Ing. Santiago Delgado Leiva"},
                {"node": "Generador OTP 6 Dígitos", "status": "ok", "ms": 68, "output": "Código de 6 dígitos enviado vía support@auraflowtech.lat"},
                {"node": "Sesión Global TLS 1.3", "status": "ok", "ms": 44, "output": "Token SSO multi-dominio emitido correctamente"}
            ]),
            now
        )
    ]

    cursor.executemany("""
        INSERT INTO executions (
            workflow_id, workflow_name, status, duration_ms, payload_summary, steps_log_json, executed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, executions)

    leads = [
        (
            "Dr. Esteban Mora",
            "emora@clinicasanisi.cr",
            "+506 8821-4500",
            "Centro Médico Pérez Zeledón",
            "Clínicas & Salud CR",
            "Plan PYME Pro (WaBot IA + Factura CR v4.4)",
            "₡65,000 - ₡120,000 / mes",
            "Automatizar citas por WhatsApp 24/7 y emitir factura electrónica v4.4 con IVA 4% para pacientes.",
            4800,
            "calificado_ia",
            now
        ),
        (
            "Laura Jiménez Vindas",
            "ljimenez@ferreteriasur.cr",
            "+506 8390-1122",
            "Ferretería & Materiales El Sur",
            "PYME / Comercio CR",
            "Plan Ecosistema Cloud Completo",
            "₡120,000 - ₡250,000 / mes",
            "Conectar catálogo de 3,500 artículos con CABYS, POS en tienda y cotizador automático por WhatsApp.",
            9200,
            "en_sandbox",
            now
        ),
        (
            "Andrés Solís Quesada",
            "asolis@logisticabrunca.cr",
            "+506 8510-9988",
            "Logística & Seguridad Brunca",
            "Logística & Flotas",
            "AuraFlow PTT Radio + ERP Factura v4.4",
            "₡95,000 / mes",
            "Radio PTT táctico con radar GPS para 18 unidades en Zona Sur y facturación mensual automatizada.",
            6400,
            "cerrado_v44",
            now
        ),
        (
            "Mariela Castro",
            "mcastro@boutiqueosa.cr",
            "+506 8944-3311",
            "Boutique & Café Bahía Osa",
            "Comercio & Lealtad",
            "Plan Emprendedor CR v4.4",
            "₡35,000 - ₡65,000 / mes",
            "Tiquete electrónico v4.4 rápido desde el celular y tarjeta digital de puntos para clientes frecuentes.",
            3100,
            "nuevo_whatsapp",
            now
        )
    ]

    cursor.executemany("""
        INSERT INTO leads (
            name, email, phone, company, sector, plan_interest, monthly_budget, automation_goal, estimated_roi_usd, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, leads)

    loyalty = [
        ("Valeria Navarro", "+506 8711-2233", 420, "Plata", 210000, now),
        ("Roberto Hidalgo", "+506 8844-5566", 1150, "Oro", 575000, now),
        ("Grettel Araya", "+506 8322-9900", 2650, "Diamante", 1325000, now),
    ]
    cursor.executemany("""
        INSERT INTO loyalty_members (member_name, phone, points, tier, total_purchases_crc, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, loyalty)
