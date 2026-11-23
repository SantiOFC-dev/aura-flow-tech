# ⚡ AuraFlow Tech (`auraflowtech.lat`) — Software, IA para WhatsApp y Facturación Electrónica CR v4.4

Plataforma Full-Stack para **AuraFlow Tech**, fundada por el **Ing. Santiago Delgado Leiva** (Zona Sur, Costa Rica). Especializada en **Bots de WhatsApp con IA 24/7**, **AuraFlow Builder**, **Facturación Electrónica Hacienda Costa Rica v4.4** y **AuraFlow ID Cloud (SSO)**.

## 🏗️ Nodos Principales del Ecosistema

1. **NODO 01 • IA (`AuraFlow Builder` — `bot.auraflowtech.lat`)**:
   - Orquestador de flujos visuales para WhatsApp 24/7 y agentes autónomos.
2. **NODO 02 • HACIENDA (`Factura CR v4.4` — `fac.auraflowtech.lat`)**:
   - Emisor de comprobantes electrónicos homologado con el Ministerio de Hacienda CR (Clave Numérica de 50 dígitos, Consecutivo de 20 dígitos, catálogo CABYS, IVA Ley 9635 al 13%, 4%, 2%, 1% y XML v4.4 firmado).
3. **NODO 03 • SSO (`AuraFlow ID Cloud` — `id.auraflowtech.lat`)**:
   - Inicio de sesión único (Single Sign-On) para los **16 subdominios activos** mediante códigos de 6 dígitos enviados desde `support@auraflowtech.lat`.

## 🖼️ Vista Previa Open Graph (WhatsApp / Redes Sociales)

- `/og-image.png` y `/og-image.svg` (1200×630 px) servidos directamente en `https://auraflowtech.lat/og-image.png` con margen optimizado para evitar recortes en WhatsApp.

## 🚀 Servicio en Producción (24/7)

- **Systemd Service**: `auraflow.service` (`/etc/systemd/system/auraflow.service`)
- **Reverse Proxy & SSL TLS 1.3**: Nginx (`/etc/nginx/sites-available/auraflowtech.lat`) + Certbot Let's Encrypt.

```bash
systemctl status auraflow.service
systemctl status nginx
```

## 🔌 Endpoints de la API REST

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Estado operativo del ecosistema Cloud VPS y normativa v4.4 |
| `GET` | `/api/metrics` | Telemetría en vivo (comprobantes v4.4, 16 subdominios, ahorro en ₡ y USD) |
| `GET` | `/api/services` | Los 4 nodos principales del ecosistema AuraFlow Tech |
| `GET` | `/api/subdomains` | Estado y latencia de los 16 subdominios activos (`*.auraflowtech.lat`) |
| `GET/POST` | `/api/facturas` | Emisión en vivo de Factura Electrónica CR v4.4 (Clave 50 dígitos + XML) |
| `POST` | `/api/terminal` | Consola CLI interactiva (`--status`, `--factura-v4.4`, `--wabot-ia`, `--sso`, `--cotizar`) |
| `GET/POST` | `/api/workflows` | Gestión de flujos de AuraFlow Builder |
| `POST` | `/api/workflows/simulate` | Simulador de ejecución nodo por nodo en tiempo real |
| `POST` | `/api/roi-calculator` | Calculadora de ahorro mensual/anual en Colones (`₡`) y USD (`$`) |
| `POST` | `/api/wabot-chat` | Agente conversacional WaBot IA 24/7 |
| `POST` | `/api/sso/send-code` | Envío de código OTP de 6 dígitos de AuraFlow ID Cloud |
| `POST` | `/api/sso/verify` | Verificación de sesión SSO para los 16 subdominios |
| `GET/POST` | `/api/loyalty` | Club de Lealtad y Puntos (Bronce, Plata, Oro, Diamante) |
| `GET/POST` | `/api/leads` | Pipeline Kanban CRM y solicitudes de cotización |
