#!/usr/bin/env python3
"""
API de las web apps por subdominio (pos, clinica, club, crm, admin, id).
handle_get / handle_post devuelven (data, status) o None si la ruta no es suya.
"""

import secrets
from datetime import datetime, timedelta

from database import generate_clave_50_digitos, generate_xml_v44, get_connection

TOKEN_TTL_H = 12
LEAD_STATUSES = ["nuevo_whatsapp", "whatsapp_activo", "calificado_ia", "propuesta", "negociacion", "ganado", "perdido"]
CITA_ESTADOS = ["pendiente", "confirmada", "atendida", "cancelada"]

VERSICULOS_DIARIOS = [
    {
        "cita": "Filipenses 4:6-7",
        "RVR1960": "Por nada estéis afanosos, sino sean conocidas vuestras peticiones delante de Dios en toda oración y ruego, con acción de gracias. Y la paz de Dios, que sobrepasa todo entendimiento, guardará vuestros corazones y vuestros pensamientos en Cristo Jesús.",
        "NVI": "No se inquieten por nada; más bien, en toda ocasión, con oración y ruego, presenten sus peticiones a Dios y denle gracias. Y la paz de Dios, que sobrepasa todo entendimiento, cuidará sus corazones y sus pensamientos en Cristo Jesús.",
        "reflexion": "Entrégale a Dios tus preocupaciones en oración; Su paz guardará tu mente y tu corazón."
    },
    {
        "cita": "Romanos 8:28",
        "RVR1960": "Y sabemos que a los que aman a Dios, todas las cosas les ayudan a bien, esto es, a los que conforme a su propósito son llamados.",
        "NVI": "Ahora bien, sabemos que Dios dispone todas las cosas para el bien de quienes lo aman, los que han sido llamados de acuerdo con su propósito.",
        "reflexion": "Dios tiene el poder de transformar incluso las situaciones más difíciles en escalones para tu crecimiento y bendición."
    },
    {
        "cita": "Jeremías 29:11",
        "RVR1960": "Porque yo sé los pensamientos que tengo acerca de vosotros, dice Jehová, pensamientos de paz, y no de mal, para daros el fin que esperáis.",
        "NVI": "Porque yo sé muy bien los planes que tengo para ustedes —afirma el Señor—, planes de bienestar y no de calamidad, a fin de darles un futuro y una esperanza.",
        "reflexion": "Tu futuro está en las manos de un Dios bueno que diseña esperanza y propósito para tu vida."
    },
    {
        "cita": "Isaías 41:10",
        "RVR1960": "No temas, porque yo estoy contigo; no desmayes, porque yo soy tu Dios que te esfuerzo; siempre te ayudaré, siempre te sustentaré con la diestra de mi justicia.",
        "NVI": "Así que no temas, porque yo estoy contigo; no te angusties, porque yo soy tu Dios. Te fortaleceré y te ayudaré; te sostendré con mi diestra victoriosa.",
        "reflexion": "Nunca caminas solo: la fuerza de Dios te sostiene justo cuando sientes que te faltan fuerzas."
    },
    {
        "cita": "Salmos 23:1-3",
        "RVR1960": "Jehová es mi pastor; nada me faltará. En lugares de delicados pastos me hará descansar; junto a aguas de reposo me pastoreará. Confortará mi alma.",
        "NVI": "El Señor es mi pastor, nada me falta; en verdes pastos me hace descansar. Junto a tranquilas aguas me conduce; me infunde nuevas fuerzas.",
        "reflexion": "Descansa hoy en el cuidado fiel del Buen Pastor, quien restaura tu alma."
    },
    {
        "cita": "Mateo 11:28",
        "RVR1960": "Venid a mí todos los que estáis trabajados y cargados, y yo os haré descansar.",
        "NVI": "Vengan a mí todos ustedes que están cansados y agobiados, y yo les daré descanso.",
        "reflexion": "Jesús te invita a soltar hoy el peso que llevas y recibir Su descanso verdadero."
    },
    {
        "cita": "Juan 3:16",
        "RVR1960": "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.",
        "NVI": "Porque tanto amó Dios al mundo que dio a su Hijo unigénito, para que todo el que cree en él no se pierda, sino que tenga vida eterna.",
        "reflexion": "El amor de Dios es tan grande que abrió un camino de salvación y vida nueva para ti."
    },
]


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


# --------------------------------------------------------------------------- #
# SSO real (tokens con expiración en BD)
# --------------------------------------------------------------------------- #

def issue_token(email: str) -> str:
    token = "af_" + secrets.token_urlsafe(32)
    exp = (datetime.now() + timedelta(hours=TOKEN_TTL_H)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_connection()
    conn.execute("INSERT INTO sso_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)", (token, email, _now(), exp))
    conn.commit()
    conn.close()
    return token


def token_email(headers) -> str | None:
    auth = (headers.get("Authorization") or "").strip()
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    conn = get_connection()
    row = conn.execute("SELECT email, expires_at FROM sso_tokens WHERE token = ?", (token,)).fetchone()
    conn.close()
    if not row or row["expires_at"] < _now():
        return None
    return row["email"]


def emitir_comprobante(cur, *, tipo_doc: str, cliente_nombre: str, cliente_cedula: str, cliente_correo: str,
                       cabys: str, descripcion: str, cantidad: float, precio_unitario: float,
                       tarifa_iva: float, moneda: str = "CRC", monto_iva: float | None = None) -> dict:
    cur.execute("SELECT COUNT(*) as c FROM facturas_cr")
    next_num = 1041 + int(cur.fetchone()["c"])
    tipo_cod = "01" if "Factura" in tipo_doc else ("04" if "Tiquete" in tipo_doc else "03")
    claves = generate_clave_50_digitos(cedula=cliente_cedula, sucursal="001", terminal="00001",
                                       tipo_doc=tipo_cod, consecutivo_num=next_num)
    subtotal = round(cantidad * precio_unitario, 2)
    if monto_iva is None:
        monto_iva = round(subtotal * (tarifa_iva / 100.0), 2)
    total = round(subtotal + monto_iva, 2)
    xml = generate_xml_v44(clave=claves["clave_50"], consecutivo=claves["consecutivo_20"],
                           receptor_nombre=cliente_nombre, receptor_cedula=cliente_cedula, cabys_codigo=cabys,
                           detalle=descripcion, cantidad=cantidad, precio_unitario=precio_unitario,
                           tarifa_iva=tarifa_iva, moneda=moneda)
    now = _now()
    cur.execute("""
        INSERT INTO facturas_cr (
            clave_50, consecutivo_20, tipo_doc, cliente_nombre, cliente_cedula, cliente_correo,
            cabys_codigo, descripcion, cantidad, precio_unitario, tarifa_iva, moneda,
            subtotal, monto_iva, total, estado_hacienda, xml_payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACEPTADO · HACIENDA CR v4.4', ?, ?)
    """, (claves["clave_50"], claves["consecutivo_20"], tipo_doc, cliente_nombre, cliente_cedula, cliente_correo,
          cabys, descripcion, cantidad, precio_unitario, tarifa_iva, moneda, subtotal, monto_iva, total, xml, now))
    return {"id": cur.lastrowid, "clave_50": claves["clave_50"], "consecutivo_20": claves["consecutivo_20"],
            "tipo_doc": tipo_doc, "cliente_nombre": cliente_nombre, "subtotal": subtotal, "monto_iva": monto_iva,
            "total": total, "moneda": moneda, "xml_payload": xml, "created_at": now,
            "estado_hacienda": "ACEPTADO · HACIENDA CR v4.4"}


# --------------------------------------------------------------------------- #
# GET
# --------------------------------------------------------------------------- #

def handle_get(path: str, query: dict, headers) -> tuple[dict, int] | None:
    if path == "/api/citas":
        conn = get_connection()
        fecha = (query.get("fecha") or [""])[0]
        if fecha:
            rows = _rows(conn.execute("SELECT * FROM citas WHERE fecha = ? ORDER BY hora", (fecha,)))
        else:
            rows = _rows(conn.execute("SELECT * FROM citas ORDER BY fecha DESC, hora DESC LIMIT 200"))
        conn.close()
        return {"citas": rows, "estados": CITA_ESTADOS}, 200

    if path == "/api/productos":
        conn = get_connection()
        rows = _rows(conn.execute("SELECT * FROM productos ORDER BY nombre"))
        conn.close()
        return {"productos": rows}, 200

    if path == "/api/leads/statuses":
        return {"statuses": LEAD_STATUSES}, 200

    if path == "/api/sso/me":
        email = token_email(headers)
        if not email:
            return {"error": "Sesión no válida o expirada"}, 401
        return {"email": email}, 200

    if path == "/api/versiculo-diario":
        version = (query.get("version") or ["RVR1960"])[0].upper()
        if version not in ("RVR1960", "NVI"):
            version = "RVR1960"
        doy = datetime.now().timetuple().tm_yday
        idx = doy % len(VERSICULOS_DIARIOS)
        v = VERSICULOS_DIARIOS[idx]
        return {
            "fecha": datetime.now().strftime("%Y-%m-%d"),
            "version": version,
            "cita": v["cita"],
            "texto": v[version],
            "reflexion": v["reflexion"],
            "RVR1960": v["RVR1960"],
            "NVI": v["NVI"],
        }, 200

    if path == "/api/oracion":
        conn = get_connection()
        hoy = datetime.now().strftime("%Y-%m-%d")
        total = conn.execute("SELECT COUNT(*) c FROM oraciones").fetchone()["c"]
        hoy_n = conn.execute("SELECT COUNT(*) c FROM oraciones WHERE created_at LIKE ?", (hoy + "%",)).fetchone()["c"]
        res = {"total": total, "hoy": hoy_n}
        if token_email(headers):
            res["oraciones"] = _rows(conn.execute("SELECT * FROM oraciones ORDER BY id DESC LIMIT 100"))
        conn.close()
        return res, 200

    if path == "/api/admin/overview":
        email = token_email(headers)
        if not email:
            return {"error": "Inicia sesión con AuraFlow ID"}, 401
        conn = get_connection()
        data = {
            "email": email,
            "facturas": dict(conn.execute("SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM facturas_cr").fetchone()),
            "leads": _rows(conn.execute("SELECT status, COUNT(*) n FROM leads GROUP BY status")),
            "citas": _rows(conn.execute("SELECT estado, COUNT(*) n FROM citas GROUP BY estado")),
            "club": dict(conn.execute("SELECT COUNT(*) n, COALESCE(SUM(points),0) puntos FROM loyalty_members").fetchone()),
            "oraciones": dict(conn.execute("SELECT COUNT(*) n FROM oraciones").fetchone()),
            "productos_bajo_stock": _rows(conn.execute("SELECT nombre, stock FROM productos WHERE stock <= 10 ORDER BY stock")),
            "sesiones": _rows(conn.execute("SELECT email, created_at FROM sso_tokens ORDER BY created_at DESC LIMIT 10")),
        }
        conn.close()
        return data, 200

    return None


# --------------------------------------------------------------------------- #
# POST
# --------------------------------------------------------------------------- #

def handle_post(path: str, body: dict, headers) -> tuple[dict, int] | None:
    if path == "/api/oracion":
        mensaje = str(body.get("mensaje", "")).strip()
        if not mensaje:
            return {"error": "El mensaje o motivo de oración es requerido"}, 400
        nombre = str(body.get("nombre", "")).strip() or "Anónimo"
        ciudad = str(body.get("ciudad", "")).strip()
        motivo = str(body.get("motivo", "")).strip() or "Petición de oración"
        tipo = str(body.get("tipo", "peticion")).strip() or "peticion"
        canal = str(body.get("canal", "web")).strip() or "web"
        now = _now()
        conn = get_connection()
        cur = conn.execute(
            "INSERT INTO oraciones (nombre, ciudad, motivo, mensaje, tipo, canal, estado, created_at) VALUES (?, ?, ?, ?, ?, ?, 'recibida', ?)",
            (nombre[:120], ciudad[:120], motivo[:120], mensaje[:2000], tipo[:40], canal[:40], now),
        )
        conn.commit()
        oid = cur.lastrowid
        row = dict(conn.execute("SELECT * FROM oraciones WHERE id = ?", (oid,)).fetchone())
        conn.close()
        return {"ok": True, "oracion": row}, 201
    if path == "/api/citas":
        paciente = str(body.get("paciente", "")).strip()
        telefono = str(body.get("telefono", "")).strip()
        servicio = str(body.get("servicio", "Consulta general")).strip() or "Consulta general"
        fecha = str(body.get("fecha", "")).strip()
        hora = str(body.get("hora", "")).strip()
        notas = str(body.get("notas", "")).strip()[:500]
        if not paciente or not telefono or not fecha or not hora:
            return {"error": "Paciente, teléfono, fecha y hora son requeridos"}, 400
        conn = get_connection()
        clash = conn.execute("SELECT id FROM citas WHERE fecha = ? AND hora = ? AND estado != 'cancelada'", (fecha, hora)).fetchone()
        if clash:
            conn.close()
            return {"error": f"Ya hay una cita el {fecha} a las {hora}"}, 409
        cur = conn.execute(
            "INSERT INTO citas (paciente, telefono, servicio, fecha, hora, notas, estado, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)",
            (paciente, telefono, servicio, fecha, hora, notas, _now()))
        conn.commit()
        cid = cur.lastrowid
        conn.close()
        return {"id": cid, "message": "Cita agendada"}, 201

    if path == "/api/citas/estado":
        estado = str(body.get("estado", ""))
        if estado not in CITA_ESTADOS:
            return {"error": "Estado inválido"}, 400
        conn = get_connection()
        conn.execute("UPDATE citas SET estado = ? WHERE id = ?", (estado, int(body.get("id", 0))))
        conn.commit()
        conn.close()
        return {"ok": True}, 200

    if path == "/api/citas/facturar":
        conn = get_connection()
        cur = conn.cursor()
        cita = cur.execute("SELECT * FROM citas WHERE id = ?", (int(body.get("id", 0)),)).fetchone()
        if not cita:
            conn.close()
            return {"error": "Cita no encontrada"}, 404
        precio = max(100.0, float(body.get("precio", 35000)))
        fac = emitir_comprobante(cur, tipo_doc="Factura Electrónica", cliente_nombre=cita["paciente"],
                                 cliente_cedula=str(body.get("cedula", "000000000")), cliente_correo="",
                                 cabys="8512010000000", descripcion=cita["servicio"], cantidad=1,
                                 precio_unitario=precio, tarifa_iva=4.0)
        cur.execute("UPDATE citas SET estado = 'atendida' WHERE id = ?", (cita["id"],))
        conn.commit()
        conn.close()
        return {"factura": fac}, 201

    if path == "/api/productos":
        codigo = str(body.get("codigo", "")).strip()
        nombre = str(body.get("nombre", "")).strip()
        if not codigo or not nombre:
            return {"error": "Código y nombre son requeridos"}, 400
        precio = max(0.0, float(body.get("precio", 0)))
        iva = float(body.get("tarifa_iva", 13))
        stock = int(body.get("stock", 0))
        cabys = str(body.get("cabys", "2399000000000")).strip() or "2399000000000"
        conn = get_connection()
        conn.execute("""
            INSERT INTO productos (codigo, nombre, cabys, precio, tarifa_iva, stock) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(codigo) DO UPDATE SET nombre=excluded.nombre, cabys=excluded.cabys,
              precio=excluded.precio, tarifa_iva=excluded.tarifa_iva, stock=excluded.stock
        """, (codigo, nombre, cabys, precio, iva, stock))
        conn.commit()
        conn.close()
        return {"ok": True}, 201

    if path == "/api/pos/venta":
        items = body.get("items") or []
        if not items:
            return {"error": "El carrito está vacío"}, 400
        conn = get_connection()
        cur = conn.cursor()
        subtotal = 0.0
        iva_total = 0.0
        lineas = []
        for it in items:
            p = cur.execute("SELECT * FROM productos WHERE id = ?", (int(it.get("id", 0)),)).fetchone()
            qty = max(1, int(it.get("cantidad", 1)))
            if not p:
                conn.close()
                return {"error": "Producto no encontrado"}, 404
            if p["stock"] < qty:
                conn.close()
                return {"error": f"Stock insuficiente de {p['nombre']} (quedan {p['stock']})"}, 409
            linea = p["precio"] * qty
            subtotal += linea
            iva_total += linea * p["tarifa_iva"] / 100.0
            lineas.append(f"{qty}x {p['nombre']}")
            cur.execute("UPDATE productos SET stock = stock - ? WHERE id = ?", (qty, p["id"]))
        subtotal = round(subtotal, 2)
        iva_total = round(iva_total, 2)
        tarifa_efectiva = round(iva_total / subtotal * 100, 2) if subtotal else 0
        fac = emitir_comprobante(cur, tipo_doc="Tiquete Electrónico",
                                 cliente_nombre=str(body.get("cliente", "Cliente Contado")).strip() or "Cliente Contado",
                                 cliente_cedula="000000000", cliente_correo="", cabys="2111100000000",
                                 descripcion="Venta POS: " + ", ".join(lineas)[:400], cantidad=1,
                                 precio_unitario=subtotal, tarifa_iva=tarifa_efectiva, monto_iva=iva_total)
        conn.commit()
        conn.close()
        return {"factura": fac}, 201

    if path == "/api/loyalty/members":
        name = str(body.get("member_name", "")).strip()
        phone = str(body.get("phone", "")).strip()
        if not name or not phone:
            return {"error": "Nombre y teléfono son requeridos"}, 400
        conn = get_connection()
        cur = conn.execute(
            "INSERT INTO loyalty_members (member_name, phone, points, tier, total_purchases_crc, updated_at) VALUES (?, ?, 0, 'Bronce', 0, ?)",
            (name, phone, _now()))
        conn.commit()
        mid = cur.lastrowid
        conn.close()
        return {"id": mid}, 201

    if path == "/api/leads/status":
        status = str(body.get("status", ""))
        if status not in LEAD_STATUSES:
            return {"error": "Estado inválido"}, 400
        conn = get_connection()
        conn.execute("UPDATE leads SET status = ? WHERE id = ?", (status, int(body.get("id", 0))))
        conn.commit()
        conn.close()
        return {"ok": True}, 200

    if path == "/api/sso/logout":
        auth = (headers.get("Authorization") or "")[7:].strip()
        conn = get_connection()
        conn.execute("DELETE FROM sso_tokens WHERE token = ?", (auth,))
        conn.commit()
        conn.close()
        return {"ok": True}, 200

    return None
