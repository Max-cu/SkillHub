import { sqliteTable, text, integer, real, blob, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull(),
  category: text('category').notNull(), agents: text('agents').notNull(), tags: text('tags').notNull(),
  source: text('source').notNull(), sourcePath: text('source_path').notNull(), commit: text('commit'),
  license: text('license').notNull(), owner: text('owner').notNull(), featured: integer('featured').notNull().default(0),
  createdAt: text('created_at').notNull(),
});
export const versions = sqliteTable('versions', {
  skillId: text('skill_id').notNull().references(() => skills.id), version: text('version').notNull(),
  markdown: text('markdown').notNull(), digest: text('digest').notNull(), commit: text('commit'),
  changelog: text('changelog').notNull(), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.skillId, t.version] })]);
export const favorites = sqliteTable('favorites', {
  userId: text('user_id').notNull(), skillId: text('skill_id').notNull().references(() => skills.id), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.skillId] })]);
// Legacy storage retained without product endpoints; no active recipe feature.
export const legacyRecipes = sqliteTable('recipes', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  task: text('task').notNull(), agent: text('agent').notNull(), items: text('items').notNull(), createdAt: text('created_at').notNull(),
});
export const packages = sqliteTable('packages', {
  skillId: text('skill_id').notNull().references(() => skills.id), version: text('version').notNull(),
  digest: text('digest').notNull(), size: integer('size').notNull(), filename: text('filename').notNull(),
  root: text('root').notNull(), files: text('files').notNull(),
}, t => [primaryKey({ columns: [t.skillId, t.version] })]);
export const packageChunks = sqliteTable('package_chunks', {
  skillId: text('skill_id').notNull().references(() => skills.id), version: text('version').notNull(),
  chunkIndex: integer('chunk_index').notNull(), content: blob('content', { mode: 'buffer' }).notNull(),
}, t => [primaryKey({ columns: [t.skillId, t.version, t.chunkIndex] })]);
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  hash: text('hash').notNull().unique(), prefix: text('prefix').notNull(), scope: text('scope').notNull(), createdAt: text('created_at').notNull(),
});
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), author: text('author').notNull(),
  content: text('content').notNull(), color: text('color').notNull(), createdAt: text('created_at').notNull(),
  positionX: real('position_x'), positionY: real('position_y'),
}, t => [index('messages_created_idx').on(t.createdAt, t.id)]);
