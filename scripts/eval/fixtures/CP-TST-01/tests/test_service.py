import unittest

from app.service import fetch_profile


class ServiceTest(unittest.TestCase):
    def test_fetch_profile(self) -> None:
        self.assertEqual(
            fetch_profile(7),
            {"url": "https://example.test/users/7", "status": 200},
        )
