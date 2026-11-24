import unittest

from app.parser import error_count, parse_line


class ParserTest(unittest.TestCase):
    def test_parse_line(self) -> None:
        parsed = parse_line("2026-01-01T00:00:000Z ERROR worker=3 stage=decode")
        self.assertEqual(parsed["worker"], "3")
        self.assertEqual(parsed["stage"], "decode")

    def test_error_count(self) -> None:
        lines = [
            "2026-01-01T00:00:000Z INFO worker=1 stage=scan",
            "2026-01-01T00:00:001Z ERROR worker=2 stage=decode",
            "2026-01-01T00:00:002Z WARN worker=3 stage=retry",
        ]
        self.assertEqual(error_count(lines), 1)

    def test_error_level_is_recognised(self) -> None:
        parsed = parse_line("2026-01-01T00:00:000Z ERROR worker=3 stage=decode")
        self.assertEqual(parsed.get("level"), "ERROR")
