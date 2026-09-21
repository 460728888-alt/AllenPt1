const terminalStatuses = new Set(['已到期','逻辑失效','完成复盘']);

function chinaDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) ? new Date(time + days * 86400_000).toISOString().slice(0, 10) : null;
}

function positiveEventDates(idea, today, windowEnd) {
  return (idea?.evidence || []).flatMap(evidence => {
    if (evidence.negative || !evidence.bodyRead) return [];
    return (evidence.eventDates || []).map(item => item.date);
  }).filter(date => /^20\d{2}-\d{2}-\d{2}$/.test(date) && date >= today && date <= windowEnd).sort();
}

export function retentionFor(idea, window, now = new Date()) {
  const today = chinaDate(now);
  const dates = positiveEventDates(idea, today, window.end);
  const eventDate = dates.at(-1) || null;
  return {
    eventDate,
    validUntil: eventDate ? addDays(eventDate, 5) : window.end,
    reason: eventDate
      ? `已确认计划日期${eventDate}，至少跟踪至事件后5天`
      : `尚无可靠计划日期，保留至原研究窗口${window.end}`
  };
}

function hasNewAdverseEvidence(idea, firstSeenAt) {
  const firstSeen = Date.parse(firstSeenAt || '');
  return (idea?.evidence || []).some(evidence => evidence.negative &&
    (!Number.isFinite(firstSeen) || Date.parse(evidence.publishedAt || '') >= firstSeen));
}

export function mergeOpportunityLifecycle(previous = [], report, now = new Date()) {
  const today = chinaDate(now);
  const nowIso = now.toISOString();
  const priorBySymbol = new Map(previous.map(item => [item.symbol, item]));
  const refreshed = new Set();
  const entries = [];
  let nextPosition = previous.reduce((max, item) => Math.max(max, Number(item.position) || 0), 0) + 1;

  for (const idea of report.candidates || []) {
    const storedPrior = priorBySymbol.get(idea.symbol);
    // 已结束的旧逻辑若日后因新证据再次入选，应当作为一条新机会重新计时。
    const prior = storedPrior && !terminalStatuses.has(storedPrior.status) ? storedPrior : null;
    const retention = retentionFor(idea, report.window, now);
    const status = hasNewAdverseEvidence(idea, prior?.firstSeenAt) ? '需要复核' : (prior?.status || '跟踪中');
    // 已锁定事件日期后，保留期固定为“事件+5天”；不能因后来滚动到新窗口而被无限续期。
    const priorEventUntil = prior?.eventDate ? addDays(prior.eventDate, 5) : null;
    const currentUntil = retention.eventDate ? retention.validUntil : (priorEventUntil || retention.validUntil);
    const validUntil = prior?.validUntil && prior.validUntil > currentUntil ? prior.validUntil : currentUntil;
    entries.push({
      symbol: idea.symbol,
      status: terminalStatuses.has(status) ? '跟踪中' : status,
      position: prior?.position || nextPosition++,
      firstSeenAt: prior?.firstSeenAt || nowIso,
      lastSeenAt: nowIso,
      validUntil,
      eventDate: retention.eventDate || prior?.eventDate || null,
      sourceReportId: report.id || prior?.sourceReportId || null,
      seenCount: Number(prior?.seenCount || 0) + 1,
      missingScans: 0,
      lifecycleStage: prior ? '持续跟踪' : '本次新发现',
      lifecycleReason: status === '需要复核' ? '出现新的反面公告，需要重新核验，但不会静默删除' : retention.reason,
      idea
    });
    refreshed.add(idea.symbol);
  }

  for (const prior of previous) {
    if (refreshed.has(prior.symbol) || terminalStatuses.has(prior.status)) continue;
    if (!prior.validUntil || prior.validUntil < today) {
      entries.push({...prior, status:'已到期', lifecycleStage:'已到期', lifecycleReason:`原跟踪期限${prior.validUntil || '未知'}已经结束`});
      continue;
    }
    entries.push({...prior,
      lifecycleStage:'持续跟踪',
      lifecycleReason:'本次没有进入新榜前列，但原事件尚未到期，继续保留',
      missingScans:Number(prior.missingScans || 0) + 1
    });
  }

  const active = entries.filter(item => !terminalStatuses.has(item.status)).sort((a,b) => a.position - b.position);
  const decorate = entry => ({...entry.idea,lifecycle:{
    stage:entry.lifecycleStage,status:entry.status,firstSeenAt:entry.firstSeenAt,lastSeenAt:entry.lastSeenAt,
    validUntil:entry.validUntil,eventDate:entry.eventDate,seenCount:entry.seenCount,missingScans:entry.missingScans,
    reason:entry.lifecycleReason
  }});
  return {
    entries,
    candidates:active.map(decorate),
    newCandidates:active.filter(item => item.lifecycleStage === '本次新发现').map(decorate),
    continuingCandidates:active.filter(item => item.lifecycleStage === '持续跟踪').map(decorate),
    expired:entries.filter(item => item.status === '已到期').map(item => item.symbol)
  };
}
