/** Suggestions are optional: fenced code may use any language identifier. */
export const codeLanguages = [
  'text',
  'bash',
  'c',
  'cpp',
  'css',
  'diff',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'markdown',
  'mermaid',
  'nginx',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml',
];

export const cleanCodeLanguage = (value: string) => value.replace(/[\r\n`]/g, '').trim();

/** The context menu opens exactly the same native, searchable control as the header. */
export function openCodeLanguagePicker(input: HTMLInputElement | null) {
  if (!input || input.disabled) return;
  input.focus();
  input.select();
  try {
    input.showPicker?.();
  } catch {
    // Browsers without transient activation still leave the editable input focused.
  }
}
