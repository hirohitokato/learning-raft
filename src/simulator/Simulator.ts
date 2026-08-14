import { VirtualClock } from "./../clock/VirtualClock"
import { RaftNode } from "./../nodes/RaftNode"
import type { Message } from "./../nodes/Message"

export class Simulator {
    readonly clock = new VirtualClock()

    readonly nodes = new Map<number, RaftNode>()

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
                    this.send(message)
                },
                Math.floor(Math.random() * 150) + 150,
            ) // 150ms〜300msの範囲でランダムに選挙タイムアウトを設定
            this.nodes.set(i, node)
        }
    }

    start(): void {
        for (const node of this.nodes.values()) {
            node.start()
        }
    }

    private send(message: Message): void {
        // 今は通信遅延なし
        this.clock.schedule(0, () => {
            const receiver = this.nodes.get(message.to)
            if (!receiver) {
                return
            }
            receiver.receive(message)
        })
    }

    run(): void {
        this.clock.run()
    }
}
