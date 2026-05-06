export function normalizeExampleAudioText(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
