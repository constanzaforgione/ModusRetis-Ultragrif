"""Genera informe_mensual/assets/plantilla_base.pptx a partir de un informe ya hecho.

Conserva el tema, los masters y las fuentes embebidas (Roboto, Plus Jakarta Sans)
del mockup y elimina todas las diapositivas. Solo hace falta correrlo si cambia
el diseño base del mockup:

    python scripts/crear_plantilla_base.py "[Confort Iván] Septiembre 2026_ModusRetis.pptx"
"""
import sys
from pathlib import Path

from pptx import Presentation

DESTINO = Path(__file__).resolve().parent.parent / "informe_mensual" / "assets" / "plantilla_base.pptx"


def main(origen: str) -> None:
    prs = Presentation(origen)
    lista = prs.slides._sldIdLst
    for sld_id in list(lista):
        prs.part.drop_rel(sld_id.rId)
        lista.remove(sld_id)
    prs.save(DESTINO)
    print(f"Plantilla guardada en {DESTINO}")


if __name__ == "__main__":
    main(sys.argv[1])
