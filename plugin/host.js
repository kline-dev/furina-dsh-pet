// ============================================================
// Furina Desktop Pet — DSH dynamic Cordis Plugin (Host half)
// ------------------------------------------------------------
// 用法：在 DeepSeek Harness Web GUI 中，把本文件内容作为
// cordis_define 的 code.host 提交（code.client 用 client.js）。
// 运行后插件会注册两个本地 HTTP 接口：
//   GET /dsh-pet-assets/furina/sprite.webp  清洁版雪碧图
//   GET /dsh-pet-assets/furina/status.json  实时心情 + 任务进度
// 以及供网页端轮询的 RPC 方法 furina-pet/state。
// ============================================================
return {
  apply(ctx) {
    const webServer = ctx.get('webServer')
    const fs = ctx.get('fs')
    if (webServer === undefined || fs === undefined) {
      console.error('furina-pet: webServer or fs service unavailable')
      return
    }

    // 素材目录候选（按顺序回退）：会话工作区根目录 -> 固定路径。
    // 注意：某些环境下 sandboxPolicy.workspaceRoot 可能指向别处，
    // 因此按候选列表逐个尝试，找到 sprite-clean.png 为止。
    const candidateDirs = []
    try {
      const sp = ctx.get('sandboxPolicy')
      if (sp !== undefined && typeof sp.workspaceRoot === 'string' && sp.workspaceRoot.length > 0) {
        candidateDirs.push(sp.workspaceRoot)
      }
    } catch (e) {}
    candidateDirs.push('C:\\Users\\34541\\Desktop\\codex furina switch')
    let sprite = null
    let spriteInfo = null

    const state = {
      running: false,
      thinking: false,
      approval: false,
      subagents: 0,
      failedUntil: 0,
      failedText: '',
      greetUntil: 0,
      celebrateUntil: 0,
      lastTool: '',
      lastRunStart: 0,
      todos: null,
      turnActive: false,
      todoVersion: 0,
      mainSessionId: null,
    }
    const now = Date.now.bind(Date)
    const projService = ctx.get('sessionProjections')
    const agentsService = ctx.get('agents')
    let sessionRef = null

    const sameTodos = (a, b) => {
      if (a === b) return true
      if (a === null || b === null) return a === b
      if (!Array.isArray(a) || !Array.isArray(b)) return false
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (a[i].content !== b[i].content || a[i].status !== b[i].status) return false
      }
      return true
    }

    const applyTodos = (list) => {
      if (list === null) {
        if (state.todos !== null) { state.todos = null; state.todoVersion += 1 }
        return
      }
      if (!Array.isArray(list)) return
      const cleaned = []
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        if (item === null || typeof item !== 'object') return
        const content = item.content
        const status = item.status
        if (typeof content !== 'string' || content.length === 0) return
        if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return
        cleaned.push({ content: content, status: status })
      }
      if (sameTodos(cleaned, state.todos)) return
      state.todos = cleaned
      state.todoVersion += 1
    }

    const captureSession = () => {
      try {
        if (sessionRef !== undefined && sessionRef !== null) return true
        if (projService === undefined || agentsService === undefined) return false
        const initiator = agentsService.currentInitiator()
        const session = initiator !== undefined ? initiator.session : undefined
        if (session !== undefined) {
          sessionRef = session
          state.mainSessionId = session.id
          return true
        }
        return false
      } catch (e) { return false }
    }

    // 投影轮询：只应用非空的 todo 列表。DSH 会在每回合开始时清空
    // 常驻投影，但宠物面板需要跨回合保留最近清单，因此忽略空值。
    const refreshTodosFromProjection = () => {
      try {
        if (projService === undefined || !captureSession()) return
        const snap = projService.snapshot(sessionRef)
        const values = snap && snap.values
        if (values === undefined) return
        const todos = values.todos
        if (todos !== null && todos !== undefined) applyTodos(todos)
      } catch (e) {}
    }

    // 启动时从实时投影恢复任务清单。
    refreshTodosFromProjection()

    const loadSprite = async () => {
      for (let i = 0; i < candidateDirs.length; i++) {
        try {
          const target = await fs.resolve('pet-assets/sprite-clean.png', { cwd: candidateDirs[i] })
          const bytes = await fs.readBytes(target, undefined, 10 * 1024 * 1024)
          if (bytes !== undefined && bytes !== null && bytes.byteLength > 1000) {
            spriteInfo = { dir: candidateDirs[i], size: bytes.byteLength }
            return bytes
          }
        } catch (e) {}
      }
      return null
    }

    // 提供清洁版雪碧图（无损 PNG，已去除有损 WebP 边缘光晕）。
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-pet-assets/furina/sprite.webp',
      handler: async (req, res) => {
        try {
          if (sprite === null) sprite = await loadSprite()
          if (sprite === null) { res.writeHead(404); res.end('sprite missing'); return }
          res.setHeader('Content-Type', 'image/png')
          res.setHeader('Cache-Control', 'public, max-age=86400')
          res.writeHead(200)
          res.end(sprite)
        } catch (e) {
          try { res.writeHead(500); res.end('error') } catch (e2) {}
        }
      },
    }))

    // Agent 状态：running <-> idle。
    ctx.on('agent/status', (payload) => {
      const status = payload && payload.status
      if (status === 'running') {
        if (!state.running) state.lastRunStart = now()
        state.running = true
      } else if (status === 'idle') {
        const wasRunning = state.running
        state.running = false
        if (wasRunning && state.lastRunStart > 0 && now() - state.lastRunStart > 1500 && now() > state.failedUntil) {
          state.celebrateUntil = now() + 3000
        }
      }
    })

    // 模型推理流 = 思考中。
    ctx.on('llm/stream', function (options, next) {
      state.thinking = true
      let iter
      try { iter = next() } catch (e) { state.thinking = false; throw e }
      return (async function* () {
        try { yield* iter } finally { state.thinking = false }
      })()
    })

    // 回合报错 = 沮丧表情。
    ctx.on('agent/error', (payload) => {
      state.failedUntil = now() + 6000
      let msg = ''
      try {
        const err = payload && payload.error
        msg = err ? String(err.message || err).slice(0, 140) : ''
      } catch (e) {}
      state.failedText = msg
    })

    // 等待审批 = 耐心等待。
    ctx.on('approval/request', (req, next) => {
      state.approval = true
      const p = next()
      if (p && typeof p.then === 'function') {
        return p.then((v) => { state.approval = false; return v }, (e) => { state.approval = false; throw e })
      }
      state.approval = false
      return p
    })

    // 工具执行 = 工作中，并记录工具名用于气泡文案。
    ctx.on('tools/execute', (exec, next) => {
      state.running = true
      state.lastRunStart = now()
      try {
        const name = exec && (exec.toolName || exec.name)
        if (typeof name === 'string' && name.length > 0) state.lastTool = name.slice(0, 80)
      } catch (e) {}
      return next()
    })

    ctx.on('subagent/start', () => {
      state.subagents += 1
      state.running = true
      state.lastRunStart = now()
    })
    ctx.on('subagent/end', () => {
      state.subagents = Math.max(0, state.subagents - 1)
    })

    // 用户消息到达 = 挥手打招呼。
    ctx.on('agent/inbox/inserted', (payload) => {
      try {
        const m = payload && payload.message
        if (m && m.role === 'user') state.greetUntil = now() + 3200
      } catch (e) {}
    })

    // 会话事件流（快速路径；投影轮询是兜底）。
    ctx.on('session/event', (session, event) => {
      try {
        if (state.mainSessionId !== null && session !== undefined && session.id !== state.mainSessionId) return
        const type = event && event.type
        if (type === 'todo/write') {
          const data = event.data
          applyTodos(data ? data.todos : null)
          if (data && Array.isArray(data.todos) && data.todos.length > 0) {
            let done = true
            for (let i = 0; i < data.todos.length; i++) {
              const item = data.todos[i]
              if (!item || item.status !== 'completed') { done = false; break }
            }
            if (done) state.celebrateUntil = Math.max(state.celebrateUntil, now() + 3500)
          }
        } else if (type === 'turn/start') {
          state.turnActive = true
        } else if (type === 'turn/end') {
          state.turnActive = false
        }
      } catch (e) {}
    })

    const currentLiveRunning = () => {
      if (state.running) return true
      try {
        if (agentsService !== undefined) {
          const initiator = agentsService.currentInitiator()
          if (initiator !== undefined && initiator.status === 'running') return true
        }
      } catch (e) {}
      return false
    }

    const currentMood = (liveRunning) => {
      const t = now()
      if (t < state.failedUntil) return { mood: 'failed', detail: state.failedText }
      if (state.approval) return { mood: 'waiting', detail: '' }
      if (state.thinking) return { mood: 'review', detail: '' }
      if (liveRunning) return { mood: 'running', detail: state.lastTool }
      if (t < state.greetUntil) return { mood: 'waving', detail: '' }
      if (t < state.celebrateUntil) return { mood: 'jumping', detail: '' }
      return { mood: 'idle', detail: '' }
    }

    const buildProgress = (liveRunning) => {
      if (state.todos === null || !Array.isArray(state.todos)) {
        return { state: state.turnActive || liveRunning ? 'working' : 'idle', active: state.turnActive, percent: null, completed: 0, total: 0, inProgress: 0, currentTask: null, hasTodos: false }
      }
      const list = state.todos
      const total = list.length
      let completed = 0
      let inProgress = 0
      for (let i = 0; i < list.length; i++) {
        if (list[i].status === 'completed') completed += 1
        else if (list[i].status === 'in_progress') inProgress += 1
      }
      let current = null
      for (let i = 0; i < list.length; i++) {
        if (list[i].status === 'in_progress') { current = list[i].content; break }
      }
      if (current === null) {
        for (let i = 0; i < list.length; i++) {
          if (list[i].status === 'pending') { current = list[i].content; break }
        }
      }
      if (current === null && list.length > 0) current = list[list.length - 1].content
      const pstate = total > 0 && completed === total ? 'completed' : (inProgress > 0 || liveRunning || state.turnActive ? 'working' : 'idle')
      return {
        state: pstate,
        active: state.turnActive,
        percent: total > 0 ? Math.round(completed / total * 100) : null,
        completed: completed,
        total: total,
        inProgress: inProgress,
        currentTask: current,
        hasTodos: true,
      }
    }

    const buildStatusPayload = () => {
      const liveRunning = currentLiveRunning()
      refreshTodosFromProjection()
      const m = currentMood(liveRunning)
      return {
        ts: now(),
        mood: m.mood,
        detail: m.detail,
        subagents: state.subagents,
        progress: buildProgress(liveRunning),
        todos: state.todos === null ? null : state.todos.map((item) => ({ content: item.content, status: item.status })),
        debug: { workspaceRoot: candidateDirs[0] || null, sprite: spriteInfo === null ? null : { dir: spriteInfo.dir, size: spriteInfo.size } },
      }
    }

    // 桌面宠物轮询的实时状态接口。
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-pet-assets/furina/status.json',
      handler: async (req, res) => {
        try {
          const payload = JSON.stringify(buildStatusPayload())
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.writeHead(200)
          res.end(payload)
        } catch (e) {
          try { res.writeHead(500); res.end('{}') } catch (e2) {}
        }
      },
    }))

    // 网页端 Client 每 ~450ms 轮询一次。仅返回标量。
    harness.handle('furina-pet/state', async (args) => {
      const payload = buildStatusPayload()
      const out = { mood: payload.mood, detail: payload.detail, ts: payload.ts, subagents: payload.subagents, progress: payload.progress }
      const lastTodoVersion = args && typeof args.todoVersion === 'number' ? args.todoVersion : -1
      if (state.todoVersion !== lastTodoVersion) {
        out.todoVersion = state.todoVersion
        out.todos = payload.todos
      }
      return out
    })
  },
}
