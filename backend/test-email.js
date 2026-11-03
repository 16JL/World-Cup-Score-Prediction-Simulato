/**
 * ===== 163邮箱 SMTP 测试 & 并发验证码脚本 =====
 *
 * 系统邮箱: football_system@163.com
 *
 * 使用前请先获取163邮箱的SMTP授权码:
 *   1. 浏览器打开 https://mail.163.com
 *   2. 登录 football_system@163.com
 *   3. 点击「设置」→「POP3/SMTP/IMAP」
 *   4. 开启「SMTP服务」
 *   5. 点击「新增授权码」→ 手机验证 → 复制生成的16位授权码
 *   6. 将授权码粘贴到下方 AUTH_CODE 变量
 *
 * 运行: node test-email.js
 */

const nodemailer = require('nodemailer');
const readline = require('readline');

// ⚠️ 在这里粘贴163邮箱的SMTP授权码（非登录密码）
const AUTH_CODE = '';

const SMTP_HOST = 'smtp.163.com';
const SMTP_PORT = 465;
const FROM_EMAIL = 'football_system@163.com';
const FROM_NAME = '世界杯竞彩';

// ===== 交互式输入 =====
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

// ===== 生成验证码 =====
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===== 构建HTML邮件 =====
function buildEmail(code) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f0eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:30px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        <tr><td style="background:linear-gradient(135deg,#B71C1C,#D4212B);padding:28px 24px;text-align:center;border-radius:12px 12px 0 0;">
          <h1 style="color:#fff;margin:0;font-size:22px;">⚽ 世界杯竞彩</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;">邮箱验证码</p>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <p style="color:#555;font-size:15px;margin:0 0 20px;">您好，您的验证码如下：</p>
          <table width="100%"><tr><td style="background:#FFF5F5;border:2px dashed #D4212B;border-radius:10px;padding:20px;text-align:center;">
            <span style="font-size:36px;font-weight:900;color:#D4212B;letter-spacing:10px;font-family:monospace;">${code}</span>
          </td></tr></table>
          <p style="color:#aaa;font-size:12px;margin-top:16px;">⏱ 5分钟有效 | 🔒 请勿泄露</p>
        </td></tr>
        <tr><td style="background:#fafafa;padding:12px 28px;text-align:center;border-radius:0 0 12px 12px;border-top:1px solid #eee;">
          <span style="color:#ccc;font-size:11px;">世界杯竞彩系统 · 自动发送</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   📧 163邮箱 SMTP 验证码发送工具   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  let authCode = AUTH_CODE;

  if (!authCode) {
    console.log('⚠️  未设置授权码！');
    console.log('');
    console.log('📋 获取授权码步骤:');
    console.log('   1. 打开 https://mail.163.com');
    console.log('   2. 登录 football_system@163.com');
    console.log('   3. 设置 → POP3/SMTP/IMAP');
    console.log('   4. 开启 SMTP 服务 → 新增授权码');
    console.log('');
    authCode = await ask('📝 请输入163邮箱SMTP授权码: ');
  }

  console.log('');
  console.log('🔗 正在连接 smtp.163.com:465 ...');

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: FROM_EMAIL,
      pass: authCode.trim()
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  // 测试连接
  try {
    await transporter.verify();
    console.log('✅ SMTP 连接成功！');
  } catch (err) {
    console.log(`❌ SMTP 连接失败: ${err.message}`);
    console.log('');
    console.log('可能的原因:');
    console.log('   - 授权码错误（注意：是授权码，不是登录密码）');
    console.log('   - 未开启 SMTP 服务');
    console.log('   - 网络防火墙阻止了 465 端口');
    rl.close();
    return;
  }

  // 发送测试邮件
  const targetEmail = await ask('📧 请输入目标邮箱地址: ');
  if (!targetEmail || !targetEmail.includes('@')) {
    console.log('❌ 邮箱地址无效');
    rl.close();
    return;
  }

  const code = generateCode();
  console.log('');
  console.log(`📤 正在发送验证码到 ${targetEmail} ...`);

  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: targetEmail,
      subject: `【世界杯竞彩】验证码 ${code}`,
      html: buildEmail(code),
      text: `您的验证码: ${code}，5分钟有效。`,
    });

    console.log('✅ 邮件发送成功！');
    console.log(`   MessageID: ${info.messageId}`);
    console.log(`   验证码: ${code}`);
    console.log('');
    console.log('💡 提示: 将此授权码写入 email-service.js 的 pass 字段即可');
    console.log(`   当前授权码: ${authCode.trim()}`);
  } catch (err) {
    console.log(`❌ 发送失败: ${err.message}`);
  }

  rl.close();
}

main();
