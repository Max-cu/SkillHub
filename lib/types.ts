export const AGENTS = ['claude-code', 'codex', 'cursor', 'gemini-cli'] as const;
export const CATEGORIES = ['development', 'design', 'productivity', 'testing', 'documentation'] as const;
export type Agent = typeof AGENTS[number];
export type Category = typeof CATEGORIES[number];
export interface Skill {
  id: string; name: string; description: string; category: Category; agents: Agent[]; tags: string[];
  source: string; sourcePath: string; commit: string | null; license: string; owner: string;
  featured: boolean; createdAt: string; version: string; digest: string; markdown: string;
  tokenEstimate: number; permissions: string[]; favorite: boolean; favoriteCount: number;
}
export interface PackageMetadata { digest: string; size: number; filename: string; root: string; files: {path:string;size:number}[]; kind: 'uploaded' | 'catalog-markdown'; }
