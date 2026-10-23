import { type ReactNode, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  useDeleteEnergyRecord,
  useGetEnergySummary,
  useImportEnergyRecords,
  useListEnergyEquipment,
  useListEnergyRecords,
  getGetEnergySummaryQueryKey,
  getListEnergyEquipmentQueryKey,
  getListEnergyRecordsQueryKey,
} from '@workspace/api-client-react';
import type { EnergyRecordInput } from '@workspace/api-client-react';
import {
  Activity,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  FileSpreadsheet,
  Gauge,
  HardDrive,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

type CsvPreview = { records: EnergyRecordInput[]; filename: string };

function formatNumber(value: number | undefined, digits = 0) {
  return Number(value ?? 0).toLocaleString('es-ES', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatEuro(value: number | undefined) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value ?? 0);
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function readCsvRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"' && quoted) {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseEnergyCsv(text: string, filename: string): CsvPreview {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"' && firstLine[index + 1] === '"' && quoted) index += 1;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ',') commas += 1;
    else if (!quoted && character === ';') semicolons += 1;
  }
  const delimiter = semicolons > commas ? ';' : ',';
  const rows = readCsvRows(text, delimiter);
  if (rows.length < 2) throw new Error('El archivo necesita una cabecera y al menos una fila de datos.');
  const headers = rows[0].map((value) =>
    value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s_-]/g, ''),
  );
  const findHeader = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const equipmentIndex = findHeader('equipment', 'equipo');
  const dateIndex = findHeader('measuredat', 'fecha', 'fechamedicion');
  const kwhIndex = findHeader('consumptionkwh', 'consumokwh');
  const costIndex = findHeader('costeur', 'costeeur');
  if ([equipmentIndex, dateIndex, kwhIndex].some((index) => index < 0)) {
    throw new Error('Columnas necesarias: equipo, fecha y consumo_kwh. coste_eur es opcional.');
  }
  if (rows.length - 1 > 1000) throw new Error('Puedes importar hasta 1.000 mediciones cada vez.');
  const records = rows.slice(1).map((values, rowIndex) => {
    const equipment = values[equipmentIndex]?.trim() ?? '';
    const measuredAt = values[dateIndex]?.trim() ?? '';
    const parseNumber = (value: string) =>
      Number(delimiter === ';' ? value.replace(',', '.').trim() : value.trim());
    const consumptionKwh = parseNumber(values[kwhIndex] ?? '');
    const costText = costIndex < 0 ? '' : values[costIndex]?.trim() ?? '';
    const costEur = costText ? parseNumber(costText) : undefined;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(measuredAt) &&
      !Number.isNaN(new Date(`${measuredAt}T12:00:00`).getTime());
    if (!equipment || equipment.length > 160 || !validDate || !Number.isFinite(consumptionKwh) ||
      consumptionKwh < 0 || (costEur !== undefined && (!Number.isFinite(costEur) || costEur < 0))) {
      throw new Error(`Revisa la fila ${rowIndex + 2}: indica equipo, fecha AAAA-MM-DD y valores numéricos no negativos.`);
    }
    return { equipment, measuredAt, consumptionKwh, ...(costEur === undefined ? {} : { costEur }) };
  });
  return { records, filename };
}

function SummaryChart({ monthly }: { monthly: { month: string; totalKwh: number; totalCostEur: number }[] }) {
  if (!monthly?.length) {
    return <div className="empty"><div className="empty-mark"><Activity size={17} /></div>No hay mediciones mensuales en este periodo.</div>;
  }
  const width = 600;
  const height = 174;
  const left = 37;
  const right = 15;
  const top = 10;
  const bottom = 29;
  const max = Math.max(...monthly.map((item) => item.totalKwh), 1) * 1.15;
  const points = monthly.map((item, index) => {
    const x = monthly.length === 1 ? (left + width - right) / 2 : left + (index * (width - left - right)) / (monthly.length - 1);
    const y = top + (1 - item.totalKwh / max) * (height - top - bottom);
    return { x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = `${line} L ${points[points.length - 1].x} ${height - bottom} L ${points[0].x} ${height - bottom} Z`;
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico mensual de consumo energético">
        {[0, 1, 2].map((step) => {
          const y = top + step * ((height - top - bottom) / 2);
          return <g key={step}><line x1={left} y1={y} x2={width - right} y2={y} className="chart-grid" /><text x="0" y={y + 3} className="chart-label">{formatNumber(max * (1 - step / 2))}</text></g>;
        })}
        <path d={area} fill="url(#energyFill)" opacity=".45" />
        <defs><linearGradient id="energyFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#a9c9a7" /><stop offset="100%" stopColor="#fff" /></linearGradient></defs>
        <path d={line} className="chart-line" />
        {points.map((point, index) => <circle key={monthly[index].month} cx={point.x} cy={point.y} r="4" className="chart-dot" />)}
        {monthly.map((item, index) => <text key={item.month} x={points[index].x} y={height - 7} textAnchor="middle" className="chart-label">{item.month}</text>)}
      </svg>
    </div>
  );
}

function MetricSkeleton() {
  return <div className="metrics" aria-label="Cargando resumen energético">{[0, 1, 2, 3].map((item) => <div className="skeleton skel-metric" key={item} />)}</div>;
}

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const importMutation = useImportEnergyRecords();
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const onFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      setPreview(parseEnergyCsv(await file.text(), file.name));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : 'Unable to read this CSV file.');
    }
  };
  const submit = () => {
    if (!preview) return;
    importMutation.mutate({ data: { records: preview.records } }, {
      onSuccess: onImported,
      onError: (caught) => setError(caught instanceof Error ? caught.message : 'Import failed. Try again.'),
    });
  };
  return (
    <div className="import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-head">
          <div>
            <div className="eyebrow">Carga de datos</div>
            <div className="dialog-title" id="import-title">Importar mediciones</div>
          </div>
          <button className="icon-button" type="button" aria-label="Close import dialog" data-testid="button-close-import" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="dialog-copy">Añade lecturas recientes de tus equipos. Archivos CSV, hasta 1.000 filas por importación.</p>
        <div className="dropzone">
          <FileSpreadsheet size={25} strokeWidth={1.6} />
          <div className="drop-title">Selecciona un archivo CSV</div>
          <div className="drop-hint">Revisaremos los datos antes de guardarlos.</div>
          <input ref={inputRef} className="file-input" type="file" accept=".csv,text/csv" aria-label="Choose CSV file" data-testid="input-csv-file" onChange={(event) => onFile(event.target.files?.[0])} />
          <p className="csv-help">Columnas necesarias: <span className="mono">equipo, fecha, consumo_kwh</span><br />Opcional: <span className="mono">coste_eur</span> · fecha <span className="mono">AAAA-MM-DD</span>. También se aceptan los nombres de columna en inglés.</p>
        </div>
        {preview && <div className="preview"><span><Check size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: '#26766c' }} />{preview.filename}</span><span className="mono">{preview.records.length} filas</span></div>}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button-primary" type="button" disabled={!preview || importMutation.isPending} data-testid="button-submit-import" onClick={submit}>
            {importMutation.isPending ? <><LoaderCircle size={14} className="spin" />Importando</> : <><Upload size={14} />Importar mediciones</>}
          </button>
        </div>
      </section>
    </div>
  );
}

function Overview() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [equipment, setEquipment] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const params = useMemo(() => ({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(equipment ? { equipment } : {}),
  }), [from, to, equipment]);
  const summaryParams = useMemo(() => ({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(equipment ? { equipment } : {}),
  }), [from, to, equipment]);
  const recordsQuery = useListEnergyRecords(params);
  const summaryQuery = useGetEnergySummary(summaryParams);
  const equipmentQuery = useListEnergyEquipment();
  const deleteMutation = useDeleteEnergyRecord();
  const records = recordsQuery.data ?? [];
  const summary = summaryQuery.data;
  const equipmentOptions = useMemo(() => {
    const names = [...(equipmentQuery.data ?? []).map((item) => item.equipment), ...(summary?.equipment ?? []).map((item) => item.equipment)];
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [equipmentQuery.data, summary?.equipment]);

  const refreshData = () => {
    void queryClient.invalidateQueries({ queryKey: getListEnergyRecordsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetEnergySummaryQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListEnergyEquipmentQueryKey() });
  };
  const removeRecord = (id: number) => {
    if (!window.confirm('¿Eliminar esta medición? Esta acción no se puede deshacer.')) return;
    deleteMutation.mutate({ id }, {
      onSuccess: refreshData,
    });
  };
  const retry = () => {
    void recordsQuery.refetch();
    void summaryQuery.refetch();
    void equipmentQuery.refetch();
  };
  const queryError = recordsQuery.isError || summaryQuery.isError || equipmentQuery.isError;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={20} strokeWidth={2.2} /></div>
          <div className="brand-copy"><div className="brand-name">Wattline</div><div className="brand-sub">Energía para instalaciones</div></div>
        </div>
        <nav aria-label="Main navigation">
          <div className="nav-label">Espacio de trabajo</div>
          <a className="nav-item selected" href="/" aria-current="page" data-testid="link-overview"><Gauge size={16} /><span className="nav-text">Resumen</span></a>
          <a className="nav-item" href="#records" onClick={(event) => { event.preventDefault(); document.getElementById('records')?.scrollIntoView({ behavior: 'smooth' }); }} data-testid="link-readings"><Database size={16} /><span className="nav-text">Mediciones</span></a>
        </nav>
        <div className="side-bottom">
          <div className="site-label">Instalación</div>
          <div className="site-name">Todos los equipos</div>
          <div className="site-status"><span className="status-dot" />Datos guardados</div>
        </div>
      </aside>

      <main className="main">
        <div className="topline">
          <div className="crumb">ENERGÍA / RESUMEN</div>
          <div className="today"><CalendarDays size={13} />{new Date().toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
        </div>
        <div className="page-heading">
          <div>
            <div className="eyebrow">Rendimiento energético</div>
            <h1>Consumo energético</h1>
            <p className="subtitle">Consumo, coste y rendimiento de cada equipo, en un solo lugar.</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => setImportOpen(true)} data-testid="button-open-import"><Plus size={15} />Importar CSV</button>
        </div>

        <div className="filters" aria-label="Energy data filters">
          <span className="filter-label">Periodo</span>
          <label className="sr-only" htmlFor="filter-from">From date</label>
          <input className="filter-date" id="filter-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" data-testid="input-filter-from" />
          <span className="filter-label">to</span>
          <label className="sr-only" htmlFor="filter-to">To date</label>
          <input className="filter-date" id="filter-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" data-testid="input-filter-to" />
          <label className="sr-only" htmlFor="filter-equipment">Equipo</label>
          <div style={{ position: 'relative' }}>
            <select className="filter-select" id="filter-equipment" value={equipment} onChange={(event) => setEquipment(event.target.value)} aria-label="Filtrar por equipo" data-testid="select-filter-equipment">
              <option value="">Todos los equipos</option>
              {equipmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <ChevronDown size={12} style={{ position: 'absolute', pointerEvents: 'none', right: 9, top: 12 }} />
          </div>
          {(from || to || equipment) && <button type="button" className="filter-reset" onClick={() => { setFrom(''); setTo(''); setEquipment(''); }} data-testid="button-reset-filters">Quitar filtros</button>}
        </div>

        {queryError && (
          <div className="notice" role="alert"><span><CircleAlert size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} />No se han podido cargar algunos datos.</span><button type="button" onClick={retry} data-testid="button-retry">Reintentar</button></div>
        )}

        {summaryQuery.isLoading ? <MetricSkeleton /> : (
          <section className="metrics" aria-label="Energy summary">
            <article className="metric primary" data-testid="metric-total-consumption">
              <div className="metric-label">Consumo total <Activity size={14} /></div>
              <div className="metric-value">{formatNumber(summary?.totalKwh)}<span className="metric-unit">kWh</span></div>
              <div className="metric-foot">{from && to ? summary?.previousTotalKwh ? <><span className="change">{summary.changePercent > 0 ? '+' : ''}{formatNumber(summary.changePercent, 1)}%</span> frente al periodo anterior <span>·</span> {formatNumber(summary.previousTotalKwh, 1)} kWh</> : 'Sin consumo en el periodo anterior' : from || to ? 'Periodo seleccionado · sin comparativa' : 'Todo el histórico · sin comparativa'}</div>
            </article>
            <article className="metric" data-testid="metric-total-cost">
              <div className="metric-label">Coste total <Database size={13} /></div>
              <div className="metric-value">{formatEuro(summary?.totalCostEur)}</div>
              <div className="metric-foot">En el periodo seleccionado</div>
            </article>
            <article className="metric" data-testid="metric-record-count">
              <div className="metric-label">Mediciones <FileSpreadsheet size={13} /></div>
              <div className="metric-value">{formatNumber(summary?.recordCount)}</div>
              <div className="metric-foot">Registros guardados</div>
            </article>
            <article className="metric" data-testid="metric-equipment-count">
              <div className="metric-label">Equipos <HardDrive size={13} /></div>
              <div className="metric-value">{formatNumber(summary?.equipmentCount)}</div>
              <div className="metric-foot">Con mediciones registradas</div>
            </article>
          </section>
        )}

        <section className="content-grid">
          <article className="panel">
            <div className="panel-head"><div><div className="panel-title">Evolución del consumo</div><div className="panel-note">Consumo mensual · kWh</div></div><div className="crumb">KWH</div></div>
            {summaryQuery.isLoading ? <div style={{ padding: 20 }}><div className="skeleton" style={{ height: 150 }} /></div> : <SummaryChart monthly={summary?.monthly ?? []} />}
          </article>
          <article className="panel">
            <div className="panel-head"><div><div className="panel-title">Consumo por equipo</div><div className="panel-note">Porcentaje del consumo total</div></div><HardDrive size={15} color="#6e8277" /></div>
            {summaryQuery.isLoading ? <div style={{ padding: 18 }}>{[1, 2, 3].map((row) => <div className="skeleton" key={row} style={{ height: 35, marginBottom: 10 }} />)}</div> :
              (summary?.equipment?.length ? <div className="equipment-list">
                {summary.equipment.slice(0, 5).map((item) => (
                  <div className="equipment-row" key={item.equipment} data-testid={`equipment-summary-${item.equipment}`}>
                    <div><div className="equipment-name">{item.equipment}</div><div className="equipment-meta">{formatNumber(item.totalKwh)} kWh · {formatEuro(item.totalCostEur)}</div><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, item.sharePercent))}%` }} /></div></div>
                    <div className="equipment-percent">{formatNumber(item.sharePercent, 1)}%</div>
                  </div>
                ))}
              </div> : <div className="empty"><div className="empty-mark"><HardDrive size={16} /></div>Los resúmenes aparecerán al importar mediciones.</div>)}
          </article>
        </section>

        <section className="panel table-panel" id="records">
          <div className="table-toolbar">
            <div><span className="table-title">Últimas mediciones</span><span className="table-count">{recordsQuery.isLoading ? 'Cargando' : `${records.length} registros`}</span></div>
            <span className="crumb">MÁS RECIENTES</span>
          </div>
          {recordsQuery.isLoading ? (
            <div style={{ padding: '4px 20px 20px' }} aria-label="Cargando mediciones">{[0, 1, 2, 3].map((row) => <div className="skeleton" key={row} style={{ height: 38, marginTop: 8 }} />)}</div>
          ) : records.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>Equipo</th><th>Fecha</th><th>Consumo</th><th>Coste</th><th><span className="sr-only">Acciones</span></th></tr></thead>
                <tbody>
                  {records.slice(0, 12).map((record) => (
                    <tr key={record.id} data-testid={`row-energy-record-${record.id}`}>
                      <td><div className="equip-cell"><span className="equip-icon"><Activity size={13} /></span>{record.equipment}</div></td>
                      <td className="mono">{formatDate(record.measuredAt)}</td>
                      <td className="mono">{formatNumber(record.consumptionKwh, 1)} kWh</td>
                      <td className="mono">{record.costEur == null ? '—' : formatEuro(record.costEur)}</td>
                      <td style={{ textAlign: 'right' }}><button className="delete-button" type="button" title="Eliminar medición" aria-label={`Eliminar medición de ${record.equipment} del ${formatDate(record.measuredAt)}`} disabled={deleteMutation.isPending} onClick={() => removeRecord(record.id)} data-testid={`button-delete-record-${record.id}`}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty"><div className="empty-mark"><FileSpreadsheet size={17} /></div><strong style={{ display: 'block', color: '#30433d', marginBottom: 5 }}>No hay mediciones en esta vista</strong>Importa un CSV o cambia los filtros para consultar los registros.</div>
          )}
        </section>
        {deleteMutation.isError && <div className="notice" role="alert" style={{ marginTop: 12 }}><span><CircleAlert size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} />No se ha podido eliminar la medición.</span><button type="button" onClick={() => deleteMutation.reset()}>Cerrar</button></div>}
      </main>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); refreshData(); }} />}
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Overview} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
