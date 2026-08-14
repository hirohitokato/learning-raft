import { VirtualClock } from "../clock/VirtualClock"
import type { Message } from "../nodes/Message"

export type Position = {
    x: number
    y: number
}

type NetworkConfig = {
    /**
     * メッセージの伝播速度。
     *
     * 例:
     *   座標 = km
     *   speed = km / ms
     */
    speed: number
}

export class NetworkSimulator {
    private readonly clock: VirtualClock
    private readonly config: NetworkConfig

    /**
     * Node ID → 実際のRaftNodeへの配送関数
     *
     * RaftNode は「どこに届くか」よりも「このメッセージを受け取った」という事実だけを知ればよい。
     * そのため、ネットワーク層が各ノードの受信口を配置し、メッセージが到着した際に
     * そのノードの receive() を呼び出す責務を持つ。
     */
    private readonly receivers = new Map<number, (message: Message) => void>()
    private readonly nodeStates = new Map<number, boolean>()

    /**
     * Node ID → 位置
     *
     * ここで管理する座標は RaftNode の状態ではない。
     * RaftNode は「自分がどこにいるか」を知る必要はなく、
     * その情報はネットワーク層がグローバルに持つことで、
     * 物理距離と伝播遅延を計算できるようにしている。
     */
    private readonly positions = new Map<number, Position>()

    private nextMessageId = 0

    private readonly activeMessages: Array<{
        id: number
        type: string
        from: number
        to: number
        startedAt: number
        endedAt: number
        fromPosition: Position
        toPosition: Position
    }> = []

    constructor(clock: VirtualClock, config: NetworkConfig) {
        this.clock = clock
        this.config = config
    }

    /**
     * ノードをネットワークに登録する。
     *
     * position は、そのノードが仮想空間でどこにいるかを表す。
     * receiver は最終的にそのノードがメッセージを処理する関数。
     */
    registerNode(id: number, position: Position, receiver: (message: Message) => void): void {
        this.positions.set(id, position)
        this.nodeStates.set(id, true)
        this.receivers.set(id, (message: Message) => {
            if (this.nodeStates.get(id) === false) {
                return
            }

            receiver(message)
        })
    }

    unregisterNode(id: number): void {
        this.positions.delete(id)
        this.receivers.delete(id)
        this.nodeStates.delete(id)
    }

    setNodeActive(id: number, active: boolean): void {
        this.nodeStates.set(id, active)
    }

    setSpeed(speed: number): void {
        this.config.speed = Math.max(1, Number(speed) || 1)
    }

    getNodePosition(id: number): Position | undefined {
        return this.positions.get(id)
    }

    getActiveMessages(): Array<{
        id: number
        type: string
        from: number
        to: number
        progress: number
        fromPosition: Position
        toPosition: Position
    }> {
        return this.activeMessages.map((message) => {
            const duration = Math.max(1, message.endedAt - message.startedAt)
            const progress = Math.min(1, Math.max(0, (this.clock.now - message.startedAt) / duration))

            return {
                id: message.id,
                type: message.type,
                from: message.from,
                to: message.to,
                progress,
                fromPosition: message.fromPosition,
                toPosition: message.toPosition,
            }
        })
    }

    /**
     * メッセージを送信する。
     *
     * ここでは伝送時間を「距離 / 伝播速度」で計算し、
     * VirtualClock に遅延イベントとして予約する。
     *
     * これにより、RaftNode から見えるのは「非同期に届く」という抽象だけで、
     * ネットワークの物理モデルは一箇所に閉じ込められる。
     */
    send(message: Message): void {
        const from = this.positions.get(message.from)
        const to = this.positions.get(message.to)

        if (!from) {
            throw new Error(`Unknown source node: ${message.from}`)
        }

        if (!to) {
            throw new Error(`Unknown destination node: ${message.to}`)
        }

        const distance = this.distance(from, to)
        const latencyMs = distance / this.config.speed
        const deliveryTime = this.clock.now + latencyMs

        console.log(
            `[${this.clock.now}] ` +
                `Node #${message.from} -> ` +
                `Node #${message.to}, ` +
                `distance=${distance.toFixed(2)}, ` +
                `latency=${latencyMs.toFixed(2)}ms, ` +
                `delivery=${deliveryTime.toFixed(2)}`,
        )

        const activeMessage = {
            id: this.nextMessageId++,
            type: message.type,
            from: message.from,
            to: message.to,
            startedAt: this.clock.now,
            endedAt: deliveryTime,
            fromPosition: from,
            toPosition: to,
        }

        this.activeMessages.push(activeMessage)

        this.clock.schedule(latencyMs, () => {
            this.activeMessages.splice(
                this.activeMessages.findIndex((entry) => entry.id === activeMessage.id),
                1,
            )

            const receiver = this.receivers.get(message.to)

            if (!receiver) {
                return
            }

            receiver(message)
        })
    }

    /**
     * 2点間の距離をユークリッド距離で計算する。
     *
     * 実際のネットワークでは経路や障害物が影響するが、
     * このシミュレータではシンプルに「座標差の二乗和の平方根」で表現する。
     */
    private distance(a: Position, b: Position): number {
        const dx = a.x - b.x
        const dy = a.y - b.y

        return Math.sqrt(dx * dx + dy * dy)
    }
}
