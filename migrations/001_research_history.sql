-- 仅供隔离测试。网站启动时不得自动执行。
BEGIN;

CREATE TABLE research_opportunities (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  symbol TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('volume','radar')),
  strategy_version TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  source_scan_id TEXT NOT NULL,
  data_through DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE(user_id,id),
  UNIQUE(user_id,id,symbol,channel,strategy_version)
);

CREATE TABLE research_events (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  research_id TEXT NOT NULL,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('created','refreshed','invalidated','data_gap','note')
  ),
  data_through DATE NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  UNIQUE(user_id,request_key),
  FOREIGN KEY(user_id,research_id)
    REFERENCES research_opportunities(user_id,id)
);

CREATE INDEX research_events_latest_idx
  ON research_events(user_id,research_id,sequence DESC);

CREATE TABLE research_episode_heads (
  user_id BIGINT NOT NULL,
  symbol TEXT NOT NULL,
  channel TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  research_id TEXT NOT NULL,
  PRIMARY KEY(user_id,symbol,channel,strategy_version),
  FOREIGN KEY(user_id,research_id,symbol,channel,strategy_version)
    REFERENCES research_opportunities(
      user_id,id,symbol,channel,strategy_version
    )
);

CREATE FUNCTION reject_research_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Original research and events are append-only'
    USING ERRCODE='55000';
END;
$$;

CREATE TRIGGER research_original_no_rewrite
BEFORE UPDATE OR DELETE ON research_opportunities
FOR EACH ROW EXECUTE FUNCTION reject_research_history_mutation();

CREATE TRIGGER research_original_no_truncate
BEFORE TRUNCATE ON research_opportunities
FOR EACH STATEMENT EXECUTE FUNCTION reject_research_history_mutation();

CREATE TRIGGER research_events_no_rewrite
BEFORE UPDATE OR DELETE ON research_events
FOR EACH ROW EXECUTE FUNCTION reject_research_history_mutation();

CREATE TRIGGER research_events_no_truncate
BEFORE TRUNCATE ON research_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_research_history_mutation();

COMMIT;
