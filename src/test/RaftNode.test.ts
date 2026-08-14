import { describe, expect, test } from "bun:test"
import { VirtualClock } from "../clock/VirtualClock"
import { RaftNode } from "../nodes/RaftNode"
import type { Message } from "../nodes/Message"

describe("RaftNode log replication", () => {
    test("commits after a majority replicates and followers apply on the next heartbeat", () => {
        const clock = new VirtualClock()
        const messages: Message[] = []
        const nodes = new Map<number, RaftNode>()
        const deliver = () => {
            while (messages.length) {
                const message = messages.shift()!
                nodes.get(message.to)?.receive(message)
            }
        }

        for (const [id, timeout] of [100, 200, 300].entries()) {
            nodes.set(id, new RaftNode(id, [0, 1, 2].filter((peer) => peer !== id), clock, (message) => messages.push(message), timeout, () => 0))
            nodes.get(id)!.start()
        }

        clock.runUntil(100)
        deliver()

        const leader = nodes.get(0)!
        expect(leader.state).toBe("leader")
        expect(leader.propose("set x=1")).toBe(true)
        expect(leader.commitIndex).toBe(-1)

        deliver()
        expect(leader.commitIndex).toBe(0)
        expect(leader.lastApplied).toBe(0)
        expect(nodes.get(1)?.commitIndex).toBe(-1)

        clock.runUntil(200)
        deliver()
        expect(nodes.get(1)?.commitIndex).toBe(0)
        expect(nodes.get(1)?.lastApplied).toBe(0)
    })

    test("preserves Raft persistent state when restarting a leader", () => {
        const clock = new VirtualClock()
        const messages: Message[] = []
        const nodes = new Map<number, RaftNode>()
        const deliver = () => {
            while (messages.length) {
                const message = messages.shift()!
                nodes.get(message.to)?.receive(message)
            }
        }

        for (const [id, timeout] of [100, 200, 300].entries()) {
            const node = new RaftNode(id, [0, 1, 2].filter((peer) => peer !== id), clock, (message) => messages.push(message), timeout, () => 0)
            nodes.set(id, node)
            node.start()
        }

        clock.runUntil(100)
        deliver()

        const leader = nodes.get(0)!
        leader.propose("set x=1")
        deliver()
        leader.reset()

        expect(leader.state).toBe("follower")
        expect(leader.currentTerm).toBe(1)
        expect(leader.votedFor).toBe(0)
        expect(leader.logs).toEqual([{ term: 1, command: "set x=1" }])

        clock.runUntil(200)
        deliver()
        expect(leader.state).toBe("leader")
        expect(leader.currentTerm).toBe(2)
    })

    test("does not reset a follower timer when it rejects an outdated candidate", () => {
        const clock = new VirtualClock()
        const node = new RaftNode(0, [1], clock, () => {}, 100, () => 0)
        node.logs.push({ term: 1, command: "committed" })
        node.start()

        clock.runUntil(50)
        node.receive({
            type: "RequestVote",
            from: 1,
            to: 0,
            term: 1,
            lastLogIndex: -1,
            lastLogTerm: 0,
        })

        clock.runUntil(100)
        expect(node.state).toBe("candidate")
        expect(node.currentTerm).toBe(2)
    })

    test("breaks a split vote by choosing a new timeout for each election", () => {
        const clock = new VirtualClock()
        const messages: Message[] = []
        const nodes = new Map<number, RaftNode>()
        const randomValues = [[0, 0], [0, 0.5], [0, 0.9]]
        const deliver = () => {
            while (messages.length) {
                const message = messages.shift()!
                nodes.get(message.to)?.receive(message)
            }
        }

        for (const id of [0, 1, 2]) {
            const values = randomValues[id]!
            const node = new RaftNode(id, [0, 1, 2].filter((peer) => peer !== id), clock, (message) => messages.push(message), 100, () => values.shift() ?? 0)
            nodes.set(id, node)
            node.start()
        }

        clock.runUntil(100)
        deliver()
        expect([...nodes.values()].every((node) => node.state === "candidate")).toBe(true)

        clock.runUntil(200)
        deliver()
        expect(nodes.get(0)?.state).toBe("leader")
    })
})
