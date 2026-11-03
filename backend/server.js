const express = require('express');
const cors = require('cors');
const path = require('path');
const { seedWorldCupData } = require('./database');
const authRouter = require('./routes/auth').router;
const matchesRouter = require('./routes/matches');
const bettingRouter = require('./routes/betting');
const accountRouter = require('./routes/account');
const adminModule = require('./routes/admin');
const syncService = require('./sync-service');

const app = express();
const PORT = process.env.PORT || 6789;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件 - 普通用户前端
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 庄家管理后台 - 独立路由
app.get('/admin/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'admin', 'login.html'));
});
app.get('/admin', (req, res) => {
  res.redirect('/admin/login.html');
});
app.get('/admin/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'admin', 'index.html'));
});

// API路由
app.use('/api/auth', authRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/betting', bettingRouter);
app.use('/api/account', accountRouter);
app.use('/api/admin', adminModule.router);

// SPA fallback（排除admin路径）
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  }
});

// 初始化数据
console.log('🌍 初始化世界杯数据...');
seedWorldCupData();
console.log('🏦 初始化庄家账号...');
adminModule.seedAdminAccounts();

// 启动赔率同步调度器
console.log('🔄 启动赔率同步调度系统...');
syncService.startScheduler();

// 启动邮件服务连接测试
const emailService = require('./email-service');
console.log('📧 测试邮件服务连接...');
emailService.checkConnection();

// 启动实时比分同步
const liveScoreSync = require('./live-score-sync');
console.log('📡 启动实时比分同步系统...');
liveScoreSync.startScheduler();

// 获取局域网IP
const os = require('os');
const nets = os.networkInterfaces();
let localIP = 'localhost';
for (const name of Object.values(nets)) {
  for (const net of name) {
    if (net.family === 'IPv4' && !net.internal) {
      localIP = net.address;
      break;
    }
  }
  if (localIP !== 'localhost') break;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚽ 世界杯赌球模拟器已启动`);
  console.log(`   用户端: http://localhost:${PORT}`);
  console.log(`   庄家端: http://localhost:${PORT}/admin`);
  console.log(`   局域网: http://${localIP}:${PORT}`);
  console.log(`   ──────────────────────────────`);
  console.log(`   庄家账号: admin / admin888`);
  console.log(`   二次验证码: 888888`);
  console.log(`   ──────────────────────────────`);
  console.log(`   赔率同步: 已启动 (每1小时自动同步)`);
  console.log(`   同步模式: ${syncService.getSyncMode() === 'auto' ? '自动同步(体彩平台)' : '手动固定'}`);
});
