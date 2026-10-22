import fs from 'node:fs';

// 显式指定的文件无法读取时返回 null，不偷偷换用默认日历。
export function loadMarketCalendar(
  file = process.env.MARKET_CALENDAR_FILE
) {
  try {
    if (file) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }

    const definition = JSON.parse(fs.readFileSync(
      new URL(
        './calendars/cn-equities-holidays.json',
        import.meta.url
      ),
      'utf8'
    ));

    return buildMarketCalendar(definition);
  } catch {
    return null;
  }
}

export function buildMarketCalendar(definition) {
  const {
    validFrom, validThrough, years, weekendClosed
  } = definition;

  if (
    !Array.isArray(years) ||
    !years.length ||
    JSON.stringify(weekendClosed) !== '[0,6]'
  ) {
    throw Error('Invalid calendar definition');
  }

  const closures = years.flatMap(year => year.closures);
  const sessions = [];

  for (
    let time = Date.parse(validFrom);
    time <= Date.parse(validThrough);
    time += 86400000
  ) {
    const date = new Date(time).toISOString().slice(0, 10);

    if (!years.some(year =>
      year.year === Number(date.slice(0, 4)) &&
      year.sources.length === 2
    )) {
      throw Error('Missing exchange sources');
    }

    const weekend = weekendClosed.includes(
      new Date(time).getUTCDay()
    );
    const closed = closures.some(
      ([from, to]) => date >= from && date <= to
    );

    if (!weekend && !closed) sessions.push(date);
  }

  if (!sessions.length) {
    throw Error('Empty exchange calendar');
  }

  return {...definition, sessions};
}
