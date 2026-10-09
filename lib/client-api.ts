export async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch('/api/v1/' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const payload = await response.json() as { data: T; error?: { message: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? '请求失败');
  return payload.data;
}
