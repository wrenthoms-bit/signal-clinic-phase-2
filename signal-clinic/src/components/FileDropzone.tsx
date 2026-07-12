import { useCallback, useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  fileName: string;
}

export function FileDropzone({ onFile, fileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      className={[
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center transition-colors',
        dragging ? 'border-signal bg-signal/5' : 'border-hairline bg-panel hover:bg-panel-raised',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="font-display text-sm font-semibold text-ink">
        {fileName ? fileName : 'Drop an audio file, or click to browse'}
      </p>
      <p className="font-mono text-xs text-ink-muted">WAV, AIFF, MP3, FLAC — decoded client-side, nothing uploaded</p>
    </div>
  );
}
