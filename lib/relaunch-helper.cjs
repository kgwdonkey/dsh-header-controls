/**
 * relaunch-helper.cjs — 重启助手（纯 Node，零 PowerShell）
 * 流程：可选延迟（argv[2] 秒，默认 6）→ 若端口仍占用则 taskkill 兜底 →
 * 重新拉起 dsh web（隐藏窗口、日志落盘、写 pid 文件）→ 轮询端口就绪 → 打开浏览器。
 * 配置来源：%LOCALAPPDATA%\DeepSeekHarness\launcher.config.json
 *   node=node 可执行文件；bin=dsh CLI 入口（npm 全局包 lib/bin.js，2026-09-07 起主用渠道）；
 *   repo=可选 dsh dev 仓库（无 bin 字段时派生 repo\apps\cli\lib\bin.js，E:\dsh rc.8 备用）；profile/port/host。
 * 缺失时回退：node=process.execPath、bin=env DSH_REPO 派生、profile=web、port=3080、host=127.0.0.1。
 */
'use strict'
const { spawn, execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')

const delaySec = Number(process.argv[2]) || 6
const launcherDir = path.join(process.env.LOCALAPPDATA || '', 'DeepSeekHarness')
// no-browser：由发起方页面自行重连刷新（按钮流程），助手不再另开新标签页
const openAfter = process.argv[3] !== 'no-browser'

function log(msg) {
  try {
    fs.appendFileSync(path.join(launcherDir, 'relaunch-helper.log'), `${new Date().toISOString()} ${msg}\n`, 'utf8')
  } catch {}
}

function readConfig() {
  const file = path.join(launcherDir, 'launcher.config.json')
  const derive = (cfg) =>
    typeof cfg.bin === 'string' && cfg.bin
      ? cfg.bin
      : typeof cfg.repo === 'string' && cfg.repo
        ? path.join(cfg.repo, 'apps', 'cli', 'lib', 'bin.js')
        : (process.env.DSH_REPO ? path.join(process.env.DSH_REPO, 'apps', 'cli', 'lib', 'bin.js') : '')
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      node: typeof cfg.node === 'string' && cfg.node ? cfg.node : process.execPath,
      repo: typeof cfg.repo === 'string' && cfg.repo ? cfg.repo : (process.env.DSH_REPO || ''),
      bin: derive(cfg),
      profile: typeof cfg.profile === 'string' && cfg.profile ? cfg.profile : 'web',
      port: Number(cfg.port) || 3080,
      host: typeof cfg.host === 'string' && cfg.host ? cfg.host : '127.0.0.1',
    }
  } catch {
    return {
      node: process.execPath,
      repo: process.env.DSH_REPO || '',
      bin: process.env.DSH_REPO ? path.join(process.env.DSH_REPO, 'apps', 'cli', 'lib', 'bin.js') : '',
      profile: 'web',
      port: 3080,
      host: '127.0.0.1',
    }
  }
}

function portPid(port) {
  try {
    const out = execSync(`netstat -ano`, { encoding: 'utf8', windowsHide: true })
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const m = line.trim().match(/(\d+)\s*$/)
        if (m) return Number(m[1])
      }
    }
  } catch {}
  return null
}

function portUp(port, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const tick = () => {
      const socket = net.connect(port, '127.0.0.1')
      const done = (up) => { try { socket.destroy() } catch {} ; resolve(up) }
      socket.once('connect', () => done(true))
      socket.once('error', () => {
        if (Date.now() >= deadline) return done(false)
        setTimeout(tick, 800)
      })
    }
    tick()
  })
}

function openBrowser(url) {
  try {
    spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
  } catch {}
}

// DSH 0.1.2 browser-trust：web 需 ?token= 访问（每次实例启动轮换）。裸 URL 会 401。
// 解析 dsh-server.log 中最近一次启动打印的带 token URL（= 刚拉起的当前实例），取不到回退默认 URL。
function accessUrl(fallbackUrl) {
  try {
    const lines = fs.readFileSync(path.join(launcherDir, 'dsh-server.log'), 'utf8').split(/\r?\n/)
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/http:\/\/127\.0\.0\.1:\d+\/\S*/)
      if (m) return m[0]
    }
  } catch {}
  return fallbackUrl
}

async function main() {
  log(`start delay=${delaySec}s`)
  const cfg = readConfig()
  log(`config node=${cfg.node} bin=${cfg.bin} repo=${cfg.repo || '-'} profile=${cfg.profile} port=${cfg.port} host=${cfg.host}`)
  const bin = cfg.bin
  if (delaySec > 0) await new Promise((r) => setTimeout(r, delaySec * 1000))

  // 兜底：旧进程若还没退出（appExit 缺失/失败时），按端口杀
  const pid = portPid(cfg.port)
  log(`port ${cfg.port} pid=${pid === null ? 'none' : pid}`)
  if (pid) {
    try { execSync(`taskkill /F /T /PID ${pid}`, { windowsHide: true, stdio: 'ignore' }); log(`taskkill ${pid} ok`) } catch (e) { log(`taskkill ${pid} failed: ${e.message}`) }
    const deadline = Date.now() + 20000
    while (Date.now() < deadline && portPid(cfg.port)) {
      await new Promise((r) => setTimeout(r, 500))
    }
    log(`after kill portPid=${portPid(cfg.port) === null ? 'none' : portPid(cfg.port)}`)
  }

  if (!bin || !fs.existsSync(bin)) {
    // 无可用 bin：回退 cmd 垫片 dsh.cmd（npm 全局 @deepseek-ai/dsh 的 CLI 入口，web 子命令）
    log('fallback: dsh web via cmd shim')
    const fb = spawn('cmd.exe', ['/c', 'dsh', 'web', '--no-open', '--host', cfg.host], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    })
    fb.unref()
    if (fb.pid) {
      try { fs.writeFileSync(path.join(launcherDir, 'dsh-server.pid'), String(fb.pid), 'ascii') } catch {}
    }
    const up = await portUp(cfg.port, 90000)
    log(`fallback port up=${up}`)
    if (up && openAfter) openBrowser(accessUrl(`http://127.0.0.1:${cfg.port}`))
    process.exit(0)
  }

  try { fs.mkdirSync(launcherDir, { recursive: true }) } catch {}
  const outFd = fs.openSync(path.join(launcherDir, 'dsh-server.log'), 'a')
  const errFd = fs.openSync(path.join(launcherDir, 'dsh-server.err.log'), 'a')
  // --profile 显式形态（0.1.2-rc.1 CLI 推荐写法，web 子命令等价）；--no-open 防 dsh 自开浏览器，
  // 开浏览器统一交给下方 openAfter（按钮流程=no-browser 不开，原标签页轮询自刷新，避免双开）
  const child = spawn(cfg.node, [bin, '--profile', cfg.profile, '--no-open', '--host', cfg.host], {
    ...(cfg.repo ? { cwd: cfg.repo } : {}),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outFd, errFd],
  })
  child.unref()
  try { fs.closeSync(outFd); fs.closeSync(errFd) } catch {}
  log(`spawned new dsh pid=${child.pid || 'unknown'}`)
  if (child.pid) {
    try { fs.writeFileSync(path.join(launcherDir, 'dsh-server.pid'), String(child.pid), 'ascii') } catch {}
  }

  const up = await portUp(cfg.port, 90000)
  log(`port up=${up}`)
  if (up && openAfter) openBrowser(accessUrl(`http://127.0.0.1:${cfg.port}`))
  process.exit(0)
}

main().catch((e) => { log(`fatal: ${e && e.stack ? e.stack : e}`); process.exit(1) })
