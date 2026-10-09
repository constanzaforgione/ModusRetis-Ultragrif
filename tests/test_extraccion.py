import json
from pathlib import Path
from types import SimpleNamespace

from informe_mensual.__main__ import advertencias
from informe_mensual.extraccion import esquema_salida, extraer_informe
from informe_mensual.periodos import Periodo
from informe_mensual.spec import InformeMensual

RAIZ = Path(__file__).resolve().parent.parent
EJEMPLO = InformeMensual.model_validate(json.loads((RAIZ / "examples" / "2026-09.json").read_text()))


class _Stream:
    def __init__(self, respuesta):
        self.respuesta = respuesta

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.respuesta


class _ClienteFalso:
    def __init__(self, respuesta):
        self.llamadas = []
        self.messages = SimpleNamespace(stream=self._stream)
        self.respuesta = respuesta

    def _stream(self, **kwargs):
        self.llamadas.append(kwargs)
        return _Stream(self.respuesta)


def test_extraccion_envia_ejemplo_y_resumen():
    respuesta = SimpleNamespace(stop_reason="end_turn", content=[
        SimpleNamespace(type="thinking", thinking=""),
        SimpleNamespace(type="text", text=EJEMPLO.model_dump_json()),
    ])
    cliente = _ClienteFalso(respuesta)
    informe = extraer_informe("## Resumen de octubre", Periodo(2026, 10), client=cliente)
    assert informe == EJEMPLO
    llamada = cliente.llamadas[0]
    assert llamada["output_config"]["format"]["type"] == "json_schema"
    textos = " ".join(b["text"] for b in llamada["messages"][0]["content"])
    assert "Resumen de octubre" in textos
    assert "Octubre 2026" in textos and "Septiembre 2026" in textos  # mes informado y mes de comparación
    assert "<informe_ejemplo>" in textos


def test_extraccion_falla_si_se_corta():
    cliente = _ClienteFalso(SimpleNamespace(stop_reason="max_tokens", content=[]))
    try:
        extraer_informe("x", Periodo(2026, 10), client=cliente)
    except RuntimeError as e:
        assert "max_tokens" in str(e)
    else:
        raise AssertionError("debería fallar")


def test_ejemplo_sin_advertencias():
    assert advertencias(EJEMPLO) == []
    roto = EJEMPLO.model_copy(update={"horas_totales": 300})
    assert "suman 215" in advertencias(roto)[0]


def test_esquema_sin_campos_opcionales():
    def revisar(nodo):
        if isinstance(nodo, dict):
            if "properties" in nodo:
                assert set(nodo["required"]) == set(nodo["properties"])
                assert nodo.get("additionalProperties") is False
            for v in nodo.values():
                revisar(v)
        elif isinstance(nodo, list):
            for v in nodo:
                revisar(v)

    esquema = esquema_salida()
    revisar(esquema)
    # Un informe con todos los campos explícitos (como lo devuelve Claude) sigue siendo válido.
    assert InformeMensual.model_validate_json(EJEMPLO.model_dump_json()) == EJEMPLO
