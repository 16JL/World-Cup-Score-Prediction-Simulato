/**
 * 2026世界杯比分更新脚本
 * 从联网数据源获取真实比分并批量更新数据库
 * 运行: node update-scores.js
 */

const { query, saveDB } = require('./database');

// ===== 映射表：Bing名称 → 系统名称 =====
const NAME_MAP = {
  '波斯尼亚': '波黑',
  '库拉索岛': '库拉索',
};

// ===== 真实比分数据（来源: Bing Sports / 2026-06-16） =====
const REAL_SCORES = [
  // 6月12日
  { home: '墨西哥', away: '南非', homeScore: 2, awayScore: 0 },
  { home: '韩国', away: '捷克', homeScore: 2, awayScore: 1 },
  // 6月13日
  { home: '加拿大', away: '波黑', homeScore: 1, awayScore: 1 },
  { home: '美国', away: '巴拉圭', homeScore: 4, awayScore: 1 },
  // 6月14日
  { home: '卡塔尔', away: '瑞士', homeScore: 1, awayScore: 1 },
  { home: '巴西', away: '摩洛哥', homeScore: 1, awayScore: 1 },
  { home: '海地', away: '苏格兰', homeScore: 0, awayScore: 1 },
  { home: '澳大利亚', away: '土耳其', homeScore: 2, awayScore: 0 },
  // 6月15日
  { home: '德国', away: '库拉索', homeScore: 7, awayScore: 1 },
  { home: '荷兰', away: '日本', homeScore: 2, awayScore: 2 },
  { home: '科特迪瓦', away: '厄瓜多尔', homeScore: 1, awayScore: 0 },
  { home: '瑞典', away: '突尼斯', homeScore: 5, awayScore: 1 },
  // 6月16日
  { home: '西班牙', away: '佛得角', homeScore: 0, awayScore: 0 },
  { home: '比利时', away: '埃及', homeScore: 1, awayScore: 1 },
  { home: '沙特阿拉伯', away: '乌拉圭', homeScore: 1, awayScore: 1 },
];

// ===== 报告统计 =====
const report = {
  total: REAL_SCORES.length,
  updated: [],
  skipped: [],
  failed: [],
  noChange: [],
};

function normalizeTeam(name) {
  return NAME_MAP[name] || name;
}

function findMatch(home, away) {
  const homeNorm = normalizeTeam(home);
  const awayNorm = normalizeTeam(away);

  // 精确匹配
  let match = query.all('matches').find(m =>
    m.home_team === homeNorm && m.away_team === awayNorm
  );
  if (match) return match;

  // 反向匹配（可能主客队颠倒）
  match = query.all('matches').find(m =>
    m.home_team === awayNorm && m.away_team === homeNorm
  );
  return match || null;
}

function updateScores() {
  console.log('📊 开始更新2026世界杯真实比分...');
  console.log('');

  for (const entry of REAL_SCORES) {
    const match = findMatch(entry.home, entry.away);

    if (!match) {
      report.failed.push({
        match: `${entry.home} vs ${entry.away}`,
        reason: '未在数据库中找到对应比赛'
      });
      console.log(`  ❌ ${entry.home} vs ${entry.away} - 未找到`);
      continue;
    }

    // 检查比分是否已有变化
    if (match.home_score === entry.homeScore && match.away_score === entry.awayScore && match.status === 'finished') {
      report.noChange.push({
        match: `${match.home_team} ${match.home_score}:${match.away_score} ${match.away_team}`,
        reason: '比分已是最新'
      });
      continue;
    }

    // 比分数据为空 → 比赛可能还在进行，跳过不更新为finished
    if (entry.homeScore == null || entry.awayScore == null) {
      // 确保比赛状态正确：已到时间就应该是live
      const matchTime = new Date(match.match_time);
      const now = new Date();
      if (now >= matchTime && match.status !== 'finished' && match.status !== 'live') {
        query.update('matches', match.id, { status: 'live' });
        console.log(`  🔴 ${match.home_team} vs ${match.away_team} → 标记为进行中`);
      }
      report.skipped.push({
        match: `${match.home_team} vs ${match.away_team}`,
        reason: '比分数据为空，比赛可能仍在进行'
      });
      continue;
    }

    // 更新比分和状态
    try {
      query.update('matches', match.id, {
        home_score: entry.homeScore,
        away_score: entry.awayScore,
        status: 'finished',
      });

      report.updated.push({
        id: match.id,
        match: `${match.home_team} vs ${match.away_team}`,
        oldScore: `${match.home_score}:${match.away_score}`,
        newScore: `${entry.homeScore}:${entry.awayScore}`,
      });

      console.log(`  ✅ #${match.id} ${match.home_team} ${entry.homeScore}:${entry.awayScore} ${match.away_team}`);
    } catch (err) {
      report.failed.push({
        match: `${match.home_team} vs ${match.away_team}`,
        reason: err.message,
      });
      console.log(`  ❌ ${match.home_team} vs ${match.away_team} - ${err.message}`);
    }
  }

  saveDB();

  // ===== 输出报告 =====
  console.log('');
  console.log('═══════════════════════════════════');
  console.log('         📋 比分更新报告');
  console.log('═══════════════════════════════════');
  console.log(`  总计:        ${report.total} 场`);
  console.log(`  更新成功:    ${report.updated.length} 场`);
  console.log(`  无需更新:    ${report.noChange.length} 场`);
  console.log(`  跳过:        ${report.skipped.length} 场`);
  console.log(`  失败:        ${report.failed.length} 场`);

  if (report.updated.length > 0) {
    console.log('');
    console.log('  📝 已更新比赛:');
    report.updated.forEach(u => {
      console.log(`     ${u.match}  ${u.oldScore} → ${u.newScore}`);
    });
  }

  if (report.failed.length > 0) {
    console.log('');
    console.log('  ⚠️ 失败详情:');
    report.failed.forEach(f => {
      console.log(`     ${f.match}: ${f.reason}`);
    });
  }

  console.log('');
  console.log('🔄 请重启服务器使比分生效');
}

updateScores();
