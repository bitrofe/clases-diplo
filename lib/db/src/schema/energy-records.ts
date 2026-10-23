import { createInsertSchema } from "drizzle-zod";
import { date, integer, numeric, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const energyRecordsTable = pgTable("energy_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  equipment: text("equipment").notNull(),
  measuredAt: date("measured_at", { mode: "string" }).notNull(),
  consumptionKwh: numeric("consumption_kwh", {
    precision: 14,
    scale: 3,
    mode: "number",
  }).notNull(),
  costEur: numeric("cost_eur", {
    precision: 14,
    scale: 2,
    mode: "number",
  }),
});

export const insertEnergyRecordSchema = createInsertSchema(energyRecordsTable).extend({
    equipment: z.string().trim().min(1).max(160),
    consumptionKwh: z.number().min(0),
    costEur: z.number().min(0).nullable(),
  });

export type InsertEnergyRecord = z.infer<typeof insertEnergyRecordSchema>;
export type EnergyRecord = typeof energyRecordsTable.$inferSelect;
