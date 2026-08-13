// RaftのState Machineを表す型
import { VirtualClock } from "../clock/VirtualClock"

/// Raftノードの状態一覧
export type RaftState = "follower" | "candidate" | "leader"

export type Message = RequestVote | RequestVoteResponse

export type RequestVote = {
    type: "RequestVote"
    from: number
    to: number
    /// 要求元のノードの現在の任期
    term: number
}

export type RequestVoteResponse = {
    type: "RequestVoteResponse"
    from: number
    to: number
    /// 要求元のノードの現在の任期
    term: number
    /// 投票が許可されたかどうか
    voteGranted: boolean
}

export type SendMessage = (message: Message) => void

export class RaftNode {
    /// ノードの識別子
    readonly id: number
    readonly peers: number[]

    clock: VirtualClock
    private sendMessage: SendMessage

    /// ノードの現在の状態
    state: RaftState = "follower"

    /// ノードの現在の任期
    currentTerm: number = 0
    /// 現在の任期で投票を受けた候補者（いない場合はnull）
    votedFor: number | null = null


    /// 投票を受けたノードのIDの一覧。重複を避けるためにSetを使用
    votesReceived: Set<number> = new Set()

    private electionTimeoutId: number | null = null

    private readonly electionTimeoutMs

    constructor(id: number, peers: number[], clock: VirtualClock, sendMessage: SendMessage, electionTimeoutMs: number) {
        this.id = id
        this.peers = peers
        this.clock = clock
        this.sendMessage = sendMessage
        this.electionTimeoutMs = electionTimeoutMs
    }

    start(): void {
        this.log(`started as a ${this.state}`)
        this.resetElectionTimer()
    }

    private onElectionTimeout(): void {
        if (this.state === "leader") {
            return
        }
        this.log(`election timeout, starting election`)
        this.startElection()
    }

    /** メッセージの受信とディスパッチ */
    receive(message: Message): void {
        switch (message.type) {
            case "RequestVote":
                this.handleRequestVote(message)
                break
            case "RequestVoteResponse":
                this.handleRequestVoteResponse(message)
                break
        }
    }

    private handleRequestVote(message: RequestVote): void {
        if (message.term < this.currentTerm) {
            // 古い任期のRequestVoteは拒否
            const response: RequestVoteResponse = {
                type: "RequestVoteResponse",
                from: this.id,
                to: message.from,
                term: this.currentTerm,
                voteGranted: false
            }
            this.sendMessage(response)
            return
        }
        
        // 任期が新しい場合は、自分の任期を更新し、フォロワーに戻る
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term
            this.state = "follower"
            this.votedFor = null
        }

        let voteGranted = false

        if (this.votedFor === null || this.votedFor === message.from) {
            // まだ投票していない、または同じ候補者に投票している場合は投票を許可
            voteGranted = true
            this.votedFor = message.from
            this.resetElectionTimer() // 投票したので、選挙タイマーをリセット
        }

        const response: RequestVoteResponse = {
            type: "RequestVoteResponse",
            from: this.id,
            to: message.from,
            term: this.currentTerm,
            voteGranted: voteGranted
        }
        this.sendMessage(response)

        this.log(`received RequestVote from Node #${message.from} for term ${message.term}, vote: ${voteGranted}`)
    }

    private handleRequestVoteResponse(message: RequestVoteResponse): void {
        // 応答の任期が自分の任期より古い場合は無視
        if (message.term < this.currentTerm) {
            return
        }
        
        // 応答の任期が自分の任期より新しい場合は、自分の任期を更新し、フォロワーに戻る
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term
            this.state = "follower"
            this.votedFor = null
            this.votesReceived.clear()
            this.resetElectionTimer()

            return
        }

        // Candidate以外には応答を処理しない
        if (this.state !== "candidate") {
            return
        }

        if (message.voteGranted) {
            this.votesReceived.add(message.from)
            this.log(`received vote from Node #${message.from}, total votes: ${this.votesReceived.size}`)
            this.checkElectionResult()
        }
    }

    /// 過半数の票を獲得したかどうかをチェックする
    private checkElectionResult(): void {
        const clusterSize = this.peers.length + 1 // 自分自身を含める
        const majority = Math.floor(clusterSize / 2) + 1 // 過半数の計算

        if (this.votesReceived.size >= majority) {
            this.becomeLeader()
        }
    }

    private becomeLeader(): void {
        if (this.state === "leader") {
            return
        }
        this.state = "leader"
        this.log(`became leader for term ${this.currentTerm}`)
        // リーダーになったら、選挙タイマーを停止する
        if (this.electionTimeoutId !== null) {
            this.clock.cancel(this.electionTimeoutId)
            this.electionTimeoutId = null
        }
    }

    private startElection(): void {
        this.state = "candidate"
        this.currentTerm++
        // 自分自身に投票する
        this.votedFor = this.id
        this.votesReceived.clear()
        this.votesReceived.add(this.id)
        this.log(`started election for term ${this.currentTerm}`)
        this.resetElectionTimer()

        // 他のノードにRequestVoteを送信する
        for (const peer of this.peers) {
            const message: RequestVote = {
                type: "RequestVote",
                from: this.id,
                to: peer,
                term: this.currentTerm
            }
            this.sendMessage(message)
        }

        // 自分自身の表だけで過半数になった場合
        this.checkElectionResult()
    }

    private resetElectionTimer(): void {
        if (this.electionTimeoutId !== null) {
            this.clock.cancel(this.electionTimeoutId)
        }
        this.electionTimeoutId = this.clock.schedule(
            this.electionTimeoutMs,
            () => {
                this.log(`election timeout`)
                this.electionTimeoutId = null
                this.onElectionTimeout()
            }
        )
    }

    private log(message: string): void {
        console.log(`[${this.clock.now}] Node #${this.id} (${this.state}, term ${this.currentTerm}): ${message}`)
    }
}
