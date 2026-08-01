'use client';

export function PrintRecordButton() {
  return (
    <button
      className="button button-secondary no-print"
      onClick={() => window.print()}
    >
      Print record
    </button>
  );
}
