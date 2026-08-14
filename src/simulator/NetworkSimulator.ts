import { VirtualClock } from "../clock/VirtualClock"
import type { Message } from "../nodes/Message"

type Position = {
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

    /**
     * Node ID → 位置
     *
     * ここで管理する座標は RaftNode の状態ではない。
     * RaftNode は「自分がどこにいるか」を知る必要はなく、
     * その情報はネットワーク層がグローバルに持つことで、
     * 物理距離と伝播遅延を計算できるようにしている。
     */
    private readonly positions = new Map<number, Position>()

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
        this.receivers.set(id, receiver)
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

        this.clock.schedule(latencyMs, () => {
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

export type { Position, NetworkConfig }
