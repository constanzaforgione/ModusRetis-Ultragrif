"""Subida del informe a la carpeta de Google Drive.

Credenciales (variables de entorno), en este orden:
  * GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET + GOOGLE_OAUTH_REFRESH_TOKEN:
    credenciales de la cuenta dueña de la carpeta (ver scripts/obtener_token_google.py).
    Es la opción recomendada para carpetas de "Mi unidad".
  * GOOGLE_SERVICE_ACCOUNT_JSON: contenido JSON de una cuenta de servicio con acceso
    de editor a la carpeta. Solo sirve si la carpeta está en una unidad compartida
    (las cuentas de servicio no tienen cuota propia en "Mi unidad").
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from . import config

SCOPES = ["https://www.googleapis.com/auth/drive"]
MIME_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _credenciales():
    if os.environ.get("GOOGLE_OAUTH_REFRESH_TOKEN"):
        from google.oauth2.credentials import Credentials

        return Credentials(
            token=None,
            refresh_token=os.environ["GOOGLE_OAUTH_REFRESH_TOKEN"],
            client_id=os.environ["GOOGLE_OAUTH_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_OAUTH_CLIENT_SECRET"],
            token_uri="https://oauth2.googleapis.com/token",
            scopes=SCOPES,
        )
    if os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"):
        from google.oauth2 import service_account

        info = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
        return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    raise RuntimeError(
        "Faltan credenciales de Google: definí GOOGLE_OAUTH_REFRESH_TOKEN (+ CLIENT_ID/SECRET) "
        "o GOOGLE_SERVICE_ACCOUNT_JSON."
    )


class Drive:
    def __init__(self, carpeta_id: str = config.DRIVE_FOLDER_ID):
        self.carpeta_id = carpeta_id
        self.api = build("drive", "v3", credentials=_credenciales(), cache_discovery=False)

    def buscar(self, nombre: str) -> Optional[dict]:
        escapado = nombre.replace("\\", "\\\\").replace("'", "\\'")
        res = self.api.files().list(
            q=f"name = '{escapado}' and '{self.carpeta_id}' in parents and trashed = false",
            fields="files(id, name, webViewLink)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        archivos = res.get("files", [])
        return archivos[0] if archivos else None

    def subir(self, ruta: Path, nombre: Optional[str] = None, reemplazar: bool = False) -> dict:
        """Sube el archivo. Si ya existe uno con el mismo nombre, lo reemplaza solo con `reemplazar=True`
        (Drive guarda la versión anterior en el historial)."""
        nombre = nombre or Path(ruta).name
        media = MediaFileUpload(str(ruta), mimetype=MIME_PPTX, resumable=True)
        existente = self.buscar(nombre)
        if existente and not reemplazar:
            raise FileExistsError(f"Ya existe '{nombre}' en Drive: {existente.get('webViewLink')}")
        if existente:
            return self.api.files().update(
                fileId=existente["id"], media_body=media, fields="id, name, webViewLink", supportsAllDrives=True,
            ).execute()
        return self.api.files().create(
            body={"name": nombre, "parents": [self.carpeta_id]},
            media_body=media,
            fields="id, name, webViewLink",
            supportsAllDrives=True,
        ).execute()
