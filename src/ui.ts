import { SimulationController } from "./simulator/SimulationController"

const controller = new SimulationController({ nodeCount: 5, communicationSpeed: 1, timeStepMs: 10, simulationSpeed: 20 })
const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T
const controls = {
    nodeCount: $<HTMLInputElement>("#nodeCount"),
    communicationSpeed: $<HTMLInputElement>("#communicationSpeed"),
    timeStepMs: $<HTMLInputElement>("#timeStepMs"),
    simulationSpeed: $<HTMLInputElement>("#simulationSpeed"),
    simulationSpeedValue: $<HTMLOutputElement>("#simulationSpeedValue"),
    toggle: $<HTMLButtonElement>("#toggleSimulation"),
    clock: $<HTMLElement>("#clock"),
    stateTable: $<HTMLUListElement>("#stateTable"),
    canvas: $<HTMLCanvasElement>("#simCanvas"),
    nodeEmpty: $<HTMLElement>("#nodeEmpty"),
    nodeDetail: $<HTMLElement>("#nodeDetail"),
    nodeId: $<HTMLElement>("#selectedNodeId"),
    nodeState: $<HTMLElement>("#selectedNodeState"),
    nodeTerm: $<HTMLElement>("#selectedNodeTerm"),
    nodeVotes: $<HTMLElement>("#selectedNodeVotes"),
    nodeLogs: $<HTMLElement>("#selectedNodeLogs"),
    nodeTimer: $<HTMLElement>("#selectedNodeTimer"),
    logCommand: $<HTMLInputElement>("#logCommand"),
    commitLog: $<HTMLButtonElement>("#commitLog"),
    toggleActive: $<HTMLButtonElement>("#toggleActive"),
    resetNode: $<HTMLButtonElement>("#resetNode"),
}

const colors: Record<string, string> = { leader: "#c6f46a", follower: "#7ab8ff", candidate: "#ffc857" }
const WORLD_SIZE = 100
const GRID_CELL = 10
let selectedNodeId: number | null = null
let nodeListSignature = ""

function syncCanvasSize() {
    const rect = controls.canvas.getBoundingClientRect()
    controls.canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio))
    controls.canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio))
}

function viewBox() {
    const width = controls.canvas.width || 800
    const height = controls.canvas.height || 600
    const size = Math.min(width, height)
    return { width, height, scale: size / WORLD_SIZE, marginX: (width - size) / 2, marginY: (height - size) / 2 }
}

function worldToScreen(x: number, y: number) {
    const { scale, marginX, marginY } = viewBox()
    return { x: x * scale + marginX, y: y * scale + marginY }
}

function eventToCanvasPoint(event: MouseEvent) {
    const rect = controls.canvas.getBoundingClientRect()
    return { x: ((event.clientX - rect.left) / rect.width) * controls.canvas.width, y: ((event.clientY - rect.top) / rect.height) * controls.canvas.height }
}

function selectNode(id: number | null) {
    selectedNodeId = id
    updateUi()
}

function updateNodeList() {
    const nodes = controller.getNodesSnapshot()
    const signature = `${selectedNodeId}:${nodes.map((node) => `${node.id}:${node.state}:${node.currentTerm}:${node.voteCount}:${node.logs.length}:${node.isActive}`).join("|")}`
    if (signature === nodeListSignature) return
    nodeListSignature = signature
    controls.stateTable.innerHTML = nodes.map((node) => `
        <li><button class="node-row ${node.id === selectedNodeId ? "selected" : ""} ${node.isActive ? "" : "inactive"}" data-node-id="${node.id}" aria-pressed="${node.id === selectedNodeId}">
          <span class="node-row-top"><span class="node-name"><i style="--node-color:${colors[node.state]}"></i>NODE ${node.id}</span><span class="badge ${node.state}">${node.state}</span></span>
          <span class="node-row-meta">TERM ${node.currentTerm} · ${node.isActive ? "ONLINE" : "SUSPENDED"} · ${node.logs.length} LOGS</span>
        </button></li>`).join("")
}

function updateNodeDetail() {
    const node = selectedNodeId === null ? undefined : controller.getNodeSnapshot(selectedNodeId)
    controls.nodeEmpty.hidden = Boolean(node)
    controls.nodeDetail.hidden = !node
    if (!node) return
    controls.nodeId.textContent = `NODE ${node.id}`
    controls.nodeState.textContent = node.state
    controls.nodeState.className = `badge ${node.state}`
    controls.nodeTerm.textContent = String(node.currentTerm)
    controls.nodeVotes.textContent = String(node.voteCount)
    controls.nodeLogs.textContent = String(node.logs.length)
    controls.nodeTimer.textContent = `${Math.ceil(node.remainingElectionTime)} ms`
    controls.toggleActive.textContent = node.isActive ? "Suspend node" : "Activate node"
}

function updateUi() {
    controls.clock.textContent = `${controller.simulationTime.toFixed(0)} ms`
    controls.toggle.textContent = controller.running ? "Pause simulation" : "Start simulation"
    controls.simulationSpeedValue.textContent = controller.simulationSpeed === 0 ? "NO WAIT" : `1/${controller.simulationSpeed}`
    updateNodeList()
    updateNodeDetail()
}

function drawGrid(ctx: CanvasRenderingContext2D) {
    const { width, height, scale, marginX, marginY } = viewBox()
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "#071114"
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = "rgba(170, 215, 203, .10)"
    ctx.lineWidth = 1
    for (let unit = 0; unit <= WORLD_SIZE; unit += GRID_CELL) {
        ctx.beginPath(); ctx.moveTo(unit * scale + marginX, marginY); ctx.lineTo(unit * scale + marginX, marginY + WORLD_SIZE * scale); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(marginX, unit * scale + marginY); ctx.lineTo(marginX + WORLD_SIZE * scale, unit * scale + marginY); ctx.stroke()
    }
}

function bezier(from: { x: number; y: number }, control: { x: number; y: number }, to: { x: number; y: number }, t: number) {
    const u = 1 - t
    return { x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y }
}

function drawMessage(ctx: CanvasRenderingContext2D, message: ReturnType<SimulationController["getActiveMessages"]>[number]) {
    const from = worldToScreen(message.fromPosition.x, message.fromPosition.y)
    const to = worldToScreen(message.toPosition.x, message.toPosition.y)
    const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 48 * devicePixelRatio }
    const isResponse = message.type.includes("Response")
    const color = "#ff7f66"
    for (let trail = 4; trail >= 0; trail--) {
        const point = bezier(from, control, to, Math.max(0, message.progress - trail * 0.02))
        ctx.beginPath(); ctx.arc(point.x, point.y, (4.5 - trail * 0.5) * devicePixelRatio, 0, Math.PI * 2)
        if (isResponse) { ctx.lineWidth = 1.5 * devicePixelRatio; ctx.strokeStyle = trail ? `${color}55` : color; ctx.stroke() } else { ctx.fillStyle = trail ? `${color}55` : color; ctx.fill() }
    }
}

function drawScene() {
    const ctx = controls.canvas.getContext("2d")
    if (!ctx) return
    drawGrid(ctx)
    controller.getActiveMessages().forEach((message) => drawMessage(ctx, message))
    for (const node of controller.getNodesSnapshot()) {
        const point = worldToScreen(node.x, node.y)
        const radius = Math.max(12, Math.min(22, viewBox().scale * 0.8))
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fillStyle = node.isActive ? colors[node.state] ?? "#7ab8ff" : "#58635f"; ctx.fill()
        ctx.beginPath(); ctx.arc(point.x, point.y, radius + 6 * devicePixelRatio, 0, Math.PI * 2); ctx.lineWidth = 2 * devicePixelRatio; ctx.strokeStyle = node.isActive ? "#78e0bc" : "#78837f"; ctx.stroke()
        const timerRadius = radius + 11 * devicePixelRatio
        ctx.beginPath(); ctx.arc(point.x, point.y, timerRadius, -Math.PI / 2, Math.PI * 1.5); ctx.lineWidth = 3 * devicePixelRatio; ctx.strokeStyle = "rgba(231,241,236,.16)"; ctx.stroke()
        ctx.beginPath(); ctx.arc(point.x, point.y, timerRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * node.timerRemainingRatio); ctx.lineWidth = 3 * devicePixelRatio; ctx.strokeStyle = node.isActive ? "#f2fff9" : "#78837f"; ctx.stroke()
        if (node.id === selectedNodeId) { ctx.beginPath(); ctx.arc(point.x, point.y, radius + 17 * devicePixelRatio, 0, Math.PI * 2); ctx.lineWidth = 2 * devicePixelRatio; ctx.strokeStyle = "#c6f46a"; ctx.stroke() }
        ctx.fillStyle = "#061014"; ctx.font = `700 ${12 * devicePixelRatio}px ui-monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(node.id), point.x, point.y)
    }
}

controls.nodeCount.addEventListener("change", () => { controller.setNodeCount(Number(controls.nodeCount.value) || 5); selectNode(0) })
controls.communicationSpeed.addEventListener("change", () => controller.setCommunicationSpeed(Number(controls.communicationSpeed.value) || 1))
controls.timeStepMs.addEventListener("change", () => controller.setTimeStepMs(Number(controls.timeStepMs.value) || 10))
controls.simulationSpeed.addEventListener("input", () => { controller.setSimulationSpeed(Number(controls.simulationSpeed.value)); updateUi() })
controls.toggle.addEventListener("click", () => { controller.toggle(); updateUi() })
controls.stateTable.addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-node-id]"); if (button) { const id = Number(button.dataset.nodeId); selectNode(selectedNodeId === id ? null : id) } })
controls.toggleActive.addEventListener("click", () => { if (selectedNodeId !== null) { const node = controller.getNodeSnapshot(selectedNodeId); controller.setNodeActive(selectedNodeId, !(node?.isActive ?? true)); updateUi() } })
controls.resetNode.addEventListener("click", () => { if (selectedNodeId !== null) { controller.resetNode(selectedNodeId); updateUi() } })
controls.commitLog.addEventListener("click", () => {
    if (selectedNodeId === null || !controls.logCommand.value.trim()) return
    if (controller.proposeLogEntry(selectedNodeId, controls.logCommand.value.trim())) {
        controls.logCommand.setCustomValidity("")
        controls.logCommand.value = ""
    } else {
        controls.logCommand.setCustomValidity("No active leader is available. Retry after an election.")
        controls.logCommand.reportValidity()
    }
    updateUi()
})

controls.canvas.addEventListener("pointerdown", (event) => {
    const point = eventToCanvasPoint(event)
    const node = controller.getNodesSnapshot().find((item) => { const position = worldToScreen(item.x, item.y); return Math.hypot(position.x - point.x, position.y - point.y) <= 28 * devicePixelRatio })
    if (!node) { selectNode(null); return }
    if (selectedNodeId === node.id) { selectNode(null); return }
    selectNode(node.id); controls.canvas.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => { const cursor = eventToCanvasPoint(moveEvent); const box = viewBox(); controller.moveNode(node.id, Math.max(0, Math.min(WORLD_SIZE, (cursor.x - box.marginX) / box.scale)), Math.max(0, Math.min(WORLD_SIZE, (cursor.y - box.marginY) / box.scale))) }
    const stop = () => { controls.canvas.removeEventListener("pointermove", move); controls.canvas.removeEventListener("pointerup", stop); controls.canvas.removeEventListener("pointercancel", stop) }
    controls.canvas.addEventListener("pointermove", move); controls.canvas.addEventListener("pointerup", stop); controls.canvas.addEventListener("pointercancel", stop)
})

window.addEventListener("resize", syncCanvasSize)
syncCanvasSize(); updateUi()
function frame() { drawScene(); updateUi(); requestAnimationFrame(frame) }
requestAnimationFrame(frame)
