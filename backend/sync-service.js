// ===== 赔率同步调度系统 =====
// 模拟体彩平台数据源 + 定时调度 + 双模式管理
const { query, saveDB } = require('./database');

// ===== 同步模式 =====
// 'auto': 每小时自动从体彩平台同步赔率
// 'manual': 管理员手动设定，不自动更新
let syncMode = 'auto';
let syncStatus = {
  lastSync: null,        // 上次同步时间
  nextSync: null,        // 下次同步时间
  syncCount: 0,          // 已同步次数
  isRunning: false,      // 是否正在同步
  lastError: null,       // 最后错误
  mode: 'auto',          // 当前模式
  sourceVersion: '1.0',  // 数据源版本
};

// 缓存最近的赔率数据
let oddsCache = null;
let cacheTime = null;
const CACHE_TTL = 60 * 1000; // 缓存1分钟

// ===== 模拟体彩平台数据源 =====
// 模拟从体彩平台拉取的最新赔率数据
function fetchFromSportsLottery() {
  const matches = query.all('matches');
  const activeMatches = matches.filter(m => m.status !== 'finished');

  const updatedOdds = [];

  for (const match of activeMatches) {
    // 基于原有赔率做 ±5%~±15% 的波动模拟
    const fluctuate = (base) => {
      const change = (Math.random() - 0.5) * 0.2; // -10% ~ +10%
      return parseFloat(Math.max(1.05, base * (1 + change)).toFixed(2));
    };

    // 让球盘口也可能微调
    const handicapShift = Math.random() > 0.85
      ? parseFloat((match.handicap + (Math.random() > 0.5 ? 0.5 : -0.5)).toFixed(1))
      : match.handicap;

    // 大小球盘口微调
    const ouShift = Math.random() > 0.9
      ? parseFloat((match.over_under_line + (Math.random() > 0.5 ? 0.5 : -0.5)).toFixed(1))
      : match.over_under_line;

    const newOdds = {
      match_id: match.id,
      spf_win: fluctuate(match.spf_win),
      spf_draw: fluctuate(match.spf_draw),
      spf_lose: fluctuate(match.spf_lose),
      handicap: handicapShift,
      rqspf_win: fluctuate(match.rqspf_win),
      rqspf_draw: fluctuate(match.rqspf_draw),
      rqspf_lose: fluctuate(match.rqspf_lose),
      over_under_line: Math.max(1.0, ouShift),
      dxq_over: fluctuate(match.dxq_over),
      dxq_under: fluctuate(match.dxq_under),
    };

    updatedOdds.push(newOdds);
  }

  return {
    version: `v${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    source: '中国体育彩票·竞彩足球',
    count: updatedOdds.length,
    data: updatedOdds
  };
}

// ===== 模拟比赛结果数据源 =====
function fetchMatchResults() {
  const matches = query.all('matches');
  const liveAndUpcoming = matches.filter(m => m.status !== 'finished');
  const results = [];

  for (const match of liveAndUpcoming.slice(0, 5)) {
    results.push({
      match_id: match.id,
      home_team: match.home_team,
      away_team: match.away_team,
      home_flag: match.home_flag,
      away_flag: match.away_flag,
      stage: match.stage,
      status: match.status,
      home_score: match.home_score,
      away_score: match.away_score,
    });
  }

  return {
    version: `r${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    source: 'FIFA Official / 中国体育彩票',
    total: results.length,
    data: results
  };
}

// ===== 执行同步 =====
function performSync() {
  if (syncStatus.isRunning) {
    console.log('[赔率同步] 上一次同步仍在进行中，跳过');
    return { success: false, msg: '同步进行中' };
  }

  syncStatus.isRunning = true;
  console.log(`[赔率同步] 开始同步 (模式: ${syncMode})...`);

  try {
    if (syncMode === 'manual') {
      console.log('[赔率同步] 当前为手动模式，跳过自动同步');
      syncStatus.isRunning = false;
      updateNextSync();
      return { success: true, msg: '手动模式，跳过同步', mode: 'manual' };
    }

    // 从体彩平台拉取数据
    const lotteryData = fetchFromSportsLottery();
    console.log(`[赔率同步] 拉取到 ${lotteryData.count} 场比赛的赔率数据 (${lotteryData.source})`);

    // 更新数据库
    let applied = 0;
    for (const odds of lotteryData.data) {
      const match = query.get('matches', { id: odds.match_id });
      if (!match) continue;

      query.update('matches', odds.match_id, {
        spf_win: odds.spf_win,
        spf_draw: odds.spf_draw,
        spf_lose: odds.spf_lose,
        handicap: odds.handicap,
        rqspf_win: odds.rqspf_win,
        rqspf_draw: odds.rqspf_draw,
        rqspf_lose: odds.rqspf_lose,
        over_under_line: odds.over_under_line,
        dxq_over: odds.dxq_over,
        dxq_under: odds.dxq_under,
      });
      applied++;
    }

    // 更新缓存
    oddsCache = lotteryData;
    cacheTime = Date.now();

    // 更新状态
    syncStatus.lastSync = new Date().toISOString();
    syncStatus.syncCount++;
    syncStatus.lastError = null;
    syncStatus.sourceVersion = lotteryData.version;
    updateNextSync();

    saveDB();

    console.log(`[赔率同步] ✅ 完成! 更新了 ${applied} 场比赛赔率，下次同步: ${syncStatus.nextSync}`);
    syncStatus.isRunning = false;
    return { success: true, msg: `同步完成，更新 ${applied} 场`, mode: 'auto', count: applied };

  } catch (err) {
    console.error(`[赔率同步] ❌ 失败: ${err.message}`);
    syncStatus.lastError = err.message;
    syncStatus.isRunning = false;
    updateNextSync();
    return { success: false, msg: err.message };
  }
}

// 计算下次同步时间
function updateNextSync() {
  const next = new Date();
  next.setHours(next.getHours() + 1);
  next.setMinutes(0);
  next.setSeconds(0);
  next.setMilliseconds(0);
  syncStatus.nextSync = next.toISOString();
  syncStatus.mode = syncMode;
}

// ===== 定时调度器 =====
let schedulerInterval = null;

function startScheduler() {
  updateNextSync();

  // 每小时执行一次
  schedulerInterval = setInterval(() => {
    console.log(`[赔率同步] 定时任务触发 (${new Date().toLocaleTimeString()})`);
    performSync();
  }, 60 * 60 * 1000); // 1小时

  console.log(`[赔率同步] 调度器已启动，每1小时同步一次`);
  console.log(`[赔率同步] 下次同步: ${new Date(syncStatus.nextSync).toLocaleString()}`);
}

function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ===== 缓存服务 =====
function getCachedOdds() {
  if (oddsCache && cacheTime && (Date.now() - cacheTime < CACHE_TTL)) {
    return { ...oddsCache, cached: true };
  }
  // 缓存过期，重新获取（但不更新数据库）
  const fresh = fetchFromSportsLottery();
  oddsCache = fresh;
  cacheTime = Date.now();
  return { ...fresh, cached: false };
}

// ===== 模式管理 =====
function getSyncMode() {
  return syncMode;
}

function setSyncMode(mode) {
  if (mode !== 'auto' && mode !== 'manual') {
    return { success: false, msg: '无效模式，仅支持 auto/manual' };
  }
  const oldMode = syncMode;
  syncMode = mode;
  syncStatus.mode = mode;

  console.log(`[赔率同步] 模式切换: ${oldMode} → ${mode}`);
  return { success: true, msg: `模式已切换为: ${mode}`, oldMode, newMode: mode };
}

function getSyncStatus() {
  return {
    ...syncStatus,
    nextSyncFormatted: syncStatus.nextSync
      ? new Date(syncStatus.nextSync).toLocaleString('zh-CN')
      : '未设置',
    lastSyncFormatted: syncStatus.lastSync
      ? new Date(syncStatus.lastSync).toLocaleString('zh-CN')
      : '从未同步',
    cacheAge: cacheTime ? Math.floor((Date.now() - cacheTime) / 1000) + '秒' : '无缓存',
  };
}

// ===== 手动设置赔率 =====
function setManualOdds(matchId, oddsData) {
  if (syncMode !== 'manual') {
    return { success: false, msg: '请先切换到手动模式' };
  }

  const match = query.get('matches', { id: matchId });
  if (!match) return { success: false, msg: '比赛不存在' };

  const allowed = ['spf_win', 'spf_draw', 'spf_lose', 'handicap',
                   'rqspf_win', 'rqspf_draw', 'rqspf_lose',
                   'over_under_line', 'dxq_over', 'dxq_under'];

  const updates = {};
  for (const key of allowed) {
    if (oddsData[key] !== undefined) {
      updates[key] = parseFloat(oddsData[key]);
    }
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, msg: '未提供有效赔率数据' };
  }

  query.update('matches', matchId, updates);
  return { success: true, msg: '赔率手动设置成功' };
}

// ===== 获取比赛结果 =====
function getMatchResults() {
  const results = fetchMatchResults();
  return results;
}

module.exports = {
  startScheduler,
  stopScheduler,
  performSync,
  getSyncMode,
  setSyncMode,
  getSyncStatus,
  setManualOdds,
  getCachedOdds,
  getMatchResults,
};
