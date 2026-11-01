/**
 * test-db-validation.js - Comprehensive Database Query Plan & Latency Audit
 * Executes EXPLAIN / EXPLAIN ANALYZE on critical paths, measures read/write latencies,
 * rows examined, and index selectivity.
 */

const { performance } = require('perf_hooks');
const db = require('./db');

function calcStats(arr) {
  if (arr.length === 0) return { min: 0, p50: 0, p95: 0, avg: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    min: Number(sorted[0].toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    avg: Number(avg.toFixed(2)),
  };
}

async function main() {
  console.log('================================================================');
  console.log('🔍 BUFF LIKE 3.2 — DATABASE VALIDATION & EXPLAIN ANALYZE AUDIT');
  console.log('================================================================');

  const p = db.getPool();
  if (!p) {
    console.error('MySQL pool unavailable');
    process.exit(1);
  }

  // 1. Audit Table Indexes
  console.log('\n--- 1. ACTIVE INDEXES AUDIT ---');
  for (const table of ['buff_logs', 'buff_history', 'buff_queue', 'facebook_page_accesses']) {
    const [rows] = await p.query(`SHOW INDEXES FROM ${table}`);
    const grouped = {};
    rows.forEach((r) => {
      if (!grouped[r.Key_name]) grouped[r.Key_name] = [];
      grouped[r.Key_name].push(r.Column_name);
    });
    console.log(`Table '${table}':`);
    for (const [k, cols] of Object.entries(grouped)) {
      console.log(`  • ${k} (${cols.join(', ')})`);
    }
  }

  // 2. EXPLAIN Query Plans
  console.log('\n--- 2. EXPLAIN EXECUTION PLANS ON CRITICAL PATHS ---');

  const queries = [
    {
      name: 'buff_logs Latest Summary (Limit 50)',
      sql: `EXPLAIN SELECT id, created_at, run_type, target_url, reaction_type, total_pages, success_count, already_liked_count, failed_count, engagement_mode, comment_count, account_name FROM buff_logs ORDER BY created_at DESC, id DESC LIMIT 50`,
    },
    {
      name: 'buff_logs Keyset Cursor Seek',
      sql: `EXPLAIN SELECT id, created_at, run_type, target_url, reaction_type, total_pages, success_count, already_liked_count, failed_count, engagement_mode, comment_count, account_name FROM buff_logs WHERE created_at < NOW() ORDER BY created_at DESC, id DESC LIMIT 50`,
    },
    {
      name: 'buff_history Covering Index Lookup',
      sql: `EXPLAIN SELECT id, status, page_id, created_at FROM buff_history WHERE target_url = 'https://www.facebook.com/reel/sample' AND page_id = '1000234031'`,
    },
    {
      name: 'facebook_page_accesses Active Pages Covering Scan',
      sql: `EXPLAIN SELECT personal_profile_id, active, page_id, page_name FROM facebook_page_accesses WHERE personal_profile_id = '1000234031' AND active = 1`,
    },
  ];

  for (const q of queries) {
    const [rows] = await p.query(q.sql);
    const r = rows[0];
    console.log(`\nQuery: [${q.name}]`);
    console.log(`  Type: ${r.type} | Key: ${r.key || 'NONE'} | Ref: ${r.ref || 'NULL'} | Rows Examined: ${r.rows} | Extra: ${r.Extra || 'None'}`);

    // Try EXPLAIN ANALYZE if supported (MySQL 8.0.18+)
    try {
      const analyzeSql = q.sql.replace(/^EXPLAIN\s+/, 'EXPLAIN ANALYZE ');
      const [analyzeRows] = await p.query(analyzeSql);
      const outputKey = Object.keys(analyzeRows[0])[0];
      const tree = analyzeRows[0][outputKey];
      const firstLine = tree.split('\n')[0];
      console.log(`  EXPLAIN ANALYZE: ${firstLine.trim()}`);
    } catch (_) {}
  }

  // 3. Read Latency Benchmark (50 iterations)
  console.log('\n--- 3. READ LATENCY BENCHMARK (50 Iterations) ---');
  const readTimes = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await p.query(
      `SELECT id, created_at, run_type, target_url, reaction_type, total_pages, success_count, already_liked_count, failed_count, engagement_mode, comment_count, account_name FROM buff_logs ORDER BY created_at DESC, id DESC LIMIT 50`
    );
    readTimes.push(performance.now() - t0);
  }
  const readStats = calcStats(readTimes);
  console.log(`Read Latency (buff_logs 50 rows): P50=${readStats.p50}ms | P95=${readStats.p95}ms | Min=${readStats.min}ms | Avg=${readStats.avg}ms`);

  // 4. Write Latency Benchmark (50 iterations with transaction rollback)
  console.log('\n--- 4. WRITE LATENCY BENCHMARK (50 Inserts - Clean Without Redundant Indexes) ---');
  const writeTimes = [];
  for (let i = 0; i < 50; i++) {
    const testId = `benchmark_write_test_${Date.now()}_${i}`;
    const t0 = performance.now();
    await p.query(
      `INSERT INTO buff_logs (id, user_id, run_type, target_url, reaction_type, created_at) VALUES (?, 1, 'SINGLE', 'https://facebook.com/test', 'LIKE', NOW(3))`,
      [testId]
    );
    writeTimes.push(performance.now() - t0);

    // Clean up immediately
    await p.query(`DELETE FROM buff_logs WHERE id = ?`, [testId]);
  }
  const writeStats = calcStats(writeTimes);
  console.log(`Write Latency (INSERT buff_logs): P50=${writeStats.p50}ms | P95=${writeStats.p95}ms | Min=${writeStats.min}ms | Avg=${writeStats.avg}ms`);

  console.log('\n================================================================');
  console.log('✅ DATABASE QUERY PLAN & LATENCY AUDIT: COMPLETE');
  console.log('================================================================');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
