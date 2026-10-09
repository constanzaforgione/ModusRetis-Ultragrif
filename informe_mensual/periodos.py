"""Utilidades de fechas: qué mes se informa y cómo se nombra."""
from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass

MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


@dataclass(frozen=True)
class Periodo:
    anio: int
    mes: int

    @classmethod
    def desde_texto(cls, texto: str) -> "Periodo":
        """Acepta 'AAAA-MM'."""
        anio, mes = texto.strip().split("-")
        return cls(int(anio), int(mes))

    @classmethod
    def anterior_a(cls, fecha: dt.date) -> "Periodo":
        """Del 1 al 5 de cada mes se informa el mes previo."""
        primero = fecha.replace(day=1)
        ultimo_mes_anterior = primero - dt.timedelta(days=1)
        return cls(ultimo_mes_anterior.year, ultimo_mes_anterior.month)

    @property
    def nombre_mes(self) -> str:
        return MESES[self.mes - 1]

    @property
    def nombre(self) -> str:
        """'Septiembre 2026'."""
        return f"{self.nombre_mes.capitalize()} {self.anio}"

    @property
    def ultimo_dia(self) -> int:
        return calendar.monthrange(self.anio, self.mes)[1]

    @property
    def rango(self) -> str:
        """'01/09/2026 — 30/09/2026'."""
        return f"01/{self.mes:02d}/{self.anio} — {self.ultimo_dia:02d}/{self.mes:02d}/{self.anio}"

    @property
    def anterior(self) -> "Periodo":
        return Periodo.anterior_a(dt.date(self.anio, self.mes, 1))

    def __str__(self) -> str:
        return f"{self.anio}-{self.mes:02d}"
