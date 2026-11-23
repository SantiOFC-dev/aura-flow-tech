import py_compile
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class TestAuraFlowBackendHealth(unittest.TestCase):
    def test_python_syntax(self):
        py_compile.compile(str(ROOT / "server.py"), doraise=True)

    def test_live_health_endpoint(self):
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=3) as resp:
            self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main()
