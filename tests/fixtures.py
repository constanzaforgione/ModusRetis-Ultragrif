"""Informe de prueba que ejercita los tipos de diapositiva que no usa el ejemplo de septiembre."""
from informe_mensual.spec import InformeMensual

def k(valor, etiqueta, direccion=None, texto="", tono="neutral"):
    d = {"valor": valor, "etiqueta": etiqueta}
    if direccion:
        d["variacion"] = {"direccion": direccion, "texto": texto, "tono": tono}
    return d

INFORME_VARIADO = InformeMensual.model_validate({
    "horas_totales": 224,
    "areas": [
        {"nombre": "Mercado Libre", "horas": 75, "descripcion": "Gestión de cuenta, reclamos, publicaciones y stock"},
        {"nombre": "Redes Sociales", "horas": 70, "descripcion": "Contenido, edición de reels y métricas"},
        {"nombre": "Planificación", "horas": 32, "descripcion": "Coordinación de equipo y prioridades"},
        {"nombre": "Publicidad", "horas": 20, "descripcion": "Meli Ads y armado de campaña en Meta Ads"},
        {"nombre": "Tiendanube", "horas": 15, "descripcion": "Sincronización de stock y Chat Nube"},
        {"nombre": "Producto", "horas": 12, "descripcion": "Diseño y desarrollo de muebles"},
    ],
    "secciones": [{
        "titulo": "Publicidad",
        "subtitulo": "Mercado Libre Ads y lanzamiento de la campaña en Meta Ads",
        "diapositivas": [
            {"tipo": "texto_vinietas", "titulo": "Meta", "titulo_destacado": "Ads",
             "subtitulo": "Lanzamiento y seguimiento de la campaña: 12 hs",
             "intro": "Durante agosto se realizó el lanzamiento y seguimiento de la campaña publicitaria configurada en julio, avanzando de la planificación a la implementación efectiva.",
             "items": ["Diseño de piezas gráficas y videos para la campaña", "Configuración final y lanzamiento de la campaña en Meta Ads",
                       "Seguimiento periódico de las principales métricas de rendimiento", "Monitoreo del presupuesto y evolución del gasto",
                       "Evaluación del comportamiento de anuncios y del público seleccionado", "Revisión del tráfico generado hacia el sitio web"],
             "nota": "El seguimiento realizado permitió identificar oportunidades para seguir optimizando la capacidad de los anuncios de generar tráfico hacia el sitio web."},
            {"tipo": "tabla", "titulo": "Antes", "titulo_destacado": "vs. Después",
             "subtitulo": "El impacto de incorporar pauta publicitaria en la cuenta de Instagram",
             "encabezados": ["KPI (Instagram)", "Antes (julio)", "Después (agosto)", "Variación"],
             "filas": [["Seguidores (nuevos)", "+14", "+34", "+142%"], ["Impresiones totales", "5.416", "1.080.000", "+19.840%"],
                       ["Alcance prom. diario", "~71", "~43.250", "+60.815%"], ["Interacciones (total)", "71", "142", "+200%"],
                       ["Clics en enlaces", "0", "570", "+570"]],
             "nota": "Nuestro principal objetivo con esta primera campaña fue ganar reconocimiento de marca (awareness) asociado a dos reels y una foto estática publicados el 5 de agosto."},
            {"tipo": "grupos_metricas", "titulo": "Resultados", "titulo_destacado": "de la campaña",
             "subtitulo": "“Campaña Agosto 2026 | Tráfico Rec”",
             "grupos": [{"nombre": "Redes sociales", "kpis": [k("1.050.000", "Impresiones"), k("685.700", "Alcance (cuentas únicas)"), k("1,53", "Frecuencia"), k("570", "Clics"),
                                                              k("$400K", "Inversión"), k("$293,57", "Costo c/mil impresiones"), k("$538,84", "Costo por clic"), k("0,05%", "Tasa de clics")]},
                        {"nombre": "Tiendanube", "kpis": [k("868", "Visitas a la tienda"), k("271", "Vistas en productos"), k("14", "Carritos creados"), k("1", "Venta finalizada")]}],
             "nota": ""},
            {"tipo": "reputacion", "titulo": "Reputación", "titulo_destacado": "de la cuenta",
             "metricas": [{"valor": "512", "etiqueta": "Ventas 60 días", "alerta": False}, {"valor": "4", "etiqueta": "Reclamos activos", "alerta": True},
                          {"valor": "2", "etiqueta": "Mediaciones", "alerta": True}, {"valor": "0", "etiqueta": "Canceladas x vendedor", "alerta": False},
                          {"valor": "6", "etiqueta": "Envíos tardíos", "alerta": True}],
             "parrafos": ["Los indicadores se mantuvieron dentro de los parámetros exigidos por Mercado Libre, permitiendo alcanzar y sostener la categoría Platinum."]},
            {"tipo": "ads", "titulo": "Mercado Libre", "titulo_destacado": "Ads", "subtitulo": "Sin ROAS: grilla de 4 columnas",
             "kpis": [k("$9,58M", "Ingresos atribuidos", "sube", "30,32% vs jun", "positivo"), k("$550.145", "Inversión", "sube", "3,30% vs jun", "advertencia"),
                      k("46", "Ventas atribuidas", "sube", "31,43% vs jun", "positivo"), k("1.353.328", "Impresiones", "sube", "24,68% vs jun", "positivo")],
             "nota": "La inversión creció de forma moderada mientras ingresos y ventas atribuidas se dispararon."},
        ],
    }],
})
