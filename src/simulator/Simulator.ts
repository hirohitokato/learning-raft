import { VirtualClock } from "./../clock/VirtualClock"
import { RaftNode } from "./../nodes/RaftNode"
import type { Message } from "./../nodes/Message"
import { NetworkSimulator } from "./NetworkSimulator"

export class Simulator {
    readonly clock = new VirtualClock()

    readonly nodes = new Map<number, RaftNode>()

    readonly network = new NetworkSimulator(this.clock, { speed: 10 })

    constructor(nodeCount: number) {
        for (let i = 0; i < nodeCount; i++) {
            const peers = []

            for (let j = 0; j < nodeCount; j++) {
                if (i !== j) {
                    peers.push(j)
                }
            }

            const node = new RaftNode(
                i,
                peers,
                this.clock,
                (message: Message) => {
                    this.network.send(message)
                },
                150,
            ) // 各Election Timeoutを150ms〜300ms未満で再抽選

            this.nodes.set(i, node)
            this.network.registerNode(i, { x: i * 100, y: (i % 2) * 80 }, (message: Message) => {
                node.receive(message)
            })
        }
    }

    start(): void {
        for (const node of this.nodes.values()) {
            node.start()
        }
    }

    run(): void {
        this.clock.run()
    }
}
