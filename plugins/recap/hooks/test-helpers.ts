// Copied from shared/ by scripts/sync-shared.mjs: edit the original there, not this copy.
// Shared fakes for the mods' tests: an in-memory file system, a store a test
// can look inside, and recorders for toasts and copies.
//
// This file is the source. scripts/sync-shared.mjs copies it into each mod's
// hooks folder (each mod is installed on its own, so it needs its own copy);
// the release script syncs it and refuses a mod whose copy has drifted.

/** An in-memory file system, so logs, diaries and registries can be read back. */
export const memoryFs = (on: any): Map<string, string> => {
  const files = new Map<string, string>()
  // The engine hands paths over in the platform's own form (backslashes on Windows).
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')
  on('fs.exists', ($: any, e: any) => ({ value: files.has(norm(e.path)) }) as any)
  on('fs.read', ($: any, e: any) => (files.has(norm(e.path)) ? { value: files.get(norm(e.path)) } : { deny: 'ENOENT' }) as any)
  on('fs.write', ($: any, e: any) => { files.set(norm(e.path), e.text); return { value: undefined } as any })
  return files
}

/** A store backed by the object given, so a test can look inside it afterwards. */
export const liveStore = (on: any, store: Record<string, unknown> = {}): Record<string, unknown> => {
  on('store.get', ($: any, e: any) => ({ value: store[e.key] }) as any)
  on('store.set', ($: any, e: any) => { store[e.key] = e.value; return { value: undefined } as any })
  return store
}

/** Every toast shown, in order. */
export const recordToasts = (on: any): string[] => {
  const toasts: string[] = []
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } as any })
  return toasts
}

/** Every text put on the clipboard, in order; the copy always takes. */
export const recordCopies = (on: any): string[] => {
  const copied: string[] = []
  on('ui.copy', ($: any, e: any) => { copied.push(e.text); return { value: { isCopied: true } } as any })
  return copied
}
