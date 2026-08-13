
/// 仮想時刻を進めるためのタスクを表す型
export type ScheduledTask = {
    /// タスクの識別子
    id: number
    /// タスクが実行される予定の仮想時刻（ミリ秒）
    at: number
    /// タスクの実行内容を表すコールバック関数
    callback: () => void
}

/**
 * Raftシミュレータ内での仮想時刻を表すためのインターフェース
 */
export class VirtualClock {
    /// 現在の仮想時刻をミリ秒単位で表す
    private nowMs: number = 0
    /// タスクの識別子を生成するためのカウンタ
    private nextId: number = 0

    /// 仮想時刻を進めるためのタスクの一覧
    private tasks: ScheduledTask[] = []

    /// 現在の仮想時刻を取得する
    get now(): number {
        return this.nowMs
    }

    /**
     * 指定した遅延時間後にタスクを実行するようにスケジュールする
     * @param delayMs 現在時間からタスクが実行されるまでの遅延時間（ミリ秒）
     * @param callback タスクの実行内容を表すコールバック関数
     * @returns タスクの識別子
     */
    schedule(delayMs: number, callback: () => void): number {
        const task: ScheduledTask = {
            id: this.nextId++,
            at: this.nowMs + delayMs,
            callback: callback
        }
        this.tasks.push(task)
        // タスクを実行予定時刻でソートする
        // FIXME: ノード数・イベント数が増えたら、ここでのソートがボトルネックになる可能性があるので、優先度付きキューを使うなどの改善が必要
        this.tasks.sort((a, b) => a.at - b.at)

        return task.id
    }

    /// 指定したタスクをキャンセルする
    cancel(taskId: number): void {
        this.tasks = this.tasks.filter(task => task.id !== taskId)
    }

    /**
     * 次のイベントまで時間を進める
     */
    runNext(): boolean {
        const task = this.tasks.shift()
        if (!task) {
            return false
        }
        // 時刻を確定し、イベントを生起する
        this.nowMs = task.at
        task.callback()

        return true
    }

    /**
     * 指定した時刻までの全イベントを順に処理する
     * @param targetMs 進んだ後の時刻
     */
    runUntil(targetMs: number): void {
        while (this.tasks.length > 0 && this.tasks[0].at <= targetMs) {
            this.runNext()
        }
        // 最後に時刻をtargetMsまで進める
        this.nowMs = targetMs
    }

    /**
     * イベントが存在する限り実行する
     */
    run(): void {
        while (this.tasks.length > 0) {
            this.runNext()
        }
    }
}