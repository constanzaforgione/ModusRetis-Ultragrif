"""Modelo de datos de la presentación mensual.

Este esquema es el "contrato" entre la extracción (Claude lee el resumen de
ClickUp y devuelve un `InformeMensual`) y el renderizador (que dibuja el PPT
siguiendo los mockups). Las descripciones de cada campo también le llegan a
Claude como instrucciones, por eso incluyen límites de longitud y ejemplos.
"""
from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field

Tono = Literal["positivo", "negativo", "neutral", "advertencia"]


class Variacion(BaseModel):
    direccion: Literal["sube", "baja", "igual"] = Field(
        description="Sentido del cambio del número. Define la flecha ▲ / ▼ (o ninguna si es 'igual')."
    )
    texto: str = Field(
        description="Texto de la variación SIN flecha, máx. 26 caracteres. Ej: '37,00% vs ago/26', '0,10 pts vs ago/26', "
        "'+6 netos en el mes', '118.146 cuentas alcanzadas'."
    )
    tono: Tono = Field(
        description="Color según si el cambio es bueno para el negocio: positivo=verde, negativo=rojo, "
        "advertencia=ámbar (baja leve o mixta), neutral=gris (dato informativo). Ojo: en costos (CPC, costo por "
        "venta) bajar es positivo."
    )


class Kpi(BaseModel):
    valor: str = Field(
        description="Número ya formateado en español rioplatense, máx. 9 caracteres. Ej: '143', '18.122', '$217.194', "
        "'0,80%', '$31,1M', '11,70x', '164,07K'."
    )
    etiqueta: str = Field(description="Nombre de la métrica, corto, máx. 26 caracteres. Ej: 'Ventas', 'Precio prom. venta'.")
    variacion: Optional[Variacion] = None


class Area(BaseModel):
    nombre: str = Field(description="Área de trabajo. Ej: 'Canales de Venta', 'Redes Sociales', 'Publicidad'.")
    horas: float = Field(description="Horas dedicadas al área en el mes.")
    descripcion: str = Field(description="Resumen de lo hecho en el área, máx. 110 caracteres.")


class Destacado(BaseModel):
    icono: Literal["insignia", "ninguno"] = Field(
        description="'insignia' muestra el ícono de verificación azul (logros/gestiones destacadas)."
    )
    titulo: str = Field(description="Máx. 50 caracteres.")
    texto: str = Field(description="Máx. 130 caracteres.")


class MetricaReputacion(BaseModel):
    valor: str = Field(description="Ej: '333', '1,20%', '0%'.")
    etiqueta: str = Field(description="Máx. 22 caracteres. Ej: 'Ventas 60 días', 'Reclamos'.")
    alerta: bool = Field(description="True si el valor merece atención (se pinta en rojo).")


class Recuadro(BaseModel):
    titulo: str = Field(description="Máx. 60 caracteres. Puede empezar con un emoji, ej: '📈 Crecimiento sostenido'.")
    texto: str = Field(description="Máx. 260 caracteres.")


class ColumnaLista(BaseModel):
    titulo: str = Field(description="Ej: 'Tareas realizadas', 'Próximos pasos'.")
    items: list[str] = Field(description="Entre 2 y 8 ítems de máx. 110 caracteres cada uno.")
    estilo: Literal["lista", "recuadro"] = Field(
        description="'lista' = viñetas; 'recuadro' = texto dentro de una caja celeste (para recomendaciones). "
        "En 'recuadro' el último ítem se resalta en negrita como conclusión (empezalo con '→ ')."
    )


class ItemNumerado(BaseModel):
    titulo: str = Field(description="Máx. 50 caracteres.")
    texto: str = Field(description="Máx. 140 caracteres.")


class GrupoMetricas(BaseModel):
    nombre: str = Field(description="Encabezado del grupo en mayúsculas. Ej: 'INSTAGRAM', 'TIENDANUBE', 'REDES SOCIALES'.")
    kpis: list[Kpi] = Field(description="Entre 2 y 8 métricas (se muestran en filas de 4).")


class TarjetaPlataforma(BaseModel):
    nombre: str = Field(description="Ej: 'TikTok', 'Facebook'.")
    kpis: list[Kpi] = Field(description="1 o 2 métricas principales.")
    detalle: str = Field(description="Línea de datos secundarios, máx. 70 caracteres.")
    nota: str = Field(description="Comentario breve, máx. 160 caracteres.")


# --------------------------------------------------------------------------
# Tipos de diapositiva de contenido. Todas comparten título (con una parte
# opcional resaltada en celeste) y subtítulo gris.
# --------------------------------------------------------------------------
class _BaseDiapositiva(BaseModel):
    titulo: str = Field(description="Parte del título en azul oscuro. Ej: 'Mercado Libre '. Máx. 30 caracteres en total con titulo_destacado.")
    titulo_destacado: str = Field(
        default="", description="Parte del título en celeste, a continuación. Ej: '· Ventas', 'de la cuenta'. Puede ser ''."
    )
    subtitulo: str = Field(default="", description="Bajada gris debajo del título, máx. 90 caracteres.")


class DiapoKpisTexto(_BaseDiapositiva):
    """Fila de 3 a 5 KPIs grandes y debajo 1-3 párrafos de análisis (ej. Mercado Libre · Ventas)."""

    tipo: Literal["kpis_texto"]
    kpis: list[Kpi] = Field(description="Entre 3 y 5 KPIs.")
    parrafos: list[str] = Field(description="1 a 3 párrafos, en total máx. 650 caracteres.")


class DiapoReputacion(_BaseDiapositiva):
    """Recuadro destacado opcional + fila de tarjetas con métricas + párrafos."""

    tipo: Literal["reputacion"]
    destacado: Optional[Destacado] = None
    metricas: list[MetricaReputacion] = Field(description="Entre 3 y 7 métricas.")
    parrafos: list[str] = Field(description="1 o 2 párrafos, en total máx. 420 caracteres.")


class DiapoAds(_BaseDiapositiva):
    """Grilla de KPIs de publicidad (3 por fila) con tarjeta de ROAS a la derecha y nota final."""

    tipo: Literal["ads"]
    kpis: list[Kpi] = Field(description="Entre 3 y 9 KPIs (sin el ROAS).")
    roas: Optional[Kpi] = Field(default=None, description="ROAS, ej. valor '11,70x'.")
    roas_explicacion: str = Field(default="", description="Ej: '$1 invertido → $11,70 en ventas atribuidas'.")
    nota: str = Field(description="Análisis breve, máx. 380 caracteres.")


class DiapoGruposMetricas(_BaseDiapositiva):
    """Uno o dos bloques de métricas sin tarjeta (ej. Meta Ads: INSTAGRAM / TIENDANUBE) + nota."""

    tipo: Literal["grupos_metricas"]
    grupos: list[GrupoMetricas] = Field(description="1 o 2 grupos.")
    nota: str = Field(default="", description="Conclusión breve, máx. 260 caracteres.")


class DiapoVisionGeneral(_BaseDiapositiva):
    """4 KPIs grandes y un recuadro celeste con la lectura del mes."""

    tipo: Literal["vision_general"]
    kpis: list[Kpi] = Field(description="Entre 2 y 4 KPIs.")
    recuadro: Recuadro


class DiapoKpisLista(_BaseDiapositiva):
    """2 KPIs grandes a la izquierda, lista con viñetas a la derecha y nota abajo (ej. Instagram)."""

    tipo: Literal["kpis_lista"]
    kpis: list[Kpi] = Field(description="1 o 2 KPIs.")
    lista_titulo: str = Field(description="Ej: 'Perfil de audiencia'.")
    lista: list[str] = Field(description="Entre 2 y 5 ítems cortos, máx. 60 caracteres.")
    nota: str = Field(description="Máx. 330 caracteres.")


class DiapoPlataforma(_BaseDiapositiva):
    """Tarjeta con métricas de una plataforma secundaria (ej. TikTok)."""

    tipo: Literal["plataforma"]
    tarjeta: TarjetaPlataforma


class DiapoDosColumnas(_BaseDiapositiva):
    """Dos columnas separadas por una línea (ej. Tareas y recomendaciones / Organización y próximos pasos)."""

    tipo: Literal["dos_columnas"]
    izquierda: ColumnaLista
    derecha: ColumnaLista


class DiapoListaNumerada(_BaseDiapositiva):
    """Lista de 3 a 6 puntos numerados en tarjetas (ej. Conclusiones, Contenido destacado)."""

    tipo: Literal["lista_numerada"]
    items: list[ItemNumerado] = Field(description="Entre 3 y 6 ítems.")


class DiapoTabla(_BaseDiapositiva):
    """Tabla comparativa (ej. Antes vs. Después)."""

    tipo: Literal["tabla"]
    encabezados: list[str] = Field(description="Entre 2 y 5 columnas.")
    filas: list[list[str]] = Field(description="Entre 1 y 8 filas, cada una con tantas celdas como encabezados.")
    nota: str = Field(default="", description="Máx. 260 caracteres.")


class DiapoTextoVinietas(_BaseDiapositiva):
    """Párrafo introductorio + viñetas en dos columnas + nota en cursiva (ej. lanzamiento de campaña)."""

    tipo: Literal["texto_vinietas"]
    intro: str = Field(description="Máx. 300 caracteres.")
    items: list[str] = Field(description="Entre 2 y 8 ítems de máx. 70 caracteres.")
    nota: str = Field(default="", description="Máx. 240 caracteres.")


Diapositiva = Union[
    DiapoKpisTexto,
    DiapoReputacion,
    DiapoAds,
    DiapoGruposMetricas,
    DiapoVisionGeneral,
    DiapoKpisLista,
    DiapoPlataforma,
    DiapoDosColumnas,
    DiapoListaNumerada,
    DiapoTabla,
    DiapoTextoVinietas,
]


class Seccion(BaseModel):
    titulo: str = Field(description="Título de la portada de sección. Ej: 'Resultados en Mercado Libre', 'Publicidad', 'Redes Sociales', 'Mejora continua'.")
    subtitulo: str = Field(description="Bajada de la portada de sección, máx. 90 caracteres.")
    diapositivas: list[Diapositiva] = Field(description="Diapositivas de contenido de la sección, en orden.")


class InformeMensual(BaseModel):
    """Contenido completo de la presentación mensual."""

    horas_totales: float = Field(description="Total de horas trabajadas en el mes.")
    canales: str = Field(
        default="Mercado Libre · Tiendanube · Publicidad · Logística · Redes Sociales",
        description="Línea de canales que aparece en la portada.",
    )
    areas: list[Area] = Field(description="Distribución de horas por área (entre 2 y 6), de mayor a menor o en el orden del resumen.")
    subtitulo_areas: str = Field(default="", description="Bajada de la diapositiva de horas. Vacío = 'Distribución de horas por área de trabajo: N hs totales'.")
    secciones: list[Seccion] = Field(description="Secciones numeradas de la presentación, en orden.")
