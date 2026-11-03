const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'worldcup_data.json');

// JSON数据库
let db = {
  users: [],
  matches: [],
  bets: [],
  transactions: [],
  _nextIds: { users: 1, matches: 1, bets: 1, transactions: 1 }
};

// 加载数据库
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      db = JSON.parse(raw);
    }
  } catch (err) {
    console.log('数据库文件损坏，使用新数据库');
  }
}

// 保存数据库
function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

// 初始化，加载数据
loadDB();

// 查询helper
const query = {
  get: (table, where) => {
    const items = db[table];
    if (!where) return items[0] || null;
    for (const item of items) {
      let match = true;
      for (const [key, val] of Object.entries(where)) {
        if (item[key] !== val) { match = false; break; }
      }
      if (match) return item;
    }
    return null;
  },

  all: (table, where) => {
    if (!where) return [...db[table]];
    return db[table].filter(item => {
      for (const [key, val] of Object.entries(where)) {
        if (item[key] !== val) return false;
      }
      return true;
    });
  },

  insert: (table, data) => {
    const id = db._nextIds[table];
    db._nextIds[table]++;
    const record = { id, ...data };
    db[table].push(record);
    saveDB();
    return { id, record };
  },

  update: (table, id, data) => {
    const idx = db[table].findIndex(item => item.id === id);
    if (idx === -1) return false;
    Object.assign(db[table][idx], data);
    saveDB();
    return true;
  },

  remove: (table, id) => {
    const idx = db[table].findIndex(item => item.id === id);
    if (idx === -1) return false;
    db[table].splice(idx, 1);
    saveDB();
    return true;
  },

  count: (table, where) => {
    if (!where) return db[table].length;
    return db[table].filter(item => {
      for (const [key, val] of Object.entries(where)) {
        if (item[key] !== val) return false;
      }
      return true;
    }).length;
  }
};

// 种子数据
function seedWorldCupData() {
  if (db.matches.length > 0) return;

  const teams = {
    '卡塔尔': '🇶🇦', '厄瓜多尔': '🇪🇨', '塞内加尔': '🇸🇳', '荷兰': '🇳🇱',
    '英格兰': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '伊朗': '🇮🇷', '美国': '🇺🇸', '威尔士': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    '阿根廷': '🇦🇷', '沙特阿拉伯': '🇸🇦', '墨西哥': '🇲🇽', '波兰': '🇵🇱',
    '法国': '🇫🇷', '澳大利亚': '🇦🇺', '丹麦': '🇩🇰', '突尼斯': '🇹🇳',
    '西班牙': '🇪🇸', '哥斯达黎加': '🇨🇷', '德国': '🇩🇪', '日本': '🇯🇵',
    '比利时': '🇧🇪', '加拿大': '🇨🇦', '摩洛哥': '🇲🇦', '克罗地亚': '🇭🇷',
    '巴西': '🇧🇷', '塞尔维亚': '🇷🇸', '瑞士': '🇨🇭', '喀麦隆': '🇨🇲',
    '葡萄牙': '🇵🇹', '加纳': '🇬🇭', '乌拉圭': '🇺🇾', '韩国': '🇰🇷'
  };

  const groups = {
    'A': [
      ['卡塔尔', '厄瓜多尔', '2026-06-16 00:00:00'],
      ['塞内加尔', '荷兰', '2026-06-16 03:00:00'],
      ['卡塔尔', '塞内加尔', '2026-06-20 21:00:00'],
      ['荷兰', '厄瓜多尔', '2026-06-21 00:00:00'],
      ['荷兰', '卡塔尔', '2026-06-25 23:00:00'],
      ['厄瓜多尔', '塞内加尔', '2026-06-25 23:00:00'],
    ],
    'B': [
      ['英格兰', '伊朗', '2026-06-16 21:00:00'],
      ['美国', '威尔士', '2026-06-17 00:00:00'],
      ['威尔士', '伊朗', '2026-06-20 18:00:00'],
      ['英格兰', '美国', '2026-06-21 03:00:00'],
      ['威尔士', '英格兰', '2026-06-26 03:00:00'],
      ['伊朗', '美国', '2026-06-26 03:00:00'],
    ],
    'C': [
      ['阿根廷', '沙特阿拉伯', '2026-06-17 18:00:00'],
      ['墨西哥', '波兰', '2026-06-17 21:00:00'],
      ['波兰', '沙特阿拉伯', '2026-06-22 00:00:00'],
      ['阿根廷', '墨西哥', '2026-06-22 03:00:00'],
      ['波兰', '阿根廷', '2026-06-27 03:00:00'],
      ['沙特阿拉伯', '墨西哥', '2026-06-27 03:00:00'],
    ],
    'D': [
      ['法国', '澳大利亚', '2026-06-18 00:00:00'],
      ['丹麦', '突尼斯', '2026-06-18 03:00:00'],
      ['突尼斯', '澳大利亚', '2026-06-22 18:00:00'],
      ['法国', '丹麦', '2026-06-22 21:00:00'],
      ['突尼斯', '法国', '2026-06-28 03:00:00'],
      ['澳大利亚', '丹麦', '2026-06-28 03:00:00'],
    ],
    'E': [
      ['西班牙', '哥斯达黎加', '2026-06-18 18:00:00'],
      ['德国', '日本', '2026-06-18 21:00:00'],
      ['日本', '哥斯达黎加', '2026-06-23 18:00:00'],
      ['西班牙', '德国', '2026-06-23 21:00:00'],
      ['日本', '西班牙', '2026-06-28 03:00:00'],
      ['哥斯达黎加', '德国', '2026-06-28 03:00:00'],
    ],
    'F': [
      ['比利时', '加拿大', '2026-06-19 00:00:00'],
      ['摩洛哥', '克罗地亚', '2026-06-19 03:00:00'],
      ['比利时', '摩洛哥', '2026-06-23 21:00:00'],
      ['克罗地亚', '加拿大', '2026-06-24 00:00:00'],
      ['克罗地亚', '比利时', '2026-06-29 03:00:00'],
      ['加拿大', '摩洛哥', '2026-06-29 03:00:00'],
    ],
    'G': [
      ['巴西', '塞尔维亚', '2026-06-19 21:00:00'],
      ['瑞士', '喀麦隆', '2026-06-20 00:00:00'],
      ['喀麦隆', '塞尔维亚', '2026-06-24 18:00:00'],
      ['巴西', '瑞士', '2026-06-24 21:00:00'],
      ['喀麦隆', '巴西', '2026-06-29 03:00:00'],
      ['塞尔维亚', '瑞士', '2026-06-29 03:00:00'],
    ],
    'H': [
      ['葡萄牙', '加纳', '2026-06-20 18:00:00'],
      ['乌拉圭', '韩国', '2026-06-20 21:00:00'],
      ['韩国', '加纳', '2026-06-25 21:00:00'],
      ['葡萄牙', '乌拉圭', '2026-06-26 00:00:00'],
      ['韩国', '葡萄牙', '2026-06-30 03:00:00'],
      ['加纳', '乌拉圭', '2026-06-30 03:00:00'],
    ]
  };

  const knockoutMatches = [
    ['淘汰赛', '2026-07-04 23:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-05 03:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-05 23:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-06 03:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-06 23:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-07 03:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-07 23:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-08 03:00:00', '1/8决赛'],
    ['淘汰赛', '2026-07-09 23:00:00', '1/4决赛'],
    ['淘汰赛', '2026-07-10 03:00:00', '1/4决赛'],
    ['淘汰赛', '2026-07-10 23:00:00', '1/4决赛'],
    ['淘汰赛', '2026-07-11 03:00:00', '1/4决赛'],
    ['淘汰赛', '2026-07-14 03:00:00', '半决赛'],
    ['淘汰赛', '2026-07-15 03:00:00', '半决赛'],
    ['淘汰赛', '2026-07-18 03:00:00', '季军赛'],
    ['淘汰赛', '2026-07-19 03:00:00', '决赛'],
  ];

  const generateOdds = (home, away) => {
    const homeStrength = Math.random() * 3 + 1;
    const awayStrength = Math.random() * 3 + 1;
    const total = homeStrength + awayStrength;

    const spfWin = parseFloat((total / homeStrength * (0.8 + Math.random() * 0.4)).toFixed(2));
    const spfDraw = parseFloat((3 + Math.random() * 2).toFixed(2));
    const spfLose = parseFloat((total / awayStrength * (0.8 + Math.random() * 0.4)).toFixed(2));

    const handicap = Math.random() > 0.5
      ? (Math.floor(Math.random() * 3) + 0.5) * (Math.random() > 0.5 ? 1 : -1)
      : (Math.floor(Math.random() * 2) + 0.5) * (Math.random() > 0.5 ? 1 : -1);

    const rqWin = parseFloat((2 + Math.random() * 2).toFixed(2));
    const rqDraw = parseFloat((3 + Math.random() * 1.5).toFixed(2));
    const rqLose = parseFloat((2 + Math.random() * 2).toFixed(2));

    const ouLine = parseFloat([1.5, 2.0, 2.5, 2.5, 2.5, 3.0, 3.5][Math.floor(Math.random() * 7)].toFixed(1));
    const dxqOver = parseFloat((1.8 + Math.random() * 1.2).toFixed(2));
    const dxqUnder = parseFloat((1.8 + Math.random() * 1.2).toFixed(2));

    return { spfWin, spfDraw, spfLose, handicap, rqWin, rqDraw, rqLose, ouLine, dxqOver, dxqUnder };
  };

  // 小组赛
  for (const [group, fixtures] of Object.entries(groups)) {
    for (const [home, away, time] of fixtures) {
      const odds = generateOdds(home, away);
      query.insert('matches', {
        home_team: home,
        away_team: away,
        home_flag: teams[home],
        away_flag: teams[away],
        match_time: time,
        stage: '小组赛',
        group_name: group,
        status: 'upcoming',
        home_score: null,
        away_score: null,
        spf_win: odds.spfWin,
        spf_draw: odds.spfDraw,
        spf_lose: odds.spfLose,
        handicap: odds.handicap,
        rqspf_win: odds.rqWin,
        rqspf_draw: odds.rqDraw,
        rqspf_lose: odds.rqLose,
        over_under_line: odds.ouLine,
        dxq_over: odds.dxqOver,
        dxq_under: odds.dxqUnder
      });
    }
  }

  // 淘汰赛
  for (const [stage, time, round] of knockoutMatches) {
    const odds = generateOdds('待定', '待定');
    query.insert('matches', {
      home_team: '待定',
      away_team: '待定',
      home_flag: '❓',
      away_flag: '❓',
      match_time: time,
      stage: round,
      group_name: null,
      status: 'upcoming',
      home_score: null,
      away_score: null,
      spf_win: odds.spfWin,
      spf_draw: odds.spfDraw,
      spf_lose: odds.spfLose,
      handicap: odds.handicap,
      rqspf_win: odds.rqWin,
      rqspf_draw: odds.rqDraw,
      rqspf_lose: odds.rqLose,
      over_under_line: odds.ouLine,
      dxq_over: odds.dxqOver,
      dxq_under: odds.dxqUnder
    });
  }

  // 预设前12场比赛为已结束，接下来6场为进行中
  const groupMatches = query.all('matches', { stage: '小组赛' });
  for (let i = 0; i < Math.min(12, groupMatches.length); i++) {
    const m = groupMatches[i];
    m.status = 'finished';
    m.home_score = Math.floor(Math.random() * 4);
    m.away_score = Math.floor(Math.random() * 3);
  }
  for (let i = 12; i < Math.min(18, groupMatches.length); i++) {
    const m = groupMatches[i];
    m.status = 'live';
    m.home_score = Math.floor(Math.random() * 2);
    m.away_score = Math.floor(Math.random() * 2);
  }

  saveDB();
  console.log('✅ 世界杯赛程数据已初始化');
}

module.exports = { db, query, saveDB, seedWorldCupData };
