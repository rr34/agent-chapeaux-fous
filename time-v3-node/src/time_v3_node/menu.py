"""Flat root menu and deterministic keypad actions."""

from dataclasses import dataclass

MENU_ITEMS = ("Messages", "Accelerometer", "Internet", "Device status")


@dataclass
class Menu:
    selected: int = 0

    def move(self, amount: int) -> None:
        self.selected = (self.selected + amount) % len(MENU_ITEMS)

    def rows(self) -> tuple[str, str, str, str]:
        first = min(max(0, self.selected - 1), max(0, len(MENU_ITEMS) - 4))
        values = []
        for index in range(first, first + 4):
            if index >= len(MENU_ITEMS):
                values.append(" " * 20)
                continue
            marker = ">" if index == self.selected else " "
            values.append(f"{marker}{MENU_ITEMS[index][:19]:<19}")
        return tuple(values)  # type: ignore[return-value]

    @property
    def current(self) -> str:
        return MENU_ITEMS[self.selected]

