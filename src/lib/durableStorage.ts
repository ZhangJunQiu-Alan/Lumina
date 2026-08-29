export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    window.dispatchEvent(new Event('lumina:storage-error'));
    throw new Error('无法保存到本机，请检查存储空间。请勿退出当前页面。');
  }
}
