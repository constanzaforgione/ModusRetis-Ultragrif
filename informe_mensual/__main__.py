"""Línea de comandos.

    python -m informe_mensual generar                 # mes anterior: ClickUp → Claude → PPT → Drive
    python -m informe_mensual generar --mes 2026-09 --sin-drive
    python -m informe_mensual extraer resumen.md --mes 2026-10       # solo Claude → JSON
    python -m informe_mensual renderizar salida/2026-10.json         # JSON (editado a mano) → PPT
    python -m informe_mensual subir "salida/[Confort Iván] Octubre 2026_ModusRetis.pptx" --reemplazar
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from . import config
from .periodos import Periodo
from .render import nombre_archivo, renderizar
from .spec import InformeMensual

ZONA = ZoneInfo("America/Argentina/Buenos_Aires")


def _periodo(texto: str | None) -> Periodo:
    if texto:
        return Periodo.desde_texto(texto)
    return Periodo.anterior_a(dt.datetime.now(ZONA).date())


def _periodo_de_archivo(ruta: Path) -> Periodo | None:
    m = re.search(r"(\d{4})-(\d{2})", ruta.name)
    return Periodo(int(m.group(1)), int(m.group(2))) if m else None


def advertencias(informe: InformeMensual) -> list[str]:
    avisos = []
    suma = sum(a.horas for a in informe.areas)
    if abs(suma - informe.horas_totales) > 0.5:
        avisos.append(f"Las horas por área suman {suma:g} pero el total informado es {informe.horas_totales:g}.")
    for sec in informe.secciones:
        if not sec.diapositivas:
            avisos.append(f"La sección '{sec.titulo}' no tiene diapositivas.")
    return avisos


def _guardar_json(informe: InformeMensual, ruta: Path) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(informe.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")


def _resumen_github(lineas: list[str]) -> None:
    destino = os.environ.get("GITHUB_STEP_SUMMARY")
    if destino:
        with open(destino, "a", encoding="utf-8") as f:
            f.write("\n".join(lineas) + "\n")


def cmd_generar(args) -> int:
    from .clickup import ClickUp
    from .extraccion import extraer_informe

    periodo = _periodo(args.mes)
    salida = Path(args.salida)
    nombre = nombre_archivo(periodo)
    print(f"Informe de {periodo.nombre} → {nombre}")

    drive = None
    if not args.sin_drive:
        from .drive import Drive

        drive = Drive()
        existente = drive.buscar(nombre)
        if existente and not args.reemplazar:
            print(f"Ya existe en Drive, no se regenera: {existente.get('webViewLink')}")
            _resumen_github([f"⏭️ **{nombre}** ya existe en Drive: {existente.get('webViewLink')}"])
            return 0

    pagina = ClickUp().resumen_del_mes(periodo)
    if pagina is None or len(pagina.contenido.strip()) < 500:
        print(f"Todavía no hay un resumen de {periodo.nombre} en ClickUp (o está vacío).", file=sys.stderr)
        _resumen_github([f"⏳ No se encontró el resumen de **{periodo.nombre}** en ClickUp."])
        return 2
    print(f"Resumen encontrado en ClickUp: '{pagina.nombre}' ({len(pagina.contenido)} caracteres)")
    if args.horas_sin_editar and pagina.actualizada:
        editada = dt.datetime.fromtimestamp(pagina.actualizada / 1000, tz=ZONA)
        horas = (dt.datetime.now(ZONA) - editada).total_seconds() / 3600
        if horas < args.horas_sin_editar:
            print(f"El resumen se editó hace {horas:.1f} h; se espera a que lleve {args.horas_sin_editar} h sin cambios.")
            _resumen_github([f"⏳ El resumen de **{periodo.nombre}** se sigue editando (hace {horas:.1f} h)."])
            return 0
    (salida / f"{periodo}_clickup.md").parent.mkdir(parents=True, exist_ok=True)
    (salida / f"{periodo}_clickup.md").write_text(pagina.contenido, encoding="utf-8")

    informe = extraer_informe(pagina.contenido, periodo)
    _guardar_json(informe, salida / f"{periodo}.json")
    avisos = advertencias(informe)
    for aviso in avisos:
        print(f"⚠️  {aviso}")

    pptx = renderizar(informe, periodo, salida / nombre)
    print(f"Presentación generada: {pptx}")
    resumen = [f"✅ **{nombre}** generado a partir de '{pagina.nombre}'."] + [f"- ⚠️ {a}" for a in avisos]

    if drive:
        archivo = drive.subir(pptx, nombre, reemplazar=args.reemplazar)
        print(f"Subido a Drive: {archivo.get('webViewLink')}")
        resumen.append(f"- Drive: {archivo.get('webViewLink')}")
    _resumen_github(resumen)
    return 0


def cmd_extraer(args) -> int:
    from .extraccion import extraer_informe

    periodo = _periodo(args.mes)
    informe = extraer_informe(Path(args.resumen).read_text(encoding="utf-8"), periodo)
    destino = Path(args.salida) / f"{periodo}.json"
    _guardar_json(informe, destino)
    for aviso in advertencias(informe):
        print(f"⚠️  {aviso}")
    print(f"Contenido guardado en {destino}")
    return 0


def cmd_renderizar(args) -> int:
    ruta = Path(args.json)
    periodo = Periodo.desde_texto(args.mes) if args.mes else _periodo_de_archivo(ruta)
    if periodo is None:
        print("Indicá el mes con --mes AAAA-MM", file=sys.stderr)
        return 1
    informe = InformeMensual.model_validate_json(ruta.read_text(encoding="utf-8"))
    for aviso in advertencias(informe):
        print(f"⚠️  {aviso}")
    pptx = renderizar(informe, periodo, Path(args.salida) / nombre_archivo(periodo))
    print(f"Presentación generada: {pptx}")
    return 0


def cmd_subir(args) -> int:
    from .drive import Drive

    archivo = Drive().subir(Path(args.pptx), reemplazar=args.reemplazar)
    print(f"Subido a Drive: {archivo.get('webViewLink')}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="informe_mensual", description=f"Informe mensual de {config.CLIENTE}")
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("generar", help="ClickUp → Claude → PPT → Drive")
    p.add_argument("--mes", help="AAAA-MM (por defecto, el mes anterior)")
    p.add_argument("--salida", default="salida")
    p.add_argument("--sin-drive", action="store_true", help="No consulta ni sube a Drive")
    p.add_argument("--reemplazar", action="store_true", help="Regenera aunque ya exista en Drive y lo reemplaza")
    p.add_argument("--horas-sin-editar", type=float, default=0,
                   help="Espera a que la página de ClickUp lleve N horas sin cambios (evita tomar un resumen a medio escribir)")
    p.set_defaults(func=cmd_generar)

    p = sub.add_parser("extraer", help="Resumen en Markdown → JSON del informe (Claude)")
    p.add_argument("resumen")
    p.add_argument("--mes", help="AAAA-MM (por defecto, el mes anterior)")
    p.add_argument("--salida", default="salida")
    p.set_defaults(func=cmd_extraer)

    p = sub.add_parser("renderizar", help="JSON del informe → PPT")
    p.add_argument("json")
    p.add_argument("--mes", help="AAAA-MM (si no, se toma del nombre del archivo)")
    p.add_argument("--salida", default="salida")
    p.set_defaults(func=cmd_renderizar)

    p = sub.add_parser("subir", help="Sube un PPT a la carpeta de Drive")
    p.add_argument("pptx")
    p.add_argument("--reemplazar", action="store_true")
    p.set_defaults(func=cmd_subir)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
