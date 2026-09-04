import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export type ProjectWeights = Record<string, number>;
export type ScoreSnapshot = Record<string, unknown>;

export const project = pgTable(
  "project",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    preset: text("preset").notNull().default("warehouse"),
    weights: jsonb("weights").$type<ProjectWeights>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("project_user_id_idx").on(table.userId)],
);

export const savedSite = pgTable(
  "saved_site",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    h3Cell: text("h3_cell"),
    notes: text("notes"),
    scoreSnapshot: jsonb("score_snapshot")
      .$type<ScoreSnapshot>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("saved_site_project_id_idx").on(table.projectId)],
);

export const comparisonSet = pgTable(
  "comparison_set",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    savedSiteIds: jsonb("saved_site_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("comparison_set_project_id_idx").on(table.projectId)],
);

export const projectRelations = relations(project, ({ one, many }) => ({
  user: one(user, {
    fields: [project.userId],
    references: [user.id],
  }),
  savedSites: many(savedSite),
  comparisonSets: many(comparisonSet),
}));

export const savedSiteRelations = relations(savedSite, ({ one }) => ({
  project: one(project, {
    fields: [savedSite.projectId],
    references: [project.id],
  }),
}));

export const comparisonSetRelations = relations(comparisonSet, ({ one }) => ({
  project: one(project, {
    fields: [comparisonSet.projectId],
    references: [project.id],
  }),
}));
