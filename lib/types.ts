export const AGENTS = ['claude-code', 'codex', 'cursor', 'gemini-cli'] as const;
export const CATEGORIES = ['development', 'design', 'productivity', 'testing', 'documentation'] as const;
export type Agent = typeof AGENTS[number];
export type Category = typeof CATEGORIES[number];
// 'auto' is the upload placeholder while the AI summary has not assigned one of the five real categories yet.
export type SkillCategory = Category | 'auto';
export type UserRole = 'user' | 'admin';
export interface Skill {
  id: string; name: string; description: string; category: SkillCategory; agents: Agent[]; tags: string[];
  source: string; sourcePath: string; commit: string | null; license: string; owner: string;
  featured: boolean; createdAt: string; version: string; digest: string; markdown: string;
  slug: string; communityVersion: string | null; reviewStatus: 'pending'|'approved'|'rejected'|'withdrawn'|null;
  aiStatus:'unprocessed'|'queued'|'running'|'ready'|'error';originalDescription:string;communityBlocked:boolean;moderationReason:string;
  importWarnings:string[];
  tokenEstimate: number; permissions: string[]; favorite: boolean; favoriteCount: number;
}
export interface PackageMetadata { digest: string; size: number; filename: string; root: string; files: {path:string;size:number}[]; kind: 'uploaded' | 'catalog-markdown'; }
