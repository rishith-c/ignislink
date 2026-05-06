import json
from pathlib import Path


def test_contract_package_exports_codegen_inputs() -> None:
    root = Path(__file__).resolve().parents[3]
    package_json = root / "packages" / "contracts" / "package.json"

    package = json.loads(package_json.read_text())

    assert package["exports"]["."]["default"] == "./dist/index.js"
    assert package["exports"]["./geometry"]["types"] == "./dist/geometry.d.ts"
    assert (Path(__file__).resolve().parents[1] / "src" / "sentry_max_api" / "generated" / "README.md").exists()
