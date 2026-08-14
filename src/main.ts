import index from "./index.html"

const port = Number(process.env.PORT ?? 3000)

Bun.serve({
    port,
    routes: {
        "/": index,
    },
    development: {
        hmr: true,
        console: true,
    },
})

console.log(`Raft visualization is running at http://localhost:${port}`)
