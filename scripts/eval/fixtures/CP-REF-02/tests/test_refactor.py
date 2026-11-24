import unittest
from pathlib import Path

import app
import app.monolith as monolith
from app import monolith as api


class RefactorTest(unittest.TestCase):
    def test_public_interface_preserved(self) -> None:
        for name in ("normalize", "summarize", "render"):
            self.assertTrue(hasattr(api, name), name)
            self.assertEqual(getattr(api, name), getattr(monolith, name))

    def test_behavior_preserved(self) -> None:
        rows = [{"name": " a ", "amount": "1.5"}, {"name": "b", "amount": 2}]
        self.assertEqual(monolith.normalize(rows), [{"name": "a", "amount": 1.5}, {"name": "b", "amount": 2.0}])
        self.assertEqual(monolith.summarize(rows), {"count": 2, "total": 3.5})
        self.assertEqual(monolith.render(rows), "count=2 total=3.50")

    def test_implementation_split_into_core_package(self) -> None:
        self.assertTrue((Path(app.__file__).parent / "core").is_dir(), "缺少 app/core 包")
