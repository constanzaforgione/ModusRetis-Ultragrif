"""Lectura de los resúmenes mensuales desde el doc de ClickUp (API v3)."""
from __future__ import annotations

import difflib
import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable, Optional

import requests

from . import config
from .periodos import MESES, Periodo

API = "https://api.clickup.com/api/v3"


@dataclass
class Pagina:
    id: str
    nombre: str
    contenido: str
    actualizada: int = 0


def _normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", texto.lower()).strip()


def _mes_en_nombre(nombre: str) -> Optional[int]:
    """Detecta el mes aunque el nombre tenga errores de tipeo (ej. 'Sptiembre')."""
    for palabra in re.findall(r"[a-z]+", _normalizar(nombre)):
        if len(palabra) < 4:
            continue
        coincidencia = difflib.get_close_matches(palabra, MESES, n=1, cutoff=0.8)
        if coincidencia:
            return MESES.index(coincidencia[0]) + 1
    return None


def puntaje(nombre: str, periodo: Periodo) -> Optional[int]:
    """None si la página no corresponde al período; si corresponde, mayor = mejor candidata."""
    norm = _normalizar(nombre)
    if str(periodo.anio) not in norm or _mes_en_nombre(nombre) != periodo.mes:
        return None
    valor = 0
    if "resum" in norm:
        valor += 10
    # Versiones consolidadas/completas reemplazan a la original.
    if any(p in norm for p in ("consolidado", "completo", "final", "v2", "v3")):
        valor += 5
    return valor


def elegir_pagina(paginas: Iterable[Pagina], periodo: Periodo) -> Optional[Pagina]:
    candidatas = [(puntaje(p.nombre, periodo), p.actualizada, p) for p in paginas]
    candidatas = [c for c in candidatas if c[0] is not None]
    if not candidatas:
        return None
    candidatas.sort(key=lambda c: (c[0], c[1]), reverse=True)
    return candidatas[0][2]


def _aplanar(paginas: list[dict]) -> Iterable[Pagina]:
    for p in paginas:
        yield Pagina(
            id=p["id"], nombre=p.get("name", ""), contenido=p.get("content", "") or "",
            actualizada=int(p.get("date_updated") or 0),
        )
        yield from _aplanar(p.get("pages") or [])


class ClickUp:
    def __init__(self, token: Optional[str] = None, workspace_id: str = config.CLICKUP_WORKSPACE_ID,
                 doc_id: str = config.CLICKUP_DOC_ID):
        self.token = token or os.environ["CLICKUP_API_TOKEN"]
        self.workspace_id = workspace_id
        self.doc_id = doc_id

    def paginas(self) -> list[Pagina]:
        r = requests.get(
            f"{API}/workspaces/{self.workspace_id}/docs/{self.doc_id}/pages",
            params={"max_page_depth": -1, "content_format": "text/md"},
            headers={"Authorization": self.token},
            timeout=60,
        )
        r.raise_for_status()
        datos = r.json()
        if isinstance(datos, dict):
            datos = datos.get("pages", [])
        return list(_aplanar(datos))

    def resumen_del_mes(self, periodo: Periodo) -> Optional[Pagina]:
        return elegir_pagina(self.paginas(), periodo)
