import { ApiError } from './domain.ts';

export const NOTE_COLORS = ['yellow', 'blue', 'pink', 'green'] as const;
export type NoteColor = typeof NOTE_COLORS[number];
export type NotePosition = { x: number; y: number };
export type BoardMessage = { id: string; author: string; content: string; color: NoteColor; createdAt: string; position: NotePosition | null };
export type MessagePage = { items: BoardMessage[]; total: number; offset: number; limit: number; nextOffset: number | null };

export function validateMessage(input: Record<string, unknown>) {
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 2000) throw new ApiError(400, 'invalid_message', '留言须为 1–2000 字符');
  if (input.author !== undefined && (typeof input.author !== 'string' || input.author.length > 24)) throw new ApiError(400, 'invalid_author', '署名最多 24 字符');
  const color = input.color === undefined ? 'yellow' : input.color;
  if (!NOTE_COLORS.includes(color as NoteColor)) throw new ApiError(400, 'invalid_color', '请选择有效的便签颜色');
  let position: NotePosition | null = null;
  if (input.position !== undefined) {
    const value = input.position as NotePosition;
    if (!value || typeof value !== 'object' || Array.isArray(value) || [value.x, value.y].some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) throw new ApiError(400, 'invalid_position', '白板坐标 x / y 须为 0–1 之间的数字');
    position = { x: value.x, y: value.y };
  }
  return { content: input.content.trim(), author: (input.author as string | undefined)?.trim() || '匿名访客', color: color as NoteColor, position };
}

export function messagePagination(params: URLSearchParams) {
  const offset = Number(params.get('offset') ?? 0), limit = Number(params.get('limit') ?? 12);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_pagination', 'offset ≥ 0，limit 为 1–100');
  return { offset, limit };
}
