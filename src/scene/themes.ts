export const THEMES = {
  forest: { name: '林光秘境', title: '林光之间', subtitle: '让记忆，栖居在光里。', english: 'WHERE LIGHT FINDS A HOME', description: '晨雾针叶林 · 温暖光束 · 苔绿与琥珀', intensity: 0.65, tint: 0xb4ba86 },
  lake: { name: '镜湖回廊', title: '镜湖回廊', subtitle: '在辽阔与宁静之间，靠近每一帧。', english: 'A QUIET PLACE FOR EVERY MOMENT', description: '湖面远山 · 银蓝天光 · 清澈地平线', intensity: 0.5, tint: 0xabc7d3 },
  meadow: { name: '旷野流光', title: '旷野流光', subtitle: '风经过的地方，记忆自在生长。', english: 'MEMORIES IN THE OPEN', description: '阴天旷野 · 草木前景 · 柔和灰绿', intensity: 0.6, tint: 0xc5c5aa },
} as const;
export type ThemeId = keyof typeof THEMES;
export function parseTheme(value: unknown): ThemeId {
  return typeof value === 'string' && Object.hasOwn(THEMES, value) ? value as ThemeId : 'forest';
}
export function savedTheme(): ThemeId {
  try { return parseTheme(localStorage.getItem('stillspace:theme')); } catch { return 'forest'; }
}
