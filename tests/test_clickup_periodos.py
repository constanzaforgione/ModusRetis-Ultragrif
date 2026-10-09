import datetime as dt

from informe_mensual.clickup import Pagina, _aplanar, elegir_pagina
from informe_mensual.periodos import Periodo

# Nombres reales de las páginas del doc de ClickUp de Confort Iván
NOMBRES = [
    "Resumen de avance - Septiembre 2026", "Resumen de avance - Agosto 2026", "Resumen de avance - Julio 2026",
    "Resumen de avance - Marzo 2026", "Resumen de avance - Enero 2026", "Resumen de avance - Diciembre 2025",
    "Resumen de avance - Octubre 2025", "Resumen de avance - Sptiembre 2025 COMPLETO",
    "Resume de avance - Septiembre 2025", "Resúmen para revisión con cliente", "Resumen de avance- Agosto",
    "🔑 Credenciales de Acceso", "Resumen de avance - Marzo 2026 v2 (Consolidado)",
]
PAGINAS = [Pagina(id=str(i), nombre=n, contenido="x", actualizada=i) for i, n in enumerate(NOMBRES)]


def _elegida(anio, mes):
    p = elegir_pagina(PAGINAS, Periodo(anio, mes))
    return p.nombre if p else None


def test_elige_la_pagina_del_mes():
    assert _elegida(2026, 9) == "Resumen de avance - Septiembre 2026"
    assert _elegida(2026, 8) == "Resumen de avance - Agosto 2026"


def test_prefiere_version_consolidada_y_tolera_errores_de_tipeo():
    assert _elegida(2026, 3) == "Resumen de avance - Marzo 2026 v2 (Consolidado)"
    assert _elegida(2025, 9) == "Resumen de avance - Sptiembre 2025 COMPLETO"


def test_sin_resumen_devuelve_none():
    assert _elegida(2026, 10) is None
    assert _elegida(2025, 8) is None  # "Agosto" sin año no es confiable


def test_aplanar_incluye_subpaginas():
    datos = [{"id": "a", "name": "Padre", "pages": [{"id": "b", "name": "Hija", "content": "hola"}]}]
    assert [p.id for p in _aplanar(datos)] == ["a", "b"]


def test_periodo_anterior():
    assert Periodo.anterior_a(dt.date(2026, 10, 3)) == Periodo(2026, 9)
    assert Periodo.anterior_a(dt.date(2027, 1, 2)) == Periodo(2026, 12)
    assert Periodo(2026, 9).rango == "01/09/2026 — 30/09/2026"
    assert Periodo(2026, 2).rango == "01/02/2026 — 28/02/2026"
    assert Periodo(2026, 9).anterior.nombre == "Agosto 2026"
