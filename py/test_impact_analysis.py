import json
import subprocess
import sys
import tempfile
import textwrap
import os
import unittest


class TestImpactAnalysis(unittest.TestCase):
    def run_script(self, payload):
        script_path = os.path.join(os.path.dirname(__file__), "impact_analysis.py")
        proc = subprocess.run(
            [sys.executable, script_path],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
        )
        return proc

    def test_finds_call_site_referencing_changed_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            module_path = os.path.join(tmp, "client.py")
            with open(module_path, "w") as f:
                f.write(
                    textwrap.dedent(
                        """
                        def get_order():
                            return call_api("orders/123")

                        def get_health():
                            return call_api("health")
                        """
                    )
                )
            proc = self.run_script(
                {
                    "command": "impact-analysis",
                    "changedEndpoint": "orders/123",
                    "sourceRoot": tmp,
                }
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            result = json.loads(proc.stdout)
            functions = sorted(c["function"] for c in result["callSites"])
            self.assertEqual(functions, ["get_order"])

    def test_module_top_level_call_reports_module_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            module_path = os.path.join(tmp, "client.py")
            with open(module_path, "w") as f:
                f.write('call_api("orders/123")\n')
            proc = self.run_script(
                {
                    "command": "impact-analysis",
                    "changedEndpoint": "orders/123",
                    "sourceRoot": tmp,
                }
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            result = json.loads(proc.stdout)
            self.assertEqual(result["callSites"][0]["function"], "<module scope>")

    def test_no_matches_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            module_path = os.path.join(tmp, "client.py")
            with open(module_path, "w") as f:
                f.write('def f():\n    return call_api("other")\n')
            proc = self.run_script(
                {
                    "command": "impact-analysis",
                    "changedEndpoint": "orders/123",
                    "sourceRoot": tmp,
                }
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            result = json.loads(proc.stdout)
            self.assertEqual(result["callSites"], [])


if __name__ == "__main__":
    unittest.main()
