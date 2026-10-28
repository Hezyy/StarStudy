import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
  id: uuid().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text().notNull().default('user'),
  disabled: boolean().notNull().default(false),
  onboarded: boolean().notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const authSessions = pgTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('session_owner').on(t.ownerId)],
);
export const invitations = pgTable('invitations', {
  tokenHash: text('token_hash').primaryKey(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
});
export const platformSettings = pgTable('platform_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
});
export const dataVersions = pgTable('data_versions', {
  ownerId: uuid('owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  version: integer().notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const studyRecords = pgTable(
  'study_records',
  {
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    id: uuid().notNull(),
    payload: jsonb().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.kind, t.id] }),
    index('records_owner_kind').on(t.ownerId, t.kind),
  ],
);
export const recoveryCopies = pgTable('recovery_copies', {
  id: uuid().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb().notNull(),
});
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    provider: text().notNull(),
    kind: text().notNull(),
    status: text().notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reservedTokens: integer('reserved_tokens').notNull(),
    estimatedMicroCost: integer('estimated_micro_cost').notNull().default(0),
  },
  (t) => [index('usage_owner_date').on(t.ownerId, t.createdAt)],
);
export const auditEvents = pgTable('audit_events', {
  id: uuid().primaryKey(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
