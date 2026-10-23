import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LIMITS,
  isCalendarDate,
  limitsFromEnv,
  percentChange,
  readingKey,
  validateReadings,
  type EnergyReading,
} from "./energy-validation.ts";

const today = "2026-10-22";
const reading = (overrides: Partial<EnergyReading> = {}): EnergyReading => ({
  equipment: "Compresor A",
  measuredAt: "2026-10-21",
  consumptionKwh: 182.4,
  costEur: 32.83,
  ...overrides,
});
const messages = (readings: EnergyReading[], existingKeys: string[] = []) =>
  validateReadings(readings, { today, existingKeys }).map((issue) => `${issue.index}: ${issue.message}`);

test("acepta las mediciones que hoy tiene la app", () => {
  assert.deepEqual(
    messages([
      reading(),
      reading({ equipment: "Línea de envasado", consumptionKwh: 126.7, costEur: 22.81 }),
      reading({ equipment: "HVAC planta", measuredAt: "2026-10-20", consumptionKwh: 94.2, costEur: 16.96 }),
    ]),
    [],
  );
});

test("acepta consumo sin coste y equipo apagado (0 kWh sin coste)", () => {
  assert.deepEqual(messages([reading({ costEur: null }), reading({ equipment: "Bomba", consumptionKwh: 0, costEur: 0 })]), []);
});

test("rechaza días que no existen", () => {
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-13-01"), false);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.match(messages([reading({ measuredAt: "2026-02-30" })])[0], /no existe en el calendario/);
});

test("rechaza fechas futuras con un día de margen por la zona horaria", () => {
  assert.deepEqual(messages([reading({ measuredAt: "2026-10-23" })]), []);
  assert.match(messages([reading({ measuredAt: "2026-10-24" })])[0], /es futura/);
});

test("rechaza consumos por encima del tope", () => {
  const [issue] = messages([reading({ consumptionKwh: 1_234_000, costEur: null })]);
  assert.match(issue, /supera el máximo/);
});

test("rechaza costes que no cuadran con el consumo", () => {
  assert.match(messages([reading({ consumptionKwh: 100, costEur: 900 })])[0], /€\/kWh, fuera del rango/);
  assert.match(messages([reading({ consumptionKwh: 100, costEur: 1 })])[0], /fuera del rango/);
  assert.match(messages([reading({ consumptionKwh: 0, costEur: 5 })])[0], /consumo es 0 kWh/);
});

test("detecta duplicados en el archivo y contra lo guardado", () => {
  const dupInFile = messages([reading(), reading({ equipment: "  compresor   a " })]);
  assert.deepEqual(dupInFile, ["1: repite el equipo y la fecha de otra fila del archivo"]);
  const dupInDb = messages([reading()], [readingKey("COMPRESOR A", "2026-10-21")]);
  assert.match(dupInDb[0], /ya hay una medición/);
});

test("informa cada problema con su posición", () => {
  const issues = validateReadings(
    [reading(), reading({ equipment: "B", consumptionKwh: 80_000, costEur: null }), reading({ equipment: "C", measuredAt: "2030-01-01" })],
    { today },
  );
  assert.deepEqual(issues.map((issue) => issue.index), [1, 2]);
});

test("la variación es null sin periodo anterior y se redondea a un decimal", () => {
  assert.equal(percentChange(403.3, 0), null);
  assert.equal(percentChange(110, 100), 10);
  assert.equal(percentChange(90, 120), -25);
  assert.equal(percentChange(1, 3), -66.7);
});

test("los topes se pueden configurar y descartan valores inválidos", () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  assert.deepEqual(limitsFromEnv({ ENERGY_MAX_KWH_PER_READING: "2000", ENERGY_MIN_TARIFF_EUR_KWH: "0.1", ENERGY_MAX_TARIFF_EUR_KWH: "0.3" }), {
    maxKwhPerReading: 2000,
    minTariffEurPerKwh: 0.1,
    maxTariffEurPerKwh: 0.3,
  });
  assert.equal(limitsFromEnv({ ENERGY_MAX_KWH_PER_READING: "-5" }).maxKwhPerReading, DEFAULT_LIMITS.maxKwhPerReading);
  assert.deepEqual(limitsFromEnv({ ENERGY_MIN_TARIFF_EUR_KWH: "0.9", ENERGY_MAX_TARIFF_EUR_KWH: "0.2" }).minTariffEurPerKwh, 0.05);
});
