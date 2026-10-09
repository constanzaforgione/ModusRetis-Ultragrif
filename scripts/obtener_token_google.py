"""Obtiene el refresh token de Google para que la automatización suba archivos a Drive.

Se corre UNA sola vez, en una computadora con navegador, con la cuenta dueña de la
carpeta de Drive (constanzaforgione@gmail.com):

    pip install google-auth-oauthlib
    python scripts/obtener_token_google.py client_secret.json

`client_secret.json` es el cliente OAuth de tipo "App de escritorio" descargado desde
Google Cloud Console (APIs y servicios → Credenciales). Copiá los tres valores que
imprime el script en los secrets del repositorio.
"""
import json
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/drive"]


def main(ruta_cliente: str) -> None:
    flow = InstalledAppFlow.from_client_secrets_file(ruta_cliente, SCOPES)
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    cliente = json.load(open(ruta_cliente))["installed"]
    print("\nCargá estos secrets en GitHub (Settings → Secrets and variables → Actions):\n")
    print(f"GOOGLE_OAUTH_CLIENT_ID={cliente['client_id']}")
    print(f"GOOGLE_OAUTH_CLIENT_SECRET={cliente['client_secret']}")
    print(f"GOOGLE_OAUTH_REFRESH_TOKEN={creds.refresh_token}")


if __name__ == "__main__":
    main(sys.argv[1])
