// ============================================================
// Furina Desktop Pet — DSH dynamic Cordis Plugin (Client half)
// ------------------------------------------------------------
// 用法：在 DeepSeek Harness Web GUI 中，把本文件内容作为
// cordis_define 的 code.client 提交（code.host 用 host.js）。
// 网页端效果：右下角悬浮宠物 + 任务进度面板。
// ============================================================
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const FRAME_W = 192
    const FRAME_H = 208
    // petdex 官方 furina-2 状态表（src/lib/pet-states.ts）。
    const STATES = {
      idle: { row: 0, frames: 6, dur: 1100 },
      'running-right': { row: 1, frames: 8, dur: 1060 },
      'running-left': { row: 2, frames: 8, dur: 1060 },
      waving: { row: 3, frames: 4, dur: 700 },
      jumping: { row: 4, frames: 5, dur: 840 },
      failed: { row: 5, frames: 8, dur: 1220 },
      waiting: { row: 6, frames: 6, dur: 1010 },
      running: { row: 7, frames: 6, dur: 820 },
      review: { row: 8, frames: 6, dur: 1030 },
    }

    // petdex 官方雪碧图 CSS（改名前缀），加任务面板样式。
    styles.insert([
      '.furina-pet-wrap{position:fixed;z-index:6000;pointer-events:none;user-select:none;-webkit-user-select:none;}',
      '.furina-pet-frame{--furina-scale:0.8;width:calc(192px*var(--furina-scale));height:calc(208px*var(--furina-scale));overflow:hidden;pointer-events:auto;cursor:grab;contain:layout paint;}',
      '.furina-pet-frame:active{cursor:grabbing;}',
      '.furina-pet-sprite{--sprite-row:0;--sprite-frames:6;--sprite-duration:1100ms;--sprite-sheet-width:1536px;--sprite-y:0px;--sprite-end-x:-1152px;width:192px;height:208px;background-image:url("/dsh-pet-assets/furina/sprite.webp");background-repeat:no-repeat;background-size:var(--sprite-sheet-width) auto;image-rendering:pixelated;transform:scale(var(--furina-scale)) translateZ(0);transform-origin:top left;will-change:background-position;animation:furina-pet-state var(--sprite-duration) steps(var(--sprite-frames)) infinite;}',
      '@keyframes furina-pet-state{from{background-position:0 var(--sprite-y);}to{background-position:var(--sprite-end-x) var(--sprite-y);}}',
      '@media (prefers-reduced-motion:reduce){.furina-pet-sprite{animation:none;}}',
      '.furina-pet-bubble{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);max-width:340px;padding:5px 12px;border-radius:12px;background:rgba(24,26,36,0.92);color:#fff;font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 20px rgba(0,0,0,0.28);pointer-events:none;z-index:2;}',
      '.furina-pet-panel{position:absolute;right:-6px;bottom:calc(100% + 8px);width:280px;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:14px;background:rgba(24,26,36,0.94);color:#fff;font:12px/1.5 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.35);pointer-events:auto;border:1px solid rgba(255,255,255,0.12);z-index:1;}',
      '.furina-pet-panel-head{display:flex;align-items:baseline;gap:8px;}',
      '.furina-pet-panel-title{font-weight:600;font-size:13px;}',
      '.furina-pet-panel-percent{margin-left:auto;font-size:13px;font-weight:700;color:#7cc7ff;}',
      '.furina-pet-panel-count{opacity:0.6;font-size:11px;}',
      '.furina-pet-panel-close{margin-left:6px;background:none;border:none;color:rgba(255,255,255,0.65);cursor:pointer;font-size:14px;line-height:1;padding:0;}',
      '.furina-pet-panel-bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.15);overflow:hidden;}',
      '.furina-pet-panel-bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#4c8dff,#7cc7ff);transition:width 0.4s ease;}',
      '.furina-pet-panel-current{color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.furina-pet-panel-list{list-style:none;margin:0;padding:0;overflow-y:auto;display:flex;flex-direction:column;gap:4px;max-height:150px;}',
      '.furina-pet-panel-item{display:flex;gap:6px;align-items:flex-start;}',
      '.furina-pet-panel-item.completed{opacity:0.55;text-decoration:line-through;}',
      '.furina-pet-panel-mark{flex:none;width:14px;text-align:center;}',
      '.furina-pet-badge{position:absolute;top:-10px;right:-10px;width:26px;height:26px;border-radius:50%;border:1px solid rgba(255,255,255,0.25);background:rgba(24,26,36,0.9);color:#fff;font-size:13px;line-height:1;cursor:pointer;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:3;}',
      '.furina-pet-restore{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,0.2);background:rgba(24,26,36,0.85);color:#fff;font-size:20px;line-height:1;cursor:pointer;pointer-events:auto;box-shadow:0 6px 20px rgba(0,0,0,0.3);}',
    ].join('\n'))

    let moodRef = 'idle'
    let detailRef = ''
    let hiddenRef = false
    let draggingRef = false
    let todoVersionRef = -1
    let todosRef = null
    let prevProgressStateRef = ''

    function FurinaPet() {
      const [mood, setMoodState] = React.useState('idle')
      const [detail, setDetail] = React.useState('')
      const [hidden, setHiddenState] = React.useState(false)
      const [pos, setPos] = React.useState(null)
      const [waveUntil, setWaveUntil] = React.useState(0)
      const [celebrateUntil, setCelebrateUntil] = React.useState(0)
      const [drag, setDrag] = React.useState(null)
      const [dragDir, setDragDir] = React.useState('left')
      const [progress, setProgress] = React.useState(null)
      const [todos, setTodos] = React.useState(null)
      const [panelOpen, setPanelOpen] = React.useState(true)

      // 每 450ms 轮询 Host 心情/进度；挂载时挥手一次。
      React.useEffect(() => {
        setWaveUntil(Date.now() + 2500)
        const stopPoll = ctx.interval(() => {
          host.call('furina-pet/state', { todoVersion: todoVersionRef }).then((s) => {
            if (s === null || s === undefined) return
            moodRef = typeof s.mood === 'string' ? s.mood : 'idle'
            detailRef = typeof s.detail === 'string' ? s.detail : ''
            setMoodState(moodRef)
            setDetail(detailRef)
            if (s.todos !== undefined) {
              todosRef = s.todos === null ? null : s.todos
              todoVersionRef = typeof s.todoVersion === 'number' ? s.todoVersion : todoVersionRef
              setTodos(todosRef)
            }
            if (s.progress && typeof s.progress === 'object') {
              if (prevProgressStateRef !== 'completed' && s.progress.state === 'completed' && prevProgressStateRef !== '') {
                setCelebrateUntil(Date.now() + 3000)
                ctx.timeout(() => setCelebrateUntil(0), 3100)
              }
              prevProgressStateRef = s.progress.state
              setProgress(s.progress)
            }
          }, () => {})
        }, 450)
        return stopPoll
      }, [])

      const onPointerDown = (e) => {
        let rect = null
        try { rect = e.currentTarget.getBoundingClientRect() } catch (err) {}
        try { if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
        setDrag({ sx: e.clientX, sy: e.clientY, rect: rect, moved: false, base: pos })
      }
      const onPointerMove = (e) => {
        if (drag === null) return
        const dx = e.clientX - drag.sx
        const dy = e.clientY - drag.sy
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
          drag.moved = true
          draggingRef = true
        }
        if (drag.moved) {
          const dir = dx < 0 ? 'left' : 'right'
          if (dir !== dragDir) setDragDir(dir)
          let left = 0
          let top = 0
          if (drag.base !== null) { left = drag.base.left; top = drag.base.top }
          else if (drag.rect !== null) { left = drag.rect.left; top = drag.rect.top }
          setPos({ left: left + dx, top: top + dy })
        }
      }
      const onPointerUp = () => {
        if (drag === null) return
        const wasDrag = drag.moved
        draggingRef = false
        setDrag(null)
        if (!wasDrag) {
          setWaveUntil(Date.now() + 2600)
          ctx.timeout(() => setWaveUntil(0), 2700)
        }
      }
      const onDoubleClick = () => {
        hiddenRef = true
        setHiddenState(true)
        setPos(null)
      }

      const t = Date.now()
      let spriteId = 'idle'
      if (drag !== null && drag.moved) spriteId = dragDir === 'left' ? 'running-left' : 'running-right'
      else if (waveUntil > t) spriteId = 'waving'
      else if (mood === 'failed') spriteId = 'failed'
      else if (mood === 'waiting') spriteId = 'waiting'
      else if (mood === 'review') spriteId = 'review'
      else if (mood === 'running') spriteId = 'running'
      else if (celebrateUntil > t) spriteId = 'jumping'
      else if (mood === 'waving') spriteId = 'waving'
      else if (mood === 'jumping') spriteId = 'jumping'
      else spriteId = 'idle'

      const st = STATES[spriteId] || STATES.idle
      const hasPanel = panelOpen && progress !== null && progress.hasTodos === true && progress.total > 0

      let bubble = ''
      if (spriteId === 'failed') bubble = detail !== '' ? '出错了 · ' + detail : '出错了…'
      else if (spriteId === 'waiting') bubble = '等待许可…'
      else if (spriteId === 'review') bubble = '思考中…'
      else if (spriteId === 'running') {
        if (progress !== null && progress.hasTodos === true && progress.total > 0 && progress.currentTask) {
          bubble = '工作中 ' + progress.percent + '% · ' + progress.currentTask
        } else {
          bubble = detail !== '' ? '工作中 · ' + detail : '工作中…'
        }
      }
      else if (spriteId === 'jumping') bubble = celebrateUntil > t ? '全部完成！' : '完成啦！'
      else if (spriteId === 'waving') bubble = '你好呀！'
      if (hasPanel) bubble = ''

      if (hidden) {
        return React.createElement('div', { className: 'furina-pet-wrap', style: { right: 16, bottom: 16 } },
          React.createElement('button', {
            className: 'furina-pet-restore',
            title: 'Show Furina',
            onClick: () => { hiddenRef = false; setHiddenState(false); setWaveUntil(Date.now() + 2200) },
          }, '🐾'))
      }

      const wrapStyle = {}
      if (pos !== null) { wrapStyle.left = pos.left; wrapStyle.top = pos.top }
      else { wrapStyle.right = 16; wrapStyle.bottom = 16 }

      const spriteStyle = {
        '--sprite-row': st.row,
        '--sprite-frames': st.frames,
        '--sprite-duration': st.dur + 'ms',
        '--sprite-y': (st.row * -FRAME_H) + 'px',
        '--sprite-end-x': (st.frames * -FRAME_W) + 'px',
      }

      const panel = hasPanel ? React.createElement('div', { className: 'furina-pet-panel' },
        React.createElement('div', { className: 'furina-pet-panel-head' },
          React.createElement('span', { className: 'furina-pet-panel-title' }, '任务进度'),
          React.createElement('span', { className: 'furina-pet-panel-count' }, progress.completed + '/' + progress.total),
          React.createElement('span', { className: 'furina-pet-panel-percent' }, progress.percent + '%'),
          React.createElement('button', { className: 'furina-pet-panel-close', title: '收起', onClick: () => setPanelOpen(false) }, '×')),
        React.createElement('div', { className: 'furina-pet-panel-bar' },
          React.createElement('div', { className: 'furina-pet-panel-bar-fill', style: { width: progress.percent + '%' } })),
        progress.currentTask ? React.createElement('div', { className: 'furina-pet-panel-current' }, '当前 · ' + progress.currentTask) : null,
        todos !== null && todos.length > 0 ? React.createElement('ul', { className: 'furina-pet-panel-list' },
          todos.map((item, i) => {
            const mark = item.status === 'completed' ? '✓' : (item.status === 'in_progress' ? '▶' : '○')
            const color = item.status === 'completed' ? '#7ce38b' : (item.status === 'in_progress' ? '#7cc7ff' : 'rgba(255,255,255,0.5)')
            return React.createElement('li', { key: i, className: 'furina-pet-panel-item' + (item.status === 'completed' ? ' completed' : '') },
              React.createElement('span', { className: 'furina-pet-panel-mark', style: { color: color } }, mark),
              React.createElement('span', null, item.content))
          })) : null
      ) : null

      const badge = (progress !== null && progress.hasTodos === true && progress.total > 0) ? React.createElement('button', {
        className: 'furina-pet-badge',
        title: '任务进度 ' + progress.completed + '/' + progress.total,
        onClick: () => setPanelOpen(!panelOpen),
      }, panelOpen ? '▾' : progress.percent + '%') : null

      return React.createElement('div', { className: 'furina-pet-wrap', style: wrapStyle },
        panel,
        bubble !== '' ? React.createElement('div', { className: 'furina-pet-bubble' }, bubble) : null,
        badge,
        React.createElement('div', {
          className: 'furina-pet-frame',
          role: 'img',
          'aria-label': 'Furina desktop pet',
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerCancel: onPointerUp,
          onDoubleClick: onDoubleClick,
        },
          React.createElement('div', { className: 'furina-pet-sprite', style: spriteStyle })))
    }

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'furina-desktop-pet', order: 0, label: 'Furina desktop pet' },
      () => React.createElement(FurinaPet)
    ))
  },
}
