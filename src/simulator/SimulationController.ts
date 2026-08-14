import { VirtualClock } from "../clock/VirtualClock"
import { RaftNode } from "../nodes/RaftNode"
import type { Message } from "../nodes/Message"
import { NetworkSimulator } from "./NetworkSimulator"

export type SimulationConfig = {
    nodeCount?: number
    communicationSpeed?: number
    timeStepMs?: number
    simulationSpeed?: number
    randomSeed?: number
}

export type SimulationNode = {
    id: number
    x: number
    y: number
    state: "follower" | "candidate" | "leader"
    currentTerm: number
    votedFor: number | null
    commitIndex: number
    lastApplied: number
    logs: Array<{ term: number; command: unknown }>
    voteCount: number
    isActive: boolean
    remainingElectionTime: number
    timerRemainingRatio: number
}

export class SimulationController {
    clock = new VirtualClock()
    readonly nodes: RaftNode[] = []
    network: NetworkSimulator

    private config: Required<SimulationConfig>
    private _running = false
    private animationFrame?: ReturnType<typeof setInterval>
    private lastTickAt = Date.now()

    constructor(config: SimulationConfig = {}) {
        this.config = {
            nodeCount: config.nodeCount ?? 5,
            communicationSpeed: config.communicationSpeed ?? 1,
            timeStepMs: config.timeStepMs ?? 5,
            simulationSpeed: config.simulationSpeed ?? 1,
            randomSeed: config.randomSeed ?? Date.now(),
        }

        this.network = new NetworkSimulator(this.clock, { speed: this.config.communicationSpeed })
        this.buildNodes(this.config.nodeCount)
    }

    get nodeCount(): number {
        return this.nodes.length
    }

    get running(): boolean {
        return this._running
    }

    get timeStepMs(): number {
        return this.config.timeStepMs
    }

    get communicationSpeed(): number {
        return this.config.communicationSpeed
    }

    get simulationSpeed(): number {
        return this.config.simulationSpeed
    }

    get simulationTime(): number {
        return this.clock.now
    }

    setNodeCount(nextCount: number): void {
        const count = Math.max(1, Math.floor(nextCount))
        this.config.nodeCount = count
        this.reset(count)
    }

    setCommunicationSpeed(speed: number): void {
        const value = Math.max(1, Number(speed) || 1)
        this.config.communicationSpeed = value
        this.network.setSpeed(value)
    }

    setTimeStepMs(stepMs: number): void {
        this.config.timeStepMs = Math.max(1, Number(stepMs) || 1)
    }

    setSimulationSpeed(speed: number): void {
        const value = Number(speed)
        this.config.simulationSpeed = Math.max(0.1, Number.isFinite(value) ? value : 1)
        if (this._running) {
            this.pause()
            this.start()
        }
    }

    start(): void {
        if (this._running) {
            return
        }

        this._running = true
        this.lastTickAt = Date.now()

        for (const node of this.nodes) {
            node.start()
        }

        this.animationFrame = setInterval(() => {
            this.advance(this.config.timeStepMs)
            this.lastTickAt = Date.now()
        }, 100 / this.config.simulationSpeed)
    }

    pause(): void {
        this._running = false
        if (this.animationFrame !== undefined) {
            clearInterval(this.animationFrame)
            this.animationFrame = undefined
        }
    }

    toggle(): void {
        if (this._running) {
            this.pause()
        } else {
            this.start()
        }
    }

    advance(ms: number): void {
        const target = this.clock.now + Math.max(0, ms)
        this.clock.runUntil(target)
    }

    getNodeSnapshot(id: number): SimulationNode | undefined {
        const node = this.nodes.find((candidate) => candidate.id === id)
        if (!node) {
            return undefined
        }

        const baseState = this.network.getNodePosition(id)
        const timerSnapshot = node.getTimerSnapshot()

        return {
            id: node.id,
            x: baseState?.x ?? 0,
            y: baseState?.y ?? 0,
            state: node.state,
            currentTerm: node.currentTerm,
            votedFor: node.votedFor,
            commitIndex: node.commitIndex,
            lastApplied: node.lastApplied,
            logs: node.logs.map((entry) => ({ term: entry.term, command: entry.command })),
            voteCount: node.state === "candidate" ? node["votesReceived"]?.size ?? 0 : 0,
            isActive: node.active,
            remainingElectionTime: timerSnapshot.remaining,
            timerRemainingRatio: timerSnapshot.ratio,
        }
    }

    getNodesSnapshot(): SimulationNode[] {
        return this.nodes.map((node) => this.getNodeSnapshot(node.id)!).filter(Boolean)
    }

    resetNode(id: number): void {
        const node = this.nodes.find((candidate) => candidate.id === id)
        if (!node) {
            return
        }

        node.reset()
    }

    setNodeActive(id: number, active: boolean): void {
        const node = this.nodes.find((candidate) => candidate.id === id)
        if (!node) {
            return
        }

        node.setActive(active)
        this.network.setNodeActive(id, active)

        if (active) {
            node.start()
        }
    }

    proposeLogEntry(sourceNodeId: number, command: unknown): boolean {
        const source = this.nodes.find((node) => node.id === sourceNodeId)
        if (!source?.active) {
            return false
        }

        const leader = this.nodes.find((node) => node.active && node.state === "leader")
        return leader?.propose(command) ?? false
    }

    reset(count = this.config.nodeCount): void {
        const wasRunning = this._running
        this.pause()
        this.clock = new VirtualClock()
        this.network = new NetworkSimulator(this.clock, { speed: this.config.communicationSpeed })
        this.nodes.length = 0
        this.buildNodes(count)

        if (wasRunning) {
            this.start()
        }
    }

    moveNode(id: number, x: number, y: number): void {
        const node = this.nodes.find((candidate) => candidate.id === id)
        if (!node) {
            return
        }

        this.network.registerNode(id, { x, y }, (message: Message) => {
            node.receive(message)
        })
    }

    getActiveMessages() {
        const elapsed = this._running
            ? Math.min(1, (Date.now() - this.lastTickAt) / (100 / this.config.simulationSpeed))
            : 0
        return this.network.getActiveMessages(this.clock.now + this.config.timeStepMs * elapsed)
    }

    private buildNodes(count: number): void {
        this.nodes.length = 0

        for (let i = 0; i < count; i++) {
            const peers = Array.from({ length: count }, (_, idx) => idx).filter((idx) => idx !== i)

            const node = new RaftNode(
                i,
                peers,
                this.clock,
                (message: Message) => {
                    this.network.send(message)
                },
                Math.floor(Math.random() * 150) + 150,
            )

            this.nodes.push(node)
            this.network.registerNode(i, {
                x: Math.random() * 90 + 5,
                y: Math.random() * 90 + 5,
            }, (message: Message) => {
                node.receive(message)
            })
        }
    }

    private getNodeTimerRemaining(node: RaftNode): number {
        const timer = node.getTimerSnapshot()
        return timer.remaining
    }

    private getNodeTimerRatio(node: RaftNode): number {
        const timer = node.getTimerSnapshot()
        return timer.ratio
    }
}
