const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
console.log('child=' + child.pid)
setTimeout(() => {}, 60000)
