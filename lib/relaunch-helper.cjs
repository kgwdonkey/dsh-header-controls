/**
 * relaunch-helper.cjs — 重启助手（纯 Node，零 PowerShell）
 * 流程：可选延迟（argv[2] 秒，默认 6）→ 若端口仍占用则 taskkill 兜底 →
 * 重新拉起 dsh web（隐藏窗口、日志落盘、写 pid 文件）→ 轮询端口就绪 → 打开浏览器。
 * 配置来源：%LOCALAPPDATA%\DeepSeekHarness\launcher.config.json（node/repo/profile/port/host），
 * 缺失时回退：node=process.execPath、repo=env DSH_REPO、profile=web、port=3080、host=127.0.0.1。
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
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      node: typeof cfg.node === 'string' && cfg.node ? cfg.node : process.execPath,
      repo: typeof cfg.repo === 'string' && cfg.repo ? cfg.repo : (process.env.DSH_REPO || ''),
      profile: typeof cfg.profile === 'string' && cfg.profile ? cfg.profile : 'web',
      port: Number(cfg.port) || 3080,
      host: typeof cfg.host === 'string' && cfg.host ? cfg.host : '127.0.0.1',
    }
  } catch {
    return {
      node: process.execPath,
      repo: process.env.DSH_REPO || '',
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

async function main() {
  log(`start delay=${delaySec}s`)
  const cfg = readConfig()
  log(`config node=${cfg.node} repo=${cfg.repo} profile=${cfg.profile} port=${cfg.port} host=${cfg.host}`)
  const bin = path.join(cfg.repo, 'apps', 'cli', 'lib', 'bin.js')
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

  if (!cfg.repo || !fs.existsSync(bin)) {
    // 无预构建产物：回退 cmd 垫片 dsh.cmd（内部 cd 到 dsh 仓库目录 + tsx 源码启动）
    log('fallback: dsh web via cmd shim')
    const fb = spawn('cmd.exe', ['/c', 'dsh', 'web', '--host', cfg.host], {
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
    if (up && openAfter) openBrowser(`http://127.0.0.1:${cfg.port}`)
    process.exit(0)
  }

  try { fs.mkdirSync(launcherDir, { recursive: true }) } catch {}
  const outFd = fs.openSync(path.join(launcherDir, 'dsh-server.log'), 'a')
  const errFd = fs.openSync(path.join(launcherDir, 'dsh-server.err.log'), 'a')
  const child = spawn(cfg.node, [bin, cfg.profile, '--host', cfg.host], {
    cwd: cfg.repo,
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
  if (up && openAfter) openBrowser(`http://127.0.0.1:${cfg.port}`)
  process.exit(0)
}

main().catch((e) => { log(`fatal: ${e && e.stack ? e.stack : e}`); process.exit(1) })
