import { pgTable, text, integer, doublePrecision, customType, primaryKey, index, uniqueIndex,check,foreignKey, timestamp,type AnyPgColumn } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
const bytea = customType<{data:Buffer}>({dataType:()=> 'bytea'});
export const authUsers=pgTable('auth_users',{
  id:text('id').primaryKey(),casSubject:text('cas_subject').notNull().unique(),displayName:text('display_name').notNull(),role:text('role').notNull().default('user'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[check('auth_users_role_check',sql`${t.role} IN ('user','admin')`)]);
export const authSessions=pgTable('auth_sessions',{
  tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>authUsers.id),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
},t=>[index('auth_sessions_expiry_idx').on(t.expiresAt)]);
export const authAttempts=pgTable('auth_attempts',{tokenHash:text('token_hash').primaryKey(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull()});
export const authTickets=pgTable('auth_tickets',{ticketHash:text('ticket_hash').primaryKey(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull()});

export const skills = pgTable('skills', {
  id: text('id').primaryKey(),slug:text('slug').notNull(),communityVersion:text('community_version'),communityBlocked:customType<{data:boolean}>({dataType:()=> 'boolean'})('community_blocked').notNull().default(false),moderationReason:text('moderation_reason').notNull().default(''), name: text('name').notNull(), description: text('description').notNull(),
  category: text('category').notNull(), agents: text('agents').notNull(), tags: text('tags').notNull(),
  source: text('source').notNull(), sourcePath: text('source_path').notNull(), commit: text('commit'),
  license: text('license').notNull(), owner: text('owner').notNull(), featured: integer('featured').notNull().default(0),
  createdAt: text('created_at').notNull(),
},t=>[uniqueIndex('skills_owner_slug_idx').on(t.owner,t.slug),foreignKey({name:'skills_community_version_fk',columns:[t.id,t.communityVersion],foreignColumns:[versions.skillId,versions.version]})]);
export const versions = pgTable('versions', {
  skillId: text('skill_id').notNull().references(():AnyPgColumn => skills.id), version: text('version').notNull(),
  markdown: text('markdown').notNull(), digest: text('digest').notNull(), commit: text('commit'),
  changelog: text('changelog').notNull(), createdAt: text('created_at').notNull(),metadata:text('metadata').notNull().default('{}'),aiStatus:text('ai_status').notNull().default('unprocessed'),aiSummary:text('ai_summary'),aiCategory:text('ai_category'),aiTags:text('ai_tags'),
}, t => [primaryKey({ columns: [t.skillId, t.version] })]);
export const favorites = pgTable('favorites', {
  userId: text('user_id').notNull(), skillId: text('skill_id').notNull().references(() => skills.id), createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.skillId] })]);
// Legacy storage retained without product endpoints; no active recipe feature.
export const legacyRecipes = pgTable('recipes', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  task: text('task').notNull(), agent: text('agent').notNull(), items: text('items').notNull(), createdAt: text('created_at').notNull(),
});
export const packages = pgTable('packages', {
  skillId: text('skill_id').notNull(), version: text('version').notNull(),
  digest: text('digest').notNull(), size: integer('size').notNull(), filename: text('filename').notNull(),
  root: text('root').notNull(), files: text('files').notNull(),
}, t => [primaryKey({ columns: [t.skillId, t.version] }), foreignKey({columns:[t.skillId,t.version],foreignColumns:[versions.skillId,versions.version]})]);
export const packageChunks = pgTable('package_chunks', {
  skillId: text('skill_id').notNull(), version: text('version').notNull(),
  chunkIndex: integer('chunk_index').notNull(), content: bytea('content').notNull(),
}, t => [primaryKey({ columns: [t.skillId, t.version, t.chunkIndex] }), foreignKey({columns:[t.skillId,t.version],foreignColumns:[packages.skillId,packages.version]})]);
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
  hash: text('hash').notNull().unique(), prefix: text('prefix').notNull(), scope: text('scope').notNull(), createdAt: text('created_at').notNull(),
});
export const messages = pgTable('messages', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), author: text('author').notNull(),
  content: text('content').notNull(), color: text('color').notNull(), createdAt: text('created_at').notNull(),
  positionX: doublePrecision('position_x'), positionY: doublePrecision('position_y'),
  deletedAt:timestamp('deleted_at',{withTimezone:true}),deletedBy:text('deleted_by').references(()=>authUsers.id),
}, t => [index('messages_created_idx').on(t.createdAt, t.id)]);
export const communityReviews=pgTable('community_reviews',{
  id:text('id').primaryKey(),skillId:text('skill_id').notNull(),version:text('version').notNull(),submitter:text('submitter').notNull().references(()=>authUsers.id),
  decisionSource:text('decision_source').notNull().default('human'),aiStatus:text('ai_status').notNull().default('not_requested'),aiReport:text('ai_report').notNull().default('{}'),aiModel:text('ai_model'),packageDigest:text('package_digest'),status:text('status').notNull().default('pending'),reason:text('reason').notNull().default(''),reviewer:text('reviewer').references(()=>authUsers.id),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),reviewedAt:timestamp('reviewed_at',{withTimezone:true}),
},t=>[foreignKey({columns:[t.skillId,t.version],foreignColumns:[versions.skillId,versions.version]}),index('community_reviews_status_idx').on(t.status,t.createdAt),uniqueIndex('community_reviews_active_idx').on(t.skillId,t.version).where(sql`${t.status} IN ('pending','approved')`),check('community_reviews_status_check',sql`${t.status} IN ('pending','approved','rejected','withdrawn')`)]);

export const aiJobs=pgTable('ai_jobs',{
 id:text('id').primaryKey(),kind:text('kind').notNull(),skillId:text('skill_id').notNull(),version:text('version').notNull(),reviewId:text('review_id').references(()=>communityReviews.id),status:text('status').notNull().default('queued'),attempts:integer('attempts').notNull().default(0),availableAt:timestamp('available_at',{withTimezone:true}).notNull().defaultNow(),leaseUntil:timestamp('lease_until',{withTimezone:true}),claimToken:text('claim_token'),errorCode:text('error_code').notNull().default(''),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[foreignKey({columns:[t.skillId,t.version],foreignColumns:[versions.skillId,versions.version]}),uniqueIndex('ai_jobs_summary_idx').on(t.skillId,t.version).where(sql`${t.kind}='summary'`),uniqueIndex('ai_jobs_review_idx').on(t.reviewId).where(sql`${t.kind}='review'`),index('ai_jobs_queue_idx').on(t.status,t.availableAt)]);
export const communityModeration=pgTable('community_moderation',{id:text('id').primaryKey(),skillId:text('skill_id').notNull().references(()=>skills.id),actor:text('actor').notNull().references(()=>authUsers.id),action:text('action').notNull(),reason:text('reason').notNull().default(''),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
