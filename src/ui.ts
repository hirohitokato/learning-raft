import { SimulationController } from "./simulator/SimulationController"

const controller = new SimulationController({
    nodeCount: 5,
    communicationSpeed: 10,
    timeStepMs: 10,
})

const settings = {
    nodeCount: document.querySelector("#nodeCount") as HTMLInputElement,
    communicationSpeed: document.querySelector("#communicationSpeed") as HTMLInputElement,
    timeStepMs: document.querySelector("#timeStepMs") as HTMLInputElement,
    toggle: document.querySelector("#toggleSimulation") as HTMLButtonElement,
    clock: document.querySelector("#clock") as HTMLDivElement,
    nodeSettings: document.querySelector("#nodeSettings") as HTMLDivElement,
    stateTable: document.querySelector("#stateTable") as HTMLUListElement,
    canvas: document.querySelector("#simCanvas") as HTMLCanvasElement,
}

const stateColors: Record<string, string> = {
    leader: "#22c55e",
    follower: "#60a5fa",
    candidate: "#fbbf24",
    active: "#34d399",
    suspend: "#f87171",
}

let selectedNodeId: number | null = null
const WORLD_SIZE = 100
const GRID_CELL = 10
const NODE_RADIUS = 18
const ANIMATION_FPS = 30
const FRAME_INTERVAL_MS = 1000 / ANIMATION_FPS

function syncCanvasSize() {
    const rect = settings.canvas.getBoundingClientRect()
    settings.canvas.width = Math.max(1, Math.floor(rect.width))
    settings.canvas.height = Math.max(1, Math.floor(rect.height))
}

function getViewBox() {
    const width = settings.canvas.width || 800
    const height = settings.canvas.height || 600
    const size = Math.min(width, height)
    const marginX = (width - size) / 2
    const marginY = (height - size) / 2
    const scale = size / WORLD_SIZE

    return {
        width,
        height,
        size,
        scale,
        marginX,
        marginY,
    }
}

function worldToScreen(x: number, y: number) {
    const { scale, marginX, marginY } = getViewBox()
    return {
        x: x * scale + marginX,
        y: y * scale + marginY,
    }
}

function quadraticBezier(p0: { x: number; y: number }, p1: { x: number; y: number }, p2: { x: number; y: number }, t: number) {
    const u = 1 - t
    return {
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    }
}

function renderNodeSettings() {
    const nodeList = controller.nodes
    const selectedNode = selectedNodeId === null ? null : nodeList.find((node) => node.id === selectedNodeId)

    if (!selectedNode) {
        settings.nodeSettings.innerHTML = `<div class="field"><label>Selected Node</label><div style="color:#94a3b8; font-size:12px;">No node selected.</div></div>`
        return
    }

    const snapshot = controller.getNodeSnapshot(selectedNode.id)
    settings.nodeSettings.innerHTML = `
      <div class="field">
        <label>Selected Node</label>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>#${selectedNode.id}</strong>
          <span class="badge ${snapshot?.state ?? "follower"}">${snapshot?.state ?? "follower"}</span>
        </div>
      </div>
      <div class="field">
        <label>Role</label>
        <div>${snapshot?.state ?? "follower"}</div>
      </div>
      <div class="field">
        <label>Current Term</label>
        <div>${snapshot?.currentTerm ?? 0}</div>
      </div>
      <div class="field">
        <label>Vote Count</label>
        <div>${snapshot?.voteCount ?? 0}</div>
      </div>
      <div class="field">
        <button data-action="toggle-active" class="secondary">${snapshot?.isActive ? "Suspend" : "Activate"}</button>
      </div>
      <div class="field">
        <button data-action="reset-node" class="secondary">Reset State Machine</button>
      </div>
      <div class="field">
        <label>New State</label>
        <select id="newStateSelect">
          <option value="follower">Follower</option>
          <option value="candidate">Candidate</option>
          <option value="leader">Leader</option>
        </select>
      </div>
      <div class="field">
        <button data-action="apply-state" class="primary">Set New State</button>
      </div>
    `

    const actionButtons = settings.nodeSettings.querySelectorAll("button[data-action]")
    actionButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.getAttribute("data-action")
            if (!selectedNodeId || !action) {
                return
            }

            if (action === "toggle-active") {
                controller.setNodeActive(selectedNodeId, !(controller.getNodeSnapshot(selectedNodeId)?.isActive ?? true))
            }

            if (action === "reset-node") {
                controller.resetNode(selectedNodeId)
            }

            if (action === "apply-state") {
                const select = document.querySelector("#newStateSelect") as HTMLSelectElement | null
                if (!select) {
                    return
                }

                const state = select.value as "follower" | "candidate" | "leader"
                const node = controller.nodes.find((entry) => entry.id === selectedNodeId)
                if (node) {
                    node.state = state
                }
            }

            renderNodeSettings()
        })
    })
}

function renderStateTable() {
    const snapshots = controller.getNodesSnapshot()

    settings.stateTable.innerHTML = snapshots
        .map((node) => {
            const selectedClass = node.id === selectedNodeId ? " selected" : ""
            return `
            <li class="node-row${selectedClass}" data-node-id="${node.id}">
              <div class="node-row-header">
                <span><span class="dot" style="background:${stateColors[node.state]};"></span>#${node.id}</span>
                <span class="badge ${node.state}">${node.state}</span>
              </div>
              <div style="font-size:12px;color:#94a3b8;">term ${node.currentTerm} / votes ${node.voteCount}</div>
              <div style="font-size:12px;color:#94a3b8; margin-top:4px;">logs: ${node.logs.length}</div>
            </li>
          `
        })
        .join("")

    settings.stateTable.querySelectorAll(".node-row").forEach((row) => {
        row.addEventListener("click", () => {
            const id = Number(row.getAttribute("data-node-id"))
            selectedNodeId = id
            renderNodeSettings()
            renderStateTable()
        })
    })
}

function drawGrid(ctx: CanvasRenderingContext2D) {
    const { width, height, scale, marginX, marginY } = getViewBox()

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "#0b1120"
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = "rgba(148,163,184,0.14)"
    ctx.lineWidth = 1

    for (let x = 0; x <= WORLD_SIZE; x += GRID_CELL) {
        const px = x * scale + marginX
        ctx.beginPath()
        ctx.moveTo(px, marginY)
        ctx.lineTo(px, marginY + WORLD_SIZE * scale)
        ctx.stroke()
    }

    for (let y = 0; y <= WORLD_SIZE; y += GRID_CELL) {
        const py = y * scale + marginY
        ctx.beginPath()
        ctx.moveTo(marginX, py)
        ctx.lineTo(marginX + WORLD_SIZE * scale, py)
        ctx.stroke()
    }
}

function drawMessage(
    ctx: CanvasRenderingContext2D,
    message: {
        from: number
        to: number
        type: string
        progress: number
        fromPosition: { x: number; y: number }
        toPosition: { x: number; y: number }
    },
) {
    const from = worldToScreen(message.fromPosition.x, message.fromPosition.y)
    const to = worldToScreen(message.toPosition.x, message.toPosition.y)

    const control = {
        x: (from.x + to.x) / 2,
        y: Math.min(from.y, to.y) - 40,
    }

    const color = message.type.includes("Response") ? "#fbbf24" : "#a78bfa"

    for (let i = 0; i < 3; i++) {
        const t = Math.max(0, Math.min(1, message.progress - i * 0.12))
        const point = quadraticBezier(from, control, to, t)

        ctx.beginPath()
        ctx.arc(point.x, point.y, 4.5 - i * 0.7, 0, Math.PI * 2)
        ctx.fillStyle = color + (i === 0 ? "" : "88")
        ctx.fill()
    }
}

function drawNodes(ctx: CanvasRenderingContext2D) {
    const nodes = controller.getNodesSnapshot()
    const messages = controller.getActiveMessages()

    messages.forEach((message) => drawMessage(ctx, message))

    nodes.forEach((node) => {
        const position = worldToScreen(node.x, node.y)
        const radius = Math.max(12, Math.min(22, getViewBox().scale * 0.8))
        const stateColor =
            node.state === "leader"
                ? stateColors.leader
                : node.state === "candidate"
                  ? stateColors.candidate
                  : stateColors.follower

        ctx.beginPath()
        ctx.arc(position.x, position.y, radius, 0, Math.PI * 2)
        ctx.fillStyle = stateColor ?? "#60a5fa"
        ctx.fill()

        ctx.beginPath()
        ctx.arc(position.x, position.y, radius + 5, 0, Math.PI * 2)
        ctx.strokeStyle = node.isActive ? "#34d399" : "#f87171"
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(position.x, position.y, radius + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * node.timerRemainingRatio)
        ctx.strokeStyle = "rgba(255,255,255,0.9)"
        ctx.lineWidth = 3
        ctx.stroke()

        ctx.fillStyle = "#111827"
        ctx.font = "bold 12px sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(String(node.id), position.x, position.y)

        if (node.state === "candidate") {
            const barWidth = radius * 2.6
            const barX = position.x - barWidth / 2
            const barY = position.y + radius + 12
            ctx.fillStyle = "#111827"
            ctx.fillRect(barX, barY, barWidth, 8)
            ctx.fillStyle = "#fbbf24"
            ctx.fillRect(barX, barY, barWidth * Math.min(node.voteCount / Math.max(node.currentTerm || 1, 1), 1), 8)
        }
    })
}

function render() {
    const ctx = settings.canvas.getContext("2d")
    if (!ctx) {
        return
    }

    settings.clock.textContent = `Time: ${controller.simulationTime}ms`
    drawGrid(ctx)
    drawNodes(ctx)
    renderStateTable()
    renderNodeSettings()
}

settings.nodeCount.addEventListener("change", () => {
    const value = Number(settings.nodeCount.value) || 5
    controller.setNodeCount(value)
    selectedNodeId = 0
    render()
})

settings.communicationSpeed.addEventListener("change", () => {
    const value = Number(settings.communicationSpeed.value) || 10
    controller.setCommunicationSpeed(value)
    render()
})

settings.timeStepMs.addEventListener("change", () => {
    const value = Number(settings.timeStepMs.value) || 10
    controller.setTimeStepMs(value)
    render()
})

settings.toggle.addEventListener("click", () => {
    controller.toggle()
    settings.toggle.textContent = controller.running ? "Pause" : "Start"
})

settings.canvas.addEventListener("click", (event) => {
    const rect = settings.canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * settings.canvas.width
    const y = (event.clientY - rect.top) / rect.height * settings.canvas.height

    const hitNode = controller.getNodesSnapshot().find((node) => {
        const p = worldToScreen(node.x, node.y)
        return Math.hypot(p.x - x, p.y - y) <= 20
    })

    if (hitNode) {
        selectedNodeId = hitNode.id
        renderStateTable()
        renderNodeSettings()
    }
})

settings.canvas.addEventListener("mousedown", (event) => {
    const rect = settings.canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width * settings.canvas.width
    const y = (event.clientY - rect.top) / rect.height * settings.canvas.height

    const hitNode = controller.getNodesSnapshot().find((node) => {
        const p = worldToScreen(node.x, node.y)
        return Math.hypot(p.x - x, p.y - y) <= 20
    })

    if (!hitNode) {
        return
    }

    selectedNodeId = hitNode.id
    const move = (moveEvent: MouseEvent) => {
        const rect2 = settings.canvas.getBoundingClientRect()
        const nextX = ((moveEvent.clientX - rect2.left) / rect2.width) * WORLD_SIZE
        const nextY = ((moveEvent.clientY - rect2.top) / rect2.height) * WORLD_SIZE
        controller.moveNode(hitNode.id, Math.max(0, Math.min(WORLD_SIZE, nextX)), Math.max(0, Math.min(WORLD_SIZE, nextY)))
        render()
    }

    const stop = () => {
        window.removeEventListener("mousemove", move)
        window.removeEventListener("mouseup", stop)
    }

    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", stop)
})

window.addEventListener("resize", syncCanvasSize)
syncCanvasSize()
render()

let lastFrameTime = 0
function animationLoop(timestamp: number) {
    if (!lastFrameTime) {
        lastFrameTime = timestamp
    }

    if (timestamp - lastFrameTime >= FRAME_INTERVAL_MS) {
        render()
        lastFrameTime = timestamp
    }

    requestAnimationFrame(animationLoop)
}

requestAnimationFrame(animationLoop)
