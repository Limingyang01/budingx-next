import unittest

from app.calc import add, subtract


class CalcTest(unittest.TestCase):
    def test_add(self) -> None:
        self.assertEqual(add(2, 3), 5)

    def test_subtract(self) -> None:
        self.assertEqual(subtract(5, 3), 2)

    def test_subtract_negative(self) -> None:
        self.assertEqual(subtract(3, 5), -2)
