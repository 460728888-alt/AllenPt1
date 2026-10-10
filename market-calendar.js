import fs from 'node:fs';

// An explicit override that cannot be read must fail closed, not silently fall back.
export function loadMarketCalendar(file = process.env.MARKET_CALENDAR_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file || new URL('./calendars/cn-equities-2024-2026.json', import.meta.url), 'utf8'));
  } catch { return null; }
}

export function buildMarketCalendar(definition) {
  const {validFrom, validThrough, years, weekendClosed} = definition;
  if (!Array.isArray(years) || !years.length || JSON.stringify(weekendClosed) !== '[0,6]') throw Error('Invalid calendar definition');
  const closures = years.flatMap(y => y.closures);
  const sessions = [];
  for (let time = Date.parse(validFrom); time <= Date.parse(validThrough); time += 86400000) {
    const date = new Date(time).toISOString().slice(0,10);
    if (!years.some(y => y.year === Number(date.slice(0,4)) && y.sources.length === 2)) throw Error('Missing exchange sources');
    if (!weekendClosed.includes(new Date(time).getUTCDay()) && !closures.some(([from,to]) => date >= from && date <= to)) sessions.push(date);
  }
  if (!sessions.length) throw Error('Empty exchange calendar');
  return {...definition, sessions};
}
