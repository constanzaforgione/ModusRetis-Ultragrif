"""Convierte el resumen mensual de ClickUp en un `InformeMensual` usando Claude.

Claude recibe:
  * el esquema `InformeMensual` como salida estructurada (las descripciones de
    los campos indican límites de longitud y formato),
  * un ejemplo completo (resumen de ClickUp de septiembre 2026 → la
    presentación que el equipo armó a mano para ese mes),
  * el resumen del mes a informar.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import anthropic
from anthropic.lib._parse._transform import transform_schema

from . import config
from .periodos import Periodo
from .spec import InformeMensual

EJEMPLOS = Path(__file__).resolve().parent.parent / "examples"
EJEMPLO_MES = "2026-09"

SISTEMA = """\
Sos analista de ecommerce en la agencia Modus Retis. Cada mes, a partir del resumen \
interno que el equipo carga en ClickUp, armás el contenido de la presentación mensual \
para el cliente {cliente}. La presentación se dibuja automáticamente con el diseño de \
la agencia: vos solo definís el contenido, eligiendo para cada diapositiva el tipo que \
mejor se adapte a la información.

Cómo armar el informe:
- Estructura habitual de secciones (incluí solo las que tengan información ese mes y \
respetá el orden): 1) Resultados en Mercado Libre (ventas con 'kpis_texto' y reputación \
con 'reputacion'), 2) Publicidad (Mercado Libre Ads con 'ads'; Meta Ads con \
'grupos_metricas' si hay métricas o 'texto_vinietas' si fue planificación/lanzamiento sin \
métricas; comparaciones antes/después con 'tabla'), 3) Redes Sociales (visión general, \
Instagram con 'kpis_lista', otras plataformas con 'plataforma', contenido destacado o \
conclusiones con 'lista_numerada', tareas y recomendaciones con 'dos_columnas'), \
4) Mejora continua (organización de equipo y próximos pasos con 'dos_columnas'). Si el \
resumen trae áreas nuevas (Tiendanube, Logística, Producto, etc.) sumalas donde \
corresponda.
- Las áreas de la diapositiva de horas salen de los encabezados con horas del resumen \
(nivel principal, ej. 'Canales de Venta (98 hs)'). Las horas deben sumar el total.
- Usá únicamente datos que estén en el resumen: no inventes números, variaciones ni \
nombres de campañas. Si un dato no está, omitilo.
- Formato de números en español rioplatense: separador de miles '.', decimales ',', \
abreviaturas K / M ('$31,1M', '164,07K'), porcentajes con dos decimales como en el \
resumen. Variaciones vs el mes anterior con el formato 'NN,NN% vs mmm/aa' en la \
diapositiva de ventas, y 'vs mmm' en la de publicidad.
- Tono: profesional, cercano y claro para el cliente, en primera persona del plural \
('vamos a reforzar…'). Condensá: las diapositivas son mucho más breves que el resumen. \
Respetá los límites de caracteres indicados en el esquema.
- Las conclusiones (3 a 5) resumen los aprendizajes del mes en todas las áreas.
"""


def _todo_obligatorio(nodo: Any) -> Any:
    """Marca todos los campos como obligatorios (los vacíos se envían como "" o null).

    La salida estructurada limita la cantidad de campos opcionales por esquema; el
    informe tiene más de 24, así que se envían todos como obligatorios y pydantic
    valida la respuesta.
    """
    if isinstance(nodo, dict):
        if "properties" in nodo:
            nodo["required"] = list(nodo["properties"])
        for valor in nodo.values():
            _todo_obligatorio(valor)
    elif isinstance(nodo, list):
        for valor in nodo:
            _todo_obligatorio(valor)
    return nodo


def esquema_salida() -> dict:
    return _todo_obligatorio(transform_schema(InformeMensual))


def _mensaje_ejemplo() -> str:
    resumen = (EJEMPLOS / f"{EJEMPLO_MES}_clickup.md").read_text(encoding="utf-8")
    # Se normaliza para que el ejemplo muestre todos los campos, igual que el esquema de salida.
    informe = InformeMensual.model_validate_json(
        (EJEMPLOS / f"{EJEMPLO_MES}.json").read_text(encoding="utf-8")
    ).model_dump_json(indent=2)
    return (
        "Ejemplo de referencia (Septiembre 2026). Este es el resumen que cargó el equipo en ClickUp:\n"
        f"<resumen_ejemplo>\n{resumen}\n</resumen_ejemplo>\n\n"
        "Y este es el contenido de la presentación que se armó a partir de él, aprobado por el equipo. "
        "Tomalo como referencia de estilo, nivel de síntesis y elección de tipos de diapositiva:\n"
        f"<informe_ejemplo>\n{informe}\n</informe_ejemplo>"
    )


def extraer_informe(resumen_md: str, periodo: Periodo, *, cliente: str = config.CLIENTE,
                    modelo: str = config.CLAUDE_MODEL, client: anthropic.Anthropic | None = None) -> InformeMensual:
    client = client or anthropic.Anthropic()
    pedido = (
        f"Armá el contenido de la presentación de {periodo.nombre} (período {periodo.rango}). "
        f"El mes anterior, para las comparaciones, es {periodo.anterior.nombre}.\n\n"
        f"<resumen_clickup>\n{resumen_md}\n</resumen_clickup>"
    )
    with client.messages.stream(
        model=modelo,
        max_tokens=64000,
        system=SISTEMA.format(cliente=cliente),
        messages=[{"role": "user", "content": [
            {"type": "text", "text": _mensaje_ejemplo()},
            {"type": "text", "text": pedido},
        ]}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": esquema_salida()}},
    ) as stream:
        respuesta = stream.get_final_message()

    if respuesta.stop_reason == "refusal":
        raise RuntimeError(f"Claude rechazó la solicitud: {respuesta.stop_details}")
    if respuesta.stop_reason == "max_tokens":
        raise RuntimeError("La respuesta de Claude se cortó por longitud (max_tokens).")
    texto = next((b.text for b in respuesta.content if b.type == "text"), None)
    if not texto:
        raise RuntimeError("Claude no devolvió un informe.")
    return InformeMensual.model_validate_json(texto)
