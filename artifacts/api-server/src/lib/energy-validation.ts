// Reglas de validación de las mediciones de consumo. Funciones puras, sin base de datos,
// para poder probarlas con `node --test` sin instalar nada.

export type EnergyReading = {
  equipment: string;
  measuredAt: string;
  consumptionKwh: number;
  costEur: number | null;
};

export type ReadingIssue = { index: number; message: string };

export type ValidationLimits = {
  maxKwhPerReading: number;
  minTariffEurPerKwh: number;
  maxTariffEurPerKwh: number;
};

export const DEFAULT_LIMITS: ValidationLimits = {
  maxKwhPerReading: 50_000,
  minTariffEurPerKwh: 0.05,
  maxTariffEurPerKwh: 0.6,
};

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function limitsFromEnv(
  env: Record<string, string | undefined> = process.env,
): ValidationLimits {
  const limits = {
    maxKwhPerReading: positiveNumber(env.ENERGY_MAX_KWH_PER_READING, DEFAULT_LIMITS.maxKwhPerReading),
    minTariffEurPerKwh: positiveNumber(env.ENERGY_MIN_TARIFF_EUR_KWH, DEFAULT_LIMITS.minTariffEurPerKwh),
    maxTariffEurPerKwh: positiveNumber(env.ENERGY_MAX_TARIFF_EUR_KWH, DEFAULT_LIMITS.maxTariffEurPerKwh),
  };
  return limits.minTariffEurPerKwh < limits.maxTariffEurPerKwh
    ? limits
    : { ...limits, minTariffEurPerKwh: DEFAULT_LIMITS.minTariffEurPerKwh, maxTariffEurPerKwh: DEFAULT_LIMITS.maxTariffEurPerKwh };
}

// `new Date("2026-02-30")` no falla: pasa al 1 de marzo. Aquí se exige que el día exista.
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function readingKey(equipment: string, measuredAt: string): string {
  return `${equipment.trim().replace(/\s+/g, " ").toLowerCase()}|${measuredAt}`;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatKwh(value: number): string {
  return value.toLocaleString("es-ES", { maximumFractionDigits: 3 });
}

export function validateReadings(
  readings: EnergyReading[],
  options: {
    today: string;
    existingKeys?: Iterable<string>;
    limits?: ValidationLimits;
  },
): ReadingIssue[] {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const existing = new Set(options.existingKeys ?? []);
  // Un día de margen: el servidor va en UTC y quien importa puede ir por delante (Europa).
  const latestAllowed = addDays(options.today, 1);
  const seen = new Set<string>();
  const issues: ReadingIssue[] = [];

  readings.forEach((reading, index) => {
    const add = (message: string) => issues.push({ index, message });
    const { consumptionKwh: kwh, costEur: cost } = reading;

    if (!isCalendarDate(reading.measuredAt)) {
      add(`la fecha «${reading.measuredAt}» no existe en el calendario`);
      return;
    }
    if (reading.measuredAt > latestAllowed) add(`la fecha ${reading.measuredAt} es futura`);

    if (!Number.isFinite(kwh) || kwh < 0) add("el consumo debe ser un número no negativo");
    else if (kwh > limits.maxKwhPerReading) {
      add(`${formatKwh(kwh)} kWh supera el máximo por medición (${formatKwh(limits.maxKwhPerReading)} kWh)`);
    }

    if (cost != null && Number.isFinite(kwh) && kwh >= 0) {
      if (!Number.isFinite(cost) || cost < 0) add("el coste debe ser un número no negativo");
      else if (kwh === 0 && cost > 0) add("tiene coste pero el consumo es 0 kWh");
      else if (kwh > 0) {
        const tariff = cost / kwh;
        if (tariff < limits.minTariffEurPerKwh || tariff > limits.maxTariffEurPerKwh) {
          add(
            `el coste implica ${tariff.toLocaleString("es-ES", { maximumFractionDigits: 3 })} €/kWh, ` +
              `fuera del rango ${limits.minTariffEurPerKwh.toLocaleString("es-ES")}–${limits.maxTariffEurPerKwh.toLocaleString("es-ES")} €/kWh`,
          );
        }
      }
    }

    const key = readingKey(reading.equipment, reading.measuredAt);
    if (seen.has(key)) add("repite el equipo y la fecha de otra fila del archivo");
    else if (existing.has(key)) add(`ya hay una medición de «${reading.equipment}» el ${reading.measuredAt}`);
    else seen.add(key);
  });

  return issues;
}

// Sin consumo en el periodo anterior no hay base para comparar: se devuelve null, no 0 %.
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}
