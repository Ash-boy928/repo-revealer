import fs from 'fs';
import path from 'path';

// ---------------- NON-BLOCKING DEBOUNCED ASYNC FILE WRITER ----------------
export const fileWriteDebounceMap = new Map<string, { getData: () => string | any; timer: NodeJS.Timeout | null }>();

export function asyncSaveJson(filePath: string, dataOrFn: any, delayMs = 1000): void {
  const getData = typeof dataOrFn === 'function' ? dataOrFn : () => dataOrFn;
  const existing = fileWriteDebounceMap.get(filePath);

  if (existing && existing.timer) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(async () => {
    fileWriteDebounceMap.delete(filePath);
    try {
      const raw = getData();
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const tmpFile = `${filePath}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tmpFile, content, 'utf8');
      await fs.promises.rename(tmpFile, filePath);
    } catch (err: any) {
      console.error(`Async save error for ${path.basename(filePath)}:`, err?.message || err);
    }
  }, delayMs);

  fileWriteDebounceMap.set(filePath, { getData, timer });
}

export function flushPendingFileWritesSync(): void {
  for (const [filePath, entry] of fileWriteDebounceMap.entries()) {
    if (entry.timer) clearTimeout(entry.timer);
    try {
      const raw = entry.getData();
      const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
      fs.writeFileSync(filePath, content, 'utf8');
    } catch {}
  }
  fileWriteDebounceMap.clear();
}

process.on('beforeExit', flushPendingFileWritesSync);
process.on('SIGINT', () => { flushPendingFileWritesSync(); process.exit(0); });
process.on('SIGTERM', () => { flushPendingFileWritesSync(); process.exit(0); });
