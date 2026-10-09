"""Configuración del cliente y de las integraciones.

Los IDs se pueden sobreescribir con variables de entorno para reutilizar la
automatización con otros clientes.
"""
import os

CLIENTE = os.environ.get("INFORME_CLIENTE", "Confort Iván")
AGENCIA = "Modus Retis"

# ClickUp: doc "Resúmenes" de Confort Iván
# https://app.clickup.com/9002139524/v/dc/8c93fw4-3714
CLICKUP_WORKSPACE_ID = os.environ.get("CLICKUP_WORKSPACE_ID", "9002139524")
CLICKUP_DOC_ID = os.environ.get("CLICKUP_DOC_ID", "8c93fw4-3714")

# Google Drive: carpeta donde están los mockups y donde se suben los informes
# https://drive.google.com/drive/u/0/folders/1KQoJDBKMqyrLG8hFUXcbvmBfbudlcNsr
DRIVE_FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID", "1KQoJDBKMqyrLG8hFUXcbvmBfbudlcNsr")

CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
