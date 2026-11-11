import { useId, useMemo, useState } from "react";
import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export interface JournalTrackerValuePoint {
  occurredAtUtc: string;
  value: number;
}

type TrackerChartRange = "1W" | "1M" | "1Q" | "6M" | "YTD" | "1Y" | "All";

const chartRanges: Array<{ key: TrackerChartRange; label: string }> = [
  { key: "1W", label: "1 week" },
  { key: "1M", label: "1 month" },
  { key: "1Q", label: "1 quarter" },
  { key: "6M", label: "6 months" },
  { key: "YTD", label: "Year to date" },
  { key: "1Y", label: "1 year" },
  { key: "All", label: "All time" },
];

function subtractCalendarMonths(date: Date, months: number) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function startForRange(range: TrackerChartRange, now: Date) {
  if (range === "All") return null;
  if (range === "YTD") return new Date(now.getFullYear(), 0, 1);
  if (range === "1M") return subtractCalendarMonths(now, 1);
  if (range === "1Q") return subtractCalendarMonths(now, 3);
  if (range === "6M") return subtractCalendarMonths(now, 6);
  if (range === "1Y") return subtractCalendarMonths(now, 12);
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  return start;
}

function formatValue(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function shortDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(value);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function TrackerValueChart({ values, loggedDates, currentStreak, longestStreak, unit, trackerName }: {
  values: JournalTrackerValuePoint[];
  loggedDates: string[];
  currentStreak: number;
  longestStreak: number;
  unit: string;
  trackerName: string;
}) {
  const [range, setRange] = useState<TrackerChartRange>("1Y");
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const gradientId = `tracker-chart-fill-${useId().replaceAll(":", "")}`;
  const now = new Date();
  const points = useMemo(() => {
    const start = startForRange(range, now)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const end = now.getTime();
    return values
      .map((point) => ({ ...point, time: new Date(point.occurredAtUtc).getTime(), value: Number(point.value) }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.time >= start && point.time <= end)
      .sort((left, right) => left.time - right.time);
  }, [range, values]);

  const width = 640;
  const height = 180;
  const inset = 10;
  const valuesOnly = points.map(({ value }) => value);
  const minimum = valuesOnly.length ? Math.min(...valuesOnly) : 0;
  const maximum = valuesOnly.length ? Math.max(...valuesOnly) : 0;
  const valueSpan = maximum - minimum || Math.max(Math.abs(maximum) * 0.04, 1);
  const firstTime = points[0]?.time ?? 0;
  const lastTime = points.at(-1)?.time ?? firstTime;
  const timeSpan = lastTime - firstTime;
  const coordinates = points.map((point, index) => ({
    x: points.length === 1
      ? width / 2
      : inset + ((timeSpan ? point.time - firstTime : index) / (timeSpan || points.length - 1)) * (width - inset * 2),
    y: maximum === minimum
      ? height / 2
      : inset + ((maximum - point.value) / valueSpan) * (height - inset * 2),
  }));
  const linePoints = coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPoints = coordinates.length > 1
    ? `${inset},${height - inset} ${linePoints} ${width - inset},${height - inset}`
    : "";
  const first = points[0]?.value;
  const latest = points.at(-1)?.value;
  const change = first == null || latest == null ? null : latest - first;
  const percentChange = change == null || first === 0 ? null : (change / Math.abs(first)) * 100;
  const direction = change == null || change === 0 ? "neutral" : change > 0 ? "positive" : "negative";
  const rangeStart = startForRange(range, now);
  const rangeStartKey = rangeStart ? localDateKey(rangeStart) : "0000-00-00";
  const rangeEndKey = localDateKey(now);
  const loggedDayCount = loggedDates.filter((date) => date >= rangeStartKey && date <= rangeEndKey).length;
  const dailyValues = new Map<string, number[]>();
  for (const point of points) {
    const key = localDateKey(new Date(point.time));
    dailyValues.set(key, [...(dailyValues.get(key) || []), point.value]);
  }
  const dailyAverages = [...dailyValues.values()].map((day) => day.reduce((sum, value) => sum + value, 0) / day.length);
  const rangeAverage = dailyAverages.length ? dailyAverages.reduce((sum, value) => sum + value, 0) / dailyAverages.length : null;
  const active = activePoint == null ? null : points[activePoint];
  const activeCoordinate = activePoint == null ? null : coordinates[activePoint];

  return <section className="tracker-value-chart" aria-label={`${trackerName} value history`}>
    <div className="tracker-chart-range" role="group" aria-label={`${trackerName} chart range`}>
      {chartRanges.map((option) => <button
        type="button"
        key={option.key}
        className={range === option.key ? "is-active" : ""}
        aria-label={option.label}
        aria-pressed={range === option.key}
        onClick={() => setRange(option.key)}
      >{option.key}</button>)}
    </div>
    <header className="tracker-chart-summary">
        {latest != null && <strong>{formatValue(latest)}{unit ? <small> {unit}</small> : null}</strong>}
        {change != null && points.length > 1 && <span className={`is-${direction}`}>
          {change > 0 ? "+" : ""}{formatValue(change)}{unit ? ` ${unit}` : ""}
          {percentChange != null ? ` (${percentChange > 0 ? "+" : ""}${formatValue(percentChange)}%)` : ""}
        </span>}
        <span className="tracker-chart-metric"><b>{currentStreak}</b><small>current streak</small></span>
        <span className="tracker-chart-metric"><b>{longestStreak}</b><small>longest streak</small></span>
        <span className="tracker-chart-metric"><b>{loggedDayCount}</b><small>days logged</small></span>
        {rangeAverage != null && <span className="tracker-chart-metric"><b>{formatValue(rangeAverage)}{unit ? ` ${unit}` : ""}</b><small>average</small></span>}
    </header>
    {points.length === 0 ? <p className="tracker-chart-empty">No numeric values in this range.</p> : <>
      <div className="tracker-chart-plot">
        <span className="tracker-chart-maximum">{formatValue(maximum)}</span>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${trackerName} from ${formatValue(first!)} to ${formatValue(latest!)} ${unit}`.trim()} preserveAspectRatio="none">
          <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".2"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
          {[10, 63.33, 116.67, 170].map((y) => <line className="tracker-chart-gridline" x1="0" x2={width} y1={y} y2={y} key={y} />)}
          {areaPoints && <polygon className="tracker-chart-area" points={areaPoints} fill={`url(#${gradientId})`} />}
          {linePoints && <polyline className="tracker-chart-line" points={linePoints} />}
          {activeCoordinate && <line className="tracker-chart-guide" x1={activeCoordinate.x} x2={activeCoordinate.x} y1={inset} y2={height - inset} />}
          {coordinates.map(({ x, y }, index) => <g key={`${points[index].occurredAtUtc}-${index}`}>
            <circle className={`tracker-chart-point${activePoint === index ? " is-active" : ""}`} cx={x} cy={y} r={activePoint === index || points.length === 1 || index === coordinates.length - 1 ? 4 : 2.25} />
            <circle className="tracker-chart-hit-point" cx={x} cy={y} r="12" tabIndex={0} role="button"
              aria-label={`${shortDate(points[index].time)}, ${formatValue(points[index].value)}${unit ? ` ${unit}` : ""}`}
              onMouseEnter={() => setActivePoint(index)} onMouseLeave={() => setActivePoint(null)}
              onFocus={() => setActivePoint(index)} onBlur={() => setActivePoint(null)}
              onClick={() => setActivePoint((current) => current === index ? null : index)} />
          </g>)}
        </svg>
        {active && activeCoordinate && <output className="tracker-chart-tooltip" style={{ left: `${(activeCoordinate.x / width) * 100}%`, top: `${(activeCoordinate.y / height) * 100}%` }}>
          <strong>{formatValue(active.value)}{unit ? ` ${unit}` : ""}</strong>
          <time dateTime={active.occurredAtUtc}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(active.time)}</time>
        </output>}
        <span className="tracker-chart-minimum">{formatValue(minimum)}</span>
      </div>
      <footer className="tracker-chart-dates"><time dateTime={points[0].occurredAtUtc}>{shortDate(firstTime)}</time><time dateTime={points.at(-1)!.occurredAtUtc}>{shortDate(lastTime)}</time></footer>
    </>}
  </section>;
}

export function JournalTrackerCard({ values, loggedDates = [], currentStreak = 0, longestStreak = 0, ...props }: ObjectCardProps & {
  values?: JournalTrackerValuePoint[];
  loggedDates?: string[];
  currentStreak?: number;
  longestStreak?: number;
}) {
  const details = values === undefined ? props.details : <div className="journal-tracker-details">
    <TrackerValueChart values={values} loggedDates={loggedDates} currentStreak={currentStreak} longestStreak={longestStreak} unit={props.object.attributes?.find(({ label }) => label === "Unit")?.value || ""} trackerName={props.object.display} />
    {props.details}
  </div>;
  return <SimpleObjectCard {...props} details={details} className={`journal-tracker-card${props.className ? ` ${props.className}` : ""}`} />;
}
