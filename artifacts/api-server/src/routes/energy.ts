import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  energyRecordsTable,
  insertEnergyRecordSchema,
} from "@workspace/db";
import {
  DeleteEnergyRecordParams,
  GetEnergySummaryQueryParams,
  GetEnergySummaryResponse,
  ImportEnergyRecordsBody,
  ImportEnergyRecordsResponse,
  ListEnergyEquipmentResponse,
  ListEnergyRecordsQueryParams,
  ListEnergyRecordsResponse,
} from "@workspace/api-zod";
import {
  isCalendarDate,
  limitsFromEnv,
  percentChange,
  readingKey,
  validateReadings,
} from "../lib/energy-validation";

const router: IRouter = Router();
const validationLimits = limitsFromEnv();

function asDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeDateQuery(query: Record<string, unknown>) {
  const normalized = { ...query };
  for (const key of ["from", "to"]) {
    const value = normalized[key];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      normalized[key] = new Date(`${value}T00:00:00.000Z`);
    }
  }
  return normalized;
}

function groupRecords(
  records: Array<{
    equipment: string;
    measuredAt: string;
    consumptionKwh: number;
    costEur: number | null;
  }>,
) {
  const totals = new Map<
    string,
    { totalKwh: number; totalCostEur: number; recordCount: number }
  >();
  for (const record of records) {
    const item = totals.get(record.equipment) ?? {
      totalKwh: 0,
      totalCostEur: 0,
      recordCount: 0,
    };
    item.totalKwh += record.consumptionKwh;
    item.totalCostEur += record.costEur ?? 0;
    item.recordCount += 1;
    totals.set(record.equipment, item);
  }
  const overallKwh = [...totals.values()].reduce(
    (total, item) => total + item.totalKwh,
    0,
  );
  return [...totals.entries()]
    .map(([equipment, item]) => ({
      equipment,
      totalKwh: Number(item.totalKwh.toFixed(3)),
      totalCostEur: Number(item.totalCostEur.toFixed(2)),
      recordCount: item.recordCount,
      sharePercent:
        overallKwh === 0
          ? 0
          : Number(((item.totalKwh / overallKwh) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.totalKwh - a.totalKwh);
}

router.get("/energy/records", async (req, res): Promise<void> => {
  const parsed = ListEnergyRecordsQueryParams.safeParse(
    normalizeDateQuery(req.query),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  if (parsed.data.from) {
    conditions.push(
      gte(energyRecordsTable.measuredAt, asDateString(parsed.data.from)),
    );
  }
  if (parsed.data.to) {
    conditions.push(
      lte(energyRecordsTable.measuredAt, asDateString(parsed.data.to)),
    );
  }
  if (parsed.data.equipment) {
    conditions.push(eq(energyRecordsTable.equipment, parsed.data.equipment));
  }
  if (
    parsed.data.from &&
    parsed.data.to &&
    parsed.data.from > parsed.data.to
  ) {
    res.status(400).json({ error: "'from' must be earlier than or equal to 'to'" });
    return;
  }
  const records = await db
    .select()
    .from(energyRecordsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(energyRecordsTable.measuredAt), desc(energyRecordsTable.id));
  res.json(ListEnergyRecordsResponse.parse(records));
});

router.post("/energy/records", async (req, res): Promise<void> => {
  const parsed = ImportEnergyRecordsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Zod convierte la fecha en Date y "2026-02-30" pasa a ser el 1 de marzo:
  // la fecha se valida sobre el texto que llegó.
  const rawRecords: unknown[] = Array.isArray(req.body?.records) ? req.body.records : [];
  const readings = parsed.data.records.map((record, index) => {
    const raw = (rawRecords[index] as { measuredAt?: unknown } | undefined)?.measuredAt;
    return {
      equipment: record.equipment.trim(),
      measuredAt:
        typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)
          ? raw
          : asDateString(record.measuredAt),
      consumptionKwh: record.consumptionKwh,
      costEur: record.costEur ?? null,
    };
  });
  const dates = readings.map((reading) => reading.measuredAt).filter(isCalendarDate).sort();
  const existing = dates.length
    ? await db
        .select({
          equipment: energyRecordsTable.equipment,
          measuredAt: energyRecordsTable.measuredAt,
        })
        .from(energyRecordsTable)
        .where(
          and(
            gte(energyRecordsTable.measuredAt, dates[0]),
            lte(energyRecordsTable.measuredAt, dates[dates.length - 1]),
          ),
        )
    : [];
  const issues = validateReadings(readings, {
    today: asDateString(new Date()),
    existingKeys: existing.map((record) => readingKey(record.equipment, record.measuredAt)),
    limits: validationLimits,
  });
  if (issues.length) {
    const badReadings = new Set(issues.map((issue) => issue.index)).size;
    res.status(400).json({
      error: `No se importó nada: ${badReadings} ${badReadings === 1 ? "medición tiene" : "mediciones tienen"} problemas.`,
      issues,
    });
    return;
  }
  const recordsToInsert = readings.map((reading) => insertEnergyRecordSchema.parse(reading));
  const records = await db
    .insert(energyRecordsTable)
    .values(recordsToInsert)
    .returning();
  res.status(201).json(ImportEnergyRecordsResponse.parse(records));
});

router.delete("/energy/records/:id", async (req, res): Promise<void> => {
  const parsed = DeleteEnergyRecordParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const deleted = await db
    .delete(energyRecordsTable)
    .where(eq(energyRecordsTable.id, parsed.data.id))
    .returning({ id: energyRecordsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Energy record not found" });
    return;
  }
  res.status(204).end();
});

router.get("/energy/equipment", async (_req, res): Promise<void> => {
  const records = await db.select().from(energyRecordsTable);
  const summaries = groupRecords(records);
  res.json(ListEnergyEquipmentResponse.parse(summaries));
});

router.get("/energy/summary", async (req, res): Promise<void> => {
  const parsed = GetEnergySummaryQueryParams.safeParse(
    normalizeDateQuery(req.query),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { from, to } = parsed.data;
  if (from && to && from > to) {
    res.status(400).json({ error: "'from' must be earlier than or equal to 'to'" });
    return;
  }

  const currentConditions = [];
  if (parsed.data.equipment) {
    currentConditions.push(
      eq(energyRecordsTable.equipment, parsed.data.equipment),
    );
  }
  if (from) {
    currentConditions.push(
      gte(energyRecordsTable.measuredAt, asDateString(from)),
    );
  }
  if (to) {
    currentConditions.push(lte(energyRecordsTable.measuredAt, asDateString(to)));
  }
  const currentRecords = await db
    .select()
    .from(energyRecordsTable)
    .where(currentConditions.length ? and(...currentConditions) : undefined);

  let previousTotalKwh = 0;
  if (from && to) {
    const days =
      Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    const previousTo = new Date(from.getTime() - 86_400_000);
    const previousFrom = new Date(previousTo.getTime() - (days - 1) * 86_400_000);
    const previousRecords = await db
      .select({ consumptionKwh: energyRecordsTable.consumptionKwh })
      .from(energyRecordsTable)
      .where(
        and(
          gte(energyRecordsTable.measuredAt, asDateString(previousFrom)),
          lte(energyRecordsTable.measuredAt, asDateString(previousTo)),
          ...(parsed.data.equipment
            ? [eq(energyRecordsTable.equipment, parsed.data.equipment)]
            : []),
        ),
      );
    previousTotalKwh = previousRecords.reduce(
      (total, record) => total + record.consumptionKwh,
      0,
    );
  }

  const totalKwh = currentRecords.reduce(
    (total, record) => total + record.consumptionKwh,
    0,
  );
  const totalCostEur = currentRecords.reduce(
    (total, record) => total + (record.costEur ?? 0),
    0,
  );
  const monthlyMap = new Map<
    string,
    { totalKwh: number; totalCostEur: number }
  >();
  for (const record of currentRecords) {
    const month = record.measuredAt.slice(0, 7);
    const item = monthlyMap.get(month) ?? { totalKwh: 0, totalCostEur: 0 };
    item.totalKwh += record.consumptionKwh;
    item.totalCostEur += record.costEur ?? 0;
    monthlyMap.set(month, item);
  }
  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, item]) => ({
      month,
      totalKwh: Number(item.totalKwh.toFixed(3)),
      totalCostEur: Number(item.totalCostEur.toFixed(2)),
    }));
  const equipment = groupRecords(currentRecords);

  res.json(
    GetEnergySummaryResponse.parse({
      totalKwh: Number(totalKwh.toFixed(3)),
      totalCostEur: Number(totalCostEur.toFixed(2)),
      recordCount: currentRecords.length,
      equipmentCount: equipment.length,
      previousTotalKwh: Number(previousTotalKwh.toFixed(3)),
      changePercent: from && to ? percentChange(totalKwh, previousTotalKwh) : null,
      recordsWithoutCost: currentRecords.filter((record) => record.costEur == null).length,
      monthly,
      equipment,
    }),
  );
});

export default router;
