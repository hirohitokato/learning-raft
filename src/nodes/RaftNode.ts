import { VirtualClock } from "../clock/VirtualClock"
import type {
    LogEntry,
    AppendEntries,
    AppendEntriesResponse,
    Message,
    RequestVote,
    RequestVoteResponse,
} from "./Message"

/**
 * Raftノードの状態。
 *
 * follower   : 通常状態。LeaderからのHeartbeatを待つ。
 * candidate  : Leader選出に立候補している状態。
 * leader     : 現在のLeader。
 */
export type RaftState = "follower" | "candidate" | "leader"

export type SendMessage = (message: Message) => void

export class RaftNode {
    /// ノードの識別子
    readonly id: number

    /**
     * 自分以外のRaftNodeのID一覧。
     *
     * 例:
     *   Node 0 の peers = [1, 2]
     */
    readonly peers: readonly number[]

    /**
     * シミュレーション用の仮想時計。
     *
     * RaftNode自身は実時間を直接扱わず、
     * VirtualClockを通してタイマーを制御する。
     */
    private readonly clock: VirtualClock

    /**
     * ネットワークへのメッセージ送信関数。
     *
     * RaftNode自身はネットワークの実装を知らない。
     * 実際の送信や遅延・パケットロスなどはSimulator側で処理する。
     */
    private readonly sendMessage: SendMessage

    // ============================================================
    // Raftの基本状態
    // ============================================================

    /// ノードの現在の状態
    state: RaftState = "follower"

    /**
     * ノードが知っている最新のTerm。
     *
     * TermはRaftにおける「任期」のようなもの。
     * より大きなTermを見つけたら、自分のTermを更新する。
     */
    currentTerm = 0

    /**
     * 現在のTermで投票した相手。
     *
     * 1つのTermにつき最大1回しか投票しない。
     * まだ投票していない場合はnull。
     */
    votedFor: number | null = null

    /**
     * Raft Log。
     *
     * log[0], log[1], ... のように配列のindexが
     * Raft上のlog indexになる。
     */
    logs: LogEntry[] = []

    /**
     * Leaderとして「コミット済み」と判断しているLogの最後のindex。
     *
     * commitIndexまでは過半数のノードに複製されたことが確認されている。
     *
     * 空のLogの場合は -1。
     */
    commitIndex = -1

    /**
     * State Machineへ適用済みのLogの最後のindex。
     *
     * 現時点ではState Machine自体を実装していないため、
     * commitIndexに追従させるところまでを担当する。
     */
    lastApplied = -1

    // ============================================================
    // Candidate用の状態
    // ============================================================

    /**
     * 現在のElectionで獲得した票。
     *
     * 自分自身の票も含む。
     */
    private readonly votesReceived = new Set<number>()

    // ============================================================
    // Leader用の状態
    // ============================================================

    /**
     * Leaderが各Followerに対して、
     * 「次に送信すべきLogのindex」を記録する。
     *
     * nextIndex[followerId] = 次に送るLog index
     *
     * 例えば:
     * - Leader: [0] [1] [2] [3] [4]
     * - Follower: [0] [1]
     * なら、 `nextIndex[follower] = 2` となる。
     */
    private readonly nextIndex = new Map<number, number>()

    /**
     * Leaderが各Followerについて、どのLog indexまで複製できたかを記録する。
     *
     * matchIndex[followerId] = そのFollowerに複製済みの最後のindex
     *
     * まだ一度も複製成功していない場合は -1。
     */
    private readonly matchIndex = new Map<number, number>()

    // ============================================================
    // Timer
    // ============================================================

    /**
     * LeaderがFollowerへ定期的に送るHeartbeatのタイマーID。
     */
    private heartbeatTimeoutId: number | null = null

    /**
     * Heartbeatの送信間隔。Election Timeoutより十分短くする必要がある。
     */
    private readonly heartbeatIntervalMs = 100

    /**
     * Election TimeoutのタイマーID。
     */
    private electionTimeoutId: number | null = null

    /**
     * Election Timeout。
     *
     * この値はNodeごとに異なる値を渡すことを推奨。実際のRaftではランダム化する。
     */
    private readonly electionTimeoutMs: number

    // ============================================================
    // 状態
    // ============================================================

    active = true
    private started = false
    private pausedElectionRemaining = 0
    private pausedElectionRatio = 0
    private electionDeadline: number | null = null
    private lastElectionStartedAt = 0

    constructor(
        id: number,
        peers: readonly number[],
        clock: VirtualClock,
        sendMessage: SendMessage,
        electionTimeoutMs: number,
    ) {
        this.id = id
        this.peers = peers
        this.clock = clock
        this.sendMessage = sendMessage
        this.electionTimeoutMs = electionTimeoutMs
    }

    // ============================================================
    // Node lifecycle
    // ============================================================

    /**
     * RaftNodeを起動する。
     *
     * 起動時はFollowerとしてElection Timeoutを待つ。
     */
    start(): void {
        if (!this.active) {
            return
        }

        if (this.started) {
            return
        }

        this.started = true

        this.log(`started as a ${this.state}`)

        this.resetElectionTimer()
    }

    setActive(active: boolean): void {
        if (this.active === active) {
            return
        }

        this.active = active

        if (!this.active) {
            this.stopHeartbeat()
            this.stopElectionTimer()
            this.pausedElectionRemaining = this.getTimerSnapshot().remaining
            this.pausedElectionRatio = this.getTimerSnapshot().ratio
            this.electionDeadline = null
            return
        }

        this.pausedElectionRemaining = 0
        this.pausedElectionRatio = 0
        this.resetElectionTimer()

        if (this.state === "leader") {
            this.scheduleNextHeartbeat()
        }
    }

    getTimerSnapshot(): { remaining: number; ratio: number } {
        if (!this.active) {
            return {
                remaining: this.pausedElectionRemaining,
                ratio: this.pausedElectionRatio,
            }
        }

        if (this.electionDeadline === null) {
            return {
                remaining: 0,
                ratio: 0,
            }
        }

        const remaining = Math.max(0, this.electionDeadline - this.clock.now)
        const ratio = this.electionTimeoutMs <= 0 ? 0 : remaining / this.electionTimeoutMs

        return {
            remaining,
            ratio: Math.min(1, Math.max(0, ratio)),
        }
    }

    // ============================================================
    // Message handling
    // ============================================================

    /**
     * メッセージを受信して適切なハンドラへディスパッチする。
     */
    receive(message: Message): void {
        if (!this.active) {
            return
        }

        switch (message.type) {
            case "RequestVote":
                this.handleRequestVote(message)
                break

            case "RequestVoteResponse":
                this.handleRequestVoteResponse(message)
                break

            case "AppendEntries":
                this.handleAppendEntries(message)
                break

            case "AppendEntriesResponse":
                this.handleAppendEntriesResponse(message)
                break
        }
    }

    // ============================================================
    // RequestVote
    // ============================================================

    /**
     * CandidateからのRequestVoteを処理する。
     *
     * RequestVoteでは、単純に「まだ投票していなければ投票」ではない。
     * CandidateのLogが自分のLog以上に新しいことも確認する。
     */
    private handleRequestVote(message: RequestVote): void {
        // --------------------------------------------------------
        // 古いTermからのRequestVoteは拒否する
        // --------------------------------------------------------
        if (message.term < this.currentTerm) {
            this.sendMessage({
                type: "RequestVoteResponse",
                from: this.id,
                to: message.from,
                term: this.currentTerm,
                voteGranted: false,
            })

            return
        }

        // --------------------------------------------------------
        // より新しいTermを見た
        //
        // 自分はそのTermより古い状態なので、まずTermを更新してFollowerへ戻る。
        // --------------------------------------------------------
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term
            this.votedFor = null

            this.becomeFollower()
        }

        // --------------------------------------------------------
        // CandidateのLogが自分以上に新しいか確認する。
        //
        // Raftでは、lastLogTermが大きい、またはlastLogTermが同じでlastLogIndexが大きい
        // Candidateを「up-to-date」とみなす。
        // --------------------------------------------------------
        const candidateLogIsUpToDate = this.isCandidateLogUpToDate(message.lastLogIndex, message.lastLogTerm)

        let voteGranted = false

        // --------------------------------------------------------
        // まだ投票していないか、すでにこのCandidateに投票していて、
        // さらにCandidateのLogが十分新しい場合のみ投票する。
        // --------------------------------------------------------
        if ((this.votedFor === null || this.votedFor === message.from) && candidateLogIsUpToDate) {
            voteGranted = true
            this.votedFor = message.from

            /**
             * Candidateを承認した場合「Leader候補が存在する」と考え、
             * Election Timeoutをリセットする。
             */
            this.resetElectionTimer()
        }

        const response: RequestVoteResponse = {
            type: "RequestVoteResponse",
            from: this.id,
            to: message.from,
            term: this.currentTerm,
            voteGranted,
        }
        this.sendMessage(response)

        this.log(
            `received RequestVote from Node #${message.from} ` + `for term ${message.term}, ` + `vote: ${voteGranted}`,
        )
    }

    /**
     * RequestVoteResponseを処理する。
     */
    private handleRequestVoteResponse(message: RequestVoteResponse): void {
        // --------------------------------------------------------
        // 古いTermからのResponseは無視
        // --------------------------------------------------------
        if (message.term < this.currentTerm) {
            return
        }

        // --------------------------------------------------------
        // より新しいTermを見たら、
        // 自分はそのTermより古いのでFollowerへ戻る。
        // --------------------------------------------------------
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term
            this.votedFor = null

            this.becomeFollower()

            return
        }

        // --------------------------------------------------------
        // Candidateでなければ選挙の票を処理する必要がない。
        // --------------------------------------------------------
        if (this.state !== "candidate") {
            return
        }

        if (!message.voteGranted) {
            return
        }

        // --------------------------------------------------------
        // 同じノードから重複してVoteが来てもSetなので1票として扱う。
        // --------------------------------------------------------
        this.votesReceived.add(message.from)

        this.log(`received vote from Node #${message.from}, ` + `total votes: ${this.votesReceived.size}`)

        this.checkElectionResult()
    }

    // ============================================================
    // AppendEntries
    // ============================================================

    /**
     * LeaderからのAppendEntries RPCを処理する。
     * AppendEntriesには2つの用途がある。
     *
     * 1. entriesが空 → Heartbeat
     * 2. entriesが存在 → Log replication
     */
    private handleAppendEntries(message: AppendEntries): void {
        // --------------------------------------------------------
        // 古いTermのLeaderは拒否する。
        // --------------------------------------------------------
        if (message.term < this.currentTerm) {
            this.sendAppendEntriesResponse(message, false, -1)

            return
        }

        // --------------------------------------------------------
        // より新しいTermなら自分のTermを更新。
        // --------------------------------------------------------
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term
            this.votedFor = null
        }

        /**
         * 《重要》
         * message.term === currentTerm でもAppendEntriesを送ってきたということは
         * 「このTermにはLeaderが存在する」ことを意味する。
         * したがってCandidateだったとしてもFollowerに戻る。
         */
        this.becomeFollower()

        /**
         * LeaderからHeartbeat / AppendEntriesを受信したので、
         * Election Timeoutをリセットする。
         */
        this.resetElectionTimer()

        // --------------------------------------------------------
        // Leaderが示している「直前のLog」が自分のLogと一致しているか確認する。
        //
        // prevLogIndex == -1 は「Leaderの直前Logは存在しない」。
        // つまりLogの先頭から追加することを意味する。
        // --------------------------------------------------------
        if (message.prevLogIndex >= 0) {
            if (message.prevLogIndex >= this.logs.length) {
                // 自分にはprevLogIndexまでのLogが存在しない
                this.sendAppendEntriesResponse(message, false, -1)

                return
            }

            const localEntry = this.logs[message.prevLogIndex]

            if (localEntry?.term !== message.prevLogTerm) {
                // indexは存在するがTermが一致しない
                this.sendAppendEntriesResponse(message, false, -1)

                return
            }
        }

        // --------------------------------------------------------
        // prevLogIndexより後ろにentriesを追加する。
        //
        // 途中のLogとTermが違う場合は、
        // そこから後ろを削除してLeaderのLogで置き換える。
        // --------------------------------------------------------
        let insertIndex = message.prevLogIndex + 1

        for (let i = 0; i < message.entries.length; i++) {
            const incomingEntry = message.entries[i]!

            if (insertIndex >= this.logs.length) {
                // 自分のLogがそこまで存在しない
                this.logs.push(incomingEntry)
            } else if (this.logs[insertIndex]!.term !== incomingEntry.term) {
                // 同じindexなのにTermが違う。
                //
                // RaftのLog Matchingに従い、
                // ここから後ろを削除する。
                this.logs.splice(insertIndex)

                this.logs.push(incomingEntry)
            }

            insertIndex++
        }

        // --------------------------------------------------------
        // LeaderのcommitIndexを受け取り、自分のcommitIndexを進める。
        //
        // ただしFollower自身のLog長以上には進めない。
        // --------------------------------------------------------
        if (message.leaderCommit > this.commitIndex) {
            this.commitIndex = Math.min(message.leaderCommit, this.logs.length - 1)

            this.applyCommittedEntries()
        }

        const matchIndex = message.prevLogIndex + message.entries.length

        // --------------------------------------------------------
        // Log追加成功を返信する。
        // --------------------------------------------------------
        this.sendAppendEntriesResponse(message, true, matchIndex)

        if (message.entries.length === 0) {
            this.log(`received heartbeat from Node #${message.from}`)
        } else {
            this.log(`received ${message.entries.length} log entries ` + `from Node #${message.from}`)
        }
    }

    /**
     * AppendEntriesResponseをLeader側で処理する。
     */
    private handleAppendEntriesResponse(message: AppendEntriesResponse): void {
        // --------------------------------------------------------
        // 古いTermからのResponseは無視
        // --------------------------------------------------------
        if (message.term < this.currentTerm) {
            return
        }

        // --------------------------------------------------------
        // より新しいTermを見たらFollowerへ降格する。
        // --------------------------------------------------------
        if (message.term > this.currentTerm) {
            this.currentTerm = message.term
            this.votedFor = null

            this.becomeFollower()

            return
        }

        // Leader以外がAppendEntriesResponseを受け取っても無視。
        if (this.state !== "leader") {
            return
        }

        if (message.success) {
            // ----------------------------------------------------
            // Followerに複製できた最大indexを記録する。
            // ----------------------------------------------------
            const currentMatchIndex = this.matchIndex.get(message.from) ?? -1

            this.matchIndex.set(message.from, Math.max(currentMatchIndex, message.matchIndex))

            // ----------------------------------------------------
            // 次回はその次のindexから送ればよい。
            // ----------------------------------------------------
            const newNextIndex = this.matchIndex.get(message.from)! + 1

            const currentNextIndex = this.nextIndex.get(message.from) ?? 0

            this.nextIndex.set(message.from, Math.max(currentNextIndex, newNextIndex))

            this.log(`Node #${message.from} replicated log ` + `up to index ${message.matchIndex}`)

            // ----------------------------------------------------
            // 過半数に複製されたLogがあればcommitIndexを進める。
            // ----------------------------------------------------
            this.updateCommitIndex()

            return
        }

        // --------------------------------------------------------
        // AppendEntries失敗。
        //
        // prevLogIndex / prevLogTermが一致しなかったので、nextIndexを1つ前へ戻して再送する。
        // 実際のRaft実装ではconflict情報を使ってもっと効率よく戻すこともできる。
        // --------------------------------------------------------
        const currentNextIndex = this.nextIndex.get(message.from) ?? 0

        const newNextIndex = Math.max(0, currentNextIndex - 1)

        this.nextIndex.set(message.from, newNextIndex)

        this.log(`AppendEntries to Node #${message.from} failed, ` + `decreasing nextIndex to ${newNextIndex}`)

        // --------------------------------------------------------
        // 失敗したので、正しいnextIndexで再送する。
        // --------------------------------------------------------
        this.sendAppendEntries(message.from)
    }

    /**
     * AppendEntriesResponseを送信する。
     */
    private sendAppendEntriesResponse(message: AppendEntries, success: boolean, matchIndex: number): void {
        const response: AppendEntriesResponse = {
            type: "AppendEntriesResponse",
            from: this.id,
            to: message.from,
            term: this.currentTerm,
            success,
            matchIndex,
        }

        this.sendMessage(response)
    }

    // ============================================================
    // Leader election
    // ============================================================

    /**
     * Election Timeoutが発生したときの処理。
     */
    private onElectionTimeout(): void {
        /**
         * LeaderはElection Timeoutを使わない。
         */
        if (this.state === "leader") {
            return
        }

        this.log(`election timeout, starting election`)

        this.startElection()
    }

    /**
     * CandidateとしてLeader選挙を開始する。
     */
    private startElection(): void {
        // --------------------------------------------------------
        // Candidateになる
        // --------------------------------------------------------
        this.state = "candidate"

        // --------------------------------------------------------
        // 新しいTermを開始
        // --------------------------------------------------------
        this.currentTerm++

        // --------------------------------------------------------
        // 自分自身に投票
        // --------------------------------------------------------
        this.votedFor = this.id

        // --------------------------------------------------------
        // 今回のElectionにおけるVoteをクリア
        // --------------------------------------------------------
        this.votesReceived.clear()
        this.votesReceived.add(this.id)

        this.log(`started election for term ${this.currentTerm}`)

        // --------------------------------------------------------
        // Election Timeoutを再設定。
        // 自分がLeaderになれなかった場合、
        // このElectionもタイムアウトする可能性がある。
        // --------------------------------------------------------
        this.resetElectionTimer()

        // --------------------------------------------------------
        // 自分の最新Log情報を付けてRequestVoteを送る。
        // --------------------------------------------------------
        const lastLogIndex = this.logs.length - 1

        const lastLogTerm = lastLogIndex >= 0 ? this.logs[lastLogIndex]!.term : 0

        for (const peer of this.peers) {
            const message: RequestVote = {
                type: "RequestVote",
                from: this.id,
                to: peer,
                term: this.currentTerm,

                lastLogIndex,
                lastLogTerm,
            }

            this.sendMessage(message)
        }

        // --------------------------------------------------------
        // 1ノードクラスタなど、
        // 自分自身だけで過半数となる場合に備える。
        // --------------------------------------------------------
        this.checkElectionResult()
    }

    /**
     * Electionが成功したかどうか(=過半数の票を得たか)を確認する。
     */
    private checkElectionResult(): void {
        const clusterSize = this.peers.length + 1

        const majority = Math.floor(clusterSize / 2) + 1

        if (this.votesReceived.size >= majority) {
            this.becomeLeader()
        }
    }

    /**
     * CandidateのLogが自分のLog以上に新しいか確認する。
     */
    private isCandidateLogUpToDate(candidateLastLogIndex: number, candidateLastLogTerm: number): boolean {
        const myLastLogIndex = this.logs.length - 1

        const myLastLogTerm = myLastLogIndex >= 0 ? this.logs[myLastLogIndex]!.term : 0

        // Candidateの最後のTermの方が新しい
        if (candidateLastLogTerm > myLastLogTerm) {
            return true
        }

        // Candidateの最後のTermの方が古い
        if (candidateLastLogTerm < myLastLogTerm) {
            return false
        }

        // Termが同じならindexを比較
        return candidateLastLogIndex >= myLastLogIndex
    }

    // ============================================================
    // Leader heartbeat / log replication
    // ============================================================

    /**
     * 全FollowerへAppendEntriesを送信する。
     *
     * entriesが空ならHeartbeat。
     * entriesが存在すればLog replication。
     */
    private sendHeartbeats(): void {
        if (this.state !== "leader") {
            return
        }

        for (const peer of this.peers) {
            this.sendAppendEntries(peer)
        }
    }

    /**
     * 指定FollowerへAppendEntriesを送信する。
     */
    private sendAppendEntries(peer: number): void {
        if (this.state !== "leader") {
            return
        }

        const nextIndex = this.nextIndex.get(peer) ?? this.logs.length

        /**
         * nextIndexの直前のLog。
         *
         * nextIndex = 0なら
         * prevLogIndex = -1
         * prevLogTerm = 0
         */
        const prevLogIndex = nextIndex - 1

        const prevLogTerm = prevLogIndex >= 0 ? this.logs[prevLogIndex]!.term : 0

        /**
         * nextIndexから末尾までを送る。
         *
         * 最初は全Logを送る単純な実装。
         * 後で1件ずつ送る方式などに最適化してもよい。
         */
        const entries = this.logs.slice(nextIndex)

        const message: AppendEntries = {
            type: "AppendEntries",

            from: this.id,
            to: peer,

            term: this.currentTerm,

            prevLogIndex,
            prevLogTerm,

            entries,

            leaderCommit: this.commitIndex,
        }

        this.sendMessage(message)
    }

    /**
     * 次回Heartbeatをスケジュールする。
     */
    private scheduleNextHeartbeat(): void {
        this.stopHeartbeat()

        this.heartbeatTimeoutId = this.clock.schedule(this.heartbeatIntervalMs, () => {
            this.heartbeatTimeoutId = null

            if (this.state !== "leader") {
                return
            }

            // Heartbeat兼Log replication
            this.sendHeartbeats()

            // 次回Heartbeatを予約
            this.scheduleNextHeartbeat()
        })
    }

    /**
     * Heartbeat Timerを停止する。
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimeoutId !== null) {
            this.clock.cancel(this.heartbeatTimeoutId)

            this.heartbeatTimeoutId = null
        }
    }

    // ============================================================
    // Commit
    // ============================================================

    /**
     * LeaderがCommit可能なLog indexを探してcommitIndexを更新する。
     *
     * Raftでは、「過半数のノードに複製された」だけではなく、「Leader自身のcurrentTermのLog」
     * であることを確認してcommitする。
     */
    private updateCommitIndex(): void {
        if (this.state !== "leader") {
            return
        }

        for (let index = this.logs.length - 1; index > this.commitIndex; index--) {
            // ----------------------------------------------------
            // 自分自身は常にそのLogを持っているため1票。
            // ----------------------------------------------------
            let replicatedCount = 1

            for (const peer of this.peers) {
                const match = this.matchIndex.get(peer) ?? -1

                if (match >= index) {
                    replicatedCount++
                }
            }

            const majority = Math.floor((this.peers.length + 1) / 2) + 1

            /**
             * 現在のTermでLeaderが作成したLogだけを
             * この条件でcommitする。
             *
             * これはRaftの重要な安全性条件。
             */
            if (replicatedCount >= majority && this.logs[index]!.term === this.currentTerm) {
                this.commitIndex = index

                this.log(`commitIndex advanced to ${index}`)

                this.applyCommittedEntries()

                return
            }
        }
    }

    /**
     * commit済みだが、まだState Machineへ適用していないLogを処理する。
     *
     * ※現時点ではState Machine自体を実装していないため、lastAppliedを進めるだけ。
     */
    private applyCommittedEntries(): void {
        while (this.lastApplied < this.commitIndex) {
            this.lastApplied++

            const entry = this.logs[this.lastApplied]!

            this.log(`applied log index ` + `${this.lastApplied}, ` + `term=${entry.term}`)

            // TODO:
            // State Machineへcommandを適用する。
            //
            // this.stateMachine.apply(entry.command)
        }
    }

    // ============================================================
    // Role transition
    // ============================================================

    /**
     * Leaderになる。
     */
    private becomeLeader(): void {
        if (this.state === "leader") {
            return
        }

        this.state = "leader"

        this.log(`became leader for term ${this.currentTerm}`)

        // --------------------------------------------------------
        // CandidateのElection Timerを止める。
        // LeaderはElection Timeoutを待たない。
        // --------------------------------------------------------
        this.stopElectionTimer()

        // --------------------------------------------------------
        // Candidate用のVote情報は不要になる。
        // --------------------------------------------------------
        this.votesReceived.clear()

        // --------------------------------------------------------
        // Leaderになった瞬間に、
        // 全Followerに対して「次に送るLog index」を初期化する。
        //
        // まだ何も送っていないので、
        // nextIndex = 自分のLogの末尾+1。
        // --------------------------------------------------------
        const next = this.logs.length

        for (const peer of this.peers) {
            this.nextIndex.set(peer, next)
            this.matchIndex.set(peer, -1)
        }

        // --------------------------------------------------------
        // LeaderになったことをすぐFollowerへ通知する。
        // → これが最初のHeartbeatになる。
        // --------------------------------------------------------
        this.sendHeartbeats()

        // --------------------------------------------------------
        // 定期Heartbeatを開始する。
        // --------------------------------------------------------
        this.scheduleNextHeartbeat()
    }

    /**
     * Followerへ戻る。
     */
    private becomeFollower(newTerm?: number): void {
        if (newTerm !== undefined && newTerm > this.currentTerm) {
            this.currentTerm = newTerm
            this.votedFor = null
        }

        this.state = "follower"

        // Candidate用のVote情報は不要。
        this.votesReceived.clear()

        // Leader用Timerが残っていれば停止。
        this.stopHeartbeat()

        // Followerとして新しいElection Timeoutを開始。
        this.resetElectionTimer()
    }

    // ============================================================
    // Election timer
    // ============================================================

    /**
     * Election Timerをリセットする。
     *
     * 既にTimerが存在する場合はキャンセルしてから新しいTimerを登録する。
     */
    private resetElectionTimer(): void {
        if (!this.active) {
            return
        }

        this.stopElectionTimer()
        this.lastElectionStartedAt = this.clock.now
        this.electionDeadline = this.clock.now + this.electionTimeoutMs

        this.electionTimeoutId = this.clock.schedule(this.electionTimeoutMs, () => {
            this.electionTimeoutId = null
            this.electionDeadline = null

            this.log(`election timeout`)

            this.onElectionTimeout()
        })
    }

    /**
     * Election Timerを停止する。
     */
    private stopElectionTimer(): void {
        if (this.electionTimeoutId !== null) {
            this.clock.cancel(this.electionTimeoutId)

            this.electionTimeoutId = null
        }
    }

    // ============================================================
    // Debug / logging
    // ============================================================

    /**
     * シミュレーション用ログ。
     *
     * 仮想時間、Node ID、State、Termを必ず出すことで、
     * Raftの状態遷移を追いやすくする。
     */
    private log(message: string): void {
        console.log(
            `[${this.clock.now}] ` + `Node #${this.id} ` + `(${this.state}, term ${this.currentTerm}): ` + `${message}`,
        )
    }
}
