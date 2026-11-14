import { useEffect, useMemo, useState } from "react";
import { lcdViewport, renderLcdDocument } from "../lcd-document";

export function LcdPreviewCard({ text }: { text: string }) {
  const [offset, setOffset] = useState(0);
  const document = useMemo(() => renderLcdDocument(text), [text]);
  const lcd = useMemo(() => lcdViewport(document, offset), [document, offset]);

  useEffect(() => {
    setOffset((value) => Math.min(value, Math.max(0, document.length - 4)));
  }, [document.length]);

  return <div className="lcd-preview-wrap">
    <div className="lcd-preview" role="img" aria-label={`LCD preview, rows ${lcd.offset + 1} through ${Math.min(lcd.offset + 4, document.length)} of ${document.length}`}>
      {lcd.rows.map((row, index) => <span key={index}>{row}</span>)}
    </div>
    <div className="lcd-preview-controls">
      <button className="button button--quiet" type="button" disabled={lcd.offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 1))}>Scroll up</button>
      <span>{lcd.offset + 1}–{Math.min(lcd.offset + 4, document.length)} of {document.length}</span>
      <button className="button button--quiet" type="button" disabled={lcd.offset >= lcd.maximum} onClick={() => setOffset((value) => Math.min(lcd.maximum, value + 1))}>Scroll down</button>
    </div>
  </div>;
}
