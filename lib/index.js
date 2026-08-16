/**
 * dsh-header-controls 宿主半：会话右上角的「重启 / 注销」电源控制。
 * - 重启：清待重启标记 → spawn 分离式助手（等本进程退出后经 launcher 重新拉起 dsh）→ appExit(0) 优雅退出
 * - 注销：关闭整个 dsh 进程（appExit(0) 优雅退出），等同原鲸鱼按钮的作用
 * 仅允许 loopback + 自定义请求头访问（CSRF 防护）。
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { unlink } from 'node:fs/promises'

export const name = 'dsh-header-controls'
export const inject = ['webServer']

function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

/** 清掉插件管理器的「待重启」标记（重启后改动已生效，标记作废）。 */
async function clearManagerMarker() {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    await unlink(join(home, 'profiles', 'web', '.dsh-plugin-manager.json'))
  } catch {}
}

/** 派生分离式重启助手（纯 Node，零 PowerShell）：等当前进程退出后重新拉起 dsh。
 *  no-browser：发起方页面会自行轮询重连刷新，助手不开新标签页。 */
function spawnRestartHelper() {
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'relaunch-helper.cjs')
  const child = spawn(process.execPath, [helper, '6', 'no-browser'], { detached: true, stdio: 'ignore' })
  child.unref()
}

export function apply(ctx) {
  const exitApp = () => {
    const exit = ctx.get('appExit')
    if (typeof exit === 'function') {
      try { exit(0) } catch {}
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-header-controls/restart',
    handler: async (req, res) => {
      if (!isLoopback(req) || req.headers['x-dsh-header-controls'] !== '1' || req.method !== 'POST') {
        res.writeHead(403)
        return res.end('forbidden')
      }
      await clearManagerMarker()
      spawnRestartHelper()
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, message: '正在重启…' }))
      setTimeout(exitApp, 1500)
    },
  }), 'dsh-header-controls: restart route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-header-controls/exit',
    handler: async (req, res) => {
      if (!isLoopback(req) || req.headers['x-dsh-header-controls'] !== '1' || req.method !== 'POST') {
        res.writeHead(403)
        return res.end('forbidden')
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, message: '已退出' }))
      exitApp()
    },
  }), 'dsh-header-controls: exit route')
}
