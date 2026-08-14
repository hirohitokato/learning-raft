export type LogEntry = {
    term: number
    command: unknown
}

export type RequestVote = {
    type: "RequestVote"
    from: number
    to: number
    term: number

    lastLogIndex: number
    lastLogTerm: number
}

export type RequestVoteResponse = {
    type: "RequestVoteResponse"
    from: number
    to: number
    term: number
    voteGranted: boolean
}

export type AppendEntries = {
    type: "AppendEntries"
    from: number
    to: number

    term: number

    /**
     * Leaderが「このLogの次から送る」と示すための
     * 直前のLog情報。
     */
    prevLogIndex: number
    prevLogTerm: number

    /**
     * 空配列ならHeartbeat。
     */
    entries: LogEntry[]

    /**
     * Leaderが現在commit済みと考えているindex。
     */
    leaderCommit: number
}

export type AppendEntriesResponse = {
    type: "AppendEntriesResponse"
    from: number
    to: number

    term: number

    /**
     * AppendEntriesが成功したか。
     */
    success: boolean

    /**
     * 成功した場合、どのindexまで複製できたか。
     *
     * 失敗時は -1 などでよい。
     */
    matchIndex: number
}

export type Message = RequestVote | RequestVoteResponse | AppendEntries | AppendEntriesResponse
