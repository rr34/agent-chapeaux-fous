"""The canonical 20x4 text-and-link display contract."""

from dataclasses import dataclass

LCD_COLUMNS = 20
LCD_ROWS = 4


def wrap_text(value: str, width: int = LCD_COLUMNS) -> list[str]:
    rows: list[str] = []
    for source_line in str(value).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        words = source_line.strip().split()
        if not words:
            rows.append("")
            continue
        current = ""
        for word in words:
            if len(word) > width:
                if current:
                    rows.append(current)
                    current = ""
                chunks = [word[index:index + width] for index in range(0, len(word), width)]
                rows.extend(chunks[:-1])
                current = chunks[-1]
            elif not current:
                current = word
            elif len(current) + len(word) + 1 <= width:
                current = f"{current} {word}"
            else:
                rows.append(current)
                current = word
        if current or not rows:
            rows.append(current)
    return rows


@dataclass(frozen=True)
class LcdLink:
    label: str
    target: str

    def row(self) -> str:
        return f"{self.label.strip()[:19]:<19}>"


@dataclass(frozen=True)
class Viewport:
    rows: tuple[str, str, str, str]
    offset: int
    maximum_offset: int


@dataclass(frozen=True)
class LcdDocument:
    text: str = ""
    links: tuple[LcdLink, ...] = ()

    def render_rows(self) -> list[str]:
        rows = wrap_text(self.text) if self.text else []
        rows.extend(link.row() for link in self.links)
        return rows or [""]

    def viewport(self, requested_offset: int = 0) -> Viewport:
        document_rows = self.render_rows()
        maximum = max(0, len(document_rows) - LCD_ROWS)
        offset = min(maximum, max(0, int(requested_offset)))
        visible = tuple(
            (document_rows[offset + index] if offset + index < len(document_rows) else "")[:LCD_COLUMNS].ljust(LCD_COLUMNS)
            for index in range(LCD_ROWS)
        )
        return Viewport(visible, offset, maximum)  # type: ignore[arg-type]

